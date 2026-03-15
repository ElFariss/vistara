import { all, get, run } from '../db.mjs';
import { generateId } from '../utils/ids.mjs';
import { executeAnalyticsIntent } from './queryEngine.mjs';
import {
  createDashboard,
  getDashboard,
  getLatestDashboard,
  getLatestDashboardForConversation,
  updateDashboard,
} from './dashboards.mjs';
import { config } from '../config.mjs';
import { Prompts } from './agents/index.mjs';
import { generateReport } from './reports.mjs';
import { createGoal } from './goals.mjs';
import { logAudit } from './audit.mjs';
import { getDatasetProfile, inspectDatasetQuestion } from './dataProfile.mjs';
import { ensureSourcesProcessed } from './ingestion.mjs';
import { resolvePublicErrorMessage } from '../http/response.mjs';
import { createLogger } from '../utils/logger.mjs';
import {
  applyConversationApproval,
  runConversationAgent,
} from './agentProxy.mjs';
import {
  ensureConversationAgentState,
  getConversationAgentState,
  updateConversationAgentState,
} from './conversationState.mjs';

// Minimal error class for proxy error type checking (legacy runtime)
class ConversationAgentError extends Error {
  constructor({ code, statusCode, reason, message: msg }) {
    super(msg);
    this.code = code;
    this.statusCode = statusCode;
    this.reason = reason;
  }
}

