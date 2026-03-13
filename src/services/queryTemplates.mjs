const TEMPLATE_DEFINITIONS = {
  total_revenue: {
    type: 'metric',
    title: 'Omzet',
    sql: `
      SELECT COALESCE(SUM(total_revenue), 0) AS value
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND transaction_date BETWEEN :start_date AND :end_date
        {branch_filter}
        {channel_filter}
    `,
  },
  total_profit: {
    type: 'metric',
    title: 'Untung',
    sql: `
      SELECT COALESCE(SUM(total_revenue - COALESCE(cogs, 0) - COALESCE(discount, 0)), 0) AS value
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND transaction_date BETWEEN :start_date AND :end_date
        {branch_filter}
        {channel_filter}
    `,
  },
  margin_percentage: {
    type: 'metric',
    title: 'Margin',
    sql: `
      SELECT
        CASE
          WHEN COALESCE(SUM(total_revenue), 0) = 0 THEN 0
          ELSE ROUND((SUM(total_revenue - COALESCE(cogs, 0) - COALESCE(discount, 0)) / SUM(total_revenue)) * 100, 2)
        END AS value
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND transaction_date BETWEEN :start_date AND :end_date
        {branch_filter}
        {channel_filter}
    `,
  },
  revenue_trend: {
    type: 'trend',
    title: 'Trend Omzet',
    sql: `
      SELECT DATE(transaction_date) AS period, COALESCE(SUM(total_revenue), 0) AS value
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND transaction_date BETWEEN :start_date AND :end_date
        {branch_filter}
        {channel_filter}
      GROUP BY DATE(transaction_date)
      ORDER BY DATE(transaction_date)
    `,
  },
  top_products: {
    type: 'list',
    title: 'Produk Terlaris',
    sql: `
      SELECT p.name,
             ROUND(COALESCE(SUM(t.quantity), 0), 2) AS total_qty,
             ROUND(COALESCE(SUM(t.total_revenue), 0), 2) AS total_revenue
      FROM transactions t
      JOIN products p ON p.id = t.product_id
      WHERE t.tenant_id = :tenant_id
        AND t.transaction_date BETWEEN :start_date AND :end_date
        {branch_filter}
        {channel_filter}
      GROUP BY p.name
      ORDER BY total_revenue DESC
      LIMIT :limit
    `,
  },
  branch_performance: {
    type: 'list',
    title: 'Performa Cabang',
    sql: `
      SELECT b.name,
             ROUND(COALESCE(SUM(t.total_revenue), 0), 2) AS revenue,
             ROUND(COALESCE(SUM(t.total_revenue - COALESCE(t.cogs, 0) - COALESCE(t.discount, 0)), 0), 2) AS profit
      FROM transactions t
      JOIN branches b ON b.id = t.branch_id
      WHERE t.tenant_id = :tenant_id
        AND t.transaction_date BETWEEN :start_date AND :end_date
        {channel_filter}
      GROUP BY b.name
      ORDER BY revenue DESC
      LIMIT :limit
    `,
  },
  total_expense: {
    type: 'metric',
    title: 'Total Biaya',
    sql: `
      SELECT COALESCE(SUM(amount), 0) AS value
      FROM expenses
      WHERE tenant_id = :tenant_id
        AND expense_date BETWEEN :start_date AND :end_date
        {branch_filter}
    `,
  },
};

function buildOptionalFilters({ branchName, channel }) {
  const params = {};
  let branchFilter = '';
  let channelFilter = '';

  if (branchName) {
    branchFilter = 'AND LOWER(COALESCE((SELECT name FROM branches WHERE id = branch_id), "")) = LOWER(:branch_name)';
    params.branch_name = branchName;
  }

  if (channel) {
    channelFilter = 'AND LOWER(COALESCE(channel, "")) = LOWER(:channel)';
    params.channel = channel;
  }

  return { branchFilter, channelFilter, params };
}

function sanitizeLimit(limit) {
  const parsed = Number.parseInt(String(limit ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5;
  }
  return Math.min(parsed, 50);
}

export function listTemplateIds() {
  return Object.keys(TEMPLATE_DEFINITIONS);
}

export function getTemplate(templateId) {
  return TEMPLATE_DEFINITIONS[templateId] ?? null;
}

export function buildTemplateQuery(templateId, input) {
  const definition = getTemplate(templateId);
  if (!definition) {
    throw new Error('Template query tidak dikenal.');
  }

  const optional = buildOptionalFilters(input);
  const sql = definition.sql
    .replace('{branch_filter}', optional.branchFilter)
    .replace('{channel_filter}', optional.channelFilter);

  const params = {
    tenant_id: input.tenantId,
    start_date: input.startDate,
    end_date: input.endDate,
    ...optional.params,
  };

  if (sql.includes(':limit')) {
    params.limit = sanitizeLimit(input.limit);
  }

  return {
    template: definition,
    sql,
    params,
  };
}
