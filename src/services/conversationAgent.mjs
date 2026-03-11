import { generateId } from '../utils/ids.mjs';
import { generateTextWithGemini, generateWithGeminiTools } from './gemini.mjs';
import { executeAnalyticsIntent } from './queryEngine.mjs';
import { inspectDatasetQuestion, getDatasetProfile } from './dataProfile.mjs';
import { repairLatestSourceIfNeeded } from './ingestion.mjs';
import { DashboardAgentError, runDashboardAgent } from './agentRuntime.mjs';
import {
  ensureConversationAgentState,
  getConversationAgentState,
  updateConversationAgentState,
  mergeConversationAgentMemory,
} from './conversationState.mjs';

const TEAM = {
  surface: 'Vira',
  orchestrator: 'Atlas',
  analyst: 'Raka',
  engineer: 'Tala',
  creator: 'Citra',
};

export class ConversationAgentError extends Error {
  constructor({
    code = 'AI_SERVICE_UNAVAILABLE',
    message = 'Layanan AI sedang bermasalah.',
    statusCode = 503,
    reason = 'ai_service_unavailable',
    details = null,
  } = {}) {
    super(message);
    this.name = 'ConversationAgentError';
    this.code = code;
    this.statusCode = statusCode;
    this.publicMessage = message;
    this.reason = reason;
    this.details = details;
  }
}

function pushTrace(trace, step) {
  trace.push(step);
  if (trace.length > 96) {
    trace.shift();
  }
}

function buildHistoryContext(history = [], limit = 10) {
  return history
    .slice(-limit)
    .map((item) => `${item.role}: ${String(item.content || '').trim()}`)
    .join('\n');
}

function compactDatasetProfile(profile = null) {
  if (!profile) {
    return null;
  }

  return {
    summary: profile.summary || null,
    detected: profile.detected || null,
    columns: Array.isArray(profile.columns)
      ? profile.columns.slice(0, 12).map((column) => ({
          name: column.name,
          kind: column.kind,
          missing_pct: column.missing_pct,
          unique_count: column.unique_count,
          sample_values: Array.isArray(column.sample_values) ? column.sample_values.slice(0, 3) : [],
        }))
      : [],
    mapping: profile.mapping || null,
  };
}

function compactDraftDashboard(draft = null) {
  if (!draft || typeof draft !== 'object') {
    return null;
  }

  const widgets = Array.isArray(draft.widgets)
    ? draft.widgets.slice(0, 8).map((widget) => ({
        id: widget.id || null,
        title: widget.title || widget.artifact?.title || 'Widget',
        kind: widget.artifact?.kind || widget.kind || 'chart',
        page: Number(widget.layout?.page || 1),
      }))
    : [];

  return {
    name: draft.name || 'Draft Dashboard',
    pages: Number(draft.pages || 1),
    widgets,
    saved_dashboard_id: draft.saved_dashboard_id || null,
    updated_at: draft.updated_at || null,
  };
}

function classifyGeminiFailure(result, fallbackMessage = 'Layanan AI sedang bermasalah.') {
  const reason = String(result?.reason || '').toLowerCase();
  if (reason === 'missing_api_key') {
    return new ConversationAgentError({
      code: 'AI_SERVICE_UNAVAILABLE',
      statusCode: 503,
      reason,
      message: 'Layanan AI belum tersedia.',
    });
  }
  if (reason === 'quota_exhausted' || reason === 'http_429') {
    return new ConversationAgentError({
      code: 'AI_QUOTA_EXHAUSTED',
      statusCode: 429,
      reason,
      message: 'Kuota AI sedang habis. Coba lagi beberapa saat.',
    });
  }
  if (reason === 'timeout') {
    return new ConversationAgentError({
      code: 'AI_SERVICE_TIMEOUT',
      statusCode: 504,
      reason,
      message: 'Layanan AI terlalu lama merespons. Coba lagi.',
    });
  }
  return new ConversationAgentError({
    code: 'AI_SERVICE_UNAVAILABLE',
    statusCode: 503,
    reason: reason || 'ai_service_unavailable',
    message: fallbackMessage,
  });
}