const logger = createLogger('chat-service');
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

  const TEAM_AGENTS = new Set(['analyst', 'raka', 'planner', 'worker', 'citra', 'curator', 'argus', 'engineer', 'tala']);

  const noteAgent = (agent) => {
    const normalized = String(agent || '').trim().toLowerCase();
    if (!normalized) {
      return;
    }
    seenAgents.add(normalized);
    // Show timeline immediately when a team agent appears (not just orchestrator/surface)
    if (TEAM_AGENTS.has(normalized)) {
      startTimelineIfNeeded();
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
      onAgentDialogue: (entry) => {
        noteAgent(entry?.from);
        noteAgent(entry?.to);
        markComplex('Diskusi agent');
        if (typeof stream.onAgentDialogue === 'function') {
          stream.onAgentDialogue(entry);
        }
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
async function ensureConversation(tenantId, userId, conversationId = null) {
  if (conversationId) {
    const existing = await get(
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

  const latest = await get(
    `
      SELECT c.*
      FROM conversations c
      LEFT JOIN (
        SELECT conversation_id, MAX(created_at) AS last_message_at
        FROM chat_messages
        GROUP BY conversation_id
      ) lm ON lm.conversation_id = c.id
      WHERE c.tenant_id = :tenant_id
        AND c.user_id = :user_id
      ORDER BY COALESCE(lm.last_message_at, c.created_at) DESC,
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
  await run(
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

async function touchConversation(tenantId, userId, conversationId) {
  const conversation = await get(
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
    last_message_at: (await get(
      `
        SELECT created_at
        FROM chat_messages
        WHERE conversation_id = :conversation_id
        ORDER BY created_at DESC
        LIMIT 1
      `,
      { conversation_id: conversationId },
    ))?.created_at || conversation.created_at,
  };
}

async function createMessage({ conversationId, tenantId, userId, role, content, payload = null }) {
  const id = generateId();
  await run(
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

async function persistAssistantMessage({
  conversationId,
  tenantId,
  content,
  payload,
}) {
  await createMessage({
    conversationId,
    tenantId,
    userId: null,
    role: 'assistant',
    content,
    payload,
  });
}

async function persistAssistantErrorMessage({
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

  await createMessage({
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

async function maybeAutoTitleConversation({ tenantId, userId, conversationId, message }) {
  const conversation = await get(
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

  const userMessageCount = await get(
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

  const nextTitle = _safeTitle(message);
  await run(
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

async function getConversationWithStats(tenantId, userId, conversationId) {
  const conversation = await get(
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

  const lastMessage = await get(
    `
      SELECT role, content, created_at
      FROM chat_messages
      WHERE conversation_id = :conversation_id
      ORDER BY created_at DESC
      LIMIT 1
    `,
    { conversation_id: conversationId },
  );

  const messageCount = await get(
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

async function historyForConversation(tenantId, userId, conversationId, limit = 50) {
  return (await all(
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
  )).map((item) => ({
    ...item,
    payload: item.payload_json ? JSON.parse(item.payload_json) : null,
  }));
}

// Title helper — just trim and truncate, NO regex text manipulation.
// The Python agent generates proper titles via LLM when needed.
function _safeTitle(input) {
  const cleaned = String(input || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return DEFAULT_CONVERSATION_TITLE;
  if (cleaned.length <= AUTO_TITLE_MAX_LENGTH) return cleaned;
  return `${cleaned.slice(0, AUTO_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

async function hasDataset(tenantId) {
  const latestReady = await get(
    `
      SELECT id
      FROM source_files
      WHERE tenant_id = :tenant_id
        AND status = 'ready'
      ORDER BY upload_date DESC
      LIMIT 1
    `,
    { tenant_id: tenantId },
  );

  if (latestReady) {
    return true;
  }

  const txCount = await get(`SELECT COUNT(*) AS value FROM transactions WHERE tenant_id = :tenant_id`, {
    tenant_id: tenantId,
  }) || { value: 0 };

  const expenseCount = await get(`SELECT COUNT(*) AS value FROM expenses WHERE tenant_id = :tenant_id`, {
    tenant_id: tenantId,
  }) || { value: 0 };

  const storedRows = Number(txCount.value || 0) + Number(expenseCount.value || 0);
  return storedRows > 0;
}

async function enforceDemoLimit({ tenantId, userId, role, limit }) {
  if (role !== 'demo') {
    return;
  }
  const row = await get(
    `
      SELECT COUNT(*) AS value
      FROM chat_messages
      WHERE tenant_id = :tenant_id
        AND user_id = :user_id
        AND role = 'user'
    `,
    { tenant_id: tenantId, user_id: userId },
  ) || { value: 0 };
  const used = Number(row.value || 0);
  if (used >= limit) {
    throw new ChatRequestError(
      'DEMO_LIMIT',
      `Batas demo ${limit} pertanyaan sudah tercapai. Mulai ulang demo atau daftar untuk akses penuh.`,
      429,
    );
  }
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

async function lookupUserDisplayName(tenantId, userId) {
  if (!tenantId || !userId) {
    return null;
  }
  const row = await get(
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

function compactText(value, maxLength = 320) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    return null;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function pageCountForWidgets(widgets = []) {
  return widgets.reduce((max, widget) => Math.max(max, Number(widget?.layout?.page || 1)), 1);
}

function normalizeDraftDashboard(draft = null, fallback = {}) {
  if (!draft || typeof draft !== 'object') {
    return null;
  }

  const widgets = Array.isArray(draft.widgets) ? draft.widgets : [];
  const artifacts = Array.isArray(draft.artifacts)
    ? draft.artifacts
    : widgets.map((widget) => widget?.artifact).filter(Boolean);

  return {
    run_id: draft.run_id || fallback.run_id || null,
    name: String(draft.name || fallback.name || 'Draft Dashboard').trim() || 'Draft Dashboard',
    goal: compactText(draft.goal || fallback.goal || fallback.message || ''),
    pages: Math.max(1, Number(draft.pages || fallback.pages || pageCountForWidgets(widgets) || 1)),
    widgets,
    artifacts,
    saved_dashboard_id: draft.saved_dashboard_id || fallback.saved_dashboard_id || null,
    note: compactText(draft.note || fallback.note || ''),
    status: String(draft.status || fallback.status || 'drafting').trim() || 'drafting',
    updated_at: draft.updated_at || fallback.updated_at || new Date().toISOString(),
  };
}

function dashboardConfigFromDraft(draftDashboard = null) {
  const normalized = normalizeDraftDashboard(draftDashboard);
  if (!normalized) {
    return null;
  }

  return {
    mode: 'ai',
    pages: Math.max(1, Number(normalized.pages || pageCountForWidgets(normalized.widgets) || 1)),
    components: normalized.widgets,
    updated_by: 'assistant',
  };
}

async function persistDashboardDraft({
  tenantId,
  userId,
  isDemo = false,
  conversationId,
  savedDashboard,
  draftDashboard,
}) {
  const normalizedDraft = normalizeDraftDashboard(draftDashboard);
  if (isDemo) {
    return {
      dashboard: null,
      draftDashboard: normalizedDraft,
    };
  }
  if (!normalizedDraft || normalizedDraft.status !== 'ready' || normalizedDraft.widgets.length === 0) {
    return {
      dashboard: savedDashboard || null,
      draftDashboard: normalizedDraft,
    };
  }

  const config = dashboardConfigFromDraft(normalizedDraft);
  const targetDashboardId = normalizedDraft.saved_dashboard_id || savedDashboard?.id || null;
  let dashboard = null;

  if (targetDashboardId) {
    dashboard = await updateDashboard(tenantId, userId, targetDashboardId, {
      name: normalizedDraft.name || savedDashboard?.name || 'Dashboard Utama',
      config,
    });
  } else {
    dashboard = await createDashboard(
      tenantId,
      userId,
      normalizedDraft.name || 'Dashboard Utama',
      config,
      { conversationId },
    );
  }

  if (!dashboard) {
    return {
      dashboard: savedDashboard || null,
      draftDashboard: normalizedDraft,
    };
  }

  return {
    dashboard,
    draftDashboard: {
      ...normalizedDraft,
      saved_dashboard_id: dashboard.id,
      name: dashboard.name || normalizedDraft.name,
      updated_at: dashboard.updated_at || new Date().toISOString(),
    },
  };
}

function finalizeAgentState({
  existingState,
  responsePayload,
  datasetProfile,
  draftDashboard,
  dashboard,
  message,
}) {
  const incoming = responsePayload?.agent_state && typeof responsePayload.agent_state === 'object'
    ? responsePayload.agent_state
    : {};
  const existingMemory = existingState?.memory && typeof existingState.memory === 'object'
    ? existingState.memory
    : {};
  const nextMemory = incoming.memory && typeof incoming.memory === 'object'
    ? { ...existingMemory, ...incoming.memory }
    : { ...existingMemory };
  const analysisBrief = responsePayload?.analysis_brief && typeof responsePayload.analysis_brief === 'object'
    ? responsePayload.analysis_brief
    : null;
  const intent = responsePayload?.intent?.intent || responsePayload?.agent?.route?.action || null;
  const isAnalyticalTurn = ['analyze', 'create_dashboard', 'modify_dashboard', 'edit_dashboard', 'inspect_dataset']
    .includes(String(intent || '').toLowerCase());

  nextMemory.last_user_goal = compactText(message, 240) || nextMemory.last_user_goal || null;
  nextMemory.last_route = compactText(responsePayload?.agent?.route?.action || intent, 80) || nextMemory.last_route || null;
  if (isAnalyticalTurn || analysisBrief) {
    nextMemory.last_analysis_summary = compactText(
      analysisBrief?.executive_summary || analysisBrief?.headline || responsePayload?.answer || nextMemory.last_analysis_summary,
      420,
    ) || nextMemory.last_analysis_summary || null;
  }
  if (draftDashboard || analysisBrief?.business_goal) {
    nextMemory.last_dashboard_goal = compactText(
      draftDashboard?.goal || analysisBrief?.business_goal || nextMemory.last_dashboard_goal,
      240,
    ) || nextMemory.last_dashboard_goal || null;
  }
  nextMemory.active_dataset_summary = compactText(
    incoming?.dataset_profile?.summary || datasetProfile?.summary || nextMemory.active_dataset_summary,
    280,
  ) || nextMemory.active_dataset_summary || null;
  if (dashboard?.id) {
    nextMemory.current_dashboard_id = dashboard.id;
    nextMemory.current_dashboard_name = dashboard.name || nextMemory.current_dashboard_name || null;
  }

  return {
    memory: nextMemory,
    dataset_profile: incoming.dataset_profile ?? datasetProfile ?? existingState?.dataset_profile ?? null,
    draft_dashboard: draftDashboard ?? incoming.draft_dashboard ?? existingState?.draft_dashboard ?? null,
    pending_approval: responsePayload?.pending_approval ?? incoming.pending_approval ?? existingState?.pending_approval ?? null,
    active_run: null,
  };
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
  userRole = null,
  message,
  conversationId,
  dashboardId,
  stream = null,
}) {
  await enforceDemoLimit({
    tenantId,
    userId,
    role: userRole,
    limit: config.demoMaxQueries,
  });

  await ensureSourcesProcessed({ tenantId, userId });

  let conversation = await ensureConversation(tenantId, userId, conversationId);
  let agentState = await ensureConversationAgentState({
    tenantId,
    userId,
    conversationId: conversation.id,
  });
  await createMessage({
    conversationId: conversation.id,
    tenantId,
    userId,
    role: 'user',
    content: message,
  });
  conversation = (await maybeAutoTitleConversation({
    tenantId,
    userId,
    conversationId: conversation.id,
    message,
  })) || conversation;

  const history = (await historyForConversation(tenantId, userId, conversation.id, 12)).map((item) => ({
    role: item.role,
    content: item.content,
  }));

  const datasetReady = await hasDataset(tenantId);
  const datasetProfile = datasetReady ? await getDatasetProfile(tenantId) : null;
  const userDisplayName = await lookupUserDisplayName(tenantId, userId);
  const savedDashboard = dashboardId
    ? await getDashboard(tenantId, userId, dashboardId)
    : await getLatestDashboardForConversation(tenantId, userId, conversation.id);

  let responsePayload = null;
  const bufferedStream = createBufferedTimelineStream(stream);
  await updateConversationAgentState({
    tenantId,
    userId,
    conversationId: conversation.id,
    activeRun: {
      status: 'running',
      message: compactText(message, 240),
      dashboard_id: dashboardId || savedDashboard?.id || null,
      started_at: new Date().toISOString(),
    },
  });

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
      datasetProfile,
      userDisplayName,
      agentState,
      hooks: bufferedStream.hooks,
    });

    // Python agent completely handles the response generation and execution.
    // We removed the analytics_intent intercept block here so Python can execute natively.
  } catch (error) {
    logger.error('process_chat_failed', {
      code: error?.code,
      statusCode: error?.statusCode,
      message: error?.message,
      stack: error?.stack,
      conversation_id: conversation?.id,
      tenant_id: tenantId,
      user_id: userId,
    });
    const fallbackIntent = error instanceof ConversationAgentError
      ? { intent: 'conversation', nlu_source: 'atlas_gemini' }
      : null;
    await persistAssistantErrorMessage({
      conversationId: conversation.id,
      tenantId,
      error,
      intent: fallbackIntent,
    });
    throw attachConversationContext(error, conversation.id);
  } finally {
    bufferedStream.finalize();
    try {
      await updateConversationAgentState({
        tenantId,
        userId,
        conversationId: conversation.id,
        activeRun: null,
      });
    } catch (stateError) {
      logger.warn('conversation_state_clear_failed', {
        conversation_id: conversation.id,
        tenant_id: tenantId,
        user_id: userId,
        error: stateError?.message,
      });
    }
  }

  const shouldPersistDashboard = ['canvas', 'create_dashboard', 'edit_dashboard', 'modify_dashboard']
    .includes(String(responsePayload?.presentation_mode || responsePayload?.intent?.intent || '').toLowerCase());
  const persistedDraftResult = shouldPersistDashboard
    ? await persistDashboardDraft({
      tenantId,
      userId,
      isDemo: userRole === 'demo',
      conversationId: conversation.id,
      savedDashboard,
      draftDashboard: responsePayload?.draft_dashboard,
    })
    : {
      dashboard: null,
      draftDashboard: normalizeDraftDashboard(
        responsePayload?.draft_dashboard,
        {
          saved_dashboard_id: savedDashboard?.id || null,
          name: savedDashboard?.name || null,
          updated_at: savedDashboard?.updated_at || null,
          message,
        },
      ) || agentState?.draft_dashboard || null,
    };

  const finalizedAgentState = finalizeAgentState({
    existingState: agentState,
    responsePayload,
    datasetProfile,
    draftDashboard: persistedDraftResult.draftDashboard,
    dashboard: persistedDraftResult.dashboard,
    message,
  });

  agentState = await updateConversationAgentState({
    tenantId,
    userId,
    conversationId: conversation.id,
    memory: finalizedAgentState.memory,
    datasetProfile: finalizedAgentState.dataset_profile,
    draftDashboard: finalizedAgentState.draft_dashboard,
    pendingApproval: finalizedAgentState.pending_approval,
    activeRun: null,
  });

  responsePayload = {
    ...responsePayload,
    draft_dashboard: persistedDraftResult.draftDashboard,
    dashboard: shouldPersistDashboard ? persistedDraftResult.dashboard : null,
    agent_state: agentState,
  };

  await persistAssistantMessage({
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
    conversation: await getConversationWithStats(tenantId, userId, conversation.id),
    ...responsePayload,
  };
}

export async function getChatHistory({ tenantId, userId, conversationId = null }) {
  const convo = await ensureConversation(tenantId, userId, conversationId);
  const agentState = await getConversationAgentState({
    tenantId,
    userId,
    conversationId: convo.id,
  });
  return {
    conversation_id: convo.id,
    conversation: await getConversationWithStats(tenantId, userId, convo.id),
    messages: await historyForConversation(tenantId, userId, convo.id, 200),
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
  const conversation = await ensureConversation(tenantId, userId, conversationId);
  const responsePayload = await applyConversationApproval({
    tenantId,
    userId,
    conversationId: conversation.id,
    approvalId,
    decision,
  });

  await persistAssistantMessage({
    conversationId: conversation.id,
    tenantId,
    content: responsePayload.answer,
    payload: responsePayload,
  });

  const agentState = await getConversationAgentState({
    tenantId,
    userId,
    conversationId: conversation.id,
  });

  return {
    conversation_id: conversation.id,
    conversation: await getConversationWithStats(tenantId, userId, conversation.id),
    agent_state: agentState,
    ...responsePayload,
  };
}


export async function listChatConversations({ tenantId, userId, limit = 100 }) {
  return (await all(
    `
      SELECT
        c.id,
        c.title,
        c.created_at,
        COALESCE(lm.last_message_at, c.created_at) AS last_message_at,
        COALESCE(lmd.content, '') AS last_message_preview,
        lmd.role AS last_message_role,
        COALESCE(cnt.message_count, 0) AS message_count
      FROM conversations c
      LEFT JOIN (
        SELECT conversation_id, MAX(created_at) AS last_message_at
        FROM chat_messages
        GROUP BY conversation_id
      ) lm ON lm.conversation_id = c.id
      LEFT JOIN (
        SELECT m.conversation_id, m.content, m.role, m.created_at
        FROM chat_messages m
        JOIN (
          SELECT conversation_id, MAX(created_at) AS last_message_at
          FROM chat_messages
          GROUP BY conversation_id
        ) lm2 ON lm2.conversation_id = m.conversation_id AND lm2.last_message_at = m.created_at
      ) lmd ON lmd.conversation_id = c.id
      LEFT JOIN (
        SELECT conversation_id, COUNT(*) AS message_count
        FROM chat_messages
        GROUP BY conversation_id
      ) cnt ON cnt.conversation_id = c.id
      WHERE c.tenant_id = :tenant_id
        AND c.user_id = :user_id
      ORDER BY last_message_at DESC, c.created_at DESC
      LIMIT :limit
    `,
    {
      tenant_id: tenantId,
      user_id: userId,
      limit,
    },
  )).map((item) => ({
    ...item,
    title: String(item.title || '').trim() || DEFAULT_CONVERSATION_TITLE,
    message_count: Number(item.message_count || 0),
    last_message_preview: String(item.last_message_preview || '').replace(/\s+/g, ' ').trim(),
  }));
}

export async function createConversation({ tenantId, userId, title = null }) {
  const id = generateId();
  const createdAt = new Date().toISOString();
  await run(
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

  const conversation = await get(
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
    await run(
      `
        UPDATE conversations
        SET title = :title
        WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
      `,
      {
        id: conversation.id,
        tenant_id: tenantId,
        user_id: userId,
        title: _safeTitle(nextTitle),
      },
    );
  }

  const created = await getConversationWithStats(tenantId, userId, conversation.id);
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

export async function renameConversation({ tenantId, userId, conversationId, title }) {
  const existing = await getConversationWithStats(tenantId, userId, conversationId);
  if (!existing) {
    return null;
  }

  const nextTitle = _safeTitle(title);
  await run(
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

export async function deleteConversation({ tenantId, userId, conversationId }) {
  const existing = await getConversationWithStats(tenantId, userId, conversationId);
  if (!existing) {
    return false;
  }

  // Delete dashboards tied to this conversation
  await run(
    `
      DELETE FROM dashboards
      WHERE conversation_id = :conversation_id AND tenant_id = :tenant_id AND user_id = :user_id
    `,
    {
      conversation_id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
    },
  );

  await run(
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

export async function setChatFeedback({ tenantId, userId, messageId, feedback }) {
  const target = await get(
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

  await run(
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
