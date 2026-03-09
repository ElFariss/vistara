function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(String(value ?? '').replace(/[^0-9,.-]/g, '').replace(/,(?=\d{1,2}\b)/g, '.').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCompactNumber(value, { currency = true, percent = false } = {}) {
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
  const title = String(artifact.title || '').toLowerCase();
  const value = String(artifact.value || '');
  return title.includes('margin') || value.includes('%');
}

function topLabel(labels = [], index = 0, fallback = 'Item utama') {
  const value = labels[index];
  return String(value || '').trim() || fallback;
}

function summarizeArtifactForExport(artifact = {}) {
  if (!artifact || typeof artifact !== 'object') {
    return {
      headline: 'Data belum tersedia',
      details: ['Widget ini belum punya nilai yang bisa diringkas.'],
    };
  }

  if (artifact.kind === 'metric') {
    const numeric = toNumber(artifact.raw_value ?? artifact.value);
    return {
      headline: numeric === null
        ? String(artifact.value || '-').trim() || '-'
        : formatCompactNumber(numeric, {
            currency: !artifactLooksPercent(artifact),
            percent: artifactLooksPercent(artifact),
          }),
      details: artifact.delta ? [String(artifact.delta).trim()] : [],
    };
  }

  if (artifact.kind === 'table') {
    const rows = Array.isArray(artifact.rows) ? artifact.rows : [];
    if (rows.length === 0) {
      return {
        headline: 'Tabel kosong',
        details: ['Belum ada baris yang bisa ditampilkan.'],
      };
    }

    const topRow = rows[0] || {};
    const label = String(topRow.name || topRow.label || topRow.branch || topRow.product || 'Baris teratas').trim();
    const value = toNumber(topRow.value ?? topRow.total_revenue ?? topRow.revenue ?? topRow.total_profit ?? topRow.profit);
    return {
      headline: `${rows.length} baris`,
      details: [
        value === null
          ? `Teratas: ${label}`
          : `Teratas: ${label} • ${formatCompactNumber(value)}`,
      ],
    };
  }

  if (artifact.kind === 'chart') {
    const series = Array.isArray(artifact.series) ? artifact.series : [];
    const values = Array.isArray(series[0]?.values)
      ? series[0].values.map((item) => Number(item || 0)).filter((item) => Number.isFinite(item))
      : [];
    const labels = Array.isArray(artifact.labels) ? artifact.labels : [];
    const chartType = String(artifact.chart_type || 'line').toLowerCase();
    const isPercent = artifactLooksPercent(artifact);

    if (values.length === 0) {
      return {
        headline: 'Chart kosong',
        details: ['Tidak ada titik data yang bisa dirender.'],
      };
    }

    const maxValue = Math.max(...values);
    const maxIndex = values.indexOf(maxValue);
    const latestValue = values[values.length - 1];
    const latestLabel = topLabel(labels, values.length - 1, 'Periode terbaru');
    const dominantLabel = topLabel(labels, maxIndex);
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);

    if (chartType === 'pie') {
      const pct = total > 0 ? (maxValue / total) * 100 : 0;
      return {
        headline: formatCompactNumber(total, { currency: !isPercent, percent: isPercent }),
        details: [`Terbesar: ${dominantLabel} • ${formatCompactNumber(maxValue, { currency: !isPercent, percent: isPercent })} (${pct.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%)`],
      };
    }

    if (chartType === 'bar') {
      return {
        headline: `Puncak ${formatCompactNumber(maxValue, { currency: !isPercent, percent: isPercent })}`,
        details: [`Dominan: ${dominantLabel}`],
      };
    }

    const startValue = values[0];
    const movement = latestValue > startValue ? 'naik' : latestValue < startValue ? 'turun' : 'stabil';
    return {
      headline: formatCompactNumber(latestValue, { currency: !isPercent, percent: isPercent }),
      details: [`${latestLabel} • ${movement}`, `Puncak: ${dominantLabel}`],
    };
  }

  return {
    headline: 'Ringkasan tidak tersedia',
    details: ['Widget ini belum punya format export yang kaya nilai.'],
  };
}

export function summarizeChartArtifactForExport(artifact = {}) {
  const summary = summarizeArtifactForExport({ ...artifact, kind: 'chart' });
  return [summary.headline, ...(Array.isArray(summary.details) ? summary.details : [])]
    .filter(Boolean)
    .slice(0, 3);
}
