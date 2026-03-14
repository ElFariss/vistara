import { generateId } from '../utils/ids.mjs';
import { parseIndonesianNumber } from '../utils/parse.mjs';
import { executeAnalyticsIntent, executeBuilderQuery, getDefaultBuilderSchema, getBuilderSchema } from './queryEngine.mjs';
import { getDashboard, getLatestDashboard } from './dashboards.mjs';
import { runPythonSnippet } from './pythonRuntime.mjs';
import { runPythonAnalysis } from './pythonSandbox.mjs';
import { generateJsonWithGeminiMedia, generateWithGeminiTools } from './gemini.mjs';
import { renderDashboardPng } from './dashboardImage.mjs';
import { config } from '../config.mjs';
import {
  DASHBOARD_GRID_COLS,
  DASHBOARD_GRID_ROWS,
  layoutsIntersect,
  normalizeDashboardLayout,
  packDashboardLayout,
  suggestDashboardLayout,
} from '../../public/dashboard-layout.js';
import { Prompts } from './agents/index.mjs';
import { getDatasetProfile } from './dataProfile.mjs';
import { getDatasetTable } from './datasetTables.mjs';
import { createLogger } from '../utils/logger.mjs';

const logger = createLogger('agent-runtime');

const VISTARA_SYSTEM_PROMPT = Prompts.VISTARA_SYSTEM;

const MAX_WIDGETS = 8;
const MIN_WIDGETS = 4;
const MAX_TRACE = 64;
const MAX_WORKER_STEPS = 8;
const MAX_ARGUS_STEPS = 2;
const MAX_ANALYST_CANDIDATES = 6;
const PLANNER_THINKING_BUDGET = 4096;
const ANALYST_THINKING_BUDGET = 4096;
const WORKER_THINKING_BUDGET = 6144;
const ARGUS_THINKING_BUDGET = 2048;
const PLANNER_MAX_OUTPUT_TOKENS = 1600;
const ANALYST_MAX_OUTPUT_TOKENS = 1800;
const WORKER_MAX_OUTPUT_TOKENS = 1800;
const ARGUS_MAX_OUTPUT_TOKENS = 1000;
const MIN_PAGE_WIDTH_COVERAGE = 0.96;
const MIN_PAGE_COVERAGE_DENSITY = 0.72;
const MIN_PAGE_ROW_COVERAGE = 0.7;
const MAX_ROW_RIGHT_GAP_COLS = 4;
const MIN_REVIEW_PASSES = 2;
const MAX_REVIEW_PASSES = 3;
const MAX_ADDITIONAL_WIDGETS_FOR_COVERAGE = 2;
const MAX_COVERAGE_REPAIR_PASSES = 3;
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

const COMPLEX_TEMPLATE_COMPONENTS = [
  { type: 'MetricCard', title: 'Omzet', metric: 'revenue' },
  { type: 'MetricCard', title: 'Untung', metric: 'profit' },
  { type: 'MetricCard', title: 'Margin', metric: 'margin' },
  { type: 'TrendChart', title: 'Trend Omzet', metric: 'revenue_trend', granularity: 'day' },
  { type: 'TopList', title: 'Produk Terlaris', metric: 'top_products' },
  { type: 'TopList', title: 'Performa Cabang', metric: 'branch_performance' },
];

const PLANNER_TOOL_DECLARATIONS = [
  {
    name: 'submit_plan',
    description: 'Submit a concise execution plan for dashboard generation.',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ordered execution steps for worker agent.',
        },
      },
      required: ['steps'],
    },
  },
];

const ANALYST_TOOL_DECLARATIONS = [
  {
    name: 'python_data_interpreter',
    description: 'Runs a Python script to analyze complex generic data shapes using pandas and openpyxl. Use this for datasets that cannot be processed through standard SQL queries.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The python script to execute. The target file is available as target_file variable.'
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'submit_analysis_brief',
    description: 'Submit a structured analyst brief grounded in real query results.',
    parameters: {
      type: 'object',
      properties: {
        headline: { type: 'string' },
        business_goal: { type: 'string' },
        time_scope: { type: 'string' },
        recommended_candidates: {
          type: 'array',
          items: { type: 'string' },
          description: 'Candidate IDs that should be prioritized for widget creation.',
        },
        recommend_dashboard: { type: 'boolean' },
        dashboard_reason: { type: 'string' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              candidate_id: { type: 'string' },
              insight: { type: 'string' },
              evidence: { type: 'string' },
              why_it_matters: { type: 'string' },
              recommended_visual: { type: 'string' },
              priority: { type: 'string', enum: ['primary', 'supporting'] },
            },
            required: ['id', 'candidate_id', 'insight', 'evidence', 'why_it_matters', 'recommended_visual', 'priority'],
          },
        },
      },
      required: ['headline', 'business_goal', 'time_scope', 'findings'],
    },
  },
];

const WORKER_TOOL_DECLARATIONS = [
  {
    name: 'python_data_interpreter',
    description: 'Runs a Python script to analyze complex generic data shapes using pandas and openpyxl. Use for datasets that cannot be processed through standard SQL queries.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The python script to execute. The target file is available as target_file variable.'
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'read_dashboard_template',
    description: 'Read available dashboard components before running data queries.',
    parameters: {
      type: 'object',
      properties: {
        dashboard_id: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'query_template',
    description: 'Run a template analytics query against user dataset.',
    parameters: {
      type: 'object',
      properties: {
        template_id: { type: 'string' },
        metric: { type: 'string' },
        time_period: { type: 'string' },
        branch: { type: 'string' },
        channel: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'query_builder',
    description: 'Run a generic builder query for custom widget generation.',
    parameters: {
      type: 'object',
      properties: {
        dataset: { type: 'string' },
        measure: { type: 'string' },
        group_by: { type: 'string' },
        visualization: { type: 'string' },
        title: { type: 'string' },
        time_period: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'finalize_dashboard',
    description: 'Mark worker execution complete and provide summary.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        layout_plan: {
          type: 'object',
          properties: {
            strategy: { type: 'string' },
            pages: { type: 'number' },
            placements: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  metric: { type: 'string' },
                  template_id: { type: 'string' },
                  kind: { type: 'string' },
                  page: { type: 'number' },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  w: { type: 'number' },
                  h: { type: 'number' },
                },
              },
            },
          },
        },
      },
      required: ['summary'],
    },
  },
];

const ARGUS_TOOL_DECLARATIONS = [
  {
    name: 'python_exec',
    description: 'Execute sandboxed Python code against provided context artifacts.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string' },
      },
      required: ['code'],
    },
  },
  {
    name: 'python_data_interpreter',
    description: 'Runs a Python script to analyze complex generic data shapes using pandas and openpyxl, avoiding strict SQL schema failures. Prints final results via stdout using print().',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The python script to execute. The target file is available as target_file variable.'
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'submit_review',
    description: 'Submit Argus visual curation verdict after assessing dashboard quality.',
    parameters: {
      type: 'object',
      properties: {
        verdict: { type: 'string' },
        completeness_pct: { type: 'number' },
        summary: { type: 'string' },
      },
      required: ['verdict', 'summary'],
    },
  },
];

const PYTHON_REVIEW_CODE = `
artifacts = context.get("artifacts", [])
non_empty = 0
metric_positive = 0
table_rows = 0
chart_points = 0

for item in artifacts:
    kind = str(item.get("kind", ""))
    if kind == "metric":
        raw = item.get("raw_value")
        if raw is None:
            text_value = "".join(ch for ch in str(item.get("value", "")) if ch.isdigit() or ch in ".-")
            raw = float(text_value) if text_value else 0.0
        if float(raw or 0) > 0:
            metric_positive += 1
            non_empty += 1
    elif kind == "table":
        rows = item.get("rows", []) or []
        table_rows += len(rows)
        if len(rows) > 0:
            non_empty += 1
    elif kind == "chart":
        values = []
        for series in item.get("series", []) or []:
            values.extend(series.get("values", []) or [])
        chart_points += len(values)
        if any(float(v or 0) != 0 for v in values):
            non_empty += 1

total = len(artifacts)
completeness = 0 if total == 0 else round((non_empty / total) * 100, 2)

if total == 0:
    verdict = "no_artifacts"
elif completeness < 35:
    verdict = "low"
elif completeness < 70:
    verdict = "medium"
else:
    verdict = "high"

result = {
    "total_widgets": total,
    "non_empty_widgets": non_empty,
    "metric_positive": metric_positive,
    "table_rows": table_rows,
    "chart_points": chart_points,
    "completeness_pct": completeness,
    "verdict": verdict,
}
`;

export class DashboardAgentError extends Error {
  constructor({
    code = 'DASHBOARD_AGENT_FAILED',
    message = 'Gagal membuat dashboard.',
    statusCode = 503,
    retryable = false,
    reason = null,
    details = null,
  } = {}) {
    super(message);
    this.name = 'DashboardAgentError';
    this.code = code;
    this.statusCode = statusCode;
    this.publicMessage = message;
    this.retryable = Boolean(retryable);
    this.reason = reason || code.toLowerCase();
    this.details = details ?? null;
  }
}

