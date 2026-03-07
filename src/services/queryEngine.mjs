import { all, get } from '../db.mjs';
import { buildTemplateQuery, getTemplate } from './queryTemplates.mjs';
import { parseTimePeriod, previousPeriod } from '../utils/time.mjs';
import { toLowerAlnum, toRupiah } from '../utils/text.mjs';
import { logAudit } from './audit.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateOrNull(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function datasetForTemplate(templateId) {
  if (templateId === 'total_expense') {
    return 'expenses';
  }
  return 'transactions';
}

function isRelativePeriodInput(input) {
  const text = String(input || '').toLowerCase().trim();
  if (!text) {
    return true;
  }

  return /hari|minggu|bulan|today|yesterday|last|this|kemarin/.test(text);
}

function latestDataDate(tenantId, dataset = 'transactions') {
  if (dataset === 'expenses') {
    const row = get(
      `
        SELECT MAX(expense_date) AS latest
        FROM expenses
        WHERE tenant_id = :tenant_id
      `,
      { tenant_id: tenantId },
    );
    return toDateOrNull(row?.latest);
  }

  const tx = get(
    `
      SELECT MAX(transaction_date) AS latest
      FROM transactions
      WHERE tenant_id = :tenant_id
    `,
    { tenant_id: tenantId },
  );

  const expense = get(
    `
      SELECT MAX(expense_date) AS latest
      FROM expenses
      WHERE tenant_id = :tenant_id
    `,
    { tenant_id: tenantId },
  );

  const txDate = toDateOrNull(tx?.latest);
  const expenseDate = toDateOrNull(expense?.latest);

  if (!txDate) {
    return expenseDate;
  }
  if (!expenseDate) {
    return txDate;
  }

  return txDate > expenseDate ? txDate : expenseDate;
}

function coveragePeriodForDataset(tenantId, dataset = 'transactions') {
  if (dataset === 'expenses') {
    const row = get(
      `
        SELECT MIN(expense_date) AS start_date, MAX(expense_date) AS end_date, COUNT(*) AS count_rows
        FROM expenses
        WHERE tenant_id = :tenant_id
      `,
      { tenant_id: tenantId },
    );

    if (!row || Number(row.count_rows || 0) === 0 || !row.start_date || !row.end_date) {
      return null;
    }

    return {
      start: new Date(row.start_date).toISOString(),
      end: new Date(row.end_date).toISOString(),
      label: 'Rentang data tersedia',
      granularity: 'day',
      anchored: true,
      source: 'dataset_coverage',
    };
  }

  const row = get(
    `
      SELECT MIN(transaction_date) AS start_date, MAX(transaction_date) AS end_date, COUNT(*) AS count_rows
      FROM transactions
      WHERE tenant_id = :tenant_id
    `,
    { tenant_id: tenantId },
  );

  if (!row || Number(row.count_rows || 0) === 0 || !row.start_date || !row.end_date) {
    return null;
  }

  return {
    start: new Date(row.start_date).toISOString(),
    end: new Date(row.end_date).toISOString(),
    label: 'Rentang data tersedia',
    granularity: 'day',
    anchored: true,
    source: 'dataset_coverage',
  };
}

function resolveAgenticPeriod(tenantId, rawPeriodInput, dataset = 'transactions') {
  const input = rawPeriodInput || (dataset === 'expenses' ? '30 hari terakhir' : '7 hari terakhir');
  const useRelativeAnchor = isRelativePeriodInput(input);

  if (!useRelativeAnchor) {
    return {
      ...parseTimePeriod(input),
      anchored: false,
      source: 'user_input',
    };
  }

  const latest = latestDataDate(tenantId, dataset);
  if (!latest) {
    return {
      ...parseTimePeriod(input),
      anchored: false,
      source: 'system_now',
    };
  }

  const now = new Date();
  const staleByDays = Math.floor((now.getTime() - latest.getTime()) / DAY_MS);
  const anchorDate = staleByDays > 2 ? latest : now;

  return {
    ...parseTimePeriod(input, anchorDate),
    anchored: staleByDays > 2,
    source: staleByDays > 2 ? 'latest_dataset_date' : 'system_now',
    anchor_date: anchorDate.toISOString(),
  };
}

