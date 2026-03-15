import { all, get } from '../db.mjs';
import { buildTemplateQuery, getTemplate } from './queryTemplates.mjs';
import { parseTimePeriod, previousPeriod } from '../utils/time.mjs';
import { toLowerAlnum, toRupiah } from '../utils/text.mjs';
import { logAudit } from './audit.mjs';
import { parseIndonesianNumber, parseFlexibleDate } from '../utils/parse.mjs';
import { listDatasetTables, getDatasetTable } from './datasetTables.mjs';
import { ensureSourcesProcessed } from './ingestion.mjs';
import { CHART_CATALOG, VISUALIZATION_IDS, SINGLE_VALUE_VISUALS, isMetricVisualization, isTableVisualization } from './chartCatalog.mjs';

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

function normalizeVisualization(value, fallback = 'line') {
  const normalized = String(value || '').toLowerCase().trim();
  return VISUALIZATION_IDS.includes(normalized) ? normalized : fallback;
}

function datasetTableSpec(table = {}) {
  const profile = table.profile || {};
  const detected = profile.detected || {};
  const numeric = Array.isArray(detected.numeric_columns) ? detected.numeric_columns : [];
  const dates = Array.isArray(detected.date_columns) ? detected.date_columns : [];
  const categorical = Array.isArray(detected.categorical_columns) ? detected.categorical_columns : [];
  const dimensions = ['none', ...dates, ...categorical];
  const measures = numeric.length ? [...numeric] : [];
  if (!measures.includes('count')) {
    measures.push('count');
  }
  return {
    id: table.id,
    label: table.name || table.id,
    measures,
    dimensions,
    date_columns: dates,
    default_measure: numeric[0] || 'count',
    default_dimension: dates[0] || categorical[0] || 'none',
  };
}

function resolveTablePeriod(rows = [], dateColumn, rawPeriodInput) {
  if (!dateColumn) {
    return {
      label: 'Semua data',
      start: null,
      end: null,
      anchored: false,
      source: 'no_date_column',
    };
  }
  const dates = rows
    .map((row) => parseFlexibleDate(row?.[dateColumn]))
    .filter((value) => value && !Number.isNaN(value.getTime()));
  if (dates.length === 0) {
    return {
      label: 'Semua data',
      start: null,
      end: null,
      anchored: false,
      source: 'no_date_values',
    };
  }
  const latest = new Date(Math.max(...dates.map((value) => value.getTime())));
  const input = rawPeriodInput || '30 hari terakhir';
  if (!isRelativePeriodInput(input)) {
    return {
      ...parseTimePeriod(input),
      anchored: false,
      source: 'user_input',
    };
  }
  return {
    ...parseTimePeriod(input, latest),
    anchored: true,
    source: 'latest_dataset_date',
    anchor_date: latest.toISOString(),
  };
}