function detectBlockingDatasetIssue(profile = null) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const numericColumns = Array.isArray(profile.detected?.numeric_columns) ? profile.detected.numeric_columns : [];
  const dateColumns = Array.isArray(profile.detected?.date_columns) ? profile.detected.date_columns : [];

  if (numericColumns.length === 0) {
    return {
      type: 'repair_latest_source',
      issue: 'measure_missing',
      title: 'Kolom angka utama belum kebaca',
      prompt: 'Saya belum menemukan kolom angka yang cukup jelas untuk dianalisis. Mau saya coba perbaiki mapping source terbaru secara otomatis?',
    };
  }

  if (dateColumns.length === 0) {
    return {
      type: 'repair_latest_source',
      issue: 'date_missing',
      title: 'Kolom tanggal belum kebaca',
      prompt: 'Saya belum menemukan kolom tanggal yang cukup jelas. Mau saya coba perbaiki format dan mapping source terbaru secara otomatis?',
    };
  }

  return null;
}

function emitAgentStart(hooks, payload = {}) {
  if (hooks && typeof hooks.onAgentStart === 'function') {
    hooks.onAgentStart(payload);
  }
}

function emitAgentStep(hooks, payload = {}) {
  if (hooks && typeof hooks.onAgentStep === 'function') {
    hooks.onAgentStep(payload);
  }
}

function emitApprovalRequired(hooks, payload = {}) {
  if (hooks && typeof hooks.onApprovalRequired === 'function') {
    hooks.onApprovalRequired(payload);
  }
}

const SURFACE_INCOMPLETE_TAILS = [
  'aku',
  'saya',
  'vira',
  'atlas',
  'raka',
  'tala',
  'citra',
  'dan',
  'atau',
  'karena',
  'untuk',
  'yang',
  'jadi',
  'agar',
  'supaya',
  'dengan',
  'kalau',
  'jika',
  'bahwa',
  'mau',
  'akan',
  'bisa',
];

function normalizeSurfaceReplyText(value = '') {
  let text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!text) {
    return '';
  }

  if (!/[.!?…]$/.test(text) && !/[,:;]$/.test(text)) {
    text = `${text}.`;
  }

  return text;
}

function isValidSelfIdentificationReply(value = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[.!?…]+$/g, '')
    .replace(/\s+/g, ' ');

  return /^(nama )?(saya|aku)( adalah)? vira$/.test(normalized)
    || /^saya vira$/.test(normalized)
    || /^aku vira$/.test(normalized);
}