function hasRowsInPeriod(tenantId, dataset, period) {
  if (dataset === 'expenses') {
    const row = get(
      `
        SELECT COUNT(*) AS value
        FROM expenses
        WHERE tenant_id = :tenant_id
          AND expense_date BETWEEN :start_date AND :end_date
      `,
      {
        tenant_id: tenantId,
        start_date: period.start,
        end_date: period.end,
      },
    );
    return Number(row?.value || 0) > 0;
  }

  const row = get(
    `
      SELECT COUNT(*) AS value
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND transaction_date BETWEEN :start_date AND :end_date
    `,
    {
      tenant_id: tenantId,
      start_date: period.start,
      end_date: period.end,
    },
  );
  return Number(row?.value || 0) > 0;
}

function resultLooksEmpty(result, tenantId, dataset) {
  if (result.type === 'list' || result.type === 'trend') {
    return !Array.isArray(result.data) || result.data.length === 0;
  }

  if (result.type === 'metric') {
    return !hasRowsInPeriod(tenantId, dataset, result.period);
  }

  return false;
}

function normalizeMetric(metric) {
  const value = toLowerAlnum(metric || '');
  if (value.includes('untung') || value.includes('profit') || value.includes('laba')) {
    return 'total_profit';
  }
  if (value.includes('margin')) {
    return 'margin_percentage';
  }
  if (value.includes('biaya') || value.includes('expense') || value.includes('pengeluaran')) {
    return 'total_expense';
  }
  if (value.includes('top') || value.includes('terlaris') || value.includes('produk')) {
    return 'top_products';
  }
  if (value.includes('cabang') || value.includes('branch')) {
    return 'branch_performance';
  }
  if (value.includes('trend') || value.includes('grafik')) {
    return 'revenue_trend';
  }
  return 'total_revenue';
}

function inferTemplate(intent) {
  if (intent.template_id && getTemplate(intent.template_id)) {
    return intent.template_id;
  }

  switch (intent.intent) {
    case 'rank':
      return intent.dimension === 'branch' ? 'branch_performance' : 'top_products';
    case 'compare':
      return normalizeMetric(intent.metric);
    case 'show_metric':
    case 'explain':
    default:
      return normalizeMetric(intent.metric);
  }
}

function executeQuery(templateId, { tenantId, period, branch, channel, limit }) {
  const query = buildTemplateQuery(templateId, {
    tenantId,
    startDate: period.start,
    endDate: period.end,
    branchName: branch,
    channel,
    limit,
  });

  if (query.template.type === 'metric') {
    const row = get(query.sql, query.params) || { value: 0 };
    return {
      type: query.template.type,
      templateId,
      title: query.template.title,
      data: row,
      period,
      sql: query.sql,
      params: query.params,
    };
  }

  const rows = all(query.sql, query.params);
  return {
    type: query.template.type,
    templateId,
    title: query.template.title,
    data: rows,
    period,
    sql: query.sql,
    params: query.params,
  };
}

function formatMetricValue(templateId, value) {
  if (templateId === 'margin_percentage') {
    return `${Number(value || 0).toFixed(2)}%`;
  }
  return toRupiah(value || 0);
}

function widgetToArtifact(widget) {
  if (!widget) {
    return null;
  }

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
}

function buildWidgets(result, comparison = null) {
  if (result.type === 'metric') {
    return [
      {
        type: 'MetricCard',
        title: result.title,
        value: Number(result.data.value || 0),
        displayValue: formatMetricValue(result.templateId, result.data.value),
        comparison,
      },
    ];
  }

  if (result.type === 'trend') {
    return [
      {
        type: 'TrendChart',
        title: result.title,
        points: result.data.map((row) => ({
          label: row.period,
          value: Number(row.value || 0),
        })),
      },
    ];
  }

  if (result.type === 'list') {
    const items = result.data.map((row) => ({ ...row }));
    return [
      {
        type: 'TopList',
        title: result.title,
        items,
      },
    ];
  }

  return [];
}

