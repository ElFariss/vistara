import { all, get } from '../db.mjs';
import { lastNDays } from '../utils/time.mjs';
import { toRupiah } from '../utils/text.mjs';
import { logAudit } from './audit.mjs';

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

function queryDailyRevenue(tenantId, days = 30) {
  const period = lastNDays(days);
  return all(
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

function detectMarginCompression(tenantId) {
  const current = get(
    `
      SELECT
        CASE WHEN SUM(total_revenue) = 0 THEN 0
             ELSE (SUM(total_revenue - COALESCE(cogs,0) - COALESCE(discount,0)) / SUM(total_revenue)) * 100
        END AS margin
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND transaction_date BETWEEN datetime('now', '-7 day') AND datetime('now')
    `,
    { tenant_id: tenantId },
  ) || { margin: 0 };

  const baseline = get(
    `
      SELECT
        CASE WHEN SUM(total_revenue) = 0 THEN 0
             ELSE (SUM(total_revenue - COALESCE(cogs,0) - COALESCE(discount,0)) / SUM(total_revenue)) * 100
        END AS margin
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND transaction_date BETWEEN datetime('now', '-37 day') AND datetime('now', '-8 day')
    `,
    { tenant_id: tenantId },
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

export function getAnomalies(tenantId, userId = null) {
  const series = queryDailyRevenue(tenantId, 30);
  const anomalies = detectRevenueAnomalies(series);
  const margin = detectMarginCompression(tenantId);

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

export function getTrends(tenantId, userId = null) {
  const series = queryDailyRevenue(tenantId, 30);
  const revenueValues = series.map((x) => Number(x.revenue || 0));
  const profitValues = series.map((x) => Number(x.profit || 0));

  const payload = {
    period_days: 30,
    points: series,
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
      metadata: { points: series.length },
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

export function getDailyVerdict(tenantId, userId = null) {
  const today = get(
    `
      SELECT COALESCE(SUM(total_revenue), 0) AS revenue,
             COALESCE(SUM(total_revenue - COALESCE(cogs, 0) - COALESCE(discount, 0)), 0) AS profit
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND DATE(transaction_date) = DATE('now')
    `,
    { tenant_id: tenantId },
  ) || { revenue: 0, profit: 0 };

  const yesterday = get(
    `
      SELECT COALESCE(SUM(total_revenue), 0) AS revenue,
             COALESCE(SUM(total_revenue - COALESCE(cogs, 0) - COALESCE(discount, 0)), 0) AS profit
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND DATE(transaction_date) = DATE('now', '-1 day')
    `,
    { tenant_id: tenantId },
  ) || { revenue: 0, profit: 0 };

  const anomalies = getAnomalies(tenantId, null);

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

  const sentence =
    status === 'SEHAT'
      ? `Bisnis stabil. Omzet hari ini ${toRupiah(todayRevenue)} (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% vs kemarin).`
      : status === 'WASPADA'
        ? `Perhatian: Omzet ${toRupiah(todayRevenue)} (${deltaPct.toFixed(1)}% vs kemarin). Ada ${anomalies.length} sinyal anomali.`
        : `Peringatan: Kondisi kritis. Omzet ${toRupiah(todayRevenue)} (${deltaPct.toFixed(1)}% vs kemarin) dan margin tertekan.`;

  const verdict = {
    status,
    sentence,
    metrics: {
      revenue_today: todayRevenue,
      revenue_yesterday: yesterdayRevenue,
      profit_today: Number(today.profit || 0),
      profit_yesterday: Number(yesterday.profit || 0),
      delta_pct: Number(deltaPct.toFixed(2)),
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