function looksLikeCompleteSurfaceReply(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }

  if (isValidSelfIdentificationReply(text)) {
    return true;
  }

  const lower = text.toLowerCase();
  if (/[,:;(\[{'"`-]$/.test(lower)) {
    return false;
  }

  for (const token of SURFACE_INCOMPLETE_TAILS) {
    if (lower === token || lower.endsWith(` ${token}`) || lower.endsWith(` ${token}.`)) {
      return false;
    }
  }

  return true;
}

async function classifyRoute({ message, history, datasetReady, agentState, userDisplayName }) {
  const result = await generateWithGeminiTools({
    systemPrompt: [
      `Kamu adalah ${TEAM.orchestrator}, orchestrator agent untuk Vistara.`,
      'Pilih satu action terbaik untuk pesan user: conversational, analyze, inspect_dataset, create_dashboard, edit_dashboard, atau ask_clarification.',
      'Gunakan conversational untuk sapaan atau obrolan ringan.',
      'Gunakan analyze untuk insight/metrik/perbandingan/ranking yang cukup dijawab di chat.',
      'Gunakan create_dashboard bila user meminta dashboard, canvas, atau visual lengkap.',
      'Gunakan edit_dashboard bila user ingin mengubah dashboard yang sedang aktif.',
      'Gunakan inspect_dataset bila user ingin mengecek struktur atau kualitas dataset.',
      'Jika belum jelas, gunakan ask_clarification.',
      userDisplayName ? `Nama user: ${userDisplayName}.` : 'Nama user belum diketahui.',
      datasetReady ? 'Dataset user tersedia.' : 'Dataset user belum tersedia.',
      agentState?.draft_dashboard ? 'Ada draft dashboard aktif pada percakapan ini.' : 'Belum ada draft dashboard aktif.',
    ].join(' '),
    userPrompt: JSON.stringify({
      message,
      history: buildHistoryContext(history),
      draft_dashboard: compactDraftDashboard(agentState?.draft_dashboard),
      pending_approval: agentState?.pending_approval || null,
    }),
    tools: [
      {
        name: 'route_request',
        description: 'Pilih jalur penanganan terbaik untuk permintaan user.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['conversational', 'analyze', 'inspect_dataset', 'create_dashboard', 'edit_dashboard', 'ask_clarification'],
            },
            reason: { type: 'string' },
            time_period: { type: 'string' },
            metric: { type: 'string' },
            visualization: { type: 'string' },
            dimension: { type: 'string' },
            limit: { type: 'number' },
            branch: { type: 'string' },
            channel: { type: 'string' },
          },
          required: ['action'],
        },
      },
    ],
    temperature: 0.1,
    maxOutputTokens: 512,
    thinkingBudget: 128,
    functionCallingMode: 'ANY',
    allowedFunctionNames: ['route_request'],
  });

  if (!result.ok) {
    throw classifyGeminiFailure(result, 'Layanan AI sedang bermasalah saat menentukan langkah analisis.');
  }

  const payload = (result.functionCalls || []).find((call) => call.name === 'route_request')?.args
    || result.data
    || null;
  if (!payload || typeof payload !== 'object') {
    throw new ConversationAgentError({
      code: 'AI_ROUTE_INVALID',
      statusCode: 502,
      reason: 'missing_route_request_call',
      message: 'Layanan AI belum memberi keputusan rute yang valid.',
    });
  }

  const action = String(payload.action || '').trim().toLowerCase();
  const normalizedAction = [
    'conversational',
    'analyze',
    'inspect_dataset',
    'create_dashboard',
    'edit_dashboard',
    'ask_clarification',
  ].includes(action)
    ? action
    : 'ask_clarification';

  return {
    action: normalizedAction,
    reason: String(payload.reason || '').trim() || null,
    time_period: payload.time_period || null,
    metric: payload.metric || null,
    visualization: payload.visualization || null,
    dimension: payload.dimension || null,
    limit: Number.isFinite(Number(payload.limit)) ? Number(payload.limit) : null,
    branch: payload.branch || null,
    channel: payload.channel || null,
  };
}