function describeResult(intent, result, comparison) {
  if (result.type === 'metric') {
    const value = formatMetricValue(result.templateId, result.data.value);
    if (comparison) {
      const delta = comparison.delta;
      const sign = delta >= 0 ? 'naik' : 'turun';
      const pct = Number.isFinite(comparison.deltaPct) ? `${Math.abs(comparison.deltaPct).toFixed(1)}%` : '0%';
      return `${result.title} ${result.period.label}: ${value}, ${sign} ${pct} dibanding periode sebelumnya.`;
    }
    return `${result.title} ${result.period.label}: ${value}.`;
  }

  if (result.type === 'trend') {
    const latest = result.data.at(-1);
    if (!latest) {
      return `Belum ada data untuk ${result.period.label}.`;
    }
    return `${result.title} ${result.period.label} siap. Nilai terakhir ${toRupiah(latest.value)}.`;
  }

  if (result.type === 'list') {
    if (!result.data.length) {
      return `Tidak ada data ${result.title.toLowerCase()} pada ${result.period.label}.`;
    }
    const top = result.data[0];
    const topName = top.name || top.product || 'Item';
    const topValue = top.total_revenue || top.revenue || top.value || 0;
    return `${result.title} ${result.period.label}: ${topName} paling tinggi dengan ${toRupiah(topValue)}.`;
  }

  return 'Analisis selesai.';
}

function calculateComparison(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  const delta = current - previous;
  const deltaPct = previous === 0 ? (current === 0 ? 0 : 100) : (delta / previous) * 100;
  return {
    current,
    previous,
    delta,
    deltaPct,
  };
}

export function executeAnalyticsIntent({ tenantId, userId, intent }) {
  const templateId = inferTemplate(intent);
  const dataset = datasetForTemplate(templateId);
  let period = resolveAgenticPeriod(tenantId, intent.time_period || intent.period || '7 hari terakhir', dataset);

  let primary = executeQuery(templateId, {
    tenantId,
    period,
    branch: intent.branch,
    channel: intent.channel,
    limit: intent.limit,
  });

  let periodAdjusted = false;
  if (resultLooksEmpty(primary, tenantId, dataset)) {
    const coverage = coveragePeriodForDataset(tenantId, dataset);
    if (coverage && (coverage.start !== period.start || coverage.end !== period.end)) {
      period = coverage;
      primary = executeQuery(templateId, {
        tenantId,
        period,
        branch: intent.branch,
        channel: intent.channel,
        limit: intent.limit,
      });
      periodAdjusted = true;
    }
  }

  let comparison = null;
  if (intent.intent === 'compare' && primary.type === 'metric') {
    const prev = executeQuery(templateId, {
      tenantId,
      period: previousPeriod(period),
      branch: intent.branch,
      channel: intent.channel,
      limit: intent.limit,
    });

    comparison = calculateComparison(primary.data.value, prev.data.value);
  }

  const answer = describeResult(intent, primary, comparison);
  const widgets = buildWidgets(primary, comparison);
  const artifacts = widgets.map(widgetToArtifact).filter(Boolean);

  logAudit({
    tenantId,
    userId,
    action: 'query_execute',
    resourceType: 'template_query',
    resourceId: templateId,
    metadata: {
      template_id: templateId,
      period,
      rows: primary.type === 'metric' ? 1 : primary.data.length,
    },
  });

  return {
    answer,
    widgets,
    artifacts,
    period,
    template_id: templateId,
    comparison,
    agent_context: {
      period_adjusted: periodAdjusted,
      period_source: period.source || 'unknown',
      period_anchored: Boolean(period.anchored),
      anchor_date: period.anchor_date || null,
    },
  };
}

