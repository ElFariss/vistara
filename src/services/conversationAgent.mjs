import { config } from '../config.mjs';
import { generateId } from '../utils/ids.mjs';
import { generateWithGeminiTools } from './gemini.mjs';
import { executeAnalyticsIntent } from './queryEngine.mjs';
import { inspectDatasetQuestion, getDatasetProfile } from './dataProfile.mjs';
import { repairLatestSourceIfNeeded } from './ingestion.mjs';
import { DashboardAgentError, runDashboardAgent } from './agentRuntime.mjs';
import { createDashboard } from './dashboards.mjs';
import {
  ensureConversationAgentState,
  getConversationAgentState,
  updateConversationAgentState,
  mergeConversationAgentMemory,
} from './conversationState.mjs';
import { Prompts } from './agents/index.mjs';

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

function normalizeIntentText(message = '') {
  return String(message || '').toLowerCase().replace(/\s+/g, ' ').trim();
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

function compactSavedDashboard(dashboard = null) {
  if (!dashboard || typeof dashboard !== 'object') {
    return null;
  }

  const components = Array.isArray(dashboard.config?.components)
    ? dashboard.config.components.slice(0, 8).map((component) => ({
        title: component.title || 'Widget',
        type: component.type || 'chart',
        metric: component.metric || component.query?.metric || component.query?.template_id || null,
      }))
    : [];

  return {
    id: dashboard.id || null,
    name: dashboard.name || 'Dashboard',
    is_default: Boolean(dashboard.is_default),
    updated_by: dashboard.config?.updated_by || null,
    components,
  };
}

function isUntouchedDefaultDashboard(dashboard = null) {
  return Boolean(dashboard?.is_default) && String(dashboard?.config?.updated_by || '').trim().toLowerCase() === 'system';
}

function hasMeaningfulDashboardContext(agentState = null, savedDashboard = null) {
  if (Array.isArray(agentState?.draft_dashboard?.widgets) && agentState.draft_dashboard.widgets.length > 0) {
    return true;
  }

  if (!savedDashboard) {
    return false;
  }

  if (isUntouchedDefaultDashboard(savedDashboard)) {
    return false;
  }

  return Array.isArray(savedDashboard.config?.components) && savedDashboard.config.components.length > 0;
}

function isDashboardIntentMessage(message = '') {
  const text = normalizeIntentText(message);
  if (!text) {
    return false;
  }

  return /\b(dashboard|kanvas|canvas|visual|widget|grafik|chart|laporan)\b/.test(text)
    || /\b(buat|buatkan|bikin|susun|generate|rangkai|siapin|siapkan)\b.*\b(dashboard|visual|grafik|chart|laporan)\b/.test(text)
    || /\b(buatin|gacor|lihat aja dataset|liat aja dataset)\b/.test(text);
}

function isDashboardContinuationMessage(message = '') {
  const text = normalizeIntentText(message);
  if (!text || isDashboardIntentMessage(text)) {
    return false;
  }

  return /\b(buat aja|bikin aja|terserah|bebas|apa aja|apa pun|apapun|ngga tau|nggak tau|gak tau|ga tau|gatau|lanjut|lanjut aja|sesuai data|berdasarkan data|yang terbaik|yang paling penting|penjualan|sales|omzet|profit|produk|cabang|transaksi|pelanggan)\b/.test(text);
}

function dashboardChoiceFromMessage(message = '') {
  const text = normalizeIntentText(message);
  if (!text) {
    return null;
  }

  if (/\b(edit|ubah|rapikan|revisi|perbarui|update|yang ada|yang ini|yang lama|dashboard aktif)\b/.test(text)) {
    return 'edit';
  }

  if (/\b(baru|baru aja|baru saja|dashboard baru|dashboard lain|buat baru|bikin baru|new|lain)\b/.test(text)) {
    return 'new';
  }

  return null;
}

function pendingDashboardChoice(agentState = null) {
  return agentState?.memory?.[TEAM.orchestrator]?.pending_dashboard_choice || null;
}

function nextOrchestratorMemory(agentState = null, patch = {}) {
  const existingMemory = agentState?.memory && typeof agentState.memory === 'object' ? agentState.memory : {};
  const existingOrchestrator = existingMemory[TEAM.orchestrator] && typeof existingMemory[TEAM.orchestrator] === 'object'
    ? existingMemory[TEAM.orchestrator]
    : {};

  return {
    ...existingMemory,
    [TEAM.orchestrator]: {
      ...existingOrchestrator,
      ...patch,
      last_updated_at: new Date().toISOString(),
    },
  };
}

function dashboardChoicePrompt() {
  return [
    'Ada dashboard yang sedang aktif.',
    '',
    '- Balas `edit` untuk mengubah dashboard yang ada.',
    '- Balas `baru` untuk membuat dashboard baru.',
  ].join('\n');
}

function buildDashboardContext(agentState = null, savedDashboard = null) {
  const draft = agentState?.draft_dashboard || null;
  const findings = Array.isArray(draft?.analysis_brief?.findings)
    ? draft.analysis_brief.findings.slice(0, 4).map((finding) => ({
        title: finding.title || null,
        insight: finding.insight || null,
        why_it_matters: finding.why_it_matters || null,
        recommended_visual: finding.recommended_visual || null,
      }))
    : [];

  return {
    active_dashboard: compactSavedDashboard(savedDashboard),
    draft_dashboard: compactDraftDashboard(draft),
    latest_findings: findings,
  };
}

function hasRecentDashboardConversation(history = [], agentState = null) {
  if (pendingDashboardChoice(agentState)) {
    return true;
  }

  const recentHistory = Array.isArray(history) ? history.slice(-6) : [];
  return recentHistory.some((item) => {
    const content = normalizeIntentText(item?.content || '');
    if (!content) {
      return false;
    }
    if (item?.role === 'user') {
      return isDashboardIntentMessage(content);
    }
    return /\bdashboard\b/.test(content);
  });
}

function shouldPromoteToDashboardRoute({ message, history = [], datasetReady = false, agentState = null }) {
  if (!datasetReady) {
    return false;
  }

  if (isDashboardIntentMessage(message)) {
    return true;
  }

  return isDashboardContinuationMessage(message) && hasRecentDashboardConversation(history, agentState);
}

function normalizeRouteDecision({ route, message, datasetReady = false, history = [], agentState = null }) {
  const nextRoute = route && typeof route === 'object' ? { ...route } : { action: 'ask_clarification' };
  const originalAction = nextRoute.action;
  if (shouldPromoteToDashboardRoute({ message, history, datasetReady, agentState })
    && !['create_dashboard', 'edit_dashboard'].includes(originalAction)) {
    nextRoute.action = 'create_dashboard';
    nextRoute.reason = originalAction === 'inspect_dataset'
      ? 'dashboard_intent_overrode_dataset_inspection'
      : 'dashboard_intent_auto_promoted';
  }
  return nextRoute;
}

function dashboardShellName(message = '') {
  const cleaned = String(message || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return 'Dashboard Baru';
  }

  const tokens = cleaned
    .split(' ')
    .filter((token) => token.length > 2)
    .slice(0, 3)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase());

  return tokens.length > 0 ? `Dashboard ${tokens.join(' ')}` : 'Dashboard Baru';
}