async function generateSurfaceReply({ message, history, datasetReady, userDisplayName, draftDashboard, routeReason = null }) {
  const baseSystemPrompt = [
    `Kamu adalah ${TEAM.surface}, wajah percakapan Vistara untuk user bisnis non-teknis.`,
    'Jawab natural dalam Bahasa Indonesia.',
    'Untuk sapaan atau obrolan ringan, balas dengan 1 kalimat singkat yang utuh.',
    'Untuk pertanyaan kemampuan, balas maksimal 2 kalimat pendek yang utuh.',
    'Jika dataset belum tersedia dan relevan, arahkan user untuk upload file atau gunakan demo dengan bahasa sederhana.',
    'Jangan menyebut agent internal lain kecuali bila diminta secara eksplisit.',
    'Jangan memanggil user dengan nama kecuali diminta secara eksplisit.',
    'Jangan menyebut namamu sendiri kecuali user memintanya.',
    datasetReady ? 'Dataset tersedia.' : 'Dataset belum tersedia.',
    draftDashboard ? 'Ada draft dashboard aktif.' : 'Belum ada draft dashboard aktif.',
    routeReason ? `Konteks keputusan Atlas: ${routeReason}.` : '',
    userDisplayName ? `Info internal: nama user ${userDisplayName}.` : '',
  ].join(' ');

  const userPrompt = buildHistoryContext(history)
    ? `Riwayat:\n${buildHistoryContext(history)}\n\nPesan terbaru: ${message}`
    : `Pesan terbaru: ${message}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await generateTextWithGemini({
      systemPrompt: [
        baseSystemPrompt,
        attempt === 1
          ? 'Pastikan jawaban berupa kalimat utuh, tidak terpotong, dan diakhiri tanda baca.'
          : '',
      ].filter(Boolean).join(' '),
      userPrompt,
      temperature: attempt === 0 ? 0.65 : 0.5,
      maxOutputTokens: attempt === 0 ? 180 : 220,
    });

    if (!result.ok || !result.text) {
      throw classifyGeminiFailure(result, 'Layanan AI sedang bermasalah saat membalas percakapan.');
    }

    const normalized = normalizeSurfaceReplyText(result.text);
    if (looksLikeCompleteSurfaceReply(normalized)) {
      return normalized;
    }
  }

  throw new ConversationAgentError({
    code: 'AI_SERVICE_UNAVAILABLE',
    statusCode: 503,
    reason: 'surface_reply_incomplete',
    message: 'Layanan AI belum memberi jawaban yang utuh.',
  });
}

async function buildAnalyticsIntent({ message, history, route, datasetProfile }) {
  const result = await generateWithGeminiTools({
    systemPrompt: [
      `Kamu adalah ${TEAM.analyst}, data analyst agent Vistara.`,
      'Ubah pertanyaan bisnis user menjadi parameter analytics yang aman dan grounded.',
      'intent hanya boleh salah satu dari: show_metric, compare, rank, explain.',
      'metric boleh menggunakan istilah bisnis seperti revenue, profit, margin, expense, top_products, branch_performance, revenue_trend.',
      'Pilih rank bila user meminta top/ranking/peringkat, compare bila user membandingkan periode, explain bila user meminta penjelasan umum tren, selain itu show_metric.',
      'Gunakan konteks dataset hanya untuk menghindari field yang tidak masuk akal.',
    ].join(' '),
    userPrompt: JSON.stringify({
      message,
      history: buildHistoryContext(history),
      route,
      dataset_profile: compactDatasetProfile(datasetProfile),
    }),
    tools: [
      {
        name: 'submit_analytics_intent',
        description: 'Ubah pertanyaan user menjadi intent analytics yang aman dan grounded.',
        parameters: {
          type: 'object',
          properties: {
            intent: { type: 'string', enum: ['show_metric', 'compare', 'rank', 'explain'] },
            metric: { type: 'string' },
            visualization: { type: 'string' },
            dimension: { type: 'string' },
            time_period: { type: 'string' },
            limit: { type: 'number' },
            branch: { type: 'string' },
            channel: { type: 'string' },
            template_id: { type: 'string' },
          },
          required: ['intent', 'metric'],
        },
      },
    ],
    temperature: 0.1,
    maxOutputTokens: 512,
    thinkingBudget: 128,
    functionCallingMode: 'ANY',
    allowedFunctionNames: ['submit_analytics_intent'],
  });

  if (!result.ok) {
    throw classifyGeminiFailure(result, 'Layanan AI sedang bermasalah saat menyusun analisis.');
  }

  const payload = (result.functionCalls || []).find((call) => call.name === 'submit_analytics_intent')?.args
    || result.data
    || null;
  if (!payload || typeof payload !== 'object') {
    throw new ConversationAgentError({
      code: 'AI_ANALYTICS_INVALID',
      statusCode: 502,
      reason: 'missing_submit_analytics_intent_call',
      message: 'Layanan AI belum memberi parameter analisis yang valid.',
    });
  }

  const intent = String(payload.intent || 'show_metric').trim().toLowerCase();
  const normalizedIntent = ['show_metric', 'compare', 'rank', 'explain'].includes(intent)
    ? intent
    : 'show_metric';

  return {
    intent: normalizedIntent,
    metric: payload.metric || route.metric || 'revenue',
    visualization: payload.visualization || route.visualization || null,
    dimension: payload.dimension || route.dimension || null,
    time_period: payload.time_period || route.time_period || '7 hari terakhir',
    limit: Number.isFinite(Number(payload.limit)) ? Number(payload.limit) : (route.limit || 10),
    branch: payload.branch || route.branch || null,
    channel: payload.channel || route.channel || null,
    template_id: payload.template_id || null,
    nlu_source: 'atlas_raka_gemini',
  };
}

function buildDraftDashboardPayload({ widgets = [], artifacts = [], dashboard = null, runId, note = '', status = 'drafting', savedDashboardId = null }) {
  const normalizedWidgets = Array.isArray(widgets) ? widgets : [];
  const pages = normalizedWidgets.reduce((max, widget) => Math.max(max, Number(widget?.layout?.page || 1)), 1);
  return {
    run_id: runId,
    status,
    note: String(note || '').trim() || null,
    pages: Math.max(1, Number(pages || 1)),
    widgets: normalizedWidgets,
    artifacts: Array.isArray(artifacts) ? artifacts : [],
    saved_dashboard_id: savedDashboardId || dashboard?.id || null,
    name: dashboard?.name || 'Draft Dashboard',
    updated_at: new Date().toISOString(),
  };
}

function emitDashboardProgressPatch({ hooks, runId, dashboard, patch, savedDashboardId = null }) {
  if (!hooks || typeof hooks.onDashboardPatch !== 'function') {
    return;
  }
  hooks.onDashboardPatch({
    run_id: runId,
    draft_dashboard: buildDraftDashboardPayload({
      widgets: patch.widgets,
      artifacts: patch.artifacts,
      dashboard,
      runId,
      note: patch.note,
      status: patch.status,
      savedDashboardId,
    }),
    changed_widgets: Array.isArray(patch.changed_widgets) ? patch.changed_widgets : [],
    page_count: Number(patch.page_count || 1),
    status: patch.status || 'drafting',
    note: patch.note || null,
  });
}

function runDashboardBaseFromState(agentState, savedDashboard) {
  if (agentState?.draft_dashboard && Array.isArray(agentState.draft_dashboard.widgets)) {
    return {
      id: agentState.draft_dashboard.saved_dashboard_id || savedDashboard?.id || `draft_${generateId()}`,
      name: agentState.draft_dashboard.name || savedDashboard?.name || 'Draft Dashboard',
      config: {
        mode: 'manual',
        pages: Number(agentState.draft_dashboard.pages || 1),
        components: agentState.draft_dashboard.widgets,
        updated_by: 'agent',
      },
    };
  }
  return savedDashboard || null;
}

export async function runConversationAgent({
  tenantId,
  userId,
  conversationId,
  dashboardId = null,
  message,
  history = [],
  datasetReady = false,
  userDisplayName = null,
  savedDashboard = null,
  hooks = null,
}) {
  const trace = [];
  const runId = generateId();
  let agentState = ensureConversationAgentState({ tenantId, userId, conversationId });

  emitAgentStart(hooks, {
    run_id: runId,
    agent: TEAM.surface,
    title: 'Vira membaca permintaan Anda',
  });
  updateConversationAgentState({
    tenantId,
    userId,
    conversationId,
    activeRun: {
      run_id: runId,
      status: 'running',
      stage: 'surface',
      message,
      started_at: new Date().toISOString(),
    },
  });

  let datasetProfile = agentState?.dataset_profile || null;
  if (datasetReady && !datasetProfile) {
    try {
      datasetProfile = await getDatasetProfile(tenantId);
      agentState = updateConversationAgentState({
        tenantId,
        userId,
        conversationId,
        datasetProfile,
      });
    } catch {
      datasetProfile = null;
    }
  }

  const route = await classifyRoute({
    message,
    history,
    datasetReady,
    agentState,
    userDisplayName,
  });
  pushTrace(trace, { step: 'atlas_route', route });
  emitAgentStep(hooks, {
    run_id: runId,
    agent: TEAM.orchestrator,
    title: `Atlas memilih jalur ${route.action}`,
    status: 'done',
  });

  if (!datasetReady && ['analyze', 'inspect_dataset', 'create_dashboard', 'edit_dashboard'].includes(route.action)) {
    const answer = await generateSurfaceReply({
      message,
      history,
      datasetReady,
      userDisplayName,
      draftDashboard: agentState?.draft_dashboard,
      routeReason: 'Dataset belum tersedia, jadi arahkan user untuk menambahkan data terlebih dulu.',
    });

    const nextState = updateConversationAgentState({
      tenantId,
      userId,
      conversationId,
      activeRun: {
        run_id: runId,
        status: 'done',
        stage: 'surface',
        completed_at: new Date().toISOString(),
      },
    });

    return {
      answer,
      widgets: [],
      artifacts: [],
      presentation_mode: 'chat',
      intent: {
        intent: route.action === 'inspect_dataset' ? 'dataset_inspection' : 'conversation',
        nlu_source: 'atlas_gemini',
      },
      draft_dashboard: nextState?.draft_dashboard || null,
      pending_approval: nextState?.pending_approval || null,
      agent: {
        mode: 'agentic_team_runtime',
        run_id: runId,
        team: TEAM,
        trace,
        route,
      },
    };
  }

  if (route.action === 'conversational' || route.action === 'ask_clarification') {
    const answer = await generateSurfaceReply({
      message,
      history,
      datasetReady,
      userDisplayName,
      draftDashboard: agentState?.draft_dashboard,
      routeReason: route.reason,
    });

    mergeConversationAgentMemory({
      tenantId,
      userId,
      conversationId,
      patch: {
        [TEAM.surface]: {
          last_message: message,
          last_reply: answer,
          last_updated_at: new Date().toISOString(),
        },
      },
    });
    const nextState = updateConversationAgentState({
      tenantId,
      userId,
      conversationId,
      activeRun: {
        run_id: runId,
        status: 'done',
        stage: 'surface',
        completed_at: new Date().toISOString(),
      },
    });

    return {
      answer,
      widgets: [],
      artifacts: [],
      presentation_mode: 'chat',
      intent: {
        intent: route.action === 'ask_clarification' ? 'clarify' : 'smalltalk',
        nlu_source: 'atlas_gemini',
      },
      draft_dashboard: nextState?.draft_dashboard || null,
      pending_approval: nextState?.pending_approval || null,
      agent: {
        mode: 'agentic_team_runtime',
        run_id: runId,
        team: TEAM,
        trace,
        route,
      },
    };
  }

  if (route.action === 'inspect_dataset') {
    emitAgentStep(hooks, {
      run_id: runId,
      agent: TEAM.analyst,
      title: 'Raka memeriksa kualitas dataset aktif',
      status: 'pending',
    });

    const inspection = await inspectDatasetQuestion({ tenantId, message });
    const nextState = updateConversationAgentState({
      tenantId,
      userId,
      conversationId,
      datasetProfile: inspection.profile || datasetProfile,
      activeRun: {
        run_id: runId,
        status: 'done',
        stage: 'inspect_dataset',
        completed_at: new Date().toISOString(),
      },
    });

    pushTrace(trace, { step: 'dataset_inspection', columns: inspection.profile?.summary?.columns || 0 });
    return {
      answer: inspection.answer,
      widgets: [],
      artifacts: inspection.artifacts || [],
      dataset_profile: inspection.profile || null,
      presentation_mode: 'chat',
      intent: {
        intent: 'dataset_inspection',
        nlu_source: 'atlas_gemini',
      },
      draft_dashboard: nextState?.draft_dashboard || null,
      pending_approval: nextState?.pending_approval || null,
      agent: {
        mode: 'agentic_team_runtime',
        run_id: runId,
        team: TEAM,
        trace,
        route,
      },
    };
  }

  if (route.action === 'analyze') {
    emitAgentStep(hooks, {
      run_id: runId,
      agent: TEAM.analyst,
      title: 'Raka menyusun analisis dari dataset aktif',
      status: 'pending',
    });

    const analysisIntent = await buildAnalyticsIntent({
      message,
      history,
      route,
      datasetProfile,
    });
    const analytics = executeAnalyticsIntent({
      tenantId,
      userId,
      intent: analysisIntent,
    });

    mergeConversationAgentMemory({
      tenantId,
      userId,
      conversationId,
      patch: {
        [TEAM.analyst]: {
          last_intent: analysisIntent,
          last_result: {
            template_id: analytics.template_id,
            period: analytics.period,
          },
          last_updated_at: new Date().toISOString(),
        },
      },
    });

    const nextState = updateConversationAgentState({
      tenantId,
      userId,
      conversationId,
      activeRun: {
        run_id: runId,
        status: 'done',
        stage: 'analysis',
        completed_at: new Date().toISOString(),
      },
    });

    pushTrace(trace, { step: 'analysis', template_id: analytics.template_id, intent: analysisIntent.intent });
    return {
      ...analytics,
      presentation_mode: 'chat',
      intent: analysisIntent,
      draft_dashboard: nextState?.draft_dashboard || null,
      pending_approval: nextState?.pending_approval || null,
      agent: {
        mode: 'agentic_team_runtime',
        run_id: runId,
        team: TEAM,
        trace,
        route,
      },
    };
  }

  if (route.action === 'create_dashboard' || route.action === 'edit_dashboard') {
    const blockingIssue = detectBlockingDatasetIssue(datasetProfile);
    if (blockingIssue && !agentState?.pending_approval) {
      const approval = {
        id: generateId(),
        type: blockingIssue.type,
        issue: blockingIssue.issue,
        title: blockingIssue.title,
        prompt: blockingIssue.prompt,
        requested_by: TEAM.engineer,
        created_at: new Date().toISOString(),
        message_context: message,
      };
      const nextState = updateConversationAgentState({
        tenantId,
        userId,
        conversationId,
        pendingApproval: approval,
        activeRun: {
          run_id: runId,
          status: 'waiting_approval',
          stage: 'data_repair',
          completed_at: new Date().toISOString(),
        },
      });

      emitApprovalRequired(hooks, {
        run_id: runId,
        approval,
      });
      return {
        answer: approval.prompt,
        widgets: [],
        artifacts: [],
        presentation_mode: 'chat',
        pending_approval: nextState?.pending_approval || approval,
        intent: {
          intent: 'approval_required',
          nlu_source: 'atlas_gemini',
        },
        agent: {
          mode: 'agentic_team_runtime',
          run_id: runId,
          team: TEAM,
          trace,
          route,
        },
      };
    }

    const baseDashboard = runDashboardBaseFromState(agentState, savedDashboard);
    emitAgentStart(hooks, {
      run_id: runId,
      agent: TEAM.creator,
      title: 'Citra mulai menyusun draft dashboard',
    });
    updateConversationAgentState({
      tenantId,
      userId,
      conversationId,
      activeRun: {
        run_id: runId,
        status: 'running',
        stage: 'dashboard',
        completed_at: null,
      },
    });

    let latestDraft = agentState?.draft_dashboard || null;
    const dashboardResult = await runDashboardAgent({
      tenantId,
      userId,
      dashboardId,
      dashboard: baseDashboard,
      goal: message,
      request: {
        time_period: route.time_period || '30 hari terakhir',
        branch: route.branch || null,
        channel: route.channel || null,
        limit: route.limit || 8,
        mode: route.action,
      },
      hooks: {
        onTimelineEvent: hooks?.onTimelineEvent,
        onDashboardPatch: (patch) => {
          latestDraft = buildDraftDashboardPayload({
            widgets: patch.widgets,
            artifacts: patch.artifacts,
            dashboard: baseDashboard,
            runId,
            note: patch.note,
            status: patch.status,
            savedDashboardId: baseDashboard?.id || null,
          });
          updateConversationAgentState({
            tenantId,
            userId,
            conversationId,
            draftDashboard: latestDraft,
            activeRun: {
              run_id: runId,
              status: patch.status || 'drafting',
              stage: 'dashboard',
              updated_at: new Date().toISOString(),
            },
          });
          emitDashboardProgressPatch({
            hooks,
            runId,
            dashboard: baseDashboard,
            patch,
            savedDashboardId: baseDashboard?.id || null,
          });
        },
      },
    });

    latestDraft = buildDraftDashboardPayload({
      widgets: dashboardResult.widgets,
      artifacts: dashboardResult.artifacts,
      dashboard: baseDashboard,
      runId,
      note: dashboardResult.answer,
      status: 'ready',
      savedDashboardId: baseDashboard?.id || null,
    });
    const nextState = updateConversationAgentState({
      tenantId,
      userId,
      conversationId,
      draftDashboard: latestDraft,
      pendingApproval: null,
      activeRun: {
        run_id: runId,
        status: 'done',
        stage: 'dashboard',
        completed_at: new Date().toISOString(),
      },
    });

    pushTrace(trace, {
      step: 'dashboard',
      widgets: dashboardResult.widgets.length,
      pages: latestDraft.pages,
    });
    return {
      ...dashboardResult,
      draft_dashboard: nextState?.draft_dashboard || latestDraft,
      save_required: true,
      intent: {
        intent: route.action === 'edit_dashboard' ? 'modify_dashboard' : 'create_dashboard',
        nlu_source: 'atlas_gemini',
      },
      agent: {
        ...(dashboardResult.agent || {}),
        mode: 'agentic_team_runtime',
        run_id: runId,
        team: TEAM,
        route,
        trace: [...trace, ...((dashboardResult.agent && Array.isArray(dashboardResult.agent.trace)) ? dashboardResult.agent.trace : [])],
      },
    };
  }

  throw new ConversationAgentError({
    code: 'CHAT_CLARIFICATION_REQUIRED',
    statusCode: 400,
    reason: 'unsupported_route',
    message: 'Permintaan belum cukup jelas. Coba jelaskan insight atau dashboard yang Anda inginkan.',
  });
}

export async function applyConversationApproval({ tenantId, userId, conversationId, approvalId, decision }) {
  const agentState = getConversationAgentState({ tenantId, userId, conversationId });
  const approval = agentState?.pending_approval;

  if (!approval || approval.id !== approvalId) {
    throw new ConversationAgentError({
      code: 'APPROVAL_NOT_FOUND',
      statusCode: 404,
      reason: 'approval_not_found',
      message: 'Permintaan persetujuan tidak ditemukan.',
    });
  }

  const normalizedDecision = String(decision || '').trim().toLowerCase();
  if (!['approve', 'reject'].includes(normalizedDecision)) {
    throw new ConversationAgentError({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      reason: 'invalid_decision',
      message: 'decision harus approve atau reject.',
    });
  }

  if (normalizedDecision === 'reject') {
    const nextState = updateConversationAgentState({
      tenantId,
      userId,
      conversationId,
      pendingApproval: null,
      activeRun: null,
    });
    return {
      answer: 'Baik, saya tidak mengubah dataset. Saya akan tetap membantu sebisanya dengan kondisi data yang ada.',
      widgets: [],
      artifacts: [],
      presentation_mode: 'chat',
      pending_approval: nextState?.pending_approval || null,
      draft_dashboard: nextState?.draft_dashboard || null,
      intent: {
        intent: 'approval_rejected',
        nlu_source: 'approval_api',
      },
      agent: {
        mode: 'agentic_team_runtime',
        team: TEAM,
        approval,
      },
    };
  }

  if (approval.type !== 'repair_latest_source') {
    throw new ConversationAgentError({
      code: 'APPROVAL_ACTION_UNSUPPORTED',
      statusCode: 400,
      reason: 'approval_action_unsupported',
      message: 'Jenis persetujuan ini belum didukung.',
    });
  }

  const repair = await repairLatestSourceIfNeeded({
    tenantId,
    userId,
  });

  let nextProfile = null;
  try {
    nextProfile = await getDatasetProfile(tenantId);
  } catch {
    nextProfile = null;
  }
  const nextState = updateConversationAgentState({
    tenantId,
    userId,
    conversationId,
    datasetProfile: nextProfile,
    pendingApproval: null,
    activeRun: null,
  });

  if (!repair.ok) {
    return {
      answer: 'Perbaikan data belum berhasil. Dataset lama tetap dipertahankan, jadi Anda masih bisa lanjut memakai data sebelumnya.',
      widgets: [],
      artifacts: [],
      dataset_profile: nextProfile,
      presentation_mode: 'chat',
      pending_approval: nextState?.pending_approval || null,
      draft_dashboard: nextState?.draft_dashboard || null,
      intent: {
        intent: 'repair_failed',
        nlu_source: 'approval_api',
      },
      error: {
        code: 'DATA_REPAIR_FAILED',
        status: 422,
        message: 'Perbaikan data belum berhasil.',
      },
      agent: {
        mode: 'agentic_team_runtime',
        team: TEAM,
        approval,
        repair,
      },
    };
  }

  return {
    answer: 'Perbaikan source terbaru selesai. Anda bisa lanjut minta analisis atau dashboard lagi.',
    widgets: [],
    artifacts: [],
    dataset_profile: nextProfile,
    presentation_mode: 'chat',
    pending_approval: nextState?.pending_approval || null,
    draft_dashboard: nextState?.draft_dashboard || null,
    intent: {
      intent: 'repair_completed',
      nlu_source: 'approval_api',
    },
    agent: {
      mode: 'agentic_team_runtime',
      team: TEAM,
      approval,
      repair,
    },
  };
}

export function conversationAgentTeam() {
  return { ...TEAM };
}