function normalizeLimit(limit, fallback = 20, max = 200) {
  const parsed = Number.parseInt(String(limit ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function buildBuilderParts(query) {
  const dataset = query.dataset === 'expenses' ? 'expenses' : 'transactions';
  const groupBy = String(query.group_by || 'none').toLowerCase();
  const measure = String(query.measure || (dataset === 'expenses' ? 'amount' : 'revenue')).toLowerCase();
  const visualization = String(query.visualization || (groupBy === 'none' ? 'metric' : 'line')).toLowerCase();

  if (dataset === 'expenses') {
    const dimensions = {
      none: null,
      day: `DATE(e.expense_date)`,
      category: `COALESCE(e.category, 'Tidak diketahui')`,
      branch: `COALESCE(b.name, 'Tanpa Cabang')`,
      recurring: `CASE WHEN e.recurring = 1 THEN 'Recurring' ELSE 'Sekali' END`,
    };

    const measures = {
      amount: `ROUND(COALESCE(SUM(e.amount), 0), 2)`,
      count: `COUNT(*)`,
      avg: `ROUND(COALESCE(AVG(e.amount), 0), 2)`,
    };

    return {
      dataset,
      groupBy,
      measure,
      visualization,
      dimensionExpr: dimensions[groupBy] ?? dimensions.none,
      measureExpr: measures[measure] ?? measures.amount,
      fromClause: `FROM expenses e LEFT JOIN branches b ON b.id = e.branch_id`,
      dateField: 'e.expense_date',
      valueLabel: measure,
    };
  }

  const dimensions = {
    none: null,
    day: `DATE(t.transaction_date)`,
    product: `COALESCE(p.name, 'Tanpa Produk')`,
    branch: `COALESCE(b.name, 'Tanpa Cabang')`,
    channel: `COALESCE(t.channel, 'Tidak diketahui')`,
    payment_method: `COALESCE(t.payment_method, 'Tidak diketahui')`,
    category: `COALESCE(p.category, 'Tidak diketahui')`,
  };

  const measures = {
    revenue: `ROUND(COALESCE(SUM(t.total_revenue), 0), 2)`,
    profit: `ROUND(COALESCE(SUM(t.total_revenue - COALESCE(t.cogs, 0) - COALESCE(t.discount, 0)), 0), 2)`,
    quantity: `ROUND(COALESCE(SUM(t.quantity), 0), 2)`,
    margin: `CASE WHEN COALESCE(SUM(t.total_revenue),0)=0 THEN 0 ELSE ROUND((SUM(t.total_revenue - COALESCE(t.cogs, 0) - COALESCE(t.discount, 0)) / SUM(t.total_revenue)) * 100, 2) END`,
    cogs: `ROUND(COALESCE(SUM(t.cogs), 0), 2)`,
    count: `COUNT(*)`,
  };

  return {
    dataset,
    groupBy,
    measure,
    visualization,
    dimensionExpr: dimensions[groupBy] ?? dimensions.none,
    measureExpr: measures[measure] ?? measures.revenue,
    fromClause: `FROM transactions t LEFT JOIN products p ON p.id = t.product_id LEFT JOIN branches b ON b.id = t.branch_id`,
    dateField: 't.transaction_date',
    valueLabel: measure,
  };
}

function rowsToArtifact(query, rows, valueField = 'value') {
  const kind = query.visualization === 'table'
    ? 'table'
    : query.visualization === 'metric'
      ? 'metric'
      : 'chart';

  if (kind === 'metric') {
    const value = rows[0]?.[valueField] ?? 0;
    return {
      kind: 'metric',
      title: query.title || 'Metrik',
      value: Number(value).toLocaleString('id-ID'),
      raw_value: Number(value || 0),
    };
  }

  if (kind === 'table') {
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return {
      kind: 'table',
      title: query.title || 'Tabel',
      columns,
      rows,
    };
  }

  const labelKey = query.group_by && query.group_by !== 'none' ? 'label' : 'row';
  const labels = rows.map((row, index) => row[labelKey] ?? `Item ${index + 1}`);
  const values = rows.map((row) => Number(row[valueField] || 0));

  return {
    kind: 'chart',
    title: query.title || 'Grafik',
    chart_type: query.visualization === 'pie' ? 'pie' : query.visualization === 'bar' ? 'bar' : 'line',
    labels,
    series: [
      {
        name: query.measure || 'value',
        values,
      },
    ],
  };
}

export function executeBuilderQuery({ tenantId, userId, query }) {
  const normalized = buildBuilderParts(query);
  let period = resolveAgenticPeriod(tenantId, query.time_period || '30 hari terakhir', normalized.dataset);
  const limit = normalizeLimit(query.limit, normalized.groupBy === 'none' ? 1 : 20, 500);

  const params = {
    tenant_id: tenantId,
    start_date: period.start,
    end_date: period.end,
  };

  const groupExpr = normalized.dimensionExpr;
  const valueExpr = `${normalized.measureExpr} AS value`;

  let sql;
  if (!groupExpr) {
    sql = `
      SELECT ${valueExpr}
      ${normalized.fromClause}
      WHERE ${normalized.dataset === 'expenses' ? 'e.tenant_id' : 't.tenant_id'} = :tenant_id
        AND ${normalized.dateField} BETWEEN :start_date AND :end_date
      LIMIT 1
    `;
  } else {
    sql = `
      SELECT ${groupExpr} AS label, ${valueExpr}
      ${normalized.fromClause}
      WHERE ${normalized.dataset === 'expenses' ? 'e.tenant_id' : 't.tenant_id'} = :tenant_id
        AND ${normalized.dateField} BETWEEN :start_date AND :end_date
      GROUP BY label
      ORDER BY value DESC
      LIMIT :limit
    `;
  }

  if (sql.includes(':limit')) {
    params.limit = limit;
  }

  let rows = all(sql, params);

  let periodAdjusted = false;
  const needsCoverageFallback =
    normalized.groupBy !== 'none'
      ? rows.length === 0
      : !hasRowsInPeriod(tenantId, normalized.dataset, period);

  if (needsCoverageFallback) {
    const coverage = coveragePeriodForDataset(tenantId, normalized.dataset);
    if (coverage && (coverage.start !== period.start || coverage.end !== period.end)) {
      period = coverage;
      params.start_date = period.start;
      params.end_date = period.end;
      rows = all(sql, params);
      periodAdjusted = true;
    }
  }

  const artifact = rowsToArtifact(
    {
      ...query,
      group_by: normalized.groupBy,
      visualization: normalized.visualization,
      title: query.title || `${normalized.measure.toUpperCase()} ${period.label}`,
      measure: normalized.valueLabel,
    },
    rows,
  );

  logAudit({
    tenantId,
    userId,
    action: 'canvas_query_execute',
    resourceType: 'builder_query',
    resourceId: normalized.dataset,
    metadata: {
      dataset: normalized.dataset,
      group_by: normalized.groupBy,
      measure: normalized.measure,
      limit,
      period,
      rows: rows.length,
    },
  });

  return {
    period,
    rows,
    artifact,
    agent_context: {
      period_adjusted: periodAdjusted,
      period_source: period.source || 'unknown',
      period_anchored: Boolean(period.anchored),
      anchor_date: period.anchor_date || null,
    },
    query: {
      dataset: normalized.dataset,
      group_by: normalized.groupBy,
      measure: normalized.measure,
      visualization: normalized.visualization,
      title: query.title || artifact.title,
    },
  };
}

export function getBuilderSchema() {
  return {
    datasets: [
      {
        id: 'transactions',
        label: 'Transaksi',
        measures: ['revenue', 'profit', 'quantity', 'margin', 'cogs', 'count'],
        dimensions: ['none', 'day', 'product', 'branch', 'channel', 'payment_method', 'category'],
      },
      {
        id: 'expenses',
        label: 'Biaya',
        measures: ['amount', 'count', 'avg'],
        dimensions: ['none', 'day', 'category', 'branch', 'recurring'],
      },
    ],
    visualizations: ['metric', 'table', 'line', 'bar', 'pie'],
    default_time_period: '30 hari terakhir',
  };
}