function safeText(value, fallback = '', maxLen = 180) {
  const text = String(value ?? '').trim();
  if (!text) {
    return fallback;
  }
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function nonEmptyWidgetCount(widgets = []) {
  return widgets.filter((widget) => !artifactLooksEmpty(widget?.artifact)).length;
}

function normalizeUserFacingText(value, fallback = '') {
  const text = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text || fallback;
}

function pushTrace(trace, step) {
  trace.push(step);
  if (trace.length > MAX_TRACE) {
    trace.shift();
  }
}

function emitTimelineEvent(hooks, event) {
  if (!hooks || typeof hooks.onTimelineEvent !== 'function') {
    return;
  }
  try {
    hooks.onTimelineEvent({
      ...event,
      ts: new Date().toISOString(),
    });
  } catch {
    // Timeline emission must not break dashboard generation flow.
  }
}

function emitDashboardPatch(hooks, patch) {
  if (!hooks || typeof hooks.onDashboardPatch !== 'function') {
    return;
  }
  try {
    hooks.onDashboardPatch({
      ...patch,
      ts: new Date().toISOString(),
    });
  } catch {
    // Patch emission must not break dashboard generation flow.
  }
}

function summarizeThoughtForTimeline(thoughts = [], fallback = '') {
  if (!Array.isArray(thoughts) || thoughts.length === 0) {
    return fallback;
  }

  const text = String(thoughts.join(' ')
    .replace(/[`*_>#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
  if (!text) {
    return fallback;
  }

  let sentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  sentence = sentence.replace(/^okay[,.!\s]*/i, '').trim();
  sentence = sentence.replace(/^my\s+(action plan|planning process)\s+for\s+/i, 'Menyusun ');
  sentence = sentence.replace(/^i will\s+/i, 'Saya akan ');
  const lower = sentence.toLowerCase();
  if (/^my\b.*\bplan\b/.test(lower) || /(execution plan|here'?s the plan|action plan|planning process|plan for building|build(ing)?.*dashboard)/.test(lower)) {
    return 'Menyusun rencana dashboard berbasis dataset';
  }
  if (/(dashboard review|review.*dashboard|menilai|audit)/.test(lower)) {
    return 'Meninjau kualitas dashboard dan kelengkapan visual';
  }
  if (/dashboard creation|phase\s*\d+|next step/.test(lower)) {
    return 'Menentukan langkah berikutnya untuk melengkapi dashboard';
  }
  if (/(identify|date column|time column|numeric|measure|schema)/.test(lower)) {
    return 'Mengidentifikasi kolom tanggal dan metrik numerik';
  }
  if (/(dashboard)/.test(lower) && /(layout|visual|widget)/.test(lower)) {
    return 'Merancang layout visual dashboard';
  }

  return safeText(sentence, fallback, 120);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLimit(limit, fallback = 8, max = 50) {
  const parsed = Number.parseInt(String(limit ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

async function dashboardFromContext(tenantId, userId, dashboardId = null) {
  if (dashboardId) {
    const specific = await getDashboard(tenantId, userId, dashboardId);
    if (specific) {
      return specific;
    }
  }
  const latest = await getLatestDashboard(tenantId, userId);
  if (latest) {
    return latest;
  }
  return {
    id: `draft_${generateId()}`,
    name: 'Draft Dashboard',
    config: {
      mode: 'ai',
      pages: 1,
      components: [],
      updated_by: 'agent',
    },
  };
}

function normalizeScope(intent = {}) {
  return {
    time_period: intent.time_period || intent.period || '30 hari terakhir',
    branch: intent.branch || null,
    channel: intent.channel || null,
    limit: normalizeLimit(intent.limit, 8, 50),
  };
}

const BUILDER_SCHEMA = getDefaultBuilderSchema();
const BUILDER_DATASETS = Array.isArray(BUILDER_SCHEMA?.datasets) ? BUILDER_SCHEMA.datasets : [];

function datasetSpec(datasetId = 'transactions') {
  const requested = String(datasetId || 'transactions').toLowerCase();
  return BUILDER_DATASETS.find((dataset) => dataset.id === requested)
    || BUILDER_DATASETS.find((dataset) => dataset.id === 'transactions')
    || BUILDER_DATASETS[0]
    || {
      id: 'transactions',
      measures: ['revenue'],
      dimensions: ['none', 'day'],
    };
}

function detectDateDimension(dimensions = []) {
  const list = Array.isArray(dimensions) ? dimensions.map((value) => String(value || '').toLowerCase()) : [];
  return list.find((value) => /(day|date|time|month|week|year)/.test(value))
    || (list.includes('day') ? 'day' : null)
    || list.find((value) => value !== 'none')
    || 'none';
}

function normalizeVisualization(value, fallback = 'line') {
  const normalized = safeText(value, fallback, 24).toLowerCase();
  const allowed = new Set(['metric', 'table', 'line', 'bar', 'pie']);
  return allowed.has(normalized) ? normalized : fallback;
}

function edaSuggestionForComponent(component = {}) {
  const metricKey = componentMetricKey(component);
  if (metricKey === 'total_expense') {
    return {
      dataset: 'expenses',
      measure: 'amount',
      group_by: 'day',
      visualization: component.type === 'MetricCard' ? 'metric' : 'line',
    };
  }

  if (metricKey === 'top_products') {
    return { dataset: 'transactions', measure: 'revenue', group_by: 'product', visualization: 'bar' };
  }
  if (metricKey === 'branch_performance') {
    return { dataset: 'transactions', measure: 'revenue', group_by: 'branch', visualization: 'bar' };
  }
  if (metricKey === 'revenue_trend') {
    return { dataset: 'transactions', measure: 'revenue', group_by: 'day', visualization: 'line' };
  }
  if (metricKey === 'margin_percentage') {
    return { dataset: 'transactions', measure: 'margin', group_by: 'none', visualization: 'metric' };
  }
  if (metricKey === 'total_profit') {
    return { dataset: 'transactions', measure: 'profit', group_by: 'none', visualization: 'metric' };
  }
  return { dataset: 'transactions', measure: 'revenue', group_by: 'none', visualization: 'metric' };
}

async function buildEdaProfile({ tenantId, components = [], scope = {} }) {
  const schema = await getBuilderSchema(tenantId);
  const datasets = (schema.datasets || []).map((dataset) => {
    const dimensions = Array.isArray(dataset.dimensions) ? dataset.dimensions : [];
    const measures = Array.isArray(dataset.measures) ? dataset.measures : [];
    return {
      id: dataset.id,
      date_columns: dimensions.filter((dimension) => /(day|date|time|month|week|year)/i.test(String(dimension || ''))),
      numeric_measures: measures,
      default_date_column: detectDateDimension(dimensions),
      default_measure: measures[0] || null,
    };
  });

  return {
    checklist: [
      'Identifikasi kolom tanggal/waktu sebelum memilih visual tren.',
      'Gunakan hanya measure numerik yang valid dari schema dataset.',
      'Untuk line/bar/pie/table wajib pilih group_by bukan none.',
    ],
    scope: {
      time_period: scope.time_period || '30 hari terakhir',
      branch: scope.branch || null,
      channel: scope.channel || null,
    },
    datasets,
    component_targets: components.slice(0, 8).map((component, index) => ({
      index,
      title: component.title || `Widget ${index + 1}`,
      ...edaSuggestionForComponent(component),
    })),
  };
}

function summarizeEdaForTimeline(edaProfile = {}) {
  const datasets = Array.isArray(edaProfile.datasets) ? edaProfile.datasets : [];
  if (datasets.length === 0) {
    return 'Menganalisis skema dataset aktif';
  }

  const parts = datasets.map((dataset) => {
    const dates = Array.isArray(dataset.date_columns) ? dataset.date_columns.filter(Boolean) : [];
    const nums = Array.isArray(dataset.numeric_measures) ? dataset.numeric_measures.filter(Boolean) : [];
    const dateLabel = dates.length > 0 ? dates.join('/') : 'tanpa kolom tanggal';
    const measureLabel = nums.length > 0 ? nums.slice(0, 3).join('/') : 'tanpa measure numerik';
    return `${dataset.id}: tanggal ${dateLabel}, numerik ${measureLabel}`;
  });

  return safeText(`Menganalisis skema dataset (${parts.join(' | ')})`, 'Menganalisis skema dataset aktif', 170);
}

function componentMetricKey(component = {}) {
  const text = `${component.metric || ''} ${component.title || ''}`.toLowerCase();
  if (text.includes('branch_performance') || text.includes('cabang')) {
    return 'branch_performance';
  }
  if (text.includes('top_products') || text.includes('produk')) {
    return 'top_products';
  }
  if (text.includes('revenue_trend') || text.includes('trend') || text.includes('grafik')) {
    return 'revenue_trend';
  }
  if (text.includes('profit') || text.includes('untung') || text.includes('laba')) {
    return 'total_profit';
  }
  if (text.includes('margin')) {
    return 'margin_percentage';
  }
  if (text.includes('expense') || text.includes('biaya')) {
    return 'total_expense';
  }
  return 'total_revenue';
}

function normalizeKeyText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function artifactSemanticKey(artifact = {}) {
  const metricKey = normalizeTemplateId(artifact?.metric || artifact?.template_id || artifact?.title || '');
  if (metricKey) {
    return metricKey;
  }

  return componentMetricKey({
    metric: artifact?.metric || '',
    title: artifact?.title || '',
  });
}

function artifactValueSignature(artifact = {}) {
  if (artifact.kind === 'metric') {
    const raw = parseArtifactNumber(artifact.raw_value ?? artifact.value);
    return `${raw ?? safeText(artifact.value || '-', '-', 32)}:${safeText(artifact.delta || '', '', 48)}`;
  }

  if (artifact.kind === 'chart') {
    const labels = Array.isArray(artifact.labels) ? artifact.labels.slice(0, 8).map((label) => safeText(label, '', 24)) : [];
    const values = (artifact.series || [])
      .flatMap((series) => series.values || [])
      .slice(0, 12)
      .map((value) => toNumber(value, 0));
    return `${labels.join('|')}::${values.join('|')}`;
  }

  if (artifact.kind === 'table') {
    const rows = Array.isArray(artifact.rows) ? artifact.rows : [];
    return rows
      .slice(0, 5)
      .map((row) => `${normalizeKeyText(row?.name || row?.label || row?.branch || row?.product || '')}:${parseArtifactNumber(
        row?.value ?? row?.total_revenue ?? row?.revenue ?? row?.total_profit ?? row?.profit,
      ) ?? '-'}`)
      .join('|');
  }

  return safeText(JSON.stringify(artifact), '', 240);
}

function artifactDedupKey(artifact = {}) {
  const semantic = artifactSemanticKey(artifact);
  if (semantic) {
    const signature = artifactValueSignature(artifact);
    return `${artifact.kind || 'unknown'}:${semantic}${signature ? `:${signature}` : ''}`;
  }

  return `${artifact.kind || 'unknown'}:${normalizeKeyText(artifact.title || '')}:${artifactValueSignature(artifact)}`;
}

function widgetDedupKey(widget = {}) {
  const query = widget?.query || {};
  const templateId = normalizeTemplateId(query.template_id || query.metric || widget?.metric || widget?.artifact?.title || '');
  if (templateId) {
    return [
      'template',
      templateId,
      normalizeKeyText(query.time_period || ''),
      normalizeKeyText(query.branch || ''),
      normalizeKeyText(query.channel || ''),
      normalizeLimit(query.limit, 0, 500),
    ].join(':');
  }

  if (query.dataset || query.measure || query.group_by || query.visualization) {
    return [
      'builder',
      normalizeKeyText(query.dataset || 'transactions'),
      normalizeKeyText(query.measure || ''),
      normalizeKeyText(query.group_by || ''),
      normalizeKeyText(query.visualization || ''),
      normalizeKeyText(query.time_period || ''),
    ].join(':');
  }

  return artifactDedupKey(widget?.artifact || {});
}

function toolCallKey(call = {}) {
  if (call.tool === 'query_template') {
    return [
      'query_template',
      normalizeTemplateId(call.args?.template_id || call.args?.metric || ''),
      normalizeKeyText(call.args?.time_period || ''),
      normalizeKeyText(call.args?.branch || ''),
      normalizeKeyText(call.args?.channel || ''),
      normalizeLimit(call.args?.limit, 0, 500),
    ].join(':');
  }

  if (call.tool === 'query_builder') {
    return [
      'query_builder',
      normalizeKeyText(call.args?.dataset || ''),
      normalizeKeyText(call.args?.measure || ''),
      normalizeKeyText(call.args?.group_by || ''),
      normalizeKeyText(call.args?.visualization || ''),
      normalizeKeyText(call.args?.time_period || ''),
      normalizeLimit(call.args?.limit, 0, 500),
    ].join(':');
  }

  if (call.name === 'read_dashboard_template' || call.tool === 'read_dashboard_template') {
    return `read_dashboard_template:${safeText(call.args?.dashboard_id || '', '', 80)}`;
  }

  return null;
}

function dedupeComponents(components = []) {
  const seen = new Set();
  const result = [];

  for (const component of components) {
    if (!component) {
      continue;
    }
    if (component.id) {
      if (seen.has(component.id)) {
        continue;
      }
      seen.add(component.id);
      result.push(component);
      continue;
    }
    const key = component?.query && typeof component.query === 'object'
      ? [
          'builder',
          normalizeKeyText(component.query.dataset || ''),
          normalizeKeyText(component.query.measure || ''),
          normalizeKeyText(component.query.group_by || ''),
          normalizeKeyText(component.query.visualization || ''),
          normalizeKeyText(component.query.time_period || ''),
          normalizeKeyText(component.title || ''),
        ].join(':')
      : [
          'template',
          normalizeTemplateId(component.metric || component.title || component.type || '') || componentMetricKey(component),
          normalizeKeyText(component.title || ''),
        ].join(':');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(component);
  }

  return result;
}

function dedupeWidgets(widgets = []) {
  const seen = new Set();
  const result = [];

  for (const widget of widgets) {
    const key = widgetDedupKey(widget);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(widget);
  }

  return result;
}

function normalizeTemplateId(raw) {
  const text = String(raw || '').toLowerCase().trim();
  const allowed = [
    'total_revenue',
    'total_profit',
    'margin_percentage',
    'revenue_trend',
    'top_products',
    'branch_performance',
    'total_expense',
  ];

  if (allowed.includes(text)) {
    return text;
  }

  if (text.includes('profit') || text.includes('untung') || text.includes('laba')) {
    return 'total_profit';
  }
  if (text.includes('margin')) {
    return 'margin_percentage';
  }
  if (text.includes('trend')) {
    return 'revenue_trend';
  }
  if (text.includes('product') || text.includes('produk')) {
    return 'top_products';
  }
  if (text.includes('branch') || text.includes('cabang')) {
    return 'branch_performance';
  }
  if (text.includes('expense') || text.includes('biaya')) {
    return 'total_expense';
  }

  return null;
}

function templateIntentFromComponent(component, scope) {
  const templateId = componentMetricKey(component);
  const intentType = templateId === 'top_products' || templateId === 'branch_performance' ? 'rank' : 'show_metric';

  return {
    intent: intentType,
    metric: component.metric || component.title || templateId,
    template_id: templateId,
    time_period: scope.time_period,
    branch: scope.branch,
    channel: scope.channel,
    limit: scope.limit,
    dimension: templateId === 'branch_performance' ? 'branch' : null,
  };
}

function normalizeTemplateQueryArgs(args, scope) {
  const templateId = normalizeTemplateId(args?.template_id || args?.metric || '');
  const finalTemplateId = templateId || 'total_revenue';

  return {
    intent: finalTemplateId === 'top_products' || finalTemplateId === 'branch_performance' ? 'rank' : 'show_metric',
    metric: safeText(args?.metric || finalTemplateId, finalTemplateId, 64),
    template_id: finalTemplateId,
    time_period: safeText(args?.time_period || scope.time_period, scope.time_period, 64),
    branch: args?.branch ? safeText(args.branch, '', 64) : scope.branch,
    channel: args?.channel ? safeText(args.channel, '', 64) : scope.channel,
    limit: normalizeLimit(args?.limit, scope.limit, 50),
    dimension: finalTemplateId === 'branch_performance' ? 'branch' : null,
  };
}

function normalizeBuilderQueryArgs(args, scope) {
  const requestedDataset = String(args?.dataset || 'transactions').toLowerCase();
  const dataset = requestedDataset === 'expenses' ? 'expenses' : 'transactions';
  const spec = datasetSpec(dataset);

  const allowedMeasures = Array.isArray(spec.measures) ? spec.measures.map((item) => String(item).toLowerCase()) : [];
  const allowedDimensions = Array.isArray(spec.dimensions) ? spec.dimensions.map((item) => String(item).toLowerCase()) : [];
  const dateDimension = detectDateDimension(allowedDimensions);

  const fallbackMeasure = dataset === 'expenses' ? 'amount' : 'revenue';
  let measure = safeText(args?.measure || fallbackMeasure, fallbackMeasure, 40).toLowerCase();
  if (!allowedMeasures.includes(measure)) {
    measure = allowedMeasures[0] || fallbackMeasure;
  }

  let groupBy = safeText(args?.group_by || 'none', 'none', 40).toLowerCase();
  if (!allowedDimensions.includes(groupBy)) {
    groupBy = 'none';
  }

  let visualization = normalizeVisualization(args?.visualization, groupBy === 'none' ? 'metric' : 'line');
  if (visualization === 'metric') {
    groupBy = 'none';
  } else if (groupBy === 'none') {
    groupBy = dateDimension || allowedDimensions.find((value) => value !== 'none') || 'none';
    if (groupBy === 'none' && visualization !== 'table') {
      visualization = 'metric';
    }
  }

  const defaultLimit = visualization === 'metric' ? 1 : scope.limit;

  return {
    dataset,
    measure,
    group_by: groupBy,
    visualization,
    title: args?.title ? safeText(args.title, '', 80) : null,
    time_period: safeText(args?.time_period || scope.time_period, scope.time_period, 64),
    limit: normalizeLimit(args?.limit, defaultLimit, 500),
  };
}

function toolCallFromComponent(component, scope) {
  if (component?.query && typeof component.query === 'object') {
    return {
      tool: 'query_builder',
      args: normalizeBuilderQueryArgs(component.query, scope),
      source: 'component_query',
    };
  }

  if (typeof component?.type === 'string' || typeof component?.metric === 'string') {
    return {
      tool: 'query_template',
      args: templateIntentFromComponent(component, scope),
      source: 'component_template',
    };
  }

  return null;
}

function cloneComponent(component) {
  const kind = component?.type === 'MetricCard'
    ? 'metric'
    : component?.type === 'TopList'
      ? 'table'
      : 'chart';
  return {
    ...component,
    layout: component?.layout
      ? normalizeDashboardLayout(component.layout, {
          page: Number(component.layout.page || 1),
          kind,
        })
      : null,
  };
}

function toArtifactFromLegacyWidget(widget) {
  if (!widget) {
    return null;
  }

  if (widget.type === 'MetricCard') {
    return {
      kind: 'metric',
      title: widget.title,
      value: widget.displayValue || `${Number(widget.value || 0).toLocaleString('id-ID')}`,
      raw_value: Number(widget.value || 0),
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
          name: widget.title || 'Trend',
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
        value: extractTopListValue(item),
      })),
    };
  }

  return null;
}

function extractTopListValue(item = {}) {
  const candidates = [
    item.total_revenue,
    item.revenue,
    item.total_profit,
    item.profit,
    item.total_expense,
    item.expense,
    item.amount,
    item.total,
    item.value,
    item.quantity,
    item.qty,
    item.count,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) {
      continue;
    }
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = parseIndonesianNumber(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function artifactsFromAnalyticsResult(result) {
  if (Array.isArray(result?.artifacts) && result.artifacts.length > 0) {
    return result.artifacts;
  }
  return (result?.widgets || []).map(toArtifactFromLegacyWidget).filter(Boolean);
}

function artifactLooksEmpty(artifact) {
  if (!artifact) {
    return true;
  }

  if (artifact.kind === 'metric') {
    const raw = Number(artifact.raw_value);
    if (Number.isFinite(raw)) {
      return false;
    }
    const parsed = parseIndonesianNumber(artifact.value);
    return !Number.isFinite(parsed);
  }

  if (artifact.kind === 'table') {
    return !Array.isArray(artifact.rows) || artifact.rows.length === 0;
  }

  if (artifact.kind === 'chart') {
    const values = (artifact.series || []).flatMap((series) => series.values || []);
    if (values.length === 0) {
      return true;
    }
    return false;
  }

  return false;
}

function widgetLayoutKey(widget = {}) {
  const templateId = normalizeTemplateId(widget?.query?.template_id || widget?.query?.metric || '');
  if (templateId) {
    return templateId;
  }

  return componentMetricKey({
    metric: widget?.query?.metric || widget?.metric || '',
    title: widget?.title || widget?.artifact?.title || '',
  });
}

function normalizeLayoutTitle(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizePlacementMetricKey(rawPlacement = {}) {
  return normalizeTemplateId(rawPlacement?.template_id || rawPlacement?.metric || '');
}

function normalizeLayoutPlan(rawPlan = null) {
  if (!rawPlan || typeof rawPlan !== 'object') {
    return null;
  }

  const placements = Array.isArray(rawPlan.placements)
    ? rawPlan.placements
      .map((placement) => {
        if (!placement || typeof placement !== 'object') {
          return null;
        }
        const kind = safeText(placement.kind, '', 24) || 'chart';
        return {
          title: safeText(placement.title || '', '', 120),
          metric: safeText(placement.metric || '', '', 64),
          template_id: safeText(placement.template_id || '', '', 64),
          kind,
          layout: normalizeDashboardLayout(placement, {
            page: Number(placement.page || 1),
            kind,
          }),
        };
      })
      .filter(Boolean)
    : [];

  return {
    strategy: safeText(rawPlan.strategy || 'balanced', 'balanced', 40),
    pages: Math.max(1, Math.min(Number(rawPlan.pages || 1), 4)),
    placements,
  };
}

function applyComponentLayouts(widgets = [], components = []) {
  const layoutPool = new Map();
  const titlePool = new Map();

  for (const component of components) {
    if (!component?.layout) {
      continue;
    }
    const titleKey = normalizeLayoutTitle(component.title);
    if (titleKey) {
      const titleList = titlePool.get(titleKey) || [];
      titleList.push(component.layout);
      titlePool.set(titleKey, titleList);
    }
    const key = componentMetricKey(component);
    const list = layoutPool.get(key) || [];
    list.push(component.layout);
    layoutPool.set(key, list);
  }

  return widgets.map((widget) => {
    const titleKey = normalizeLayoutTitle(widget?.title || widget?.artifact?.title);
    const titleList = titlePool.get(titleKey);
    if (Array.isArray(titleList) && titleList.length > 0) {
      const [layout, ...rest] = titleList;
      titlePool.set(titleKey, rest);
      return {
        ...widget,
        layout,
        _layoutSource: 'component',
      };
    }

    const key = widgetLayoutKey(widget);
    const list = layoutPool.get(key);
    if (!Array.isArray(list) || list.length === 0) {
      return widget;
    }

    const [layout, ...rest] = list;
    layoutPool.set(key, rest);
    return {
      ...widget,
      layout,
      _layoutSource: 'component',
    };
  });
}

function applyWorkerLayoutPlan(widgets = [], layoutPlan = null) {
  if (!layoutPlan?.placements?.length) {
    return widgets;
  }

  const titlePool = new Map();
  const metricPool = new Map();

  for (const placement of layoutPlan.placements) {
    if (placement.title) {
      const titleKey = normalizeLayoutTitle(placement.title);
      if (titleKey) {
        const list = titlePool.get(titleKey) || [];
        list.push(placement.layout);
        titlePool.set(titleKey, list);
      }
    }

    const metricKey = normalizePlacementMetricKey(placement);
    if (metricKey) {
      const list = metricPool.get(metricKey) || [];
      list.push(placement.layout);
      metricPool.set(metricKey, list);
    }
  }

  return widgets.map((widget) => {
    const titleKey = normalizeLayoutTitle(widget?.title || widget?.artifact?.title);
    const titleList = titlePool.get(titleKey);
    if (Array.isArray(titleList) && titleList.length > 0) {
      const [layout, ...rest] = titleList;
      titlePool.set(titleKey, rest);
      return {
        ...widget,
        layout,
        _layoutSource: 'worker',
      };
    }

    const metricKey = widgetLayoutKey(widget);
    const metricList = metricPool.get(metricKey);
    if (!Array.isArray(metricList) || metricList.length === 0) {
      return widget;
    }

    const [layout, ...rest] = metricList;
    metricPool.set(metricKey, rest);
    return {
      ...widget,
      layout,
      _layoutSource: 'worker',
    };
  });
}

function widgetCategory(widget = {}) {
  const kind = String(widget?.artifact?.kind || '').toLowerCase();
  if (kind === 'metric') {
    return 'kpi';
  }
  if (kind === 'table') {
    return 'ranking';
  }
  return 'trend';
}

function shouldKeepBalancedMultiPageLayout(widgets = [], layoutPlan = null) {
  if (!widgets.length) {
    return false;
  }

  if (layoutPlan && Number(layoutPlan.pages || 1) > 1) {
    const hasLaterWidget = widgets.some((widget) => Number(widget?.layout?.page || 1) > 1);
    if (hasLaterWidget) {
      return true;
    }
  }

  if (widgets.length > 6) {
    return true;
  }

  const byPage = new Map();
  widgets.forEach((widget) => {
    const page = Number(widget.layout?.page || 1);
    const list = byPage.get(page) || [];
    list.push(widget);
    byPage.set(page, list);
  });

  if (byPage.size < 2) {
    return false;
  }

  const firstPageWidgets = byPage.get(1) || [];
  const laterPageWidgets = Array.from(byPage.entries())
    .filter(([page]) => Number(page) > 1)
    .flatMap(([, items]) => items);

  if (firstPageWidgets.length < 2 || laterPageWidgets.length < 2) {
    return false;
  }

  const firstPageCategories = new Set(firstPageWidgets.map(widgetCategory));
  const laterPageCategories = new Set(laterPageWidgets.map(widgetCategory));

  if (firstPageCategories.has('kpi') && (laterPageCategories.has('trend') || laterPageCategories.has('ranking'))) {
    return true;
  }

  if (laterPageWidgets.some((widget) => widget?._layoutSource === 'component' || widget?._layoutSource === 'worker')) {
    return true;
  }

  return Boolean(layoutPlan && Number(layoutPlan.pages || 1) > 1 && laterPageWidgets.length >= 1);
}

function nonMetricSlots(startY, count) {
  if (count <= 1) {
    return [{ x: 0, y: startY, w: 16, h: 4, page: 1 }];
  }

  if (count === 2) {
    return [
      { x: 0, y: startY, w: 8, h: 4, page: 1 },
      { x: 8, y: startY, w: 8, h: 4, page: 1 },
    ];
  }

  if (count === 3) {
    return [
      { x: 0, y: startY, w: 5, h: 3, page: 1 },
      { x: 5, y: startY, w: 5, h: 3, page: 1 },
      { x: 10, y: startY, w: 6, h: 3, page: 1 },
    ];
  }

  return [
    { x: 0, y: startY, w: 8, h: 3, page: 1 },
    { x: 8, y: startY, w: 8, h: 3, page: 1 },
    { x: 0, y: startY + 3, w: 8, h: 3, page: 1 },
    { x: 8, y: startY + 3, w: 8, h: 3, page: 1 },
  ];
}

function metricRowSlots(count) {
  const total = Math.max(0, Number(count || 0));
  if (total === 0) {
    return [];
  }

  const baseWidth = Math.floor(DASHBOARD_GRID_COLS / total);
  let remainder = DASHBOARD_GRID_COLS - (baseWidth * total);
  let cursorX = 0;

  return Array.from({ length: total }, () => {
    const extra = remainder > 0 ? 1 : 0;
    const width = baseWidth + extra;
    remainder = Math.max(0, remainder - 1);
    const slot = {
      x: cursorX,
      y: 0,
      w: width,
      h: 2,
      page: 1,
    };
    cursorX += width;
    return slot;
  });
}

function applyBalancedSinglePageFallback(widgets = []) {
  const metricIndexes = [];
  const nonMetricIndexes = [];

  widgets.forEach((widget, index) => {
    if (widgetCategory(widget) === 'kpi') {
      metricIndexes.push(index);
      return;
    }
    nonMetricIndexes.push(index);
  });

  const metricSlots = metricRowSlots(metricIndexes.length);
  const chartStartY = metricSlots.length > 0 ? 2 : 0;
  const otherSlots = nonMetricSlots(chartStartY, nonMetricIndexes.length);
  const nextWidgets = widgets.map((widget) => ({ ...widget }));

  metricIndexes.forEach((widgetIndex, slotIndex) => {
    nextWidgets[widgetIndex].layout = normalizeDashboardLayout(metricSlots[slotIndex], {
      kind: nextWidgets[widgetIndex].artifact?.kind || 'metric',
      page: 1,
    });
  });

  nonMetricIndexes.forEach((widgetIndex, slotIndex) => {
    nextWidgets[widgetIndex].layout = normalizeDashboardLayout(otherSlots[slotIndex], {
      kind: nextWidgets[widgetIndex].artifact?.kind || 'chart',
      page: 1,
    });
  });

  return nextWidgets;
}

function finalizeBalancedWidgets(widgets = [], layoutPlan = null) {
  const strongWidgets = dedupeWidgets(
    widgets.filter((widget) => !artifactLooksEmpty(widget.artifact)),
  ).slice(0, MAX_WIDGETS);

  if (strongWidgets.length === 0) {
    return {
      widgets: [],
      artifacts: [],
      nonEmptyCount: 0,
      pageCount: 0,
    };
  }

  const allowMultiPage = shouldKeepBalancedMultiPageLayout(strongWidgets, layoutPlan);
  const seeded = allowMultiPage && strongWidgets.length > 6 && !strongWidgets.some((widget) => Number(widget.layout?.page || 1) > 1)
    ? strongWidgets.map((widget, index) => {
      if (widget._layoutSource === 'component') {
        return widget;
      }
      return {
        ...widget,
        layout: normalizeDashboardLayout({
          ...(widget.layout || {}),
          page: index < 6 ? 1 : 2,
        }, {
          page: index < 6 ? 1 : 2,
          kind: widget.artifact?.kind || 'chart',
        }),
      };
    })
    : strongWidgets;

  const prepared = seeded.map((widget) => {
    if (allowMultiPage || !widget.layout) {
      return widget;
    }
    return {
      ...widget,
      layout: {
        ...widget.layout,
        page: 1,
      },
    };
  });

  const compactSinglePagePrepared = !allowMultiPage && !prepared.some((widget) => widget.layout)
    ? applyBalancedSinglePageFallback(prepared)
    : prepared;

  const packedWidgets = packDashboardLayout(compactSinglePagePrepared.map((widget) => ({
    ...widget,
    kind: widget.artifact?.kind || 'chart',
  }))).map((widget) => ({
    ...widget,
    layout: normalizeDashboardLayout(widget.layout || {}, {
      page: Number(widget.layout?.page || 1),
      kind: widget.artifact?.kind || 'chart',
    }),
  }));

  return {
    widgets: packedWidgets.map(({ _layoutSource, ...widget }) => widget),
    artifacts: packedWidgets.map((widget) => widget.artifact),
    nonEmptyCount: packedWidgets.length,
    pageCount: packedWidgets.reduce((max, widget) => Math.max(max, Number(widget.layout?.page || 1)), 1),
  };
}

function coverageRightEdgeThreshold() {
  return Math.max(1, Math.ceil(DASHBOARD_GRID_COLS * MIN_PAGE_WIDTH_COVERAGE));
}

function normalizePackedWidgets(widgets = []) {
  return packDashboardLayout(widgets.map((widget) => ({
    ...widget,
    kind: widget.artifact?.kind || widget.kind || 'chart',
  }))).map((widget) => ({
    ...widget,
    layout: normalizeDashboardLayout(widget.layout || {}, {
      page: Number(widget.layout?.page || 1),
      kind: widget.artifact?.kind || widget.kind || 'chart',
    }),
  }));
}

function pageCoverageStats(widgets = []) {
  const pages = new Map();
  for (const widget of widgets) {
    const page = Number(widget?.layout?.page || 1);
    const layout = normalizeDashboardLayout(widget.layout || {}, {
      page,
      kind: widget?.artifact?.kind || widget?.kind || 'chart',
    });
    const stats = pages.get(page) || {
      page,
      rightEdge: 0,
      coveragePct: 0,
      densityPct: 0,
      widgetCount: 0,
      occupiedArea: 0,
      contentHeight: 0,
      rowOccupancy: new Map(),
      minRowCoveragePct: 0,
      sparseRowCount: 0,
      maxRightGapCols: DASHBOARD_GRID_COLS,
      topGapRows: 0,
      bottomGapRows: DASHBOARD_GRID_ROWS,
    };
    stats.rightEdge = Math.max(stats.rightEdge, layout.x + layout.w);
    stats.contentHeight = Math.max(stats.contentHeight, layout.y + layout.h);
    stats.occupiedArea += layout.w * layout.h;
    stats.widgetCount += 1;
    for (let row = layout.y; row < layout.y + layout.h; row += 1) {
      const occupiedColumns = stats.rowOccupancy.get(row) || new Set();
      for (let column = layout.x; column < layout.x + layout.w; column += 1) {
        occupiedColumns.add(column);
      }
      stats.rowOccupancy.set(row, occupiedColumns);
    }
    pages.set(page, stats);
  }

  for (const stats of pages.values()) {
    stats.coveragePct = stats.rightEdge / DASHBOARD_GRID_COLS;
    const bandArea = Math.max(1, stats.rightEdge * Math.max(1, stats.contentHeight));
    stats.densityPct = stats.occupiedArea / bandArea;
    let minRowCoveragePct = 1;
    let sparseRowCount = 0;
    let maxRightGapCols = 0;
    let topGapRows = 0;

    for (let row = 0; row < stats.contentHeight; row += 1) {
      const occupiedColumns = stats.rowOccupancy.get(row) || new Set();
      const coveragePct = occupiedColumns.size / DASHBOARD_GRID_COLS;
      const rowRightEdge = occupiedColumns.size > 0
        ? Math.max(...occupiedColumns) + 1
        : 0;
      const rightGapCols = Math.max(0, DASHBOARD_GRID_COLS - rowRightEdge);
      if (occupiedColumns.size === 0 && row === topGapRows) {
        topGapRows += 1;
      }
      minRowCoveragePct = Math.min(minRowCoveragePct, coveragePct);
      maxRightGapCols = Math.max(maxRightGapCols, rightGapCols);
      if (coveragePct < MIN_PAGE_ROW_COVERAGE) {
        sparseRowCount += 1;
      }
    }

    stats.minRowCoveragePct = stats.rowOccupancy.size > 0 ? minRowCoveragePct : 0;
    stats.sparseRowCount = sparseRowCount;
    stats.maxRightGapCols = maxRightGapCols;
    stats.topGapRows = topGapRows;
    stats.bottomGapRows = Math.max(0, DASHBOARD_GRID_ROWS - stats.contentHeight);
    delete stats.rowOccupancy;
  }

  return Array.from(pages.values()).sort((a, b) => a.page - b.page);
}

function isUnderfilledCoveragePage(stats = null) {
  if (!stats) {
    return false;
  }

  const threshold = coverageRightEdgeThreshold();
  return stats.rightEdge < threshold
    || stats.densityPct < MIN_PAGE_COVERAGE_DENSITY
    || stats.topGapRows > 0
    || (stats.bottomGapRows > 2 && stats.widgetCount <= 2)
    || stats.sparseRowCount > 0
    || stats.maxRightGapCols > MAX_ROW_RIGHT_GAP_COLS;
}

function underfilledCoveragePages(widgets = []) {
  return pageCoverageStats(widgets).filter((stats) => isUnderfilledCoveragePage(stats));
}

function widgetExpansionPriority(widget = {}) {
  const kind = String(widget?.artifact?.kind || widget?.kind || '').toLowerCase();
  const chartType = String(widget?.artifact?.chart_type || '').toLowerCase();
  if (kind === 'chart' && chartType === 'line') {
    return 0;
  }
  if (kind === 'metric') {
    return 1;
  }
  if (kind === 'chart') {
    return 2;
  }
  if (kind === 'table') {
    return 3;
  }
  return 4;
}

function tryExpandWidgetToRight(widget, siblings = []) {
  const layout = normalizeDashboardLayout(widget.layout || {}, {
    page: Number(widget.layout?.page || 1),
    kind: widget?.artifact?.kind || widget?.kind || 'chart',
  });

  let next = layout;
  for (let width = layout.w + 1; layout.x + width <= DASHBOARD_GRID_COLS; width += 1) {
    const candidate = normalizeDashboardLayout({
      ...layout,
      w: width,
    }, {
      page: layout.page,
      kind: widget?.artifact?.kind || widget?.kind || 'chart',
    });
    const collides = siblings.some((entry) => layoutsIntersect(candidate, entry));
    if (collides) {
      break;
    }
    next = candidate;
  }

  return {
    ...widget,
    layout: next,
  };
}

function tryExpandWidgetDown(widget, siblings = []) {
  const layout = normalizeDashboardLayout(widget.layout || {}, {
    page: Number(widget.layout?.page || 1),
    kind: widget?.artifact?.kind || widget?.kind || 'chart',
  });

  let next = layout;
  for (let height = layout.h + 1; layout.y + height <= DASHBOARD_GRID_ROWS; height += 1) {
    const candidate = normalizeDashboardLayout({
      ...layout,
      h: height,
    }, {
      page: layout.page,
      kind: widget?.artifact?.kind || widget?.kind || 'chart',
    });
    const collides = siblings.some((entry) => layoutsIntersect(candidate, entry));
    if (collides) {
      break;
    }
    next = candidate;
  }

  return {
    ...widget,
    layout: next,
  };
}

function expandWidgetsToFillCoverage(widgets = []) {
  let nextWidgets = normalizePackedWidgets(widgets);

  for (const stats of underfilledCoveragePages(nextWidgets)) {
    const pageWidgets = nextWidgets
      .filter((widget) => Number(widget.layout?.page || 1) === stats.page)
      .sort((left, right) => widgetExpansionPriority(left) - widgetExpansionPriority(right));

    for (const candidate of pageWidgets) {
      const widgetIndex = nextWidgets.findIndex((widget) => widget.id === candidate.id);
      if (widgetIndex < 0) {
        continue;
      }

      const siblings = nextWidgets
        .filter((widget, index) => index !== widgetIndex && Number(widget.layout?.page || 1) === stats.page)
        .map((widget) => normalizeDashboardLayout(widget.layout || {}, {
          page: stats.page,
          kind: widget?.artifact?.kind || widget?.kind || 'chart',
        }));

      nextWidgets[widgetIndex] = tryExpandWidgetToRight(nextWidgets[widgetIndex], siblings);
      nextWidgets = normalizePackedWidgets(nextWidgets);

      let updatedStats = pageCoverageStats(nextWidgets).find((entry) => entry.page === stats.page);
      if (updatedStats && isUnderfilledCoveragePage(updatedStats) && widgetCategory(nextWidgets[widgetIndex]) !== 'kpi') {
        nextWidgets[widgetIndex] = tryExpandWidgetDown(nextWidgets[widgetIndex], siblings);
        nextWidgets = normalizePackedWidgets(nextWidgets);
        updatedStats = pageCoverageStats(nextWidgets).find((entry) => entry.page === stats.page);
      }

      if (updatedStats && !isUnderfilledCoveragePage(updatedStats)) {
        break;
      }
    }
  }

  return nextWidgets;
}

function expandWidgetsByTitle(widgets = [], titles = []) {
  const normalizedTitles = new Set(
    (Array.isArray(titles) ? titles : [])
      .map((value) => normalizeLayoutTitle(value))
      .filter(Boolean),
  );
  if (normalizedTitles.size === 0) {
    return normalizePackedWidgets(widgets);
  }

  let nextWidgets = normalizePackedWidgets(widgets);
  for (let index = 0; index < nextWidgets.length; index += 1) {
    const title = normalizeLayoutTitle(nextWidgets[index]?.title || nextWidgets[index]?.artifact?.title);
    if (!normalizedTitles.has(title)) {
      continue;
    }
    const page = Number(nextWidgets[index]?.layout?.page || 1);
    const siblings = nextWidgets
      .filter((widget, siblingIndex) => siblingIndex !== index && Number(widget.layout?.page || 1) === page)
      .map((widget) => normalizeDashboardLayout(widget.layout || {}, {
        page,
        kind: widget?.artifact?.kind || widget?.kind || 'chart',
      }));
    nextWidgets[index] = tryExpandWidgetToRight(nextWidgets[index], siblings);
  }
  return normalizePackedWidgets(nextWidgets);
}

function componentCoverageKey(component = {}) {
  const queryComponent = component?.query && typeof component.query === 'object'
    ? [
        normalizeKeyText(component.query.dataset || ''),
        normalizeKeyText(component.query.measure || ''),
        normalizeKeyText(component.query.group_by || ''),
        normalizeKeyText(component.query.visualization || ''),
      ].join(':')
    : normalizeTemplateId(component.metric || component.title || component.type || '');
  return queryComponent || componentMetricKey(component);
}

function widgetCoverageKey(widget = {}) {
  const query = widget?.query && typeof widget.query === 'object' ? widget.query : null;
  if (query && (query.dataset || query.measure || query.group_by || query.visualization)) {
    return [
      normalizeKeyText(query.dataset || ''),
      normalizeKeyText(query.measure || ''),
      normalizeKeyText(query.group_by || ''),
      normalizeKeyText(query.visualization || ''),
    ].join(':');
  }

  const templateKey = normalizeTemplateId(
    query?.template_id
    || query?.metric
    || widget?.artifact?.template_id
    || widget?.artifact?.metric
    || widget?.metric
    || widget?.title
    || widget?.artifact?.title,
  );
  return templateKey || widgetLayoutKey(widget);
}

function currentWidgetCoverageKeys(widgets = []) {
  return new Set(widgets.map((widget) => widgetCoverageKey(widget)).filter(Boolean));
}

function preferredCoverageComponents(components = [], widgets = [], preferredTemplateIds = []) {
  const currentKeys = currentWidgetCoverageKeys(widgets);
  const preferred = Array.isArray(preferredTemplateIds)
    ? preferredTemplateIds.map((value) => normalizeTemplateId(value)).filter(Boolean)
    : [];
  const pool = dedupeComponents([
    ...(Array.isArray(components) ? components : []),
    ...COMPLEX_TEMPLATE_COMPONENTS.map(cloneComponent),
  ]);

  const ranked = pool
    .filter((component) => {
      const key = componentCoverageKey(component);
      return key && !currentKeys.has(key);
    })
    .sort((left, right) => {
      const leftKey = componentCoverageKey(left);
      const rightKey = componentCoverageKey(right);
      const leftPreferred = preferred.includes(leftKey) ? 0 : 1;
      const rightPreferred = preferred.includes(rightKey) ? 0 : 1;
      if (leftPreferred !== rightPreferred) {
        return leftPreferred - rightPreferred;
      }
      return widgetExpansionPriority({ artifact: { kind: left.type === 'MetricCard' ? 'metric' : left.type === 'TopList' ? 'table' : 'chart' } })
        - widgetExpansionPriority({ artifact: { kind: right.type === 'MetricCard' ? 'metric' : right.type === 'TopList' ? 'table' : 'chart' } });
    });

  return ranked;
}

async function fetchAdditionalCoverageWidgets({
  tenantId,
  userId,
  scope,
  components,
  widgets,
  analysisBrief = null,
  hooks = null,
  trace,
  preferredTemplateIds = [],
  targetPage = 1,
  limit = MAX_ADDITIONAL_WIDGETS_FOR_COVERAGE,
}) {
  const additions = [];
  const usedFindingIds = new Set((Array.isArray(widgets) ? widgets : []).map((widget) => String(widget?.finding_id || '').trim()).filter(Boolean));
  const unusedSupportingFindings = Array.isArray(analysisBrief?.findings)
    ? analysisBrief.findings.filter((finding) => finding.priority === 'supporting' && !usedFindingIds.has(String(finding?.id || '').trim()))
    : [];
  const derivedPreferredTemplateIds = [
    ...(Array.isArray(preferredTemplateIds) ? preferredTemplateIds : []),
    ...(unusedSupportingFindings
        .map((finding) => findingTemplateKey(finding))
      ),
  ].filter(Boolean);
  const candidates = preferredCoverageComponents(components, widgets, derivedPreferredTemplateIds);
  const additionLimit = Math.max(0, Number(limit || 0));

  for (const component of candidates) {
    if (additions.length >= additionLimit) {
      break;
    }

    const call = toolCallFromComponent(component, scope);
    if (!call) {
      continue;
    }

    const stepId = `coverage_add_${Date.now()}_${additions.length + 1}`;
    emitTimelineEvent(hooks, {
      id: stepId,
      status: 'pending',
      title: `Menambah widget pendukung ${safeText(component.title || component.metric || 'tambahan', 'tambahan', 48)}`,
      agent: 'analyst',
    });

    const execution = await executeToolCall({ tenantId, userId, call });
    const artifact = (execution.artifacts || []).find((item) => !artifactLooksEmpty(item));
    if (!artifact) {
      emitTimelineEvent(hooks, {
        id: stepId,
        status: 'error',
        title: `Widget ${safeText(component.title || component.metric || 'tambahan', 'tambahan', 48)} tidak cukup kuat`,
        agent: 'analyst',
      });
      continue;
    }

    const preferredPage = Math.max(1, Number(targetPage || 1));
    const seededLayout = suggestDashboardLayout([
      ...widgets,
      ...additions,
    ], artifact.kind || 'chart', preferredPage);

    additions.push({
      id: generateId(),
      title: artifact.title || component.title || `Widget ${widgets.length + additions.length + 1}`,
      artifact,
      query: execution.query || call.args || null,
      layout: seededLayout,
      _layoutSource: 'coverage',
      finding_id: unusedSupportingFindings.find((finding) => findingTemplateKey(finding) === componentCoverageKey(component))?.id
        || findingTemplateKey({
          recommended_visual: artifact.kind === 'chart' ? artifact.chart_type || 'chart' : artifact.kind,
          insight: artifact.title || component.title || '',
          evidence: artifactEvidenceSummary(artifact),
        }),
      rationale: unusedSupportingFindings.find((finding) => findingTemplateKey(finding) === componentCoverageKey(component))?.why_it_matters
        || inferWhyItMatters(artifact),
      importance: unusedSupportingFindings.find((finding) => findingTemplateKey(finding) === componentCoverageKey(component))?.priority || 'supporting',
    });

    pushTrace(trace, {
      step: `tool:${call.tool}`,
      source: 'coverage_repair',
      produced: 1,
      template: componentCoverageKey(component),
    });
    emitTimelineEvent(hooks, {
      id: stepId,
      status: 'done',
      title: `${safeText(artifact.title || component.title || 'Widget tambahan', 'Widget tambahan', 48)} ditambahkan`,
      agent: 'analyst',
    });
  }

  return additions;
}

async function enforceDashboardCoverage({
  tenantId,
  userId,
  scope,
  components,
  widgets,
  analysisBrief = null,
  layoutPlan = null,
  trace,
  hooks = null,
  preferredTemplateIds = [],
}) {
  let currentWidgets = normalizePackedWidgets(widgets);
  let coverageAdditionsUsed = 0;
  let gaps = underfilledCoveragePages(currentWidgets);
  let remainingPreferredAdditions = preferredCoverageComponents(components, currentWidgets, preferredTemplateIds).length > 0;
  if (gaps.length === 0 && !remainingPreferredAdditions) {
    return finalizeBalancedWidgets(currentWidgets, layoutPlan);
  }

  const coverageStepId = `coverage_${Date.now()}`;
  emitTimelineEvent(hooks, {
    id: coverageStepId,
    status: 'pending',
    title: 'Citra merapikan penggunaan lebar dashboard',
    agent: 'creator',
  });

  for (let repairPass = 0; repairPass < MAX_COVERAGE_REPAIR_PASSES; repairPass += 1) {
    currentWidgets = expandWidgetsToFillCoverage(currentWidgets);
    gaps = underfilledCoveragePages(currentWidgets);
    remainingPreferredAdditions = preferredCoverageComponents(components, currentWidgets, preferredTemplateIds).length > 0;

    const remainingCoverageBudget = Math.max(0, MAX_ADDITIONAL_WIDGETS_FOR_COVERAGE - coverageAdditionsUsed);
    const mayAddCoverageWidgets = currentWidgets.length < MAX_WIDGETS && remainingCoverageBudget > 0;

    if ((gaps.length > 0 || remainingPreferredAdditions) && mayAddCoverageWidgets) {
      const preferredPage = Number(gaps[0]?.page || currentWidgets[0]?.layout?.page || 1);
      const additions = await fetchAdditionalCoverageWidgets({
        tenantId,
        userId,
        scope,
        components,
        widgets: currentWidgets,
        analysisBrief,
        hooks,
        trace,
        preferredTemplateIds,
        targetPage: preferredPage,
        limit: remainingCoverageBudget,
      });

      if (additions.length > 0) {
        coverageAdditionsUsed += additions.length;
        currentWidgets = finalizeBalancedWidgets([...currentWidgets, ...additions], layoutPlan).widgets;
        continue;
      }
    }

    if (gaps.length === 0 && !remainingPreferredAdditions) {
      break;
    }
  }

  gaps = underfilledCoveragePages(currentWidgets);
  emitTimelineEvent(hooks, {
    id: coverageStepId,
    status: gaps.length === 0 ? 'done' : 'error',
    title: gaps.length === 0
      ? `Lebar dashboard ${Math.round((pageCoverageStats(currentWidgets)[0]?.coveragePct || 0) * 100)}% dan kepadatan ${Math.round((pageCoverageStats(currentWidgets)[0]?.densityPct || 0) * 100)}%`
      : 'Masih ada area kosong yang perlu ditinjau Argus',
    agent: 'creator',
  });

  return finalizeBalancedWidgets(currentWidgets, layoutPlan);
}

async function ensureMinimumWidgets({
  tenantId,
  userId,
  scope,
  components,
  widgets,
  analysisBrief = null,
  layoutPlan = null,
  trace,
  hooks = null,
  preferredTemplateIds = [],
  minWidgets = MIN_WIDGETS,
}) {
  const target = Math.min(MAX_WIDGETS, Math.max(1, Number(minWidgets || MIN_WIDGETS)));
  let currentWidgets = normalizePackedWidgets(widgets);
  let nonEmptyCount = nonEmptyWidgetCount(currentWidgets);
  if (nonEmptyCount >= target) {
    return finalizeBalancedWidgets(currentWidgets, layoutPlan);
  }

  const minStepId = `min_widgets_${Date.now()}`;
  emitTimelineEvent(hooks, {
    id: minStepId,
    status: 'pending',
    title: `Menambah widget agar minimal ${target} visual`,
    agent: 'creator',
  });

  let attempts = 0;
  while (nonEmptyCount < target && currentWidgets.length < MAX_WIDGETS && attempts < 2) {
    const remaining = Math.min(MAX_WIDGETS - currentWidgets.length, target - nonEmptyCount);
    if (remaining <= 0) {
      break;
    }
    const additions = await fetchAdditionalCoverageWidgets({
      tenantId,
      userId,
      scope,
      components,
      widgets: currentWidgets,
      analysisBrief,
      hooks,
      trace,
      preferredTemplateIds,
      targetPage: Number(currentWidgets[0]?.layout?.page || 1),
      limit: remaining,
    });

    if (additions.length === 0) {
      break;
    }
    currentWidgets = finalizeBalancedWidgets([...currentWidgets, ...additions], layoutPlan).widgets;
    nonEmptyCount = nonEmptyWidgetCount(currentWidgets);
    attempts += 1;
  }

  emitTimelineEvent(hooks, {
    id: minStepId,
    status: nonEmptyCount >= target ? 'done' : 'error',
    title: nonEmptyCount >= target
      ? `Minimum ${target} visual terpenuhi`
      : `Minimum ${target} visual belum terpenuhi`,
    agent: 'creator',
  });

  return finalizeBalancedWidgets(currentWidgets, layoutPlan);
}

function buildWidgetsFromArtifacts({ artifacts, calls, components = [], layoutPlan = null, analysisBrief = null }) {
  const widgets = [];

  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i];
    const callArtifacts = artifacts[i] || [];
    for (const artifact of callArtifacts) {
      widgets.push({
        id: generateId(),
        title: artifact.title || `Widget ${widgets.length + 1}`,
        artifact,
        query: call.query || null,
        layout: call?.component?.layout || null,
        _layoutSource: call?.component?.layout ? 'component' : null,
      });

      if (widgets.length >= MAX_WIDGETS) {
        break;
      }
    }
    if (widgets.length >= MAX_WIDGETS) {
      break;
    }
  }

  const seededWidgets = applyComponentLayouts(widgets, components);
  const plannedWidgets = applyWorkerLayoutPlan(seededWidgets, layoutPlan);
  const finalized = finalizeBalancedWidgets(plannedWidgets, layoutPlan);
  return {
    ...finalized,
    widgets: attachAnalysisBriefToWidgets(finalized.widgets, analysisBrief),
  };
}

function normalizeTemplateComponents(dashboard) {
  const components = Array.isArray(dashboard?.config?.components) ? dashboard.config.components : [];
  if (components.length === 0) {
    return dedupeComponents(COMPLEX_TEMPLATE_COMPONENTS.map(cloneComponent));
  }

  const normalized = dedupeComponents(components.map(cloneComponent).filter(Boolean));
  if (normalized.length === 0) {
    return dedupeComponents(COMPLEX_TEMPLATE_COMPONENTS.map(cloneComponent));
  }

  return normalized.slice(0, MAX_WIDGETS);
}

function isFullDashboardGoal(goal = '', intent = {}) {
  const text = `${goal || ''} ${intent?.intent || ''}`.toLowerCase();
  return /(lengkap|kompleks|full|penuh|overview|ringkasan)/.test(text);
}

function mergeWithComplexDefaults(components, routingScope = {}) {
  // Only add transaction templates if the dataset maps to a transaction schema
  const isTransactionDataset = !routingScope.dataset_type || routingScope.dataset_type === 'transaction';
  
  if (!components || components.length === 0) {
    if (!isTransactionDataset) return [];
    return COMPLEX_TEMPLATE_COMPONENTS.slice(0, 4).map(cloneComponent);
  }
  
  const map = new Map();

  for (const item of components) {
    map.set(componentMetricKey(item), item);
  }

  if (isTransactionDataset) {
    for (const fallback of COMPLEX_TEMPLATE_COMPONENTS) {
      const key = componentMetricKey(fallback);
      if (!map.has(key)) {
        map.set(key, cloneComponent(fallback));
      }
    }
  }

  return [...map.values()].slice(0, MAX_WIDGETS);
}

async function executeToolCall({ tenantId, userId, call }) {
  if (call.tool === 'query_builder') {
    const result = await executeBuilderQuery({
      tenantId,
      userId,
      query: call.args,
    });

    return {
      kind: 'builder',
      result,
      artifacts: result?.artifact ? [result.artifact] : [],
      query: result?.query || call.args,
      agent_context: result?.agent_context || null,
    };
  }

  const analytics = await executeAnalyticsIntent({
    tenantId,
    userId,
    intent: call.args,
  });

  return {
    kind: 'template',
    result: analytics,
    artifacts: artifactsFromAnalyticsResult(analytics),
    query: call.args,
    agent_context: analytics?.agent_context || null,
  };
}

function componentCatalog(components) {
  return components.map((component, index) => ({
    index,
    type: component.type || null,
    title: component.title || `Widget ${index + 1}`,
    metric: component.metric || null,
    has_query: Boolean(component.query && typeof component.query === 'object'),
  }));
}

function compactToolHistory(history) {
  return history.slice(-6).map((item, idx) => ({
    idx,
    tool: item.tool,
    produced: item.produced,
    title: item.title,
    adjusted: item.period_adjusted,
  }));
}

function compactArtifacts(artifacts) {
  return artifacts.slice(0, 8).map((artifact) => {
    if (artifact.kind === 'metric') {
      return {
        kind: 'metric',
        title: artifact.title,
        value: artifact.value,
        raw_value: artifact.raw_value,
      };
    }

    if (artifact.kind === 'table') {
      return {
        kind: 'table',
        title: artifact.title,
        rows: Array.isArray(artifact.rows) ? artifact.rows.length : 0,
      };
    }

    if (artifact.kind === 'chart') {
      const points = (artifact.series || []).flatMap((series) => series.values || []).length;
      return {
        kind: 'chart',
        title: artifact.title,
        points,
      };
    }

    return {
      kind: artifact.kind || 'unknown',
      title: artifact.title || null,
    };
  });
}

function artifactEvidenceSummary(artifact = {}) {
  if (!artifact || typeof artifact !== 'object') {
    return 'Artefak tidak tersedia.';
  }

  if (artifact.kind === 'metric') {
    const raw = parseArtifactNumber(artifact.raw_value ?? artifact.value);
    const formatted = raw === null
      ? safeText(artifact.value || '-', '-', 32)
      : formatInsightNumber(raw, {
          currency: !artifactLooksPercent(artifact),
          percent: artifactLooksPercent(artifact),
        });
    return `${safeText(artifact.title || 'Metrik', 'Metrik', 48)}: ${formatted}${artifact.delta ? ` (${safeText(artifact.delta, '', 40)})` : ''}`;
  }

  if (artifact.kind === 'chart') {
    const insight = chartInsight(artifact);
    return insight || `Chart ${safeText(artifact.title || 'tanpa judul', 'tanpa judul', 48)}`;
  }

  if (artifact.kind === 'table') {
    const insight = tableInsight(artifact);
    return insight || `Tabel ${safeText(artifact.title || 'tanpa judul', 'tanpa judul', 48)}`;
  }

  return safeText(artifact.title || JSON.stringify(artifact), 'Artefak ringkas tidak tersedia.', 180);
}

function candidateTitle(component = {}, artifact = null, fallbackIndex = 1) {
  return safeText(
    artifact?.title
      || component?.title
      || component?.metric
      || component?.query?.title
      || `Temuan ${fallbackIndex}`,
    `Temuan ${fallbackIndex}`,
    80,
  );
}

function candidateIdForComponent(component = {}, fallbackIndex = 1) {
  const templateId = normalizeTemplateId(
    component?.metric
    || component?.title
    || component?.query?.measure
    || component?.query?.title
    || '',
  );
  if (templateId) {
    return `finding_${templateId}_${fallbackIndex}`;
  }

  const base = normalizeKeyText(component?.query?.title || component?.title || component?.query?.measure || `temuan_${fallbackIndex}`)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `finding_${base || fallbackIndex}`;
}

function recommendedVisualForArtifact(artifact = {}) {
  if (artifact.kind === 'metric') {
    return 'metric';
  }
  if (artifact.kind === 'table') {
    return 'table';
  }
  return safeText(artifact.chart_type || 'chart', 'chart', 16).toLowerCase();
}

function inferWhyItMatters(artifact = {}) {
  const title = safeText(artifact.title || 'visual ini', 'visual ini', 64).toLowerCase();
  const evidence = artifactEvidenceSummary(artifact).toLowerCase();
  if (title.includes('omzet') || title.includes('revenue')) {
    return evidence.includes('turun')
      ? 'pendapatan utama sedang melemah, jadi user perlu melihat seberapa besar pelemahan itu dan kapan mulai terjadi'
      : 'pendapatan utama adalah indikator pertama yang paling cepat menunjukkan kesehatan bisnis pada periode ini';
  }
  if (title.includes('untung') || title.includes('profit') || title.includes('laba')) {
    return 'penjualan yang naik belum tentu menghasilkan keuntungan, jadi visual ini menunjukkan apakah pertumbuhan benar-benar sehat';
  }
  if (title.includes('margin')) {
    return 'margin membantu membedakan bisnis yang sekadar ramai dari bisnis yang benar-benar efisien';
  }
  if (title.includes('produk')) {
    return 'peringkat produk membantu user melihat konsentrasi penjualan dan menentukan produk mana yang layak diprioritaskan';
  }
  if (title.includes('cabang')) {
    return 'perbandingan cabang membantu menunjukkan area operasional mana yang paling kuat dan mana yang perlu perhatian';
  }
  if (title.includes('trend') || title.includes('tren')) {
    return evidence.includes('stabil')
      ? 'tren waktu dipakai untuk memastikan performa tidak hanya terlihat besar, tetapi juga konsisten'
      : 'tren waktu dipakai supaya user bisa melihat arah perubahan dan momen puncak atau pelemahannya';
  }
  return 'Visual ini dipilih karena memberi konteks pendukung untuk keputusan bisnis pada periode yang diminta.';
}

function inferPriorityForArtifact(artifact = {}, index = 0) {
  if (index === 0) {
    return 'primary';
  }
  const title = safeText(artifact.title || '', '', 64).toLowerCase();
  if (title.includes('omzet') || title.includes('profit') || title.includes('margin') || title.includes('trend')) {
    return 'primary';
  }
  return 'supporting';
}

function normalizeAnalysisFinding(raw = {}, fallback = {}) {
  const priority = safeText(raw.priority || fallback.priority || 'supporting', 'supporting', 16).toLowerCase();
  return {
    id: safeText(raw.id || fallback.id || generateId(), generateId(), 64),
    candidate_id: safeText(raw.candidate_id || fallback.candidate_id || '', fallback.candidate_id || '', 64),
    title: safeText(raw.title || fallback.title || '', fallback.title || '', 96),
    artifact_key: safeText(raw.artifact_key || fallback.artifact_key || '', fallback.artifact_key || '', 120),
    insight: normalizeUserFacingText(raw.insight || fallback.insight || '', fallback.insight || ''),
    evidence: normalizeUserFacingText(raw.evidence || fallback.evidence || '', fallback.evidence || ''),
    why_it_matters: normalizeUserFacingText(raw.why_it_matters || fallback.why_it_matters || '', fallback.why_it_matters || ''),
    recommended_visual: safeText(raw.recommended_visual || fallback.recommended_visual || 'chart', fallback.recommended_visual || 'chart', 24).toLowerCase(),
    priority: priority === 'primary' ? 'primary' : 'supporting',
  };
}

function buildDeterministicAnalysisBrief({ goal, scope, candidates = [] }) {
  const strongCandidates = candidates.filter((candidate) => candidate?.artifact && !artifactLooksEmpty(candidate.artifact)).slice(0, 6);
  const findings = strongCandidates.map((candidate, index) => normalizeAnalysisFinding({}, {
    id: candidate.finding_id || candidateIdForComponent(candidate.component, index + 1),
    candidate_id: candidate.candidate_id,
    title: candidateTitle(candidate.component, candidate.artifact, index + 1),
    artifact_key: artifactSemanticKey(candidate.artifact) || '',
    insight: artifactEvidenceSummary(candidate.artifact),
    evidence: candidate.evidence,
    why_it_matters: inferWhyItMatters(candidate.artifact),
    recommended_visual: recommendedVisualForArtifact(candidate.artifact),
    priority: inferPriorityForArtifact(candidate.artifact, index),
  }));
  const recommendedCandidates = findings
    .map((finding) => safeText(finding.candidate_id || '', '', 64))
    .filter(Boolean)
    .slice(0, 4);

  return {
    headline: findings[0]?.insight || 'Belum ada temuan dashboard yang cukup kuat.',
    business_goal: safeText(goal || 'Dashboard bisnis', 'Dashboard bisnis', 140),
    time_scope: safeText(scope?.time_period || '30 hari terakhir', '30 hari terakhir', 64),
    recommended_candidates: recommendedCandidates,
    recommend_dashboard: false,
    dashboard_reason: null,
    findings,
  };
}

async function runAnalystAgent({ tenantId, userId, goal, scope, components, trace, memory, hooks = null, signal = null }) {
  throwIfDashboardAborted(signal);
  const analystStepId = `analyst_${Date.now()}`;
  emitTimelineEvent(hooks, {
    id: analystStepId,
    status: 'pending',
    title: 'Raka menyusun temuan utama sebelum dashboard dibuat',
    agent: 'analyst',
  });

  const candidates = [];
  const dedupedComponents = dedupeComponents(Array.isArray(components) ? components : []).slice(0, MAX_WIDGETS);
  
  // Dynamic discovery for generic datasets
  const datasetProfile = await getDatasetProfile(tenantId);
  if (datasetProfile?.mapping?.dataset_type === 'generic' || (datasetProfile?.tables?.length > 0 && candidates.length === 0)) {
    const tables = datasetProfile.tables || [];
    for (const tableInfo of tables.slice(0, 3)) {
      try {
        const table = await getDatasetTable(tenantId, tableInfo.id);
        if (table && table.rows?.length > 0) {
          const candidateId = `builder_${tableInfo.id}_discovery`;
          const artifact = {
            kind: 'table',
            title: `Data: ${tableInfo.name}`,
            columns: table.columns,
            rows: table.rows.slice(0, 5),
            total_rows: table.row_count || table.rows.length,
          };
          candidates.push({
            candidate_id: candidateId,
            finding_id: candidateId,
            component: { type: 'TopList', title: `Data: ${tableInfo.name}`, dataset: tableInfo.id },
            call: { tool: 'query_builder', args: { dataset: tableInfo.id, limit: 10 } },
            query: { dataset: tableInfo.id, limit: 10 },
            artifact,
            evidence: `Tabel ${tableInfo.name} memiliki ${artifact.total_rows} baris. Kolom: ${table.columns.join(', ')}.`,
          });
        }
      } catch (err) {
        logger.error('generic_discovery_failed', { table: tableInfo.id, error: err.message });
      }
    }
  }

  for (let index = 0; index < dedupedComponents.length; index += 1) {
    const component = dedupedComponents[index];
    const call = toolCallFromComponent(component, scope);
    if (!call) {
      continue;
    }
    const execution = await executeToolCall({ tenantId, userId, call });
    const artifact = (execution.artifacts || []).find((item) => !artifactLooksEmpty(item));
    if (!artifact) {
      continue;
    }
    const candidateId = safeText(`${call.tool}_${normalizeTemplateId(call.args?.template_id || component.metric || component.title || '') || index + 1}`, `candidate_${index + 1}`, 64);
    candidates.push({
      candidate_id: candidateId,
      finding_id: candidateIdForComponent(component, index + 1),
      component,
      call,
      query: execution.query || call.args || null,
      artifact,
      evidence: artifactEvidenceSummary(artifact),
    });
    pushTrace(trace, {
      step: `analyst:${call.tool}`,
      candidate_id: candidateId,
      title: artifact.title || component.title || null,
    });
  }

  const fallbackBrief = buildDeterministicAnalysisBrief({
    goal,
    scope,
    candidates,
  });

  if (candidates.length === 0) {
    emitTimelineEvent(hooks, {
      id: analystStepId,
      status: 'error',
      title: 'Raka belum menemukan temuan yang cukup kuat dari dataset',
      agent: 'analyst',
    });
    memory.steps.push({
      agent: 'analyst',
      source: 'fallback',
      findings: 0,
    });
    return {
      ok: true,
      source: 'fallback',
      brief: fallbackBrief,
      candidates,
    };
  }

  const response = await generateWithGeminiTools({
    systemPrompt: [
      VISTARA_SYSTEM_PROMPT,
      Prompts.ANALYST_AGENT,
    ].join('\n\n'),
    userPrompt: JSON.stringify({
      goal,
      scope,
      candidates: candidates.map((candidate) => ({
        candidate_id: candidate.candidate_id,
        title: candidateTitle(candidate.component, candidate.artifact),
        evidence: candidate.evidence,
        query: candidate.query,
        artifact: compactArtifacts([candidate.artifact])[0] || null,
      })),
    }),
    tools: ANALYST_TOOL_DECLARATIONS,
    temperature: 0.1,
    maxOutputTokens: ANALYST_MAX_OUTPUT_TOKENS,
    thinkingBudget: ANALYST_THINKING_BUDGET,
    functionCallingMode: 'ANY',
    allowedFunctionNames: ['submit_analysis_brief'],
    signal,
  });

  if (!response.ok) {
    emitTimelineEvent(hooks, {
      id: analystStepId,
      status: 'done',
      title: `Raka memakai brief fallback (${fallbackBrief.findings.length} temuan)`,
      agent: 'analyst',
    });
    memory.steps.push({
      agent: 'analyst',
      source: 'fallback',
      findings: fallbackBrief.findings.length,
      reason: response.reason,
    });
    return {
      ok: true,
      source: 'fallback',
      brief: fallbackBrief,
      candidates,
    };
  }

  const payload = (response.functionCalls || []).find((call) => call.name === 'submit_analysis_brief')?.args
    || response.data
    || null;
  const rawFindings = Array.isArray(payload?.findings) ? payload.findings : [];
  const candidateMap = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const normalizedFindings = rawFindings
    .map((finding, index) => {
      const candidate = candidateMap.get(String(finding?.candidate_id || '').trim()) || candidates[index] || null;
      if (!candidate) {
        return null;
      }
      return normalizeAnalysisFinding(finding, {
        id: candidate.finding_id,
        candidate_id: candidate.candidate_id,
        title: candidateTitle(candidate.component, candidate.artifact, index + 1),
        artifact_key: artifactSemanticKey(candidate.artifact) || '',
        insight: artifactEvidenceSummary(candidate.artifact),
        evidence: candidate.evidence,
        why_it_matters: inferWhyItMatters(candidate.artifact),
        recommended_visual: recommendedVisualForArtifact(candidate.artifact),
        priority: inferPriorityForArtifact(candidate.artifact, index),
      });
    })
    .filter(Boolean)
    .slice(0, 6);
  const rawRecommended = Array.isArray(payload?.recommended_candidates) ? payload.recommended_candidates : [];
  const normalizedRecommended = rawRecommended
    .map((value) => safeText(value || '', '', 64))
    .filter(Boolean)
    .map((candidateId) => (candidateMap.has(candidateId) ? candidateId : null))
    .filter(Boolean);
  const fallbackRecommended = normalizedFindings
    .map((finding) => safeText(finding.candidate_id || '', '', 64))
    .filter(Boolean)
    .slice(0, 4);
  const recommendedCandidates = normalizedRecommended.length > 0 ? normalizedRecommended : fallbackRecommended;
  const recommendDashboard = Boolean(payload?.recommend_dashboard);
  const dashboardReason = normalizeUserFacingText(payload?.dashboard_reason || '', '');

  const brief = normalizedFindings.length > 0
    ? {
        headline: safeText(payload?.headline || normalizedFindings[0]?.insight || fallbackBrief.headline, fallbackBrief.headline, 220),
        business_goal: safeText(payload?.business_goal || goal || fallbackBrief.business_goal, fallbackBrief.business_goal, 180),
        time_scope: safeText(payload?.time_scope || scope?.time_period || fallbackBrief.time_scope, fallbackBrief.time_scope, 64),
        recommended_candidates: recommendedCandidates,
        recommend_dashboard: recommendDashboard,
        dashboard_reason: dashboardReason || null,
        findings: normalizedFindings,
      }
    : fallbackBrief;

  emitTimelineEvent(hooks, {
    id: analystStepId,
    status: 'done',
    title: `Raka menemukan ${brief.findings.length} insight untuk dashboard`,
    agent: 'analyst',
  });
  memory.steps.push({
    agent: 'analyst',
    source: normalizedFindings.length > 0 ? 'gemini_tool_call' : 'fallback',
    findings: brief.findings.length,
  });

  return {
    ok: true,
    source: normalizedFindings.length > 0 ? 'gemini_tool_call' : 'fallback',
    brief,
    candidates,
  };
}

function selectPrimaryCandidateForAnalysis(analyst = null) {
  const candidates = Array.isArray(analyst?.candidates) ? analyst.candidates : [];
  if (candidates.length === 0) {
    return null;
  }
  const findings = Array.isArray(analyst?.brief?.findings) ? analyst.brief.findings : [];
  const primaryId = findings.find((finding) => finding.priority === 'primary')?.candidate_id || null;
  if (primaryId) {
    const primary = candidates.find((candidate) => candidate.candidate_id === primaryId && candidate.artifact);
    if (primary) {
      return primary;
    }
  }
  const recommended = Array.isArray(analyst?.brief?.recommended_candidates)
    ? new Set(analyst.brief.recommended_candidates.map((value) => safeText(value || '', '', 64)).filter(Boolean))
    : null;
  if (recommended && recommended.size > 0) {
    const pick = candidates.find((candidate) => recommended.has(candidate.candidate_id) && candidate.artifact);
    if (pick) {
      return pick;
    }
  }
  return candidates.find((candidate) => candidate.artifact) || null;
}

function buildSingleWidgetAnswer({ analysisBrief = null, artifact = null, scope = {} }) {
  const briefSummary = buildDashboardSummaryFromBrief({ analysisBrief, scope });
  if (briefSummary) {
    return briefSummary.replace(/^Ringkasan dashboard:/i, 'Ringkasan analisis:');
  }
  if (artifact) {
    const evidence = artifactEvidenceSummary(artifact);
    if (evidence) {
      return `Apa yang terlihat: ${evidence}.`;
    }
  }
  return 'Belum ada insight yang cukup kuat dari data saat ini.';
}

export async function runSingleWidgetAnalysis({
  tenantId,
  userId,
  goal,
  scope,
  dashboard = null,
  hooks = null,
  signal = null,
}) {
  const trace = [];
  const memory = { steps: [] };
  const normalizedScope = normalizeScope(scope || {});
  const components = normalizeTemplateComponents(dashboard);
  const datasetProfile = await getDatasetProfile(tenantId);
  memory.current_dataset_path = datasetProfile?.source?.file_path || null;
  const analyst = await runAnalystAgent({
    tenantId,
    userId,
    goal,
    scope: normalizedScope,
    components,
    trace,
    memory,
    hooks,
    signal,
  });

  const primaryCandidate = selectPrimaryCandidateForAnalysis(analyst);
  if (!primaryCandidate || !primaryCandidate.artifact) {
    const fallbackAnswer = buildSingleWidgetAnswer({
      analysisBrief: analyst.brief,
      artifact: null,
      scope: normalizedScope,
    });
    return {
      answer: fallbackAnswer,
      widgets: [],
      artifacts: [],
      analysis_brief: analyst.brief,
      presentation_mode: 'chat',
      content_format: 'plain',
      recommend_dashboard: Boolean(analyst?.brief?.recommend_dashboard),
      dashboard_reason: analyst?.brief?.dashboard_reason || null,
      agent: {
        mode: 'single_analysis_runtime',
        trace,
        memory,
        analyst: {
          ok: analyst.ok,
          source: analyst.source,
          findings: Array.isArray(analyst.brief?.findings) ? analyst.brief.findings.length : 0,
        },
      },
    };
  }

  const widgetTitle = candidateTitle(primaryCandidate.component, primaryCandidate.artifact);
  const widget = {
    id: generateId(),
    title: widgetTitle || primaryCandidate.artifact.title || 'Insight Utama',
    artifact: primaryCandidate.artifact,
    query: primaryCandidate.query || primaryCandidate.call?.args || null,
    layout: primaryCandidate.component?.layout || null,
  };

  const answer = buildSingleWidgetAnswer({
    analysisBrief: analyst.brief,
    artifact: primaryCandidate.artifact,
    scope: normalizedScope,
  });

  return {
    answer,
    widgets: [widget],
    artifacts: [primaryCandidate.artifact],
    analysis_brief: analyst.brief,
    presentation_mode: 'chat',
    content_format: 'plain',
    recommend_dashboard: Boolean(analyst?.brief?.recommend_dashboard),
    dashboard_reason: analyst?.brief?.dashboard_reason || null,
    agent: {
      mode: 'single_analysis_runtime',
      trace,
      memory,
      analyst: {
        ok: analyst.ok,
        source: analyst.source,
        findings: Array.isArray(analyst.brief?.findings) ? analyst.brief.findings.length : 0,
      },
    },
  };
}

function selectComponentsFromAnalystBrief(components = [], analyst = null) {
  const findings = Array.isArray(analyst?.brief?.findings) ? analyst.brief.findings : [];
  if (findings.length === 0) {
    return components;
  }

  const componentMap = new Map(
    (Array.isArray(analyst?.candidates) ? analyst.candidates : [])
      .map((candidate) => [candidate.candidate_id, candidate.component]),
  );

  const recommended = Array.isArray(analyst?.brief?.recommended_candidates)
    ? analyst.brief.recommended_candidates.map((value) => safeText(value || '', '', 64)).filter(Boolean)
    : [];
  const recommendedComponents = recommended
    .map((candidateId) => componentMap.get(candidateId))
    .filter(Boolean);

  const selectedFromFindings = findings
    .map((finding) => componentMap.get(finding.candidate_id))
    .filter(Boolean);

  const combined = recommendedComponents.length > 0
    ? [...recommendedComponents, ...selectedFromFindings]
    : selectedFromFindings;

  return combined.length > 0 ? dedupeComponents(combined).slice(0, MAX_WIDGETS) : components;
}

function supportingTemplateIdsFromAnalystBrief(analysisBrief = null) {
  return Array.from(new Set(
    (Array.isArray(analysisBrief?.findings) ? analysisBrief.findings : [])
      .filter((finding) => finding.priority === 'supporting')
      .map((finding) => findingTemplateKey(finding))
      .filter(Boolean),
  ));
}

function findingTemplateKey(finding = {}) {
  const visual = safeText(finding.recommended_visual || '', '', 24).toLowerCase();
  const insight = `${finding.insight || ''} ${finding.evidence || ''}`.toLowerCase();
  if (visual === 'metric' && /margin/.test(insight)) return 'margin_percentage';
  if (visual === 'metric' && /(untung|profit|laba)/.test(insight)) return 'total_profit';
  if (visual === 'metric' && /(biaya|expense)/.test(insight)) return 'total_expense';
  if (/produk/.test(insight)) return 'top_products';
  if (/cabang/.test(insight)) return 'branch_performance';
  if (visual === 'line' || /trend|tren|harian|mingguan|bulanan/.test(insight)) return 'revenue_trend';
  return 'total_revenue';
}

function matchFindingForWidget(widget = {}, analysisBrief = null) {
  const findings = Array.isArray(analysisBrief?.findings) ? analysisBrief.findings : [];
  if (findings.length === 0) {
    return null;
  }

  const widgetKey = widgetCoverageKey(widget);
  const widgetTitle = normalizeLayoutTitle(widget?.title || widget?.artifact?.title);

  return findings.find((finding) => {
    const candidateKey = normalizeTemplateId(finding.candidate_id || '') || findingTemplateKey(finding);
    const titleKey = normalizeLayoutTitle(finding.insight || '');
    return candidateKey === widgetKey || (widgetTitle && titleKey && titleKey.includes(widgetTitle));
  }) || null;
}

function annotateWidgetsWithFindings(widgets = [], analysisBrief = null) {
  return widgets.map((widget) => {
    const finding = matchFindingForWidget(widget, analysisBrief);
    if (!finding) {
      return widget;
    }
    return {
      ...widget,
      finding_id: finding.id,
      rationale: finding.why_it_matters,
      importance: finding.priority,
    };
  });
}

function attachAnalysisBriefToWidgets(input = [], analysisBriefArg = null) {
  if (Array.isArray(input)) {
    return annotateWidgetsWithFindings(input, analysisBriefArg);
  }

  const widgets = Array.isArray(input?.widgets) ? input.widgets : [];
  const analysisBrief = input?.analysisBrief || analysisBriefArg || null;
  return annotateWidgetsWithFindings(widgets, analysisBrief);
}

function buildDashboardSummaryFromBrief({ analysisBrief = null, scope = {} }) {
  const findings = Array.isArray(analysisBrief?.findings) ? analysisBrief.findings.filter(Boolean) : [];
  if (findings.length === 0) {
    return null;
  }

  const primary = findings.find((finding) => finding.priority === 'primary') || findings[0];
  const secondary = findings.filter((finding) => finding.id !== primary.id);
  const timeScope = normalizeUserFacingText(
    analysisBrief?.time_scope || scope?.time_period || 'periode aktif',
    'periode aktif',
  );

  const summaryItems = findings
    .slice(0, 4)
    .map((finding) => safeText(finding.title || finding.recommended_visual || 'Visual', 'Visual', 64))
    .filter(Boolean);

  const dataShows = normalizeUserFacingText(primary.insight || primary.evidence || '', 'Data utama belum tersedia.');
  const analystInsight = normalizeUserFacingText(
    primary.why_it_matters || '',
    'Insight utama belum tersedia.',
  );

  const insightPool = `${primary.insight || ''} ${primary.evidence || ''} ${primary.why_it_matters || ''}`.toLowerCase();
  let suggestion = 'Pantau metrik kunci dan tanyakan analisis lanjutan jika perlu.';
  if (/turun|menurun|melemah/.test(insightPool)) {
    suggestion = 'Telusuri faktor penurunan (produk, cabang, atau hari) lalu siapkan aksi pemulihan cepat.';
  } else if (/naik|meningkat|menguat/.test(insightPool)) {
    suggestion = 'Replikasi pola yang membuat performa naik dan pastikan stok serta promosi mengikuti tren ini.';
  } else if (/margin|laba|untung/.test(insightPool)) {
    suggestion = 'Periksa komponen biaya terbesar untuk menjaga margin tetap sehat.';
  } else if (secondary.length > 0) {
    suggestion = 'Bandingkan temuan utama dengan dimensi pendukung (produk/cabang) untuk keputusan berikutnya.';
  }

  const summaryLine = summaryItems.length > 0
    ? `Ringkasan dashboard: ${summaryItems.join(', ')}.`
    : 'Ringkasan dashboard: Visual utama sudah disiapkan.';

  return [
    summaryLine,
    `Apa yang terlihat: ${dataShows}`,
    `Insight analis: ${analystInsight}`,
    `Saran opsional: ${suggestion}`,
    timeScope ? `Periode analisis: ${timeScope}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDashboardAnswerFromBrief(analysisBrief = null, scope = {}) {
  return buildDashboardSummaryFromBrief({ analysisBrief, scope });
}

function defaultPlannerSteps(components) {
  const catalog = componentCatalog(components);
  const top = catalog.slice(0, 4).map((entry) => entry.title).join(', ');

  return [
    'Baca template dashboard aktif dan tentukan prioritas komponen utama.',
    `Jalankan query data untuk komponen penting (${top || 'KPI utama'}) dengan periode yang relevan.`,
    'Finalisasi dashboard ke Canvas mode dan pastikan komponen tidak kosong.',
  ];
}

function templateLabel(templateId) {
  switch (normalizeTemplateId(templateId)) {
    case 'total_profit':
      return 'Untung';
    case 'margin_percentage':
      return 'Margin';
    case 'revenue_trend':
      return 'Trend Omzet';
    case 'top_products':
      return 'Produk Terlaris';
    case 'branch_performance':
      return 'Performa Cabang';
    case 'total_expense':
      return 'Total Biaya';
    default:
      return 'Omzet';
  }
}

function vizLabel(visualization) {
  const value = String(visualization || '').toLowerCase();
  if (value === 'metric') return 'kartu metrik';
  if (value === 'table') return 'tabel';
  if (value === 'pie') return 'pie chart';
  if (value === 'line') return 'line chart';
  if (value === 'bar') return 'bar chart';
  return 'visual';
}

function timelineTitleForCall(call, fallbackTitle = 'Widget') {
  if (!call || !call.tool) {
    return `Menyiapkan visual untuk ${fallbackTitle}`;
  }

  if (call.tool === 'query_template') {
    const label = templateLabel(call.args?.template_id || call.args?.metric);
    const period = safeText(call.args?.time_period || '', '', 36);
    return period ? `Membuat visual ${label} (${period})` : `Membuat visual untuk ${label}`;
  }

  if (call.tool === 'query_builder') {
    const title = safeText(call.args?.title || fallbackTitle, fallbackTitle, 72);
    const measure = safeText(call.args?.measure || '', '', 28);
    const groupBy = safeText(call.args?.group_by || '', '', 28);
    if (measure && groupBy && groupBy !== 'none') {
      return `Membuat ${vizLabel(call.args?.visualization)} untuk ${title} (${measure} per ${groupBy})`;
    }
    if (measure) {
      return `Membuat ${vizLabel(call.args?.visualization)} untuk ${title} (${measure})`;
    }
    return `Membuat ${vizLabel(call.args?.visualization)} untuk ${title}`;
  }

  return `Menjalankan ${call.tool}`;
}

function throwIfDashboardAborted(signal = null) {
  if (signal?.aborted) {
    throw classifyDashboardFailure('dashboard_agent_timeout');
  }
}

async function runPlannerAgent({ tenantId, goal, scope, components, analysisBrief = null, trace, memory, hooks = null, signal = null }) {
  throwIfDashboardAborted(signal);
  const fallback = defaultPlannerSteps(components);
  const catalog = componentCatalog(components);
  const edaProfile = await buildEdaProfile({ tenantId, components, scope });
  const timelineId = `planner_${Date.now()}`;
  const edaStepId = `planner_eda_${Date.now()}`;

  emitTimelineEvent(hooks, {
    id: timelineId,
    status: 'pending',
    title: 'Menyusun rencana dashboard',
    agent: 'planner',
  });
  emitTimelineEvent(hooks, {
    id: edaStepId,
    status: 'done',
    title: summarizeEdaForTimeline(edaProfile),
    agent: 'planner',
  });

  const response = await generateWithGeminiTools({
    systemPrompt: [
      VISTARA_SYSTEM_PROMPT,
      Prompts.PLANNER_AGENT,
    ].join('\n\n'),
    userPrompt: JSON.stringify({
      goal,
      scope,
      components: catalog,
      eda_profile: edaProfile,
      analysis_brief: analysisBrief,
      constraints: {
        max_steps: 5,
        must_focus_on_data_non_empty: true,
        must_identify_date_columns: true,
        must_identify_numeric_measures: true,
      },
    }),
    tools: PLANNER_TOOL_DECLARATIONS,
    temperature: 0.1,
    maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
    thinkingBudget: PLANNER_THINKING_BUDGET,
    includeThoughts: false,
    functionCallingMode: 'ANY',
    allowedFunctionNames: ['submit_plan'],
    signal,
  });

  const plannerThought = summarizeThoughtForTimeline(response.thoughts, '');
  if (plannerThought) {
    emitTimelineEvent(hooks, {
      id: `${timelineId}_thinking`,
      status: 'done',
      title: plannerThought,
      agent: 'planner',
    });
  }

  if (!response.ok) {
    pushTrace(trace, {
      step: 'planner',
      ok: false,
      reason: response.reason,
    });
    emitTimelineEvent(hooks, {
      id: timelineId,
      status: 'error',
      title: 'Planner gagal, menggunakan rencana fallback',
      agent: 'planner',
      meta: { reason: response.reason },
    });
    memory.steps.push({
      agent: 'planner',
      ok: false,
      reason: response.reason,
      steps: fallback,
    });
    return {
      ok: true,
      degraded: true,
      reason: response.reason,
      steps: fallback,
      source: 'fallback',
    };
  }

  const call = (response.functionCalls || []).find((item) => item.name === 'submit_plan');
  const steps = Array.isArray(call?.args?.steps)
    ? call.args.steps.map((item) => safeText(item, '', 160)).filter(Boolean).slice(0, 5)
    : [];

  const finalSteps = steps.length > 0 ? steps : fallback;
  const ok = steps.length > 0;

  pushTrace(trace, {
    step: 'planner',
    ok: true,
    source: ok ? 'gemini_tool_call' : 'fallback',
    planned_steps: finalSteps.length,
  });

  emitTimelineEvent(hooks, {
    id: timelineId,
    status: 'done',
    title: ok ? `Rencana siap (${finalSteps.length} langkah)` : 'Rencana fallback dipakai',
    agent: 'planner',
  });

  memory.steps.push({
    agent: 'planner',
    ok: true,
    steps: finalSteps,
    source: ok ? 'gemini_tool_call' : 'fallback',
    reason: ok ? null : 'missing_submit_plan_call',
  });

  return {
    ok: true,
    degraded: !ok,
    reason: ok ? null : 'missing_submit_plan_call',
    steps: finalSteps,
    source: ok ? 'gemini_tool_call' : 'fallback',
  };
}

async function runTemplateComponentsDeterministic({ tenantId, userId, components, scope, analysisBrief = null, trace, hooks = null }) {
  const calls = [];
  const artifactGroups = [];
  let adjustedPeriodCount = 0;

  for (const component of components) {
    const call = toolCallFromComponent(component, scope);
    if (!call) {
      continue;
    }
    const stepId = `fallback_${calls.length + 1}_${Date.now()}`;
    emitTimelineEvent(hooks, {
      id: stepId,
      status: 'pending',
      title: timelineTitleForCall(call, component?.title || 'Widget'),
      agent: 'worker',
    });

    const execution = await executeToolCall({ tenantId, userId, call });
    calls.push({
      tool: call.tool,
      source: call.source,
      query: execution.query,
      component: {
        type: component.type || null,
        title: component.title || null,
        metric: component.metric || null,
        layout: component.layout || null,
      },
      agent_context: execution.agent_context,
    });

    if (execution.agent_context?.period_adjusted) {
      adjustedPeriodCount += 1;
    }

    artifactGroups.push(execution.artifacts || []);

    pushTrace(trace, {
      step: `tool:${call.tool}`,
      source: call.source,
      produced: (execution.artifacts || []).length,
      period_adjusted: Boolean(execution.agent_context?.period_adjusted),
    });
    emitTimelineEvent(hooks, {
      id: stepId,
      status: 'done',
      title: timelineTitleForCall(call, component?.title || 'Widget'),
      agent: 'worker',
      meta: {
        produced: (execution.artifacts || []).length,
      },
    });
  }

  const built = buildWidgetsFromArtifacts({ artifacts: artifactGroups, calls, components, analysisBrief });

  return {
    ok: true,
    source: 'deterministic',
    ...built,
    calls,
    adjustedPeriodCount,
    nonEmptyCount: built.nonEmptyCount,
    pageCount: built.pageCount || 0,
    summary: null,
  };
}

async function runWorkerAgentWithGemini({
  tenantId,
  userId,
  dashboard,
  goal,
  scope,
  components,
  planner,
  analysisBrief = null,
  trace,
  memory,
  hooks = null,
  signal = null,
}) {
  const toolHistory = [];
  const callRecords = [];
  const artifactGroups = [];
  const edaProfile = await buildEdaProfile({ tenantId, components, scope });
  const baseWidgetBudget = Math.min(MAX_WIDGETS, Array.isArray(components) ? components.length : MAX_WIDGETS);
  const plannedWidgetBudget = Math.max(MIN_WIDGETS, baseWidgetBudget);
  const maxUniqueToolCalls = Math.max(2, Math.min(MAX_WIDGETS, plannedWidgetBudget + 1));
  const maxWorkerIterations = Math.min(MAX_WORKER_STEPS, maxUniqueToolCalls + 2);
  const executedToolKeys = new Set();
  let adjustedPeriodCount = 0;
  let finalSummary = null;
  let finalLayoutPlan = null;
  let producedWidgets = 0;
  let noToolCallStreak = 0;
  let duplicateCallStreak = 0;
  let templateRead = false;

  for (let stepIndex = 0; stepIndex < maxWorkerIterations; stepIndex += 1) {
    throwIfDashboardAborted(signal);
    const promptPayload = {
      role: 'worker',
      goal,
      scope,
      planner_steps: planner.steps,
      analysis_brief: analysisBrief,
      dashboard_id: dashboard.id,
      available_components: componentCatalog(components),
      eda_profile: edaProfile,
      execution_history: compactToolHistory(toolHistory),
      tooling_reminder: 'Wajib gunakan tool call untuk setiap langkah. Jangan mengirim jawaban tanpa tool. Akhiri dengan finalize_dashboard saat widget cukup.',
      required: {
        use_tools: true,
        max_widgets: MAX_WIDGETS,
        target_unique_widgets: plannedWidgetBudget,
        max_unique_tool_calls: maxUniqueToolCalls,
        min_widgets: MIN_WIDGETS,
        identify_date_columns_before_trend: true,
        identify_numeric_measures_before_query: true,
        avoid_duplicate_queries: true,
      },
    };

    const response = await generateWithGeminiTools({
      systemPrompt: [
        VISTARA_SYSTEM_PROMPT,
        Prompts.WORKER_AGENT,
        `Usahakan minimal ${MIN_WIDGETS} widget unik jika data memungkinkan.`,
        'Utamakan komponen relevan dan hindari widget kosong.',
      ].join('\n\n'),
      userPrompt: JSON.stringify(promptPayload),
      tools: WORKER_TOOL_DECLARATIONS,
      temperature: 0.1,
      maxOutputTokens: WORKER_MAX_OUTPUT_TOKENS,
      thinkingBudget: WORKER_THINKING_BUDGET,
      includeThoughts: false,
      functionCallingMode: 'ANY',
      allowedFunctionNames: WORKER_TOOL_DECLARATIONS.map((tool) => tool.name),
      signal,
    });

    if (!response.ok) {
      pushTrace(trace, {
        step: 'worker',
        ok: false,
        reason: response.reason,
      });
      emitTimelineEvent(hooks, {
        id: `worker_error_${Date.now()}`,
        status: 'error',
        title: 'Worker gagal menjalankan tool',
        agent: 'worker',
        meta: { reason: response.reason },
      });
      return {
        ok: false,
        reason: response.reason,
        calls: [],
        artifacts: [],
        widgets: [],
        adjustedPeriodCount: 0,
        nonEmptyCount: 0,
        summary: null,
      };
    }

    const workerThought = summarizeThoughtForTimeline(response.thoughts, '');
    if (workerThought) {
      emitTimelineEvent(hooks, {
        id: `worker_thinking_${stepIndex + 1}`,
        status: 'done',
        title: workerThought,
        agent: 'worker',
      });
    }

    const call = (response.functionCalls || [])[0];
    if (!call) {
      noToolCallStreak += 1;
      const text = normalizeUserFacingText(response.text || '', '');
      if (text.toLowerCase().startsWith('final:')) {
        finalSummary = normalizeUserFacingText(text.slice(6), '');
        break;
      }

      pushTrace(trace, {
        step: 'worker_no_tool_call',
        iteration: stepIndex + 1,
        streak: noToolCallStreak,
      });
      if (noToolCallStreak >= 2 || (producedWidgets > 0 && noToolCallStreak >= 1) || producedWidgets >= plannedWidgetBudget) {
        break;
      }
      continue; // give the model another chance within max steps
    }
    noToolCallStreak = 0;

    if (call.name === 'finalize_dashboard') {
      finalSummary = normalizeUserFacingText(call.args?.summary || response.text || '', 'Dashboard selesai dibuat.');
      finalLayoutPlan = normalizeLayoutPlan(call.args?.layout_plan);
      pushTrace(trace, {
        step: 'tool:finalize_dashboard',
        iteration: stepIndex + 1,
        pages: finalLayoutPlan?.pages || 1,
      });
      emitTimelineEvent(hooks, {
        id: `worker_finalize_${Date.now()}`,
        status: 'done',
        title: 'Menyelesaikan komposisi dashboard',
        agent: 'worker',
      });
      break;
    }

    if (call.name === 'read_dashboard_template') {
      if (templateRead) {
        duplicateCallStreak += 1;
        pushTrace(trace, {
          step: 'worker_duplicate_tool',
          tool: 'read_dashboard_template',
          streak: duplicateCallStreak,
        });
        if (duplicateCallStreak >= 2 || callRecords.length >= plannedWidgetBudget) {
          break;
        }
        continue;
      }

      templateRead = true;
      duplicateCallStreak = 0;
      const stepId = `worker_template_${stepIndex + 1}_${Date.now()}`;
      emitTimelineEvent(hooks, {
        id: stepId,
        status: 'pending',
        title: 'Membaca template dashboard aktif',
        agent: 'worker',
      });
      const templateResult = {
        dashboard_id: dashboard.id,
        components: componentCatalog(components),
      };

      toolHistory.push({
        tool: 'read_dashboard_template',
        produced: templateResult.components.length,
        title: 'template',
        period_adjusted: false,
      });

      pushTrace(trace, {
        step: 'tool:read_dashboard_template',
        produced: templateResult.components.length,
      });
      emitTimelineEvent(hooks, {
        id: stepId,
        status: 'done',
        title: `Template terbaca (${templateResult.components.length} komponen)`,
        agent: 'worker',
      });
      continue;
    }

    if (call.name === 'python_data_interpreter') {
      const stepId = `worker_python_${stepIndex + 1}_${Date.now()}`;
      emitTimelineEvent(hooks, {
        id: stepId,
        status: 'pending',
        title: 'Menjalankan analisis Python untuk dataset generik',
        agent: 'worker',
      });

      try {
        // Get the current dataset path from memory
        const datasetPath = memory.current_dataset_path;
        if (!datasetPath) {
          throw new Error('No dataset available for Python analysis');
        }

        const pythonResult = await runPythonAnalysis(call.args.code, datasetPath);

        if (pythonResult.success) {
          // Create a markdown widget with the Python analysis result
          const widget = {
            id: generateId(),
            type: 'markdown',
            config: {
              content: `## Analisis Data Python\n\n\`\`\`\n${pythonResult.result}\n\`\`\``
            },
            size: 'full',
            title: 'Analisis Dataset'
          };

          widgets.push(widget);
          artifacts.push({
            kind: 'table',
            title: 'Analisis Python',
            columns: ['Output'],
            rows: [[pythonResult.result]],
          });
          nonEmptyCount += 1;
          producedWidgets += 1;

          pushTrace(trace, {
            step: 'tool:python_data_interpreter',
            success: true,
            iteration: stepIndex + 1,
          });

          emitTimelineEvent(hooks, {
            id: stepId,
            status: 'done',
            title: 'Analisis Python berhasil',
            agent: 'worker',
          });
        } else {
          pushTrace(trace, {
            step: 'tool:python_data_interpreter',
            success: false,
            error: pythonResult.result,
          });

          emitTimelineEvent(hooks, {
            id: stepId,
            status: 'error',
            title: 'Analisis Python gagal',
            agent: 'worker',
            meta: { error: pythonResult.result },
          });
        }
      } catch (error) {
        logger.error('Python data interpreter failed', { error: error.message });

        pushTrace(trace, {
          step: 'tool:python_data_interpreter',
          success: false,
          error: error.message,
        });

        emitTimelineEvent(hooks, {
          id: stepId,
          status: 'error',
          title: 'Analisis Python error',
          agent: 'worker',
          meta: { error: error.message },
        });
      }
      continue;
    }

    if (call.name !== 'query_template' && call.name !== 'query_builder') {
      pushTrace(trace, {
        step: 'worker_unknown_tool',
        tool: call.name,
      });
      continue;
    }

    const normalizedCall = call.name === 'query_template'
      ? {
          tool: 'query_template',
          args: normalizeTemplateQueryArgs(call.args, scope),
          source: 'worker_gemini',
        }
      : {
          tool: 'query_builder',
          args: normalizeBuilderQueryArgs(call.args, scope),
          source: 'worker_gemini',
        };
    const normalizedCallKey = toolCallKey(normalizedCall);
    if (normalizedCallKey && executedToolKeys.has(normalizedCallKey)) {
      duplicateCallStreak += 1;
      pushTrace(trace, {
        step: 'worker_duplicate_tool',
        tool: normalizedCall.tool,
        streak: duplicateCallStreak,
      });
      if (duplicateCallStreak >= 2 || callRecords.length >= plannedWidgetBudget || producedWidgets >= plannedWidgetBudget) {
        break;
      }
      continue;
    }

    duplicateCallStreak = 0;
    if (normalizedCallKey) {
      executedToolKeys.add(normalizedCallKey);
    }
    const timelineId = `worker_tool_${stepIndex + 1}_${Date.now()}`;
    const pendingTitle = timelineTitleForCall(normalizedCall, normalizedCall.args?.title || 'Widget');
    emitTimelineEvent(hooks, {
      id: timelineId,
      status: 'pending',
      title: pendingTitle,
      agent: 'worker',
    });

    const execution = await executeToolCall({
      tenantId,
      userId,
      call: normalizedCall,
    });

    if (execution.agent_context?.period_adjusted) {
      adjustedPeriodCount += 1;
    }

    const artifacts = execution.artifacts || [];
    const firstArtifact = artifacts[0] || null;

    callRecords.push({
      tool: normalizedCall.tool,
      source: normalizedCall.source,
      query: execution.query,
      component: null,
      agent_context: execution.agent_context,
    });

    artifactGroups.push(artifacts);
    producedWidgets += artifacts.length;
    toolHistory.push({
      tool: normalizedCall.tool,
      produced: artifacts.length,
      title: firstArtifact?.title || normalizedCall.args?.title || normalizedCall.args?.metric || normalizedCall.args?.template_id || 'widget',
      period_adjusted: Boolean(execution.agent_context?.period_adjusted),
    });

    pushTrace(trace, {
      step: `tool:${normalizedCall.tool}`,
      source: normalizedCall.source,
      produced: artifacts.length,
      period_adjusted: Boolean(execution.agent_context?.period_adjusted),
    });
    emitTimelineEvent(hooks, {
      id: timelineId,
      status: 'done',
      title: pendingTitle,
      agent: 'worker',
      meta: {
        produced: artifacts.length,
        period_adjusted: Boolean(execution.agent_context?.period_adjusted),
      },
    });

    const draft = buildWidgetsFromArtifacts({
      artifacts: artifactGroups,
      calls: callRecords,
      components,
      layoutPlan: finalLayoutPlan,
      analysisBrief,
    });

    emitDashboardPatch(hooks, {
      status: 'drafting',
      note: firstArtifact?.title
        ? `Citra menambahkan ${safeText(firstArtifact.title, 'widget', 80)} ke draft dashboard.`
        : 'Citra menambahkan visual baru ke draft dashboard.',
      widgets: draft.widgets,
      artifacts: draft.artifacts,
      changed_widgets: draft.widgets.slice(-Math.max(1, artifacts.length)).map((widget) => ({
        id: widget.id,
        title: widget.title || widget.artifact?.title || 'Widget',
      })),
      page_count: draft.pageCount || 1,
    });

    if (artifactGroups.length >= MAX_WIDGETS || callRecords.length >= maxUniqueToolCalls) {
      break;
    }
  }

  const built = buildWidgetsFromArtifacts({
    artifacts: artifactGroups,
    calls: callRecords,
    components,
    layoutPlan: finalLayoutPlan,
    analysisBrief,
  });

  memory.steps.push({
    agent: 'worker',
    source: 'gemini_tool_call',
    tools_executed: callRecords.length,
    produced_widgets: built.widgets.length,
    pages: built.pageCount || 0,
  });

  return {
    ok: callRecords.length > 0,
    reason: callRecords.length > 0 ? null : 'no_worker_tools_executed',
    source: 'gemini_tool_call',
    widgets: built.widgets,
    artifacts: built.artifacts,
    calls: callRecords,
    adjustedPeriodCount,
    nonEmptyCount: built.nonEmptyCount,
    pageCount: built.pageCount || 0,
    layoutPlan: finalLayoutPlan,
    summary: finalSummary,
  };
}

function parseArtifactNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(String(value ?? '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/,(?=\d{1,2}\b)/g, '.')
    .replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatInsightNumber(value, { currency = true, percent = false } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  if (percent) {
    return `${numeric.toLocaleString('id-ID', {
      maximumFractionDigits: Math.abs(numeric) >= 10 ? 1 : 2,
    })}%`;
  }
  const absolute = Math.abs(numeric);
  const sign = numeric < 0 ? '-' : '';
  if (absolute >= 1_000_000_000) {
    return `${sign}${currency ? 'Rp ' : ''}${(absolute / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  }
  if (absolute >= 1_000_000) {
    return `${sign}${currency ? 'Rp ' : ''}${(absolute / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  }
  if (absolute >= 1_000) {
    return `${sign}${currency ? 'Rp ' : ''}${(absolute / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} rb`;
  }
  return `${sign}${currency ? 'Rp ' : ''}${absolute.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
}

function artifactLooksPercent(artifact = {}) {
  const title = safeText(artifact.title || '', '', 80).toLowerCase();
  const value = safeText(artifact.value || '', '', 40);
  return title.includes('margin') || value.includes('%');
}

function classifyDashboardFailure(reason = 'dashboard_agent_failed', details = null) {
  const normalizedReason = safeText(reason, 'dashboard_agent_failed', 80).toLowerCase();

  if (normalizedReason === 'quota_exhausted' || normalizedReason === 'http_429') {
    return new DashboardAgentError({
      code: 'AI_QUOTA_EXHAUSTED',
      statusCode: 429,
      retryable: false,
      reason: normalizedReason,
      message: 'Kuota AI sedang habis. Coba lagi beberapa saat.',
      details,
    });
  }

  if (normalizedReason === 'missing_api_key') {
    return new DashboardAgentError({
      code: 'AI_SERVICE_UNAVAILABLE',
      statusCode: 503,
      retryable: false,
      reason: normalizedReason,
      message: 'Layanan AI belum dikonfigurasi untuk membuat dashboard.',
      details,
    });
  }

  if (normalizedReason === 'timeout' || normalizedReason === 'dashboard_agent_timeout') {
    return new DashboardAgentError({
      code: 'AI_SERVICE_TIMEOUT',
      statusCode: 504,
      retryable: true,
      reason: normalizedReason,
      message: 'Layanan AI terlalu lama merespons saat membuat dashboard. Coba lagi.',
      details,
    });
  }

  if (normalizedReason === 'dashboard_generation_empty') {
    return new DashboardAgentError({
      code: 'DASHBOARD_EMPTY',
      statusCode: 422,
      retryable: false,
      reason: normalizedReason,
      message: 'Dashboard belum bisa dibuat karena visual yang dihasilkan kosong atau tidak cukup kuat untuk ditampilkan.',
      details,
    });
  }

  if (normalizedReason === 'dashboard_visual_review_failed') {
    return new DashboardAgentError({
      code: 'DASHBOARD_REVIEW_FAILED',
      statusCode: 422,
      retryable: false,
      reason: normalizedReason,
      message: 'Dashboard belum cukup rapi atau lengkap untuk ditampilkan.',
      details,
    });
  }

  if (
    normalizedReason === 'network_error'
    || normalizedReason === 'invalid_json'
    || normalizedReason === 'missing_submit_plan_call'
    || normalizedReason === 'no_worker_tools_executed'
    || /^http_5\d\d$/.test(normalizedReason)
  ) {
    return new DashboardAgentError({
      code: 'AI_SERVICE_UNAVAILABLE',
      statusCode: 503,
      retryable: true,
      reason: normalizedReason,
      message: 'Layanan AI sedang bermasalah saat membuat dashboard. Coba lagi.',
      details,
    });
  }

  return new DashboardAgentError({
    code: 'DASHBOARD_AGENT_FAILED',
    statusCode: 503,
    retryable: false,
    reason: normalizedReason,
    message: 'Gagal membuat dashboard. Coba lagi.',
    details,
  });
}

function metricClause(artifact = {}) {
  const title = safeText(artifact.title || 'Metrik', 'Metrik', 48);
  const titleLower = title.toLowerCase();
  const rawValue = parseArtifactNumber(artifact.raw_value ?? artifact.value);
  const formattedValue = rawValue === null
    ? safeText(artifact.value || '-', '-', 32)
    : formatInsightNumber(rawValue, {
        currency: !artifactLooksPercent(artifact),
        percent: artifactLooksPercent(artifact),
      });
  const delta = safeText(artifact.delta || '', '', 48);

  let prefix = `${title} tercatat ${formattedValue}`;
  if (titleLower.includes('omzet') || titleLower.includes('revenue')) {
    prefix = `omzet tercatat ${formattedValue}`;
  } else if (titleLower.includes('untung') || titleLower.includes('profit') || titleLower.includes('laba')) {
    prefix = `untung berada di ${formattedValue}`;
  } else if (titleLower.includes('margin')) {
    prefix = `margin berada di ${formattedValue}`;
  } else if (titleLower.includes('biaya') || titleLower.includes('expense')) {
    prefix = `biaya tercatat ${formattedValue}`;
  }

  return delta ? `${prefix} (${delta})` : prefix;
}

function chartInsight(artifact = {}) {
  const series = Array.isArray(artifact.series) ? artifact.series : [];
  const values = Array.isArray(series[0]?.values)
    ? series[0].values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value))
    : [];
  const labels = Array.isArray(artifact.labels) ? artifact.labels.map((label) => safeText(label, '', 36)) : [];
  if (values.length === 0) {
    return null;
  }

  const title = safeText(artifact.title || 'tren', 'tren', 48);
  const chartType = safeText(artifact.chart_type || 'line', 'line', 16).toLowerCase();
  const isPercent = artifactLooksPercent(artifact);
  const peakValue = Math.max(...values);
  const peakIndex = values.indexOf(peakValue);
  const peakLabel = labels[peakIndex] || 'periode tertinggi';

  if (chartType === 'pie' || chartType === 'bar') {
    const leadLabel = labels[peakIndex] || 'kategori utama';
    const leadPct = chartType === 'pie'
      ? ` (${((peakValue / (values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1)) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%)`
      : '';
    return `${title} didominasi ${leadLabel} dengan nilai ${formatInsightNumber(peakValue, { currency: !isPercent, percent: isPercent })}${leadPct}.`;
  }

  const latestValue = values[values.length - 1];
  const latestLabel = labels[values.length - 1] || 'periode terbaru';
  const startValue = values[0];
  const direction = latestValue > startValue ? 'naik' : latestValue < startValue ? 'turun' : 'stabil';

  return `${title} berakhir di ${latestLabel} sebesar ${formatInsightNumber(latestValue, { currency: !isPercent, percent: isPercent })} dan bergerak ${direction} dibanding awal rentang. Puncak tertinggi ada di ${peakLabel}.`;
}

function tableInsight(artifact = {}) {
  const rows = Array.isArray(artifact.rows) ? artifact.rows : [];
  if (rows.length === 0) {
    return null;
  }

  const title = safeText(artifact.title || 'peringkat', 'peringkat', 48);
  const topRow = rows[0] || {};
  const label = safeText(topRow.name || topRow.label || topRow.branch || topRow.product || 'item teratas', 'item teratas', 40);
  const rawValue = parseArtifactNumber(topRow.value ?? topRow.total_revenue ?? topRow.revenue ?? topRow.total_profit ?? topRow.profit);
  const formattedValue = rawValue === null ? null : formatInsightNumber(rawValue);

  if (formattedValue) {
    return `Di ${title}, posisi teratas ditempati ${label} dengan nilai ${formattedValue}.`;
  }

  return `Di ${title}, posisi teratas saat ini ditempati ${label}.`;
}

function buildDashboardFindings({ artifacts = [], scope = {} }) {
  const uniqueArtifacts = dedupeArtifacts(artifacts);
  const metrics = uniqueArtifacts.filter((artifact) => artifact?.kind === 'metric');
  const charts = uniqueArtifacts.filter((artifact) => artifact?.kind === 'chart');
  const tables = uniqueArtifacts.filter((artifact) => artifact?.kind === 'table');

  const primaryMetrics = [];
  const metricMatchers = [
    (title) => title.includes('omzet') || title.includes('revenue'),
    (title) => title.includes('untung') || title.includes('profit') || title.includes('laba'),
    (title) => title.includes('margin'),
    (title) => title.includes('biaya') || title.includes('expense'),
  ];

  for (const matcher of metricMatchers) {
    const match = metrics.find((artifact) => matcher(safeText(artifact.title || '', '', 80).toLowerCase()));
    if (match && !primaryMetrics.includes(match)) {
      primaryMetrics.push(match);
    }
  }

  for (const artifact of metrics) {
    if (primaryMetrics.length >= 3) {
      break;
    }
    if (!primaryMetrics.includes(artifact)) {
      primaryMetrics.push(artifact);
    }
  }

  const clauses = primaryMetrics.map((artifact) => metricClause(artifact)).filter(Boolean).slice(0, 3);
  const nonMetricInsights = [
    chartInsight(charts[0]),
    tableInsight(tables[0]),
    chartInsight(charts[1]),
    tableInsight(tables[1]),
  ].filter(Boolean);

  if (clauses.length > 0) {
    const firstParagraph = `Untuk periode ${safeText(scope.time_period || 'yang diminta', 'yang diminta', 48)}, ${clauses.join(', ')}.`;
    const secondParagraph = nonMetricInsights.find(Boolean) || '';
    return secondParagraph ? `${firstParagraph}\n\n${secondParagraph}` : firstParagraph;
  }

  const [primaryInsight = '', secondaryInsight = ''] = nonMetricInsights;
  if (primaryInsight) {
    return secondaryInsight ? `${primaryInsight}\n\n${secondaryInsight}` : primaryInsight;
  }

  return `Belum ada temuan dashboard yang cukup kuat untuk diringkas pada periode ${safeText(scope.time_period || 'yang diminta', 'yang diminta', 48)}.`;
}

function findingSortRank(artifact = {}) {
  const semantic = artifactSemanticKey(artifact);
  if (semantic === 'total_revenue') return 0;
  if (semantic === 'total_profit') return 1;
  if (semantic === 'margin_percentage') return 2;
  if (semantic === 'revenue_trend') return 3;
  if (semantic === 'top_products') return 4;
  if (semantic === 'branch_performance') return 5;
  if (semantic === 'total_expense') return 6;
  if (artifact.kind === 'metric') return 7;
  if (artifact.kind === 'chart') return 8;
  if (artifact.kind === 'table') return 9;
  return 10;
}

function findingWhyItMatters(artifact = {}) {
  const semantic = artifactSemanticKey(artifact);
  switch (semantic) {
    case 'total_revenue':
      return 'agar user langsung tahu skala omzet pada periode ini sebelum masuk ke rincian lain';
    case 'total_profit':
      return 'agar user bisa membedakan penjualan yang ramai dengan hasil bersih yang benar-benar tersisa';
    case 'margin_percentage':
      return 'agar efisiensi tetap terlihat, bukan hanya angka omzet';
    case 'revenue_trend':
      return 'agar pola naik turun harian dan titik puncak cepat terbaca';
    case 'top_products':
      return 'agar produk yang paling mendorong omzet bisa dikenali tanpa membuka tabel mentah';
    case 'branch_performance':
      return 'agar cabang yang paling kuat atau tertinggal bisa langsung dibandingkan';
    case 'total_expense':
      return 'agar tekanan biaya tidak tertutup oleh angka penjualan';
    default:
      if (artifact.kind === 'table') {
        return 'agar urutan kontributor utama tetap mudah dibaca oleh user non-teknis';
      }
      if (artifact.kind === 'chart') {
        return 'agar perubahan pola lebih mudah terlihat daripada hanya membaca angka';
      }
      return 'agar insight utama tetap cepat dipahami';
  }
}

function findingEvidence(artifact = {}, scope = {}) {
  const semantic = artifactSemanticKey(artifact);
  if (artifact.kind === 'metric') {
    const rawValue = parseArtifactNumber(artifact.raw_value ?? artifact.value);
    return {
      metric_key: semantic,
      period: safeText(scope.time_period || 'periode aktif', 'periode aktif', 48),
      value: rawValue === null
        ? safeText(artifact.value || '-', '-', 32)
        : formatInsightNumber(rawValue, {
            currency: !artifactLooksPercent(artifact),
            percent: artifactLooksPercent(artifact),
          }),
      delta: safeText(artifact.delta || '', '', 48) || null,
    };
  }

  if (artifact.kind === 'chart') {
    const series = Array.isArray(artifact.series) ? artifact.series : [];
    const values = (series[0]?.values || []).map((value) => Number(value || 0)).filter((value) => Number.isFinite(value));
    const labels = Array.isArray(artifact.labels) ? artifact.labels : [];
    const latestValue = values.length > 0 ? values[values.length - 1] : null;
    const peakValue = values.length > 0 ? Math.max(...values) : null;
    const peakIndex = peakValue === null ? -1 : values.indexOf(peakValue);
    return {
      metric_key: semantic,
      period: safeText(scope.time_period || 'periode aktif', 'periode aktif', 48),
      latest_label: safeText(labels[values.length - 1] || '', '', 40) || null,
      latest_value: latestValue === null ? null : formatInsightNumber(latestValue, {
        currency: !artifactLooksPercent(artifact),
        percent: artifactLooksPercent(artifact),
      }),
      peak_label: safeText(labels[peakIndex] || '', '', 40) || null,
      peak_value: peakValue === null ? null : formatInsightNumber(peakValue, {
        currency: !artifactLooksPercent(artifact),
        percent: artifactLooksPercent(artifact),
      }),
    };
  }

  if (artifact.kind === 'table') {
    const topRow = Array.isArray(artifact.rows) ? artifact.rows[0] || null : null;
    const leader = safeText(topRow?.name || topRow?.label || topRow?.branch || topRow?.product || '', '', 40) || null;
    const rawValue = parseArtifactNumber(
      topRow?.value ?? topRow?.total_revenue ?? topRow?.revenue ?? topRow?.total_profit ?? topRow?.profit,
    );
    return {
      metric_key: semantic,
      period: safeText(scope.time_period || 'periode aktif', 'periode aktif', 48),
      leader,
      leader_value: rawValue === null ? null : formatInsightNumber(rawValue),
    };
  }

  return {
    metric_key: semantic,
    period: safeText(scope.time_period || 'periode aktif', 'periode aktif', 48),
  };
}

function buildFindingFromArtifact(artifact = {}, scope = {}, index = 0) {
  const insight = metricClause(artifact)
    || chartInsight(artifact)
    || tableInsight(artifact)
    || `Pantau ${safeText(artifact.title || 'visual ini', 'visual ini', 48)} untuk membaca perubahan utama pada ${safeText(scope.time_period || 'periode aktif', 'periode aktif', 48)}.`;
  return {
    id: `finding_${index + 1}`,
    candidate_id: artifactSemanticKey(artifact) || normalizeKeyText(artifact.title || '') || `candidate_${index + 1}`,
    insight,
    evidence: findingEvidence(artifact, scope),
    why_it_matters: findingWhyItMatters(artifact),
    recommended_visual: artifact.kind === 'chart'
      ? safeText(artifact.chart_type || 'chart', 'chart', 24)
      : artifact.kind === 'table'
        ? 'table'
        : 'metric',
    priority: findingSortRank(artifact) <= 3 || index === 0 ? 'primary' : 'supporting',
    title: safeText(artifact.title || `Temuan ${index + 1}`, `Temuan ${index + 1}`, 80),
    artifact_key: artifactSemanticKey(artifact) || normalizeKeyText(artifact.title || ''),
  };
}

function buildAnalysisBrief({ goal = '', artifacts = [], scope = {} }) {
  const rankedArtifacts = dedupeArtifacts(artifacts)
    .filter((artifact) => artifact && !artifactLooksEmpty(artifact))
    .sort((left, right) => findingSortRank(left) - findingSortRank(right))
    .slice(0, MAX_WIDGETS);

  const findings = rankedArtifacts.map((artifact, index) => buildFindingFromArtifact(artifact, scope, index));
  if (findings.length === 0) {
    return null;
  }

  return {
    headline: findings[0]?.insight || null,
    business_goal: safeText(goal || 'Ringkas performa bisnis', 'Ringkas performa bisnis', 140),
    time_scope: safeText(scope.time_period || 'periode aktif', 'periode aktif', 48),
    findings,
  };
}


async function reviewArtifactsWithPython(artifacts) {
  return runPythonSnippet({
    code: PYTHON_REVIEW_CODE,
    context: { artifacts },
  });
}

function normalizeReviewResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const rawVerdict = safeText(raw.verdict, 'fail', 24).toLowerCase();
  const verdict = ['pass', 'needs_revision', 'fail'].includes(rawVerdict)
    ? rawVerdict
    : ['good', 'high'].includes(rawVerdict)
      ? 'pass'
      : ['medium', 'revise', 'needs_fix'].includes(rawVerdict)
        ? 'needs_revision'
        : 'fail';

  return {
    total_widgets: toNumber(raw.total_widgets, 0),
    non_empty_widgets: toNumber(raw.non_empty_widgets, 0),
    metric_positive: toNumber(raw.metric_positive, 0),
    table_rows: toNumber(raw.table_rows, 0),
    chart_points: toNumber(raw.chart_points, 0),
    completeness_pct: toNumber(raw.completeness_pct, 0),
    verdict,
    summary: safeText(raw.summary || '', '', 280) || null,
    issues: Array.isArray(raw.issues)
      ? raw.issues.map((item) => safeText(item, '', 180)).filter(Boolean).slice(0, 6)
      : [],
    directives: {
      expand_titles: Array.isArray(raw?.directives?.expand_titles)
        ? raw.directives.expand_titles.map((item) => safeText(item, '', 80)).filter(Boolean).slice(0, 4)
        : [],
      add_templates: Array.isArray(raw?.directives?.add_templates)
        ? raw.directives.add_templates.map((item) => normalizeTemplateId(item)).filter(Boolean).slice(0, 2)
        : [],
      notes: Array.isArray(raw?.directives?.notes)
        ? raw.directives.notes.map((item) => safeText(item, '', 140)).filter(Boolean).slice(0, 4)
        : [],
    },
  };
}

async function buildVisualReviewerInput({ widgets = [], goal = '', scope = {}, artifacts = [] }) {
  const usePlaceholder = config.env === 'test';
  const rendered = usePlaceholder
    ? {
        buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        width: 1,
        height: 1,
      }
    : renderDashboardPng({
        widgets,
        stackPages: true,
        title: goal || 'Dashboard Vistara',
      });
  return {
    inlineFile: {
      mimeType: 'image/png',
      data: rendered.buffer.toString('base64'),
    },
    rendered,
    metadata: {
      page_coverage: pageCoverageStats(widgets),
      artifacts: compactArtifacts(artifacts),
      goal,
      scope,
    },
  };
}

async function runArgusAgent({
  goal,
  scope,
  artifacts,
  widgets,
  trace,
  memory,
  hooks = null,
  signal = null,
  passNumber = 1,
  minPasses = MIN_REVIEW_PASSES,
  maxPasses = MAX_REVIEW_PASSES,
}) {
  const reviewStepId = `argus_${Date.now()}`;
  emitTimelineEvent(hooks, {
    id: reviewStepId,
    status: 'pending',
    title: `Argus menilai kualitas visual (pass ${passNumber}/${maxPasses})`,
    agent: 'argus',
  });
  throwIfDashboardAborted(signal);

  const python = await reviewArtifactsWithPython(artifacts);
  const pythonResult = normalizeReviewResult(python.result);
  const visualInput = await buildVisualReviewerInput({
    widgets,
    goal,
    scope,
    artifacts,
  });

  const reviewResponse = await generateJsonWithGeminiMedia({
    systemPrompt: [
      VISTARA_SYSTEM_PROMPT,
      Prompts.ARGUS_CURATOR,
    ].join('\n\n'),
    userPrompt: JSON.stringify({
      goal,
      scope,
      layout: pageCoverageStats(widgets),
      review_pass: {
        current: passNumber,
        minimum_required: minPasses,
        maximum: maxPasses,
      },
      artifacts: compactArtifacts(artifacts),
      python_result: pythonResult,
      output_rules: 'Jawab hanya JSON object tanpa markdown. Isi verdict, completeness_pct, summary. Sertakan issues dan directives bila perlu.',
      required_shape: {
        verdict: 'pass | needs_revision | fail',
        completeness_pct: 'number 0-100',
        summary: 'string',
        issues: ['string'],
        directives: {
          expand_titles: ['string'],
          add_templates: ['total_revenue | total_profit | margin_percentage | revenue_trend | top_products | branch_performance | total_expense'],
          notes: ['string'],
        },
      },
    }),
    inlineFiles: [visualInput.inlineFile],
    temperature: 0.1,
    maxOutputTokens: ARGUS_MAX_OUTPUT_TOKENS,
    signal,
  });

  if (!reviewResponse.ok) {
    pushTrace(trace, {
      step: 'argus_visual',
      ok: false,
      reason: reviewResponse.reason,
    });
    emitTimelineEvent(hooks, {
      id: reviewStepId,
      status: 'error',
      title: 'Argus gagal menilai dashboard',
      agent: 'argus',
    });
    return {
      ok: false,
      source: 'visual_gemini',
      reason: reviewResponse.reason,
      result: pythonResult,
      python: {
        ok: python.ok,
        reason: python.reason || null,
      },
    };
  }

  const mergedResult = normalizeReviewResult({
    ...(pythonResult || {}),
    ...(reviewResponse.data || {}),
    completeness_pct: toNumber(reviewResponse.data?.completeness_pct, pythonResult?.completeness_pct || 0),
  });

  memory.steps.push({
    agent: 'argus',
    source: 'visual_gemini',
    result: mergedResult,
  });
  emitTimelineEvent(hooks, {
    id: reviewStepId,
    status: 'done',
    title: mergedResult?.verdict === 'needs_revision'
      ? 'Argus meminta revisi visual'
      : mergedResult?.verdict === 'fail'
        ? 'Argus menemukan area yang perlu diperbaiki'
        : `Argus: kurasi selesai (${toNumber(mergedResult?.completeness_pct, 0)}%)`,
    agent: 'argus',
  });

  return {
    ok: Boolean(mergedResult),
    source: 'visual_gemini',
    result: mergedResult,
    python: {
      ok: python.ok,
      reason: python.reason || null,
    },
    rendered: {
      width: visualInput.rendered.width,
      height: visualInput.rendered.height,
    },
  };
}

function dedupeArtifacts(artifacts) {
  const seen = new Set();
  const result = [];

  for (const artifact of artifacts) {
    const key = artifactDedupKey(artifact);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(artifact);
  }

  return result;
}

export async function runDashboardAgent({
  tenantId,
  userId,
  dashboardId = null,
  dashboard: inputDashboard = null,
  goal = '',
  request = null,
  intent = {},
  hooks = null,
  signal = null,
}) {
  throwIfDashboardAborted(signal);
  const routingScope = request && typeof request === 'object' ? request : intent;
  const scope = normalizeScope(routingScope);
  const trace = [];
  const memory = {
    goal,
    scope,
    steps: [],
  };

  const dashboard = inputDashboard || await dashboardFromContext(tenantId, userId, dashboardId);
  const baseComponents = normalizeTemplateComponents(dashboard);
  const components = isFullDashboardGoal(goal, routingScope) ? mergeWithComplexDefaults(baseComponents, routingScope) : baseComponents;
  const templateStepId = `template_${Date.now()}`;

  emitTimelineEvent(hooks, {
    id: templateStepId,
    status: 'pending',
    title: 'Menganalisis dataset dan template dashboard',
    agent: 'system',
  });

  pushTrace(trace, {
    step: 'tool:read_dashboard_template',
    dashboard_id: dashboard.id,
    components: components.length,
  });
  emitTimelineEvent(hooks, {
    id: templateStepId,
    status: 'done',
    title: `Template siap (${components.length} komponen)`,
    agent: 'system',
  });
  memory.steps.push({
    action: 'read_dashboard_template',
    dashboard_id: dashboard.id,
    component_count: components.length,
  });

  const datasetProfile = await getDatasetProfile(tenantId);
  memory.current_dataset_path = datasetProfile?.source?.file_path || null;

  const analyst = await runAnalystAgent({
    tenantId,
    userId,
    goal,
    scope,
    components,
    trace,
    memory,
    hooks,
    signal,
  });
  const dashboardComponents = selectComponentsFromAnalystBrief(components, analyst);
  const analystSupportingTemplateIds = supportingTemplateIdsFromAnalystBrief(analyst.brief);

  const planner = await runPlannerAgent({
    goal,
    scope,
    components: dashboardComponents,
    analysisBrief: analyst.brief,
    trace,
    memory,
    hooks,
    signal,
  });

  let worker = await runWorkerAgentWithGemini({
    tenantId,
    userId,
    dashboard,
    goal,
    scope,
    components: dashboardComponents,
    planner,
    analysisBrief: analyst.brief,
    trace,
    memory,
    hooks,
    signal,
  });

  if (!worker.ok || worker.calls.length === 0) {
    throw classifyDashboardFailure(worker.reason || 'worker_failed', {
      stage: 'worker',
      source: worker.source,
      non_empty_count: Number(worker.nonEmptyCount || 0),
      artifact_count: Array.isArray(worker.artifacts) ? worker.artifacts.length : 0,
    });
  }

  if (!worker.widgets.length || !worker.artifacts.length || worker.nonEmptyCount === 0) {
    const failureReason = worker.reason || 'dashboard_generation_empty';
    pushTrace(trace, {
      step: 'dashboard_empty',
      reason: failureReason,
    });
    memory.steps.push({
      agent: 'worker',
      source: worker.source || 'unknown',
      result: 'empty_dashboard_blocked',
      reason: failureReason,
    });
    throw classifyDashboardFailure('dashboard_generation_empty', {
      stage: 'worker',
      source: worker.source,
      reason: failureReason,
    });
  }

  let reviewedDraft = await enforceDashboardCoverage({
    tenantId,
    userId,
    scope,
    components,
    widgets: attachAnalysisBriefToWidgets(worker.widgets, analyst.brief),
    analysisBrief: analyst.brief,
    layoutPlan: worker.layoutPlan,
    trace,
    hooks,
    preferredTemplateIds: analystSupportingTemplateIds,
  });
  reviewedDraft = await ensureMinimumWidgets({
    tenantId,
    userId,
    scope,
    components,
    widgets: reviewedDraft.widgets,
    analysisBrief: analyst.brief,
    layoutPlan: worker.layoutPlan,
    trace,
    hooks,
    preferredTemplateIds: analystSupportingTemplateIds,
    minWidgets: MIN_WIDGETS,
  });
  let argusResult = null;
  let argusBlockingIssue = null;
  let argusPassCount = 0;

  while (argusPassCount < MAX_REVIEW_PASSES) {
    argusResult = await runArgusAgent({
      goal,
      scope,
      artifacts: reviewedDraft.artifacts,
      widgets: reviewedDraft.widgets,
      trace,
      memory,
      hooks,
      signal,
      passNumber: argusPassCount + 1,
      minPasses: MIN_REVIEW_PASSES,
      maxPasses: MAX_REVIEW_PASSES,
    });
    argusPassCount += 1;

    if (!argusResult.ok) {
      argusBlockingIssue = {
        stage: 'argus',
        source: argusResult.source,
        reason: argusResult.reason || 'dashboard_visual_review_failed',
      };
      break;
    }

    if (argusResult.result?.verdict === 'pass') {
      if (argusPassCount < MIN_REVIEW_PASSES) {
        emitTimelineEvent(hooks, {
          id: `argus_confirm_${Date.now()}`,
          status: 'pending',
          title: 'Argus menjalankan pass verifikasi tambahan',
          agent: 'argus',
        });
        continue;
      }
      break;
    }

    if (argusResult.result?.verdict === 'needs_revision') {
      const directedWidgets = expandWidgetsByTitle(
        reviewedDraft.widgets,
        argusResult.result?.directives?.expand_titles || [],
      );
      reviewedDraft = await enforceDashboardCoverage({
        tenantId,
        userId,
        scope,
        components,
        widgets: directedWidgets,
        analysisBrief: analyst.brief,
        layoutPlan: worker.layoutPlan,
        trace,
        hooks,
        preferredTemplateIds: [
          ...analystSupportingTemplateIds,
          ...(argusResult.result?.directives?.add_templates || []),
        ],
      });

      emitDashboardPatch(hooks, {
        status: 'drafting',
        note: 'Citra memperbarui tata letak berdasarkan tinjauan Argus...',
        widgets: reviewedDraft.widgets,
        artifacts: reviewedDraft.artifacts,
        analysis_brief: analyst.brief,
        changed_widgets: reviewedDraft.widgets.map((widget) => ({
          id: widget.id,
          title: widget.title || widget.artifact?.title || 'Widget',
        })),
        page_count: reviewedDraft.pageCount || 1,
      });

      continue;
    }

    argusBlockingIssue = {
      stage: 'argus',
      source: argusResult.source,
      review: argusResult.result,
      reason: 'dashboard_visual_review_failed',
    };
    break;
  }

  if (!argusBlockingIssue && argusResult?.result?.verdict !== 'pass') {
    argusBlockingIssue = {
      stage: 'argus',
      source: argusResult?.source || 'gemini_media',
      review: argusResult?.result || null,
      reason: 'dashboard_visual_review_failed',
    };
  }

  if (argusBlockingIssue) {
    pushTrace(trace, {
      step: 'argus_degraded',
      ...argusBlockingIssue,
    });
    emitTimelineEvent(hooks, {
      id: `argus_degraded_${Date.now()}`,
      status: 'done',
      title: argusBlockingIssue.reason === 'dashboard_visual_review_failed'
        ? 'Draft terbaik ditampilkan — Argus akan menyempurnakan nanti'
        : 'Argus tidak tersedia, gunakan draft terbaik saat ini',
      agent: 'argus',
    });
  }

  const argusNeedsAttention = argusBlockingIssue?.reason === 'dashboard_visual_review_failed';

  let baseAnswer = buildDashboardSummaryFromBrief({
    analysisBrief: analyst.brief,
    scope,
  }) || buildDashboardFindings({
    artifacts: reviewedDraft.artifacts,
    scope,
  }) || worker.summary || 'Dashboard siap ditinjau di canvas.';

  if (argusNeedsAttention) {
    baseAnswer = `${baseAnswer}\n\nPerlu dirapikan sebelum dianggap final.\n\n> ⚠️ **Argus** telah melihat beberapa area yang bisa diperbaiki. Draft terbaik ditampilkan sementara.`;
  }

  emitDashboardPatch(hooks, {
    status: argusNeedsAttention ? 'needs_review' : 'ready',
    note: baseAnswer,
    widgets: reviewedDraft.widgets,
    artifacts: reviewedDraft.artifacts,
    analysis_brief: analyst.brief,
    changed_widgets: reviewedDraft.widgets.map((widget) => ({
      id: widget.id,
      title: widget.title || widget.artifact?.title || 'Widget',
    })),
    page_count: reviewedDraft.pageCount || 1,
  });

  const argusMeta = {
    ok: argusResult?.ok || false,
    source: argusResult?.source || 'not_run',
    requires_attention: argusNeedsAttention,
  };

  return {
    answer: baseAnswer,
    widgets: reviewedDraft.widgets,
    artifacts: reviewedDraft.artifacts,
    analysis_brief: analyst.brief,
    dashboard,
    presentation_mode: 'canvas',
    draft_status: argusNeedsAttention ? 'needs_review' : 'ready',
    agent: {
      mode: 'multi_agent_runtime',
      trace,
      memory,
      fallback_used: false,
      period_adjusted_steps: worker.adjustedPeriodCount,
      tool_calls: worker.calls.length,
      analyst: {
        ok: analyst.ok,
        source: analyst.source,
        findings: Array.isArray(analyst.brief?.findings) ? analyst.brief.findings.length : 0,
      },
      planner: {
        ok: planner.ok,
        reason: planner.reason || null,
        source: planner.source,
        steps: planner.steps,
      },
      worker: {
        ok: worker.ok,
        reason: worker.reason || null,
        source: worker.source,
        pages: reviewedDraft.pageCount || worker.pageCount || 0,
      },
      argus: argusResult?.result || null,
      argus_meta: argusMeta,
      reviewer_meta: argusMeta,
      python_tool: {
        ok: argusResult?.python?.ok || false,
        reason: argusResult?.python?.reason || 'not_used',
      },
    },
  };
}
