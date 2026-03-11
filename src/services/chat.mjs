import { all, get, run } from '../db.mjs';
import { generateId } from '../utils/ids.mjs';
import { executeAnalyticsIntent } from './queryEngine.mjs';
import { getDashboard, getLatestDashboard } from './dashboards.mjs';
import { config } from '../config.mjs';
import { generateReport } from './reports.mjs';
import { createGoal } from './goals.mjs';
import { logAudit } from './audit.mjs';
import { inspectDatasetQuestion } from './dataProfile.mjs';
import { resolvePublicErrorMessage } from '../http/response.mjs';
import {
  applyConversationApproval,
  ConversationAgentError,
  runConversationAgent,
} from './conversationAgent.mjs';
import { getConversationAgentState } from './conversationState.mjs';

const DEFAULT_CONVERSATION_TITLE = 'Percakapan baru';
const AUTO_TITLE_MAX_LENGTH = 56;

export class ConversationNotFoundError extends Error {
  constructor(conversationId = null) {
    super('Percakapan tidak ditemukan.');
    this.name = 'ConversationNotFoundError';
    this.code = 'CONVERSATION_NOT_FOUND';
    this.statusCode = 404;
    this.conversationId = conversationId;
  }
}

export class ChatRequestError extends Error {
  constructor(code = 'CHAT_REQUEST_INVALID', message = 'Permintaan chat tidak valid.', statusCode = 400) {
    super(message);
    this.name = 'ChatRequestError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class DatasetRequiredError extends ChatRequestError {
  constructor() {
    super(
      'DATASET_REQUIRED',
      'Dataset belum tersedia. Upload file data dulu (CSV/JSON/XLSX/XLS) atau gunakan Demo Dataset, lalu coba pertanyaan ini lagi.',
      400,
    );
  }
}

function normalizeTimelineEventTitle(value = '', fallback = 'Langkah agent') {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

function createBufferedTimelineStream(stream = null) {
  if (!stream) {
    return {
      hooks: null,
      finalize() {},
    };
  }

  let timelineId = null;
  let timelineVisible = false;
  let timelineTitle = 'Proses analisis';
  const bufferedSteps = [];
  const seenAgents = new Set();

  const startTimelineIfNeeded = () => {
    if (timelineVisible || typeof stream.onTimelineStart !== 'function') {
      return;
    }
    timelineVisible = true;
    timelineId = timelineId || generateId();
    stream.onTimelineStart({
      timeline_id: timelineId,
      title: timelineTitle,
    });
    for (const step of bufferedSteps) {
      if (typeof stream.onTimelineStep === 'function') {
        stream.onTimelineStep(step);
      }
    }
    bufferedSteps.length = 0;
  };

  const markComplex = (nextTitle = 'Proses analisis') => {
    if (String(nextTitle || '').trim()) {
      timelineTitle = String(nextTitle).trim();
    }
    startTimelineIfNeeded();
  };

  const maybeMarkComplexFromEvent = (event = {}) => {
    const title = String(event.title || event.label || '').toLowerCase();
    if (
      event.status === 'error'
      || /retry|ulang|fallback|degrad|gagal|review/i.test(title)
    ) {
      markComplex();
    }
  };

  const noteAgent = (agent) => {
    const normalized = String(agent || '').trim().toLowerCase();
    if (!normalized) {
      return;
    }
    seenAgents.add(normalized);
    if (seenAgents.size > 2) {
      markComplex();
    }
  };

  const pushStep = (step = {}) => {
    const payload = {
      timeline_id: timelineId || generateId(),
      ...step,
    };
    timelineId = payload.timeline_id;
    if (timelineVisible && typeof stream.onTimelineStep === 'function') {
      stream.onTimelineStep(payload);
      return;
    }
    bufferedSteps.push(payload);
  };

  return {
    hooks: {
      onAgentStart: (event) => {
        noteAgent(event.agent);
        pushStep({
          id: `agent_start_${event.run_id || Date.now()}_${String(event.agent || 'agent').toLowerCase()}`,
          agent: String(event.agent || 'agent').toLowerCase(),
          status: 'pending',
          title: normalizeTimelineEventTitle(event.title, `Memulai ${event.agent || 'agent'}`),
        });
      },
      onAgentStep: (event) => {
        noteAgent(event.agent);
        maybeMarkComplexFromEvent(event);
        pushStep({
          id: `agent_step_${event.run_id || Date.now()}_${String(event.agent || 'agent').toLowerCase()}_${normalizeTimelineEventTitle(event.title, 'Langkah agent').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
          agent: String(event.agent || 'agent').toLowerCase(),
          status: event.status || 'done',
          title: normalizeTimelineEventTitle(event.title),
        });
      },
      onTimelineEvent: (event) => {
        noteAgent(event.agent);
        maybeMarkComplexFromEvent(event);
        pushStep(event);
      },
      onDashboardPatch: (patch) => {
        markComplex();
        if (typeof stream.onDashboardPatch === 'function') {
          stream.onDashboardPatch(patch);
        }
      },
      onApprovalRequired: (payload) => {
        markComplex();
        if (typeof stream.onApprovalRequired === 'function') {
          stream.onApprovalRequired(payload);
        }
        pushStep({
          id: `approval_${payload.approval?.id || Date.now()}`,
          agent: 'tala',
          status: 'pending',
          title: normalizeTimelineEventTitle(payload.approval?.title, 'Menunggu persetujuan perbaikan data'),
        });
      },
    },
    finalize() {
      if (timelineVisible && typeof stream.onTimelineDone === 'function') {
        stream.onTimelineDone({
          timeline_id: timelineId,
        });
      }
    },
  };
}

function isDefaultConversationTitle(title) {
  return String(title || '').trim().toLowerCase() === DEFAULT_CONVERSATION_TITLE.toLowerCase();
}

function buildConversationTitle(input) {
  const cleaned = String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (!cleaned) {
    return DEFAULT_CONVERSATION_TITLE;
  }

  const withoutCommand = cleaned
    .replace(/^(tolong|please|coba|bantu|bisa|mohon)\s+/i, '')
    .trim();
  const firstSentence = withoutCommand.split(/[.!?\n]/, 1)[0].trim() || withoutCommand;
  const normalized = firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);

  if (normalized.length <= AUTO_TITLE_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, AUTO_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

function ensureConversation(tenantId, userId, conversationId = null) {
  if (conversationId) {
    const existing = get(
      `
        SELECT * FROM conversations
        WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
      `,
      { id: conversationId, tenant_id: tenantId, user_id: userId },
    );

    if (existing) {
      return existing;
    }

    throw new ConversationNotFoundError(conversationId);
  }

  const latest = get(
    `
      SELECT c.*
      FROM conversations c
      WHERE c.tenant_id = :tenant_id
        AND c.user_id = :user_id
      ORDER BY COALESCE(
        (
          SELECT m.created_at
          FROM chat_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ),
        c.created_at
      ) DESC,
      c.created_at DESC
      LIMIT 1
    `,
    {
      tenant_id: tenantId,
      user_id: userId,
    },
  );

  if (latest) {
    return latest;
  }

  const id = generateId();
  run(
    `
      INSERT INTO conversations (id, tenant_id, user_id, title, created_at)
      VALUES (:id, :tenant_id, :user_id, :title, :created_at)
    `,
    {
      id,
      tenant_id: tenantId,
      user_id: userId,
      title: DEFAULT_CONVERSATION_TITLE,
      created_at: new Date().toISOString(),
    },
  );

  return get(
    `SELECT * FROM conversations WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id`,
    { id, tenant_id: tenantId, user_id: userId },
  );
}

function touchConversation(tenantId, userId, conversationId) {
  const conversation = get(
    `
      SELECT c.id, c.title, c.created_at
      FROM conversations c
      WHERE c.id = :id AND c.tenant_id = :tenant_id AND c.user_id = :user_id
      LIMIT 1
    `,
    {
      id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
    },
  );

  if (!conversation) {
    return null;
  }

  return {
    ...conversation,
    last_message_at: get(
      `
        SELECT created_at
        FROM chat_messages
        WHERE conversation_id = :conversation_id
        ORDER BY created_at DESC
        LIMIT 1
      `,
      { conversation_id: conversationId },
    )?.created_at || conversation.created_at,
  };
}

function createMessage({ conversationId, tenantId, userId, role, content, payload = null }) {
  const id = generateId();
  run(
    `
      INSERT INTO chat_messages (id, conversation_id, tenant_id, user_id, role, content, payload_json, created_at)
      VALUES (:id, :conversation_id, :tenant_id, :user_id, :role, :content, :payload_json, :created_at)
    `,
    {
      id,
      conversation_id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
      role,
      content,
      payload_json: payload ? JSON.stringify(payload) : null,
      created_at: new Date().toISOString(),
    },
  );

  return id;
}

function persistAssistantMessage({
  conversationId,
  tenantId,
  content,
  payload,
}) {
  createMessage({
    conversationId,
    tenantId,
    userId: null,
    role: 'assistant',
    content,
    payload,
  });
}

function persistAssistantErrorMessage({
  conversationId,
  tenantId,
  error,
  intent = null,
}) {
  const message = resolvePublicErrorMessage(error, 'Permintaan tidak dapat diproses.');
  const payload = {
    answer: message,
    widgets: [],
    artifacts: [],
    intent,
    presentation_mode: 'chat',
    error: {
      code: error?.code || 'CHAT_FAILED',
      message,
      status: error?.statusCode || 500,
      persistedInConversation: true,
    },
  };

  createMessage({
    conversationId,
    tenantId,
    userId: null,
    role: 'assistant',
    content: payload.answer,
    payload,
  });

  if (error && typeof error === 'object') {
    error.persistedInConversation = true;
  }
}

function attachConversationContext(error, conversationId) {
  if (!error || !conversationId) {
    return error;
  }
  if (!error.conversationId) {
    error.conversationId = conversationId;
  }
  return error;
}

function maybeAutoTitleConversation({ tenantId, userId, conversationId, message }) {
  const conversation = get(
    `
      SELECT id, title
      FROM conversations
      WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
      LIMIT 1
    `,
    {
      id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
    },
  );

  if (!conversation || !isDefaultConversationTitle(conversation.title)) {
    return conversation;
  }

  const userMessageCount = get(
    `
      SELECT COUNT(*) AS value
      FROM chat_messages
      WHERE conversation_id = :conversation_id
        AND tenant_id = :tenant_id
        AND role = 'user'
    `,
    {
      conversation_id: conversationId,
      tenant_id: tenantId,
    },
  )?.value || 0;

  if (Number(userMessageCount) !== 1) {
    return conversation;
  }

  const nextTitle = buildConversationTitle(message);
  run(
    `
      UPDATE conversations
      SET title = :title
      WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
    `,
    {
      id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
      title: nextTitle,
    },
  );

  return get(
    `
      SELECT id, title, created_at
      FROM conversations
      WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
      LIMIT 1
    `,
    {
      id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
    },
  );
}

function getConversationWithStats(tenantId, userId, conversationId) {
  const conversation = get(
    `
      SELECT c.id, c.title, c.created_at
      FROM conversations c
      WHERE c.id = :id AND c.tenant_id = :tenant_id AND c.user_id = :user_id
      LIMIT 1
    `,
    {
      id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
    },
  );

  if (!conversation) {
    return null;
  }

  const lastMessage = get(
    `
      SELECT role, content, created_at
      FROM chat_messages
      WHERE conversation_id = :conversation_id
      ORDER BY created_at DESC
      LIMIT 1
    `,
    { conversation_id: conversationId },
  );

  const messageCount = get(
    `
      SELECT COUNT(*) AS value
      FROM chat_messages
      WHERE conversation_id = :conversation_id
    `,
    { conversation_id: conversationId },
  )?.value || 0;

  return {
    ...conversation,
    title: String(conversation.title || '').trim() || DEFAULT_CONVERSATION_TITLE,
    message_count: Number(messageCount || 0),
    last_message_at: lastMessage?.created_at || conversation.created_at,
    last_message_preview: String(lastMessage?.content || '').replace(/\s+/g, ' ').trim(),
    last_message_role: lastMessage?.role || null,
  };
}

function historyForConversation(tenantId, userId, conversationId, limit = 50) {
  return all(
    `
      SELECT id, role, content, payload_json, feedback, created_at
      FROM chat_messages
      WHERE tenant_id = :tenant_id
        AND conversation_id = :conversation_id
        AND (user_id = :user_id OR user_id IS NULL)
      ORDER BY created_at ASC
      LIMIT :limit
    `,
    {
      tenant_id: tenantId,
      conversation_id: conversationId,
      user_id: userId,
      limit,
    },
  ).map((item) => ({
    ...item,
    payload: item.payload_json ? JSON.parse(item.payload_json) : null,
  }));
}

function parseGoalFromMessage(message, intent) {
  if (intent.target_value) {
    return intent.target_value;
  }
  const match = message.match(/(\d+[\d.,]*)/);
  if (!match) {
    return null;
  }
  const raw = match[1].replace(/\./g, '').replace(/,/g, '.');
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function normalizeReportPeriod(intent) {
  if (intent.time_period) {
    return intent.time_period;
  }
  return 'minggu ini';
}

function isComplexDashboardRequest(message, intent) {
  const text = String(message || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) {
    return false;
  }

  const hasCanvas = /\b(canvas|kanvas)\b/.test(text);
  const hasDashboard = /\bdashboard\b/.test(text);
  const hasBuildVerb = /\b(buat|buatkan|bikin|generate|susun|siapkan|bangun|create)\b/.test(text);
  const hasComplexQualifier = /\b(lengkap|komplet|full|penuh|multi|beberapa|overview|ringkasan)\b/.test(text);
  const hasVisualTerms = (text.match(/\b(grafik|chart|tabel|widget|visual)\b/g) || []).length;

  if (hasCanvas) {
    return true;
  }

  if (hasDashboard && (hasBuildVerb || hasComplexQualifier || hasVisualTerms >= 1)) {
    return true;
  }

  if (hasVisualTerms >= 2 && hasBuildVerb) {
    return true;
  }

  if (intent.intent === 'modify_dashboard') {
    return hasDashboard || hasCanvas || /\b(widget|layout|komponen|panel)\b/.test(text);
  }

  return false;
}

function hasDataset(tenantId) {
  const readySource = get(
    `
      SELECT id, row_count
      FROM source_files
      WHERE tenant_id = :tenant_id
        AND status = 'ready'
      ORDER BY upload_date DESC
      LIMIT 1
    `,
    { tenant_id: tenantId },
  );

  if (readySource && Number(readySource.row_count || 0) > 0) {
    return true;
  }

  const txCount = get(`SELECT COUNT(*) AS value FROM transactions WHERE tenant_id = :tenant_id`, {
    tenant_id: tenantId,
  }) || { value: 0 };

  const expenseCount = get(`SELECT COUNT(*) AS value FROM expenses WHERE tenant_id = :tenant_id`, {
    tenant_id: tenantId,
  }) || { value: 0 };

  const storedRows = Number(txCount.value || 0) + Number(expenseCount.value || 0);
  return storedRows > 0;
}

function widgetsToArtifacts(widgets = []) {
  return widgets
    .map((widget) => {
      if (widget.type === 'MetricCard') {
        return {
          kind: 'metric',
          title: widget.title,
          value: widget.displayValue || String(widget.value || 0),
          delta: widget.comparison || null,
        };
      }

      if (widget.type === 'TrendChart') {
        return {
          kind: 'chart',
          chart_type: 'line',
          title: widget.title,
          labels: (widget.points || []).map((point) => point.label),
          series: [
            {
              name: widget.title,
              values: (widget.points || []).map((point) => Number(point.value || 0)),
            },
          ],
        };
      }

      if (widget.type === 'TopList') {
        return {
          kind: 'table',
          title: widget.title,
          columns: ['name', 'value'],
          rows: (widget.items || []).map((item) => ({
            name: item.name || item.label || 'Item',
            value: item.total_revenue ?? item.revenue ?? item.value ?? 0,
          })),
        };
      }

      return null;
    })
    .filter(Boolean);
}

function lookupUserDisplayName(tenantId, userId) {
  if (!tenantId || !userId) {
    return null;
  }
  const row = get(
    `
      SELECT name
      FROM users
      WHERE id = :id AND tenant_id = :tenant_id
      LIMIT 1
    `,
    {
      id: userId,
      tenant_id: tenantId,
    },
  );
  const name = String(row?.name || '').trim();
  return name || null;
}

async function generateConversationalReply({ message, history, datasetReady, userDisplayName }) {
  const contextParts = [
    'Kamu adalah Vistara, asisten AI analitik bisnis UMKM berbahasa Indonesia.',
    'Jawab dengan singkat, ramah, dan natural. Maksimal 2-3 kalimat.',
    'Jika user menyapa, balas sapaan dengan hangat.',
    'Jika user bertanya kemampuanmu, jelaskan bahwa kamu bisa menganalisis data bisnis, membuat dashboard, menunjukkan tren penjualan, membandingkan performa, dan membuat laporan.',
    'Jika user berterima kasih atau memberikan respon positif, balas dengan sopan.',
    'Jika user bertanya nama mereka, ' + (userDisplayName ? `nama mereka adalah ${userDisplayName}.` : 'katakan bahwa kamu belum mengetahui nama mereka dan sarankan untuk mengisi profil di Pengaturan.'),
    datasetReady
      ? 'Dataset user sudah tersedia dan siap dianalisis.'
      : 'Dataset user belum tersedia. Sarankan untuk upload dataset (CSV/JSON/XLSX/XLS) jika relevan, tapi jangan memaksa.',
  ];

  const historyContext = history.slice(-6).map((h) => `${h.role}: ${h.content}`).join('\n');
  const userPrompt = historyContext
    ? `Riwayat percakapan:\n${historyContext}\n\nPesan terbaru user: ${message}`
    : `Pesan user: ${message}`;

  const result = await generateTextWithGemini({
    systemPrompt: contextParts.join(' '),
    userPrompt,
    temperature: 0.7,
    maxOutputTokens: 150,
  });

  if (result.ok && result.text) {
    return result.text.trim();
  }

  return 'Saya siap membantu. Ada yang bisa saya bantu terkait analisis bisnis Anda?';
}

function buildDashboardAgentError(error, options = {}) {
  if (error instanceof DashboardAgentError) {
    return error;
  }

  const message = String(error?.message || '').trim().toLowerCase();
  if (message === 'missing_api_key' || message.includes('not configured')) {
    return new DashboardAgentError({
      code: 'AI_SERVICE_UNAVAILABLE',
      message: 'Layanan AI belum tersedia untuk membuat dashboard.',
      statusCode: 503,
      retryable: false,
      reason: 'missing_api_key',
      details: options.details ?? null,
    });
  }

  if (message === 'dashboard_agent_timeout') {
    return new DashboardAgentError({
      code: 'AI_SERVICE_TIMEOUT',
      message: 'Layanan AI terlalu lama merespons saat membuat dashboard. Coba lagi.',
      statusCode: 504,
      retryable: true,
      reason: 'dashboard_agent_timeout',
      details: options.details ?? null,
    });
  }

  if (message.includes('quota')) {
    return new DashboardAgentError({
      code: 'AI_QUOTA_EXHAUSTED',
      message: 'Kuota AI sedang habis. Coba lagi beberapa saat.',
      statusCode: 429,
      retryable: false,
      reason: 'quota_exhausted',
      details: options.details ?? null,
    });
  }

  if (
    message.includes('network')
    || message.includes('fetch')
    || message.includes('invalid_json')
    || /^http_5\d\d$/.test(message)
  ) {
    return new DashboardAgentError({
      code: 'AI_SERVICE_UNAVAILABLE',
      message: 'Layanan AI sedang bermasalah saat membuat dashboard. Coba lagi.',
      statusCode: 503,
      retryable: true,
      reason: error?.reason || message || 'ai_service_unavailable',
      details: error?.details ?? options.details ?? null,
    });
  }

  return new DashboardAgentError({
    code: error?.code || 'DASHBOARD_AGENT_FAILED',
    message: resolvePublicErrorMessage(error, 'Gagal membuat dashboard. Coba lagi.'),
    statusCode: error?.statusCode || 503,
    retryable: Boolean(error?.retryable),
    reason: error?.reason || error?.code || 'dashboard_agent_failed',
    details: null,
  });
}

function shouldRetryDashboardFailure(error) {
  return error instanceof DashboardAgentError && Boolean(error.retryable);
}

export async function processChatMessage({
  tenantId,
  userId,
  message,
  conversationId,
  dashboardId,
  stream = null,
}) {
  let conversation = ensureConversation(tenantId, userId, conversationId);
  createMessage({
    conversationId: conversation.id,
    tenantId,
    userId,
    role: 'user',
    content: message,
  });
  conversation = maybeAutoTitleConversation({
    tenantId,
    userId,
    conversationId: conversation.id,
    message,
  }) || conversation;

  const history = historyForConversation(tenantId, userId, conversation.id, 12).map((item) => ({
    role: item.role,
    content: item.content,
  }));

  const datasetReady = hasDataset(tenantId);
  const userDisplayName = lookupUserDisplayName(tenantId, userId);
  const savedDashboard = dashboardId
    ? getDashboard(tenantId, userId, dashboardId)
    : getLatestDashboard(tenantId, userId);

  let responsePayload = null;
  const bufferedStream = createBufferedTimelineStream(stream);

  try {
    responsePayload = await runConversationAgent({
      tenantId,
      userId,
      conversationId: conversation.id,
      dashboardId,
      savedDashboard,
      message,
      history,
      datasetReady,
      userDisplayName,
      hooks: bufferedStream.hooks,
    });
  } catch (error) {
    const fallbackIntent = error instanceof ConversationAgentError
      ? { intent: 'conversation', nlu_source: 'atlas_gemini' }
      : null;
    persistAssistantErrorMessage({
      conversationId: conversation.id,
      tenantId,
      error,
      intent: fallbackIntent,
    });
    throw attachConversationContext(error, conversation.id);
  } finally {
    bufferedStream.finalize();
  }

  persistAssistantMessage({
    conversationId: conversation.id,
    tenantId,
    content: responsePayload.answer,
    payload: responsePayload,
  });

  const intent = responsePayload.intent || {
    intent: 'conversation',
    nlu_source: 'atlas_gemini',
  };

  logAudit({
    tenantId,
    userId,
    action: 'chat_message',
    resourceType: 'conversation',
    resourceId: conversation.id,
    metadata: {
      intent: intent.intent,
      nlu_source: intent.nlu_source,
    },
  });

  return {
    conversation_id: conversation.id,
    conversation: getConversationWithStats(tenantId, userId, conversation.id),
    ...responsePayload,
  };
}

export function getChatHistory({ tenantId, userId, conversationId = null }) {
  const convo = ensureConversation(tenantId, userId, conversationId);
  const agentState = getConversationAgentState({
    tenantId,
    userId,
    conversationId: convo.id,
  });
  return {
    conversation_id: convo.id,
    conversation: getConversationWithStats(tenantId, userId, convo.id),
    messages: historyForConversation(tenantId, userId, convo.id, 200),
    agent_state: agentState,
  };
}

export async function processConversationApproval({
  tenantId,
  userId,
  conversationId,
  approvalId,
  decision,
}) {
  const conversation = ensureConversation(tenantId, userId, conversationId);
  const responsePayload = await applyConversationApproval({
    tenantId,
    userId,
    conversationId: conversation.id,
    approvalId,
    decision,
  });

  persistAssistantMessage({
    conversationId: conversation.id,
    tenantId,
    content: responsePayload.answer,
    payload: responsePayload,
  });

  return {
    conversation_id: conversation.id,
    conversation: getConversationWithStats(tenantId, userId, conversation.id),
    ...responsePayload,
  };
}


export function listChatConversations({ tenantId, userId, limit = 100 }) {
  return all(
    `
      SELECT
        c.id,
        c.title,
        c.created_at,
        COALESCE(
          (
            SELECT m.created_at
            FROM chat_messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ),
          c.created_at
        ) AS last_message_at,
        COALESCE(
          (
            SELECT m.content
            FROM chat_messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ),
          ''
        ) AS last_message_preview,
        COALESCE(
          (
            SELECT m.role
            FROM chat_messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ),
          NULL
        ) AS last_message_role,
        (
          SELECT COUNT(*)
          FROM chat_messages m
          WHERE m.conversation_id = c.id
        ) AS message_count
      FROM conversations c
      WHERE c.tenant_id = :tenant_id
        AND c.user_id = :user_id
      ORDER BY datetime(last_message_at) DESC, datetime(c.created_at) DESC
      LIMIT :limit
    `,
    {
      tenant_id: tenantId,
      user_id: userId,
      limit,
    },
  ).map((item) => ({
    ...item,
    title: String(item.title || '').trim() || DEFAULT_CONVERSATION_TITLE,
    message_count: Number(item.message_count || 0),
    last_message_preview: String(item.last_message_preview || '').replace(/\s+/g, ' ').trim(),
  }));
}

export function createConversation({ tenantId, userId, title = null }) {
  const id = generateId();
  const createdAt = new Date().toISOString();
  run(
    `
      INSERT INTO conversations (id, tenant_id, user_id, title, created_at)
      VALUES (:id, :tenant_id, :user_id, :title, :created_at)
    `,
    {
      id,
      tenant_id: tenantId,
      user_id: userId,
      title: DEFAULT_CONVERSATION_TITLE,
      created_at: createdAt,
    },
  );

  const conversation = get(
    `
      SELECT *
      FROM conversations
      WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
      LIMIT 1
    `,
    {
      id,
      tenant_id: tenantId,
      user_id: userId,
    },
  );
  const nextTitle = String(title || '').trim();

  if (nextTitle) {
    run(
      `
        UPDATE conversations
        SET title = :title
        WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
      `,
      {
        id: conversation.id,
        tenant_id: tenantId,
        user_id: userId,
        title: buildConversationTitle(nextTitle),
      },
    );
  }

  const created = getConversationWithStats(tenantId, userId, conversation.id);
  logAudit({
    tenantId,
    userId,
    action: 'conversation_create',
    resourceType: 'conversation',
    resourceId: conversation.id,
    metadata: { title: created?.title || DEFAULT_CONVERSATION_TITLE },
  });
  return created;
}

export function renameConversation({ tenantId, userId, conversationId, title }) {
  const existing = getConversationWithStats(tenantId, userId, conversationId);
  if (!existing) {
    return null;
  }

  const nextTitle = buildConversationTitle(title);
  run(
    `
      UPDATE conversations
      SET title = :title
      WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
    `,
    {
      id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
      title: nextTitle,
    },
  );

  logAudit({
    tenantId,
    userId,
    action: 'conversation_rename',
    resourceType: 'conversation',
    resourceId: conversationId,
    metadata: { title: nextTitle },
  });

  return getConversationWithStats(tenantId, userId, conversationId);
}

export function deleteConversation({ tenantId, userId, conversationId }) {
  const existing = getConversationWithStats(tenantId, userId, conversationId);
  if (!existing) {
    return false;
  }

  run(
    `
      DELETE FROM conversations
      WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
    `,
    {
      id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
    },
  );

  logAudit({
    tenantId,
    userId,
    action: 'conversation_delete',
    resourceType: 'conversation',
    resourceId: conversationId,
    metadata: { title: existing.title },
  });

  return true;
}

export function setChatFeedback({ tenantId, userId, messageId, feedback }) {
  const target = get(
    `
      SELECT id
      FROM chat_messages
      WHERE id = :id AND tenant_id = :tenant_id
    `,
    { id: messageId, tenant_id: tenantId },
  );

  if (!target) {
    return false;
  }

  run(
    `
      UPDATE chat_messages
      SET feedback = :feedback
      WHERE id = :id AND tenant_id = :tenant_id
    `,
    {
      id: messageId,
      tenant_id: tenantId,
      feedback,
    },
  );

  logAudit({
    tenantId,
    userId,
    action: 'chat_feedback',
    resourceType: 'chat_message',
    resourceId: messageId,
    metadata: { feedback },
  });

  return true;
}
