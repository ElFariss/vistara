import { all, get, run } from '../db.mjs';
import { generateId } from '../utils/ids.mjs';
import { parseTimePeriod } from '../utils/time.mjs';
import { toRupiah } from '../utils/text.mjs';
import { getAnomalies } from './insights.mjs';
import { logAudit } from './audit.mjs';

async function summarizeRevenue(tenantId, start, end) {
  return (
    await get(
      `
        SELECT
          COALESCE(SUM(total_revenue), 0) AS revenue,
          COALESCE(SUM(total_revenue - COALESCE(cogs, 0) - COALESCE(discount,0)), 0) AS profit,
          CASE
            WHEN COALESCE(SUM(total_revenue), 0) = 0 THEN 0
            ELSE (SUM(total_revenue - COALESCE(cogs,0) - COALESCE(discount,0)) / SUM(total_revenue)) * 100
          END AS margin
        FROM transactions
        WHERE tenant_id = :tenant_id
          AND transaction_date BETWEEN :start AND :end
      `,
      { tenant_id: tenantId, start, end },
    ) || { revenue: 0, profit: 0, margin: 0 }
  );
}

async function topProducts(tenantId, start, end, limit = 5) {
  return all(
    `
      SELECT p.name,
             ROUND(CAST(COALESCE(SUM(t.total_revenue), 0) AS numeric), 2) AS revenue,
             ROUND(CAST(COALESCE(SUM(t.quantity), 0) AS numeric), 2) AS qty
      FROM transactions t
      LEFT JOIN products p ON p.id = t.product_id
      WHERE t.tenant_id = :tenant_id
        AND t.transaction_date BETWEEN :start AND :end
      GROUP BY p.name
      HAVING p.name IS NOT NULL
      ORDER BY revenue DESC
      LIMIT :limit
    `,
    { tenant_id: tenantId, start, end, limit },
  );
}

async function branchRanking(tenantId, start, end, limit = 5) {
  return all(
    `
      SELECT b.name,
             ROUND(CAST(COALESCE(SUM(t.total_revenue), 0) AS numeric), 2) AS revenue
      FROM transactions t
      LEFT JOIN branches b ON b.id = t.branch_id
      WHERE t.tenant_id = :tenant_id
        AND t.transaction_date BETWEEN :start AND :end
      GROUP BY b.name
      HAVING b.name IS NOT NULL
      ORDER BY revenue DESC
      LIMIT :limit
    `,
    { tenant_id: tenantId, start, end, limit },
  );
}

function buildMarkdownReport({ title, periodLabel, summary, products, branches, anomalies }) {
  const productLines =
    products.length > 0
      ? products.map((item, index) => `${index + 1}. ${item.name} - ${toRupiah(item.revenue)} (qty ${item.qty})`).join('\n')
      : '- Tidak ada data produk.';

  const branchLines =
    branches.length > 0
      ? branches.map((item, index) => `${index + 1}. ${item.name} - ${toRupiah(item.revenue)}`).join('\n')
      : '- Tidak ada data cabang.';

  const anomalyLines =
    anomalies.length > 0 ? anomalies.slice(0, 5).map((item) => `- ${item.message}`).join('\n') : '- Tidak ada anomali utama.';

  return [
    `# ${title}`,
    '',
    `Periode: **${periodLabel}**`,
    '',
    '## Ringkasan',
    `- Omzet: **${toRupiah(summary.revenue)}**`,
    `- Untung: **${toRupiah(summary.profit)}**`,
    `- Margin: **${Number(summary.margin || 0).toFixed(2)}%**`,
    '',
    '## Top Produk',
    productLines,
    '',
    '## Performa Cabang',
    branchLines,
    '',
    '## Anomali',
    anomalyLines,
  ].join('\n');
}

export async function generateReport({ tenantId, userId, title, period }) {
  const parsedPeriod = parseTimePeriod(period || 'minggu ini');
  const summary = await summarizeRevenue(tenantId, parsedPeriod.start, parsedPeriod.end);
  const products = await topProducts(tenantId, parsedPeriod.start, parsedPeriod.end);
  const branches = await branchRanking(tenantId, parsedPeriod.start, parsedPeriod.end);
  const anomalies = await getAnomalies(tenantId, null);

  const reportTitle = title || `Laporan ${parsedPeriod.label}`;
  const markdown = buildMarkdownReport({
    title: reportTitle,
    periodLabel: parsedPeriod.label,
    summary,
    products,
    branches,
    anomalies,
  });

  const id = generateId();
  await run(
    `
      INSERT INTO reports (
        id, tenant_id, user_id, title, period_start, period_end,
        format, content, status, created_at
      ) VALUES (
        :id, :tenant_id, :user_id, :title, :period_start, :period_end,
        :format, :content, :status, :created_at
      )
    `,
    {
      id,
      tenant_id: tenantId,
      user_id: userId,
      title: reportTitle,
      period_start: parsedPeriod.start,
      period_end: parsedPeriod.end,
      format: 'markdown',
      content: markdown,
      status: 'ready',
      created_at: new Date().toISOString(),
    },
  );

  logAudit({
    tenantId,
    userId,
    action: 'report_generate',
    resourceType: 'report',
    resourceId: id,
    metadata: { period: parsedPeriod },
  });

  return {
    id,
    title: reportTitle,
    period: parsedPeriod,
    content: markdown,
    format: 'markdown',
  };
}

export async function listReports(tenantId, userId) {
  return all(
    `
      SELECT id, title, period_start, period_end, format, status, created_at
      FROM reports
      WHERE tenant_id = :tenant_id AND user_id = :user_id
      ORDER BY created_at DESC
    `,
    { tenant_id: tenantId, user_id: userId },
  );
}

export async function getReport(tenantId, userId, reportId) {
  return get(
    `
      SELECT id, title, period_start, period_end, format, status, content, created_at
      FROM reports
      WHERE tenant_id = :tenant_id AND user_id = :user_id AND id = :id
    `,
    {
      tenant_id: tenantId,
      user_id: userId,
      id: reportId,
    },
  );
}
