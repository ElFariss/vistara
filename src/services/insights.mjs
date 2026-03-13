import { all, get } from '../db.mjs';
import { lastNDays } from '../utils/time.mjs';
import { toRupiah } from '../utils/text.mjs';
import { logAudit } from './audit.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function stdDev(values) {
  if (values.length < 2) {
    return 0;
  }
  const avg = mean(values);
  const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

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

function addDays(date, days) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function startOfUtcDay(date) {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

function endOfUtcDay(date) {
  const value = new Date(date);
  value.setUTCHours(23, 59, 59, 999);
  return value;
}

async function latestTransactionDate(tenantId) {
  const row = await get(
    `
      SELECT MAX(transaction_date) AS latest
      FROM transactions
      WHERE tenant_id = :tenant_id
    `,
    { tenant_id: tenantId },
  );

  return toDateOrNull(row?.latest);
}

async function transactionCoverage(tenantId) {
  const row = await get(
    `
      SELECT MIN(transaction_date) AS start_date,
             MAX(transaction_date) AS end_date,
             COUNT(*) AS count_rows
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
    row_count: Number(row.count_rows || 0),
  };
}

async function resolveInsightAnchor(tenantId) {
  const latest = await latestTransactionDate(tenantId);
  const now = new Date();
  const staleByDays = latest ? Math.floor((now.getTime() - latest.getTime()) / DAY_MS) : 0;
  const anchorDate = latest && staleByDays > 2 ? latest : now;
  const anchored = Boolean(latest) && staleByDays > 2;

  return {
    anchorDate,
    anchorDateIso: anchorDate.toISOString(),
    anchorDay: anchorDate.toISOString().slice(0, 10),
    anchored,
    source: anchored ? 'latest_dataset_date' : 'system_now',
    coverage: await transactionCoverage(tenantId),
  };
}

async function queryDailyRevenue(tenantId, days = 30) {
  const anchor = await resolveInsightAnchor(tenantId);
  const period = {
    ...lastNDays(days, anchor.anchorDate),
    anchor_date: anchor.anchorDateIso,
    anchored: anchor.anchored,
    source: anchor.source,
    coverage: anchor.coverage,
  };

  const points = await all(
    `
      SELECT DATE(transaction_date) AS day,
             ROUND(COALESCE(SUM(total_revenue), 0), 2) AS revenue,
             ROUND(COALESCE(SUM(total_revenue - COALESCE(cogs,0) - COALESCE(discount,0)), 0), 2) AS profit
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND transaction_date BETWEEN :start_date AND :end_date
      GROUP BY DATE(transaction_date)
      ORDER BY DATE(transaction_date)
    `,
    {
      tenant_id: tenantId,
      start_date: period.start,
      end_date: period.end,
    },
  );

  return {
    points,
    period,
  };
}

function detectRevenueAnomalies(series) {
  if (series.length < 7) {
    return [];
  }

  const values = series.map((item) => Number(item.revenue || 0));
  const avg = mean(values);
  const sigma = stdDev(values);

  if (sigma === 0) {
    return [];
  }

  const anomalies = [];
  for (const point of series) {
    const value = Number(point.revenue || 0);
    const z = (value - avg) / sigma;
    if (Math.abs(z) >= 2) {
      anomalies.push({
        type: value >= avg ? 'revenue_spike' : 'revenue_drop',
        day: point.day,
        value,
        z_score: Number(z.toFixed(2)),
        message:
          value >= avg
            ? `Lonjakan omzet pada ${point.day}: ${toRupiah(value)} (z=${z.toFixed(2)}).`
            : `Penurunan omzet pada ${point.day}: ${toRupiah(value)} (z=${z.toFixed(2)}).`,
      });
    }
  }

  return anomalies;
}

async function detectMarginCompression(tenantId, anchorDate) {
  const currentPeriod = lastNDays(7, anchorDate);
  const baselinePeriod = {
    start: startOfUtcDay(addDays(anchorDate, -36)).toISOString(),
    end: endOfUtcDay(addDays(anchorDate, -7)).toISOString(),
  };

  const current = await get(
    `
      SELECT
        CASE WHEN SUM(total_revenue) = 0 THEN 0
             ELSE (SUM(total_revenue - COALESCE(cogs,0) - COALESCE(discount,0)) / SUM(total_revenue)) * 100
        END AS margin
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND transaction_date BETWEEN :start_date AND :end_date
    `,
    {
      tenant_id: tenantId,
      start_date: currentPeriod.start,
      end_date: currentPeriod.end,
    },
  ) || { margin: 0 };

  const baseline = await get(
    `
      SELECT
        CASE WHEN SUM(total_revenue) = 0 THEN 0
             ELSE (SUM(total_revenue - COALESCE(cogs,0) - COALESCE(discount,0)) / SUM(total_revenue)) * 100
        END AS margin
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND transaction_date BETWEEN :start_date AND :end_date
    `,
    {
      tenant_id: tenantId,
      start_date: baselinePeriod.start,
      end_date: baselinePeriod.end,
    },
  ) || { margin: 0 };

  const currentMargin = Number(current.margin || 0);
  const baselineMargin = Number(baseline.margin || 0);

  if (baselineMargin > 0 && currentMargin < baselineMargin - 5) {
    return {
      type: 'margin_compression',
      current_margin: Number(currentMargin.toFixed(2)),
      baseline_margin: Number(baselineMargin.toFixed(2)),
      message: `Margin turun dari ${baselineMargin.toFixed(1)}% menjadi ${currentMargin.toFixed(1)}% dalam 7 hari terakhir.`,
    };
  }

  return null;
}

export async function getAnomalies(tenantId, userId = null) {
  const revenue = await queryDailyRevenue(tenantId, 30);
  const anomalies = detectRevenueAnomalies(revenue.points);
  const margin = await detectMarginCompression(tenantId, new Date(revenue.period.anchor_date));

  if (margin) {
    anomalies.push(margin);
  }

  if (userId) {
    logAudit({
      tenantId,
      userId,
      action: 'insight_anomalies_view',
      resourceType: 'insight',
      resourceId: 'anomalies',
      metadata: { count: anomalies.length },
    });
  }

  return anomalies;
}

export async function getTrends(tenantId, userId = null) {
  const revenue = await queryDailyRevenue(tenantId, 30);
  const revenueValues = revenue.points.map((x) => Number(x.revenue || 0));
  const profitValues = revenue.points.map((x) => Number(x.profit || 0));

  const payload = {
    period_days: 30,
    period: revenue.period,
    points: revenue.points,
    summary: {
      revenue_avg: Number(mean(revenueValues).toFixed(2)),
      profit_avg: Number(mean(profitValues).toFixed(2)),
      revenue_latest: Number((revenueValues.at(-1) ?? 0).toFixed(2)),
      profit_latest: Number((profitValues.at(-1) ?? 0).toFixed(2)),
    },
  };

  if (userId) {
    logAudit({
      tenantId,
      userId,
      action: 'insight_trends_view',
      resourceType: 'insight',
      resourceId: 'trends',
      metadata: { points: revenue.points.length, period: revenue.period },
    });
  }

  return payload;
}

function pickRecommendation(anomalies, latestRevenue, previousRevenue) {
  if (anomalies.find((item) => item.type === 'margin_compression')) {
    return 'Evaluasi HPP dan diskon produk utama hari ini.';
  }

  if (latestRevenue < previousRevenue * 0.8) {
    return 'Cek operasional cabang yang turun dan pastikan stok produk utama aman.';
  }

  if (latestRevenue > previousRevenue * 1.2) {
    return 'Siapkan kapasitas stok untuk menjaga momentum penjualan.';
  }

  return 'Pertahankan ritme penjualan dan pantau margin harian.';
}

export async function getDailyVerdict(tenantId, userId = null) {
  const anchor = await resolveInsightAnchor(tenantId);
  const previousAnchor = addDays(anchor.anchorDate, -1);

  const today = await get(
    `
      SELECT COALESCE(SUM(total_revenue), 0) AS revenue,
             COALESCE(SUM(total_revenue - COALESCE(cogs, 0) - COALESCE(discount, 0)), 0) AS profit
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND DATE(transaction_date) = DATE(:anchor_date)
    `,
    { tenant_id: tenantId, anchor_date: anchor.anchorDateIso },
  ) || { revenue: 0, profit: 0 };

  const yesterday = await get(
    `
      SELECT COALESCE(SUM(total_revenue), 0) AS revenue,
             COALESCE(SUM(total_revenue - COALESCE(cogs, 0) - COALESCE(discount, 0)), 0) AS profit
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND DATE(transaction_date) = DATE(:anchor_date)
    `,
    { tenant_id: tenantId, anchor_date: previousAnchor.toISOString() },
  ) || { revenue: 0, profit: 0 };

  const anomalies = await getAnomalies(tenantId, null);

  const todayRevenue = Number(today.revenue || 0);
  const yesterdayRevenue = Number(yesterday.revenue || 0);

  let status = 'SEHAT';
  if (anomalies.length > 0 || todayRevenue < yesterdayRevenue * 0.8) {
    status = 'WASPADA';
  }
  if (todayRevenue < yesterdayRevenue * 0.6 || anomalies.some((item) => item.type === 'margin_compression')) {
    status = 'KRITIS';
  }

  const deltaPct =
    yesterdayRevenue === 0
      ? todayRevenue === 0
        ? 0
        : 100
      : ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100;
  const dayLabel = anchor.anchored ? `pada ${anchor.anchorDay}` : 'hari ini';

  const sentence =
    status === 'SEHAT'
      ? `Bisnis stabil. Omzet ${dayLabel} ${toRupiah(todayRevenue)} (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% vs hari sebelumnya).`
      : status === 'WASPADA'
        ? `Perhatian: Omzet ${dayLabel} ${toRupiah(todayRevenue)} (${deltaPct.toFixed(1)}% vs hari sebelumnya). Ada ${anomalies.length} sinyal anomali.`
        : `Peringatan: Kondisi kritis. Omzet ${dayLabel} ${toRupiah(todayRevenue)} (${deltaPct.toFixed(1)}% vs hari sebelumnya) dan margin tertekan.`;

  const verdict = {
    status,
    sentence,
    period: {
      reference_date: anchor.anchorDay,
      anchored: anchor.anchored,
      source: anchor.source,
      coverage: anchor.coverage,
    },
    metrics: {
      revenue_today: todayRevenue,
      revenue_yesterday: yesterdayRevenue,
      profit_today: Number(today.profit || 0),
      profit_yesterday: Number(yesterday.profit || 0),
      delta_pct: Number(deltaPct.toFixed(2)),
      reference_date: anchor.anchorDay,
    },
    anomalies_count: anomalies.length,
    recommendation: pickRecommendation(anomalies, todayRevenue, yesterdayRevenue),
  };

  if (userId) {
    logAudit({
      tenantId,
      userId,
      action: 'insight_verdict_view',
      resourceType: 'insight',
      resourceId: 'daily_verdict',
      metadata: verdict,
    });
  }

  return verdict;
}