function emptyDashboardShellConfig() {
  return {
    mode: 'ai',
    pages: 1,
    components: [],
    updated_by: 'assistant',
  };
}

function shouldAskDashboardChoice({ route, agentState, savedDashboard }) {
  return route?.action === 'create_dashboard' && hasMeaningfulDashboardContext(agentState, savedDashboard);
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

  const numericColumns = Array.isArray(profile.detected?.numeric_columns) && profile.detected.numeric_columns.length > 0
    ? profile.detected.numeric_columns
    : Array.isArray(profile.columns)
      ? profile.columns.filter((column) => column?.kind === 'number').map((column) => column.name).filter(Boolean)
      : [];

  if (numericColumns.length === 0) {
    return {
      type: 'repair_latest_source',
      issue: 'measure_missing',
      title: 'Kolom angka utama belum kebaca',
      prompt: 'Saya belum menemukan kolom angka yang cukup jelas untuk dianalisis. Mau saya coba perbaiki mapping source terbaru secara otomatis?',
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
  'sepertinya',
  'kayaknya',
  'mungkin',
  'tolong',
  'coba',
  'memul',
  'mul',
  'lanjut',
  'jelaskan',
];

const SURFACE_REPLY_TOOL_DECLARATIONS = [
  {
    name: 'reply_user',
    description: 'Kirim jawaban final untuk user dalam satu pikiran yang utuh.',
    parameters: {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        reply_kind: { type: 'string', enum: ['smalltalk', 'capability', 'clarification'] },
        complete: { type: 'boolean' },
      },
      required: ['answer', 'reply_kind', 'complete'],
    },
  },
];

const SURFACE_INCOMPLETE_PATTERNS = [
  /\b(untuk|karena|agar|supaya|sepertinya|mungkin|kalau|jika|dengan|bahwa|dan|atau|jadi|mau|ingin|perlu|bisa|akan)\.$/i,
  /\b(untuk|karena|agar|supaya|sepertinya|mungkin|kalau|jika)\s+[a-z]{1,6}\.$/i,
  /\b(memul|memban|memba|menjel|mengar|melih|menyi|menunj|member)\.$/i,
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

function looksLikeCompleteSurfaceReply(value = '', { replyKind = 'smalltalk' } = {}) {
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

  if (/\b(untuk|karena|agar|supaya|sepertinya|mungkin|kalau|jika)\s+[a-z]{1,5}\.$/i.test(text)) {
    return false;
  }

  if (/\b(memul|mul|lanjut|sepertinya)\.$/i.test(text)) {
    return false;
  }

  for (const pattern of SURFACE_INCOMPLETE_PATTERNS) {
    if (pattern.test(text)) {
      return false;
    }
  }

  if (replyKind === 'clarification' && !/[?]$/.test(text) && !/\b(bisa|mau|ingin|tolong|jelaskan|perjelas|metrik|periode|dashboard)\b/i.test(text)) {
    return false;
  }

  if (!/[.!?…]$/.test(text)) {
    return false;
  }

  return true;
}

function extractSurfaceReplyPayload(result) {
  const payload = (result.functionCalls || []).find((call) => call.name === 'reply_user')?.args
    || result.data
    || (typeof result.text === 'string' && result.text.trim()
      ? {
          answer: result.text,
          reply_kind: 'smalltalk',
          complete: looksLikeCompleteSurfaceReply(normalizeSurfaceReplyText(result.text)),
        }
      : null);

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return {
    answer: normalizeSurfaceReplyText(payload.answer || ''),
    reply_kind: ['smalltalk', 'capability', 'clarification'].includes(String(payload.reply_kind || '').trim().toLowerCase())
      ? String(payload.reply_kind || '').trim().toLowerCase()
      : 'smalltalk',
    complete: payload.complete === true,
  };
}

async function classifyRoute({ message, history, datasetReady, agentState, userDisplayName }) {
  const result = await generateWithGeminiTools({
    systemPrompt: [
      `Kamu adalah ${TEAM.orchestrator}, orchestrator agent untuk Vistara.`,
      Prompts.ORCHESTRATOR_AGENT,
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
    Prompts.SURFACE_AGENT,
    datasetReady ? 'Dataset tersedia.' : 'Dataset belum tersedia.',
    draftDashboard ? 'Ada draft dashboard aktif.' : 'Belum ada draft dashboard aktif.',
    routeReason ? `Konteks keputusan Atlas: ${routeReason}.` : '',
    userDisplayName ? `Info internal: nama user ${userDisplayName}.` : '',
  ].join('\n\n');

  const userPrompt = buildHistoryContext(history)
    ? `Riwayat:\n${buildHistoryContext(history)}\n\nPesan terbaru: ${message}`
    : `Pesan terbaru: ${message}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await generateWithGeminiTools({
      systemPrompt: [
        baseSystemPrompt,
        'Wajib panggil fungsi reply_user untuk setiap jawaban.',
        'Jawaban harus terasa selesai, bukan potongan kalimat.',
        attempt === 1
          ? 'Pastikan jawaban berupa satu pikiran utuh, kalimat lengkap, dan pertanyaan klarifikasi harus jelas serta bisa langsung dijawab user. Jangan berhenti di tengah frasa.'
          : '',
      ].filter(Boolean).join(' '),
      userPrompt,
      tools: SURFACE_REPLY_TOOL_DECLARATIONS,
      temperature: attempt === 0 ? 0.45 : 0.25,
      maxOutputTokens: attempt === 0 ? 220 : 280,
      modelOverride: config.geminiModelLight || config.geminiModel,
      thinkingBudget: 128,
      functionCallingMode: 'ANY',
      allowedFunctionNames: ['reply_user'],
    });

    if (!result.ok) {
      throw classifyGeminiFailure(result, 'Layanan AI sedang bermasalah saat membalas percakapan.');
    }

    const payload = extractSurfaceReplyPayload(result);
    if (!payload) {
      continue;
    }

    if (payload.complete === true && looksLikeCompleteSurfaceReply(payload.answer, { replyKind: payload.reply_kind })) {
      return payload.answer;
    }
  }

  throw new ConversationAgentError({
    code: 'AI_SERVICE_UNAVAILABLE',
    statusCode: 503,
    reason: 'surface_reply_incomplete',
    message: 'Layanan AI belum memberi jawaban yang utuh.',
  });
}

async function buildAnalyticsIntent({ message, history, route, datasetProfile, dashboardContext = null }) {
  const result = await generateWithGeminiTools({
    systemPrompt: [
      `Kamu adalah ${TEAM.analyst}, data analyst agent Vistara.`,
      'Ubah pertanyaan bisnis user menjadi parameter analytics yang aman dan grounded.',
      'intent hanya boleh salah satu dari: show_metric, compare, rank, explain.',
      'metric boleh menggunakan istilah bisnis seperti revenue, profit, margin, expense, top_products, branch_performance, revenue_trend.',
      'Pilih rank bila user meminta top/ranking/peringkat, compare bila user membandingkan periode, explain bila user meminta penjelasan umum tren, selain itu show_metric.',
      'Gunakan konteks dataset hanya untuk menghindari field yang tidak masuk akal.',
      'Jika user bertanya produk yang perlu didorong atau dijual lebih banyak, prioritaskan top_products atau ranking produk yang benar-benar bisa dibuktikan dari data.',
      'Jika user bertanya kenapa performa turun/naik, prioritaskan revenue_trend atau compare dengan periode relevan.',
    ].join(' '),
    userPrompt: JSON.stringify({
      message,
      history: buildHistoryContext(history),
      route,
      dataset_profile: compactDatasetProfile(datasetProfile),
      dashboard_context: dashboardContext,
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

function buildDraftDashboardPayload({
  widgets = [],
  artifacts = [],
  dashboard = null,
  runId,
  note = '',
  status = 'drafting',
  savedDashboardId = null,
  analysisBrief = null,
}) {
  const normalizedWidgets = Array.isArray(widgets) ? widgets : [];
  const pages = normalizedWidgets.reduce((max, widget) => Math.max(max, Number(widget?.layout?.page || 1)), 1);
  return {
    run_id: runId,
    status,
    note: String(note || '').trim() || null,
    pages: Math.max(1, Number(pages || 1)),
    widgets: normalizedWidgets,
    artifacts: Array.isArray(artifacts) ? artifacts : [],
    analysis_brief: analysisBrief && typeof analysisBrief === 'object' ? analysisBrief : null,
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
      analysisBrief: patch.analysis_brief || null,
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
  let effectiveMessage = message;
  let resolvedSavedDashboard = savedDashboard;
  let route = null;
  let resolvedDashboardChoice = null;

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

  const pendingChoice = pendingDashboardChoice(agentState);
  if (pendingChoice) {
    const choice = dashboardChoiceFromMessage(message);
    if (!choice) {
      const nextState = updateConversationAgentState({
        tenantId,
        userId,
        conversationId,
        activeRun: {
          run_id: runId,
          status: 'waiting_choice',
          stage: 'dashboard_choice',
          completed_at: new Date().toISOString(),
        },
      });

      return {
        answer: dashboardChoicePrompt(),
        content_format: 'markdown',
        widgets: [],
        artifacts: [],
        presentation_mode: 'chat',
        intent: {
          intent: 'clarify_dashboard_choice',
          nlu_source: 'atlas_memory',
        },
        draft_dashboard: nextState?.draft_dashboard || null,
        pending_approval: nextState?.pending_approval || null,
        agent: {
          mode: 'agentic_team_runtime',
          run_id: runId,
          team: TEAM,
          trace,
          route: {
            action: 'ask_clarification',
            reason: 'pending_dashboard_choice',
          },
        },
      };
    }

    agentState = updateConversationAgentState({
      tenantId,
      userId,
      conversationId,
      memory: nextOrchestratorMemory(agentState, {
        pending_dashboard_choice: null,
        last_dashboard_choice: choice,
      }),
    });

    resolvedDashboardChoice = choice;
    effectiveMessage = String(pendingChoice.message_context || message).trim() || message;
    route = {
      ...(pendingChoice.requested_route || {}),
      action: choice === 'edit' ? 'edit_dashboard' : 'create_dashboard',
      reason: `resolved_dashboard_choice_${choice}`,
    };
  }

  if (!route) {
    route = normalizeRouteDecision({
      route: await classifyRoute({
        message,
        history,
        datasetReady,
        agentState,
        userDisplayName,
      }),
      message,
      datasetReady,
      history,
      agentState,
    });
  }
  pushTrace(trace, { step: 'atlas_route', route });
  emitAgentStep(hooks, {
    run_id: runId,
    agent: TEAM.orchestrator,
    title: `Atlas memilih jalur ${route.action}`,
    status: 'done',
  });

  if (!datasetReady && ['analyze', 'inspect_dataset', 'create_dashboard', 'edit_dashboard'].includes(route.action)) {
    const answer = await generateSurfaceReply({
      message: effectiveMessage,
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
      content_format: 'plain',
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

  if (!resolvedDashboardChoice && shouldAskDashboardChoice({ route, agentState, savedDashboard: resolvedSavedDashboard })) {
    agentState = updateConversationAgentState({
      tenantId,
      userId,
      conversationId,
      memory: nextOrchestratorMemory(agentState, {
        pending_dashboard_choice: {
          asked_at: new Date().toISOString(),
          message_context: effectiveMessage,
          saved_dashboard_id: resolvedSavedDashboard?.id || agentState?.draft_dashboard?.saved_dashboard_id || null,
          requested_route: route,
        },
      }),
      activeRun: {
        run_id: runId,
        status: 'waiting_choice',
        stage: 'dashboard_choice',
        completed_at: new Date().toISOString(),
      },
    });

    return {
      answer: dashboardChoicePrompt(),
      content_format: 'markdown',
      widgets: [],
      artifacts: [],
      presentation_mode: 'chat',
      intent: {
        intent: 'clarify_dashboard_choice',
        nlu_source: 'atlas_gemini',
      },
      draft_dashboard: agentState?.draft_dashboard || null,
      pending_approval: agentState?.pending_approval || null,
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
      message: effectiveMessage,
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
      content_format: 'plain',
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
      content_format: 'plain',
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
      message: effectiveMessage,
      history,
      route,
      datasetProfile,
      dashboardContext: buildDashboardContext(agentState, resolvedSavedDashboard),
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
      content_format: 'markdown',
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

    let baseDashboard = runDashboardBaseFromState(agentState, resolvedSavedDashboard);
    if (route.action === 'create_dashboard' && (!baseDashboard || hasMeaningfulDashboardContext(agentState, resolvedSavedDashboard))) {
      baseDashboard = createDashboard(
        tenantId,
        userId,
        dashboardShellName(effectiveMessage),
        emptyDashboardShellConfig(),
      );
      resolvedSavedDashboard = baseDashboard;
    }
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
      dashboardId: baseDashboard?.id || dashboardId,
      dashboard: baseDashboard,
      goal: effectiveMessage,
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
            analysisBrief: patch.analysis_brief || null,
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
      analysisBrief: dashboardResult.analysis_brief || null,
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
      content_format: 'markdown',
      dashboard: baseDashboard,
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
      content_format: 'plain',
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
      content_format: 'plain',
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
    content_format: 'plain',
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