async function latestDataDate(tenantId, dataset = 'transactions') {
  if (dataset === 'expenses') {
    const row = await get(
      `
        SELECT MAX(expense_date) AS latest
        FROM expenses
        WHERE tenant_id = :tenant_id
      `,
      { tenant_id: tenantId },
    );
    return toDateOrNull(row?.latest);
  }

  const tx = await get(
    `
      SELECT MAX(transaction_date) AS latest
      FROM transactions
      WHERE tenant_id = :tenant_id
    `,
    { tenant_id: tenantId },
  );

  const expense = await get(
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

async function coveragePeriodForDataset(tenantId, dataset = 'transactions') {
  if (dataset === 'expenses') {
    const row = await get(
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

  const row = await get(
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

async function resolveAgenticPeriod(tenantId, rawPeriodInput, dataset = 'transactions') {
  const input = rawPeriodInput || (dataset === 'expenses' ? '30 hari terakhir' : '7 hari terakhir');
  const useRelativeAnchor = isRelativePeriodInput(input);

  if (!useRelativeAnchor) {
    return {
      ...parseTimePeriod(input),
      anchored: false,
      source: 'user_input',
    };
  }

  const latest = await latestDataDate(tenantId, dataset);
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

async function hasRowsInPeriod(tenantId, dataset, period) {
  if (dataset === 'expenses') {
    const row = await get(
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

  const row = await get(
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

async function resultLooksEmpty(result, tenantId, dataset) {
  if (result.type === 'list' || result.type === 'trend') {
    return !Array.isArray(result.data) || result.data.length === 0;
  }

  if (result.type === 'metric') {
    return !(await hasRowsInPeriod(tenantId, dataset, result.period));
  }

  return false;
}


async function executeQuery(templateId, { tenantId, period, branch, channel, limit }) {
  const query = buildTemplateQuery(templateId, {
    tenantId,
    startDate: period.start,
    endDate: period.end,
    branchName: branch,
    channel,
    limit,
  });

  if (query.template.type === 'metric') {
    const row = (await get(query.sql, query.params)) || { value: 0 };
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

  const rows = await all(query.sql, query.params);
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

export async function executeAnalyticsIntent({ tenantId, userId, intent }) {
  await ensureSourcesProcessed({ tenantId, userId });
  const templateId = intent.template_id;
  if (!templateId) {
    throw new Error('template_id is required for analytics execution');
  }
  const dataset = datasetForTemplate(templateId);
  let period = await resolveAgenticPeriod(tenantId, intent.time_period || intent.period || '30 hari terakhir', dataset);

  let primary = await executeQuery(templateId, {
    tenantId,
    period,
    branch: intent.branch,
    channel: intent.channel,
    limit: intent.limit,
  });

  let periodAdjusted = false;
  if (await resultLooksEmpty(primary, tenantId, dataset)) {
    const coverage = await coveragePeriodForDataset(tenantId, dataset);
    if (coverage && (coverage.start !== period.start || coverage.end !== period.end)) {
      period = coverage;
      primary = await executeQuery(templateId, {
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
    const prev = await executeQuery(templateId, {
      tenantId,
      period: previousPeriod(period),
      branch: intent.branch,
      channel: intent.channel,
      limit: intent.limit,
    });

    comparison = calculateComparison(primary.data.value, prev.data.value);
  }

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
    raw_data: primary.data,
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
  const visualization = normalizeVisualization(query.visualization, groupBy === 'none' ? 'metric' : 'line');

  if (dataset === 'expenses') {
    const dimensions = {
      none: null,
      day: `DATE(e.expense_date)`,
      category: `COALESCE(e.category, 'Tidak diketahui')`,
      branch: `COALESCE(b.name, 'Tanpa Cabang')`,
      recurring: `CASE WHEN e.recurring = 1 THEN 'Recurring' ELSE 'Sekali' END`,
    };

    const measures = {
      amount: `ROUND(CAST(COALESCE(SUM(e.amount), 0) AS numeric), 2)`,
      count: `COUNT(*)`,
      avg: `ROUND(CAST(COALESCE(AVG(e.amount), 0) AS numeric), 2)`,
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
    revenue: `ROUND(CAST(COALESCE(SUM(t.total_revenue), 0) AS numeric), 2)`,
    profit: `ROUND(CAST(COALESCE(SUM(t.total_revenue - COALESCE(t.cogs, 0) - COALESCE(t.discount, 0)), 0) AS numeric), 2)`,
    quantity: `ROUND(CAST(COALESCE(SUM(t.quantity), 0) AS numeric), 2)`,
    margin: `CASE WHEN COALESCE(SUM(t.total_revenue),0)=0 THEN 0 ELSE ROUND(CAST(((SUM(t.total_revenue - COALESCE(t.cogs, 0) - COALESCE(t.discount, 0)) / SUM(t.total_revenue)) * 100) AS numeric), 2) END`,
    cogs: `ROUND(CAST(COALESCE(SUM(t.cogs), 0) AS numeric), 2)`,
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
  const visualization = normalizeVisualization(query.visualization, query.group_by === 'none' ? 'metric' : 'bar');
  const kind = isTableVisualization(visualization)
    ? 'table'
    : isMetricVisualization(visualization)
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
    chart_type: visualization,
    labels,
    series: [
      {
        name: query.measure || 'value',
        values,
      },
    ],
  };
}

function normalizeColumnValue(columns = [], value) {
  const normalized = String(value || '').toLowerCase().trim();
  if (!normalized) {
    return null;
  }
  return columns.find((column) => String(column || '').toLowerCase() === normalized) || null;
}

function executeTableQuery({ tenantId, userId, query, table }) {
  const spec = datasetTableSpec(table);
  const availableMeasures = spec.measures;
  const availableDimensions = spec.dimensions;

  let measure = normalizeColumnValue(availableMeasures, query.measure) || spec.default_measure;
  if (!measure) {
    measure = 'count';
  }

  let visualization = normalizeVisualization(query.visualization, query.group_by === 'none' ? 'metric' : 'bar');
  let groupBy = normalizeColumnValue(availableDimensions, query.group_by) || spec.default_dimension;
  if (!groupBy) {
    groupBy = 'none';
  }

  if (SINGLE_VALUE_VISUALS.has(visualization) || isMetricVisualization(visualization)) {
    groupBy = 'none';
  } else if (groupBy === 'none' && !isTableVisualization(visualization)) {
    groupBy = spec.default_dimension || 'none';
  }

  const dateColumn = spec.date_columns.includes(groupBy)
    ? groupBy
    : spec.date_columns[0] || null;
  const period = resolveTablePeriod(table.rows || [], dateColumn, query.time_period || '30 hari terakhir');

  let filteredRows = Array.isArray(table.rows) ? table.rows : [];
  if (period.start && period.end && dateColumn) {
    const start = new Date(period.start).getTime();
    const end = new Date(period.end).getTime();
    filteredRows = filteredRows.filter((row) => {
      const parsed = parseFlexibleDate(row?.[dateColumn]);
      if (!parsed || Number.isNaN(parsed.getTime())) return false;
      const ts = parsed.getTime();
      return ts >= start && ts <= end;
    });
  }

  const limit = Number.parseInt(String(query.limit || 20), 10) || 20;

  if (isTableVisualization(visualization) && groupBy === 'none') {
    const availableColumns = Array.isArray(table.columns) ? table.columns : [];
    const requestedColumns = Array.isArray(query.columns)
      ? query.columns.filter((column) => availableColumns.includes(column))
      : [];
    const columns = requestedColumns.length > 0 ? requestedColumns : availableColumns;
    const rows = filteredRows
      .slice(0, Math.min(limit, 200))
      .map((row) => {
        if (!columns.length) {
          return row;
        }
        return columns.reduce((acc, column) => {
          acc[column] = row?.[column];
          return acc;
        }, {});
      });
    const artifact = {
      kind: 'table',
      title: query.title || table.name || 'Tabel',
      columns,
      rows,
    };
    return {
      period,
      rows,
      artifact,
      agent_context: {
        period_adjusted: false,
        period_source: period.source || 'unknown',
        period_anchored: Boolean(period.anchored),
        anchor_date: period.anchor_date || null,
      },
      query: {
        dataset: query.dataset,
        group_by: groupBy,
        measure,
        visualization,
        title: query.title || artifact.title,
        columns,
      },
    };
  }

  if (groupBy === 'none') {
    const numericValues = filteredRows.map((row) => parseIndonesianNumber(row?.[measure]) ?? 0);
    const value = measure === 'count'
      ? filteredRows.length
      : numericValues.reduce((sum, val) => sum + (Number.isFinite(val) ? val : 0), 0);
    const rows = [{ value }];
    const artifact = rowsToArtifact(
      {
        ...query,
        group_by: groupBy,
        visualization,
        title: query.title || table.name || 'Metrik',
        measure,
      },
      rows,
    );
    return {
      period,
      rows,
      artifact,
      agent_context: {
        period_adjusted: false,
        period_source: period.source || 'unknown',
        period_anchored: Boolean(period.anchored),
        anchor_date: period.anchor_date || null,
      },
      query: {
        dataset: query.dataset,
        group_by: groupBy,
        measure,
        visualization,
        title: query.title || artifact.title,
      },
    };
  }

  const grouped = new Map();
  filteredRows.forEach((row) => {
    const label = row?.[groupBy] ?? 'Tidak diketahui';
    const key = String(label);
    const current = grouped.get(key) || 0;
    const value = measure === 'count'
      ? 1
      : parseIndonesianNumber(row?.[measure]) ?? 0;
    grouped.set(key, current + (Number.isFinite(value) ? value : 0));
  });

  const rows = Array.from(grouped.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.min(limit, 500));

  const artifact = rowsToArtifact(
    {
      ...query,
      group_by: groupBy,
      visualization,
      title: query.title || table.name || 'Grafik',
      measure,
    },
    rows,
  );

  logAudit({
    tenantId,
    userId,
    action: 'canvas_query_execute',
    resourceType: 'builder_query',
    resourceId: query.dataset,
    metadata: {
      dataset: query.dataset,
      group_by: groupBy,
      measure,
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
      period_adjusted: false,
      period_source: period.source || 'unknown',
      period_anchored: Boolean(period.anchored),
      anchor_date: period.anchor_date || null,
    },
    query: {
      dataset: query.dataset,
      group_by: groupBy,
      measure,
      visualization,
      title: query.title || artifact.title,
    },
  };
}

export async function executeBuilderQuery({ tenantId, userId, query }) {
  await ensureSourcesProcessed({ tenantId, userId });
  const table = query?.dataset ? await getDatasetTable(tenantId, query.dataset) : null;
  if (table) {
    return executeTableQuery({ tenantId, userId, query, table });
  }

  const normalized = buildBuilderParts(query);
  let period = await resolveAgenticPeriod(tenantId, query.time_period || '30 hari terakhir', normalized.dataset);
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

  let rows = await all(sql, params);

  let periodAdjusted = false;
  const needsCoverageFallback =
    normalized.groupBy !== 'none'
      ? rows.length === 0
      : !(await hasRowsInPeriod(tenantId, normalized.dataset, period));

  if (needsCoverageFallback) {
    const coverage = await coveragePeriodForDataset(tenantId, normalized.dataset);
    if (coverage && (coverage.start !== period.start || coverage.end !== period.end)) {
      period = coverage;
      params.start_date = period.start;
      params.end_date = period.end;
      rows = await all(sql, params);
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

const DEFAULT_BUILDER_SCHEMA = {
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
  visualizations: CHART_CATALOG,
  default_time_period: '30 hari terakhir',
};

export function getDefaultBuilderSchema() {
  return DEFAULT_BUILDER_SCHEMA;
}

export async function getBuilderSchema(tenantId = null) {
  const tables = tenantId ? await listDatasetTables(tenantId) : [];
  if (tables.length > 0) {
    const datasets = tables.map((table) => {
      const spec = datasetTableSpec(table);
      const profileColumns = Array.isArray(table.profile?.columns)
        ? table.profile.columns.map((column) => ({
          name: column.name,
          kind: column.kind,
          sample_values: column.sample_values || [],
        }))
        : [];
      return {
        id: table.id,
        label: table.name || table.id,
        measures: spec.measures,
        dimensions: spec.dimensions,
        columns: profileColumns,
        row_count: table.row_count,
        description: `${table.row_count} baris • ${profileColumns.length} kolom`,
      };
    });
    return {
      datasets,
      visualizations: CHART_CATALOG,
      default_time_period: '30 hari terakhir',
    };
  }

  return DEFAULT_BUILDER_SCHEMA;
}
