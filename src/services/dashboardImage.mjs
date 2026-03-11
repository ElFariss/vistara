import { Resvg } from '@resvg/resvg-js';
import { DASHBOARD_GRID_COLS, DASHBOARD_GRID_ROWS, normalizeDashboardLayout } from '../../public/dashboard-layout.js';
import { SINGLE_VALUE_VISUALS } from './chartCatalog.mjs';

const EXPORT_WIDTH = 1600;
const EXPORT_HEIGHT = 900;
const OUTER_PAD = 24;
const GRID_GAP = 10;
const PAGE_GAP = 40;
const MAX_RENDER_WIDGETS = 24;
const MAX_RENDER_PAGES = 4;
const MAX_RENDER_HEIGHT = MAX_RENDER_PAGES * EXPORT_HEIGHT + (MAX_RENDER_PAGES - 1) * PAGE_GAP;
const MAX_RENDER_LABELS = 120;
const MAX_RENDER_SERIES_POINTS = 180;
const MAX_RENDER_TABLE_ROWS = 24;
const MAX_RENDER_COLUMNS = 6;
const MAX_RENDER_TEXT = 120;
const MAX_RENDER_CHART_TEXT_BUDGET = 6000;
const MAX_RENDER_TABLE_TEXT_BUDGET = 8000;
const MAX_RENDER_SERIES = 4;
const FONT_STACK = "'Inter', 'Segoe UI', Arial, sans-serif";
const DISPLAY_STACK = "'Space Grotesk', 'Inter', 'Segoe UI', Arial, sans-serif";
const LABEL_COLOR = '#475569';
const TEXT_COLOR = '#0f172a';
const MUTED_COLOR = '#64748b';
const BORDER_COLOR = '#e2e8f0';
const SURFACE_COLOR = '#ffffff';
const BACKGROUND_COLOR = '#f8fafc';
const ACCENT = '#f97316';
const ACCENT_SOFT = 'rgba(249, 115, 22, 0.18)';
const SERIES_PALETTE = ['#f97316', '#0ea5e9', '#10b981', '#8b5cf6'];
const PIE_PALETTE = ['#f97316', '#fb923c', '#fdba74', '#f59e0b', '#84cc16', '#38bdf8', '#a78bfa', '#14b8a6'];
const PIE_LIKE_TYPES = new Set(['pie', 'donut', 'half_donut', 'multi_layer_pie']);
const BAR_LIKE_TYPES = new Set([
  'bar',
  'histogram',
  'cone',
  'pyramid',
  'funnel',
  'tree',
  'flowchart',
  'icon_array',
  'percentage_bar',
  'gauge',
  'radial_wheel',
  'concentric_circles',
  'gantt',
  'timeline',
  'venn',
  'mind_map',
  'dichotomous_key',
  'pert',
  'circuit',
  'map',
  'choropleth',
]);
const LINE_LIKE_TYPES = new Set([
  'line',
  'area',
  'scatter',
  'bubble',
  'radar_triangle',
  'radar_polygon',
  'polar',
]);

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampText(value = '', limit = MAX_RENDER_TEXT) {
  return String(value || '').trim().slice(0, limit);
}

function assertTextBudget(values = [], limit = MAX_RENDER_CHART_TEXT_BUDGET, message = 'teks melebihi batas render.') {
  const total = values.reduce((sum, value) => sum + String(value || '').length, 0);
  if (total > limit) {
    const error = new Error(message);
    error.code = 'RENDER_DATA_LIMIT';
    throw error;
  }
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(String(value ?? '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/,(?=\d{1,2}\b)/g, '.')
    .replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function artifactLooksPercent(artifact = {}) {
  const title = String(artifact.title || '').toLowerCase();
  const value = String(artifact.value || '');
  return title.includes('margin') || value.includes('%');
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

function wrapText(value = '', maxChars = 22) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [''];
  }

  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = word;
      continue;
    }
    lines.push(word.slice(0, maxChars));
    current = word.length > maxChars ? word.slice(maxChars) : '';
  }
  if (current) {
    lines.push(current);
  }
  return lines.slice(0, 3);
}

function buildText(x, y, text, options = {}) {
  const fontSize = Number(options.fontSize || 14);
  const fontWeight = Number(options.fontWeight || 500);
  const fill = escapeXml(options.fill || TEXT_COLOR);
  const anchor = escapeXml(options.anchor || 'start');
  const family = escapeXml(options.family || FONT_STACK);
  const lineHeight = Number(options.lineHeight || Math.round(fontSize * 1.3));
  const lines = Array.isArray(text) ? text : wrapText(text, options.maxChars || 28);

  return lines.map((line, index) => {
    const dy = index * lineHeight;
    return `<text x="${x}" y="${y + dy}" text-anchor="${anchor}" font-family="${family}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}">${escapeXml(line)}</text>`;
  }).join('');
}

function renderMetricWidget(artifact, body) {
  const numeric = toNumber(artifact.raw_value ?? artifact.value);
  const value = numeric === null
    ? String(artifact.value || '-').trim() || '-'
    : formatCompactNumber(numeric, {
        currency: !artifactLooksPercent(artifact),
        percent: artifactLooksPercent(artifact),
      });
  const delta = String(artifact.delta || '').trim();

  return [
    buildText(body.x, body.y + 60, value, {
      fontSize: 42,
      fontWeight: 700,
      family: DISPLAY_STACK,
      maxChars: 16,
      lineHeight: 46,
    }),
    delta
      ? buildText(body.x, body.y + 96, delta, {
          fontSize: 16,
          fontWeight: 600,
          fill: MUTED_COLOR,
          maxChars: 30,
        })
      : '',
  ].join('');
}

function tableColumns(artifact = {}) {
  const columns = Array.isArray(artifact.columns) ? artifact.columns : [];
  return columns.length > 0 ? columns.slice(0, 3) : ['name', 'value'];
}

function sanitizeArtifactForRender(artifact = {}) {
  const kind = String(artifact.kind || 'chart').toLowerCase();
  if (kind === 'metric') {
    return {
      ...artifact,
      kind: 'metric',
      title: clampText(artifact.title || '', 80),
      value: clampText(artifact.value || '', 40),
      delta: clampText(artifact.delta || '', 40),
    };
  }

  if (kind === 'table') {
    const columns = Array.isArray(artifact.columns) ? artifact.columns : [];
    const rows = Array.isArray(artifact.rows) ? artifact.rows : [];
    if (columns.length > MAX_RENDER_COLUMNS || rows.length > MAX_RENDER_TABLE_ROWS) {
      const error = new Error('data tabel melebihi batas render.');
      error.code = 'RENDER_DATA_LIMIT';
      throw error;
    }
    assertTextBudget([
      ...columns,
      ...rows.flatMap((row) => Object.entries(row || {}).flatMap(([key, value]) => [key, value])),
    ], MAX_RENDER_TABLE_TEXT_BUDGET, 'teks tabel melebihi batas render.');
    return {
      ...artifact,
      kind: 'table',
      title: clampText(artifact.title || '', 80),
      columns: columns.slice(0, MAX_RENDER_COLUMNS).map((column) => clampText(column, 32)),
      rows: rows.slice(0, MAX_RENDER_TABLE_ROWS).map((row) => {
        const next = {};
        for (const [key, value] of Object.entries(row || {})) {
          next[clampText(key, 32)] = typeof value === 'number' ? value : clampText(value, 60);
        }
        return next;
      }),
    };
  }

  if (kind === 'chart') {
    const labels = Array.isArray(artifact.labels) ? artifact.labels : [];
    const series = Array.isArray(artifact.series) ? artifact.series.slice(0, MAX_RENDER_SERIES) : [];
    const longestSeries = series.reduce((max, item) => Math.max(max, Array.isArray(item?.values) ? item.values.length : 0), 0);
    if (labels.length > MAX_RENDER_LABELS || longestSeries > MAX_RENDER_SERIES_POINTS) {
      const error = new Error('seri chart melebihi batas render.');
      error.code = 'RENDER_DATA_LIMIT';
      throw error;
    }
    assertTextBudget([
      artifact.title,
      ...series.map((item) => item?.name),
      ...labels,
    ], MAX_RENDER_CHART_TEXT_BUDGET, 'label chart melebihi batas render.');
    return {
      ...artifact,
      kind: 'chart',
      title: clampText(artifact.title || '', 80),
      chart_type: clampText(artifact.chart_type || 'line', 16),
      labels: labels.slice(0, MAX_RENDER_LABELS).map((label) => clampText(label, 40)),
      series: series.map((item, index) => ({
        name: clampText(item?.name || `${artifact.title || 'Series'} ${index + 1}`, 40),
        values: (Array.isArray(item?.values) ? item.values : [])
          .slice(0, MAX_RENDER_SERIES_POINTS)
          .map((value) => Number(value || 0)),
      })),
    };
  }

  return {
    ...artifact,
    title: clampText(artifact.title || '', 80),
  };
}

function sanitizeWidgetsForRender(widgets = []) {
  return widgets.map((widget) => ({
    ...widget,
    title: clampText(widget.title || '', 80),
    artifact: sanitizeArtifactForRender(widget.artifact || {}),
  }));
}

function renderTableWidget(artifact, body) {
  const rows = Array.isArray(artifact.rows) ? artifact.rows.slice(0, 6) : [];
  const columns = tableColumns(artifact);
  const colWidth = body.width / Math.max(1, columns.length);
  const headerY = body.y + 24;
  const rowStartY = body.y + 54;
  const rowHeight = 28;

  const header = columns.map((column, index) => buildText(
    body.x + index * colWidth,
    headerY,
    String(column).replace(/_/g, ' '),
    {
      fontSize: 13,
      fontWeight: 700,
      fill: LABEL_COLOR,
      maxChars: 18,
    },
  )).join('');

  const divider = `<line x1="${body.x}" y1="${body.y + 32}" x2="${body.x + body.width}" y2="${body.y + 32}" stroke="${BORDER_COLOR}" stroke-width="1" />`;

  const bodyRows = rows.map((row, rowIndex) => {
    const y = rowStartY + rowIndex * rowHeight;
    const rowDivider = `<line x1="${body.x}" y1="${y + 8}" x2="${body.x + body.width}" y2="${y + 8}" stroke="${BORDER_COLOR}" stroke-width="1" opacity="0.6" />`;
    const texts = columns.map((column, index) => {
      const value = row?.[column];
      const text = typeof value === 'number'
        ? formatCompactNumber(value, { currency: !String(column).toLowerCase().includes('qty'), percent: false })
        : String(value ?? '').trim();
      return buildText(body.x + index * colWidth, y, text, {
        fontSize: 13,
        fontWeight: 500,
        fill: TEXT_COLOR,
        maxChars: index === 0 ? 18 : 12,
      });
    }).join('');
    return `${rowDivider}${texts}`;
  }).join('');

  if (rows.length === 0) {
    return buildText(body.x, body.y + 40, 'Belum ada baris yang bisa ditampilkan.', {
      fontSize: 15,
      fontWeight: 500,
      fill: MUTED_COLOR,
      maxChars: 42,
    });
  }

  return `${header}${divider}${bodyRows}`;
}

function chartSeries(artifact = {}) {
  return Array.isArray(artifact.series)
    ? artifact.series
      .map((series, index) => ({
        name: clampText(series?.name || `Series ${index + 1}`, 40),
        values: Array.isArray(series?.values)
          ? series.values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value))
          : [],
      }))
      .filter((series) => series.values.length > 0)
    : [];
}

function chartLabels(artifact = {}) {
  return Array.isArray(artifact.labels)
    ? artifact.labels.map((label) => String(label || '').trim())
    : [];
}

function aggregateSeriesValues(series = []) {
  const length = series.reduce((max, item) => Math.max(max, item.values.length), 0);
  return Array.from({ length }, (_, index) => series.reduce((sum, item) => sum + Number(item.values[index] || 0), 0));
}

function renderSeriesLegend(series = [], x, y) {
  if (!Array.isArray(series) || series.length <= 1) {
    return '';
  }

  return series.map((item, index) => {
    const offsetX = x + index * 156;
    const color = SERIES_PALETTE[index % SERIES_PALETTE.length];
    return [
      `<rect x="${offsetX}" y="${y - 10}" width="14" height="14" rx="4" fill="${color}" />`,
      buildText(offsetX + 22, y + 2, item.name || `Series ${index + 1}`, {
        fontSize: 12,
        fontWeight: 700,
        fill: TEXT_COLOR,
        maxChars: 18,
      }),
    ].join('');
  }).join('');
}

function renderHorizontalBars(artifact, body) {
  const series = chartSeries(artifact);
  if (series.length > 1) {
    return renderVerticalBars(artifact, body);
  }
  const values = series[0]?.values || [];
  const labels = chartLabels(artifact);
  if (values.length === 0) {
    return buildText(body.x, body.y + 32, 'Tidak ada data chart.', {
      fontSize: 15,
      fontWeight: 500,
      fill: MUTED_COLOR,
      maxChars: 32,
    });
  }

  const maxValue = Math.max(...values, 1);
  const isPercent = artifactLooksPercent(artifact);
  const rowGap = Math.max(12, Math.round(body.height * 0.03));
  const rowHeight = Math.max(28, Math.floor((body.height - rowGap * Math.max(values.length - 1, 0)) / Math.max(values.length, 1)));
  const contentHeight = values.length * rowHeight + Math.max(0, values.length - 1) * rowGap;
  const startY = body.y + Math.max(0, Math.round((body.height - contentHeight) / 2));
  const labelWidth = Math.min(300, Math.max(180, body.width * 0.4));
  const valueWidth = 120;
  const barAreaWidth = Math.max(90, body.width - labelWidth - valueWidth - 12);

  return values.map((value, index) => {
    const rowY = startY + index * (rowHeight + rowGap);
    const ratio = maxValue > 0 ? Math.max(0, value) / maxValue : 0;
    const barWidth = Math.max(8, Math.round(barAreaWidth * ratio));
    const label = labels[index] || `Item ${index + 1}`;
    const valueText = formatCompactNumber(value, { currency: !isPercent, percent: isPercent });
    return [
      buildText(body.x, rowY + 15, label, {
        fontSize: 15,
        fontWeight: 700,
        fill: TEXT_COLOR,
        maxChars: 24,
        lineHeight: 17,
      }),
      `<rect x="${body.x + labelWidth}" y="${rowY}" width="${Math.max(12, barAreaWidth)}" height="${rowHeight}" rx="8" fill="#f1f5f9" />`,
      `<rect x="${body.x + labelWidth}" y="${rowY}" width="${barWidth}" height="${rowHeight}" rx="8" fill="${ACCENT}" />`,
      buildText(body.x + labelWidth + barAreaWidth + 12, rowY + Math.min(rowHeight - 8, 20), valueText, {
        fontSize: 14,
        fontWeight: 700,
        fill: TEXT_COLOR,
        maxChars: 14,
      }),
    ].join('');
  }).join('');
}

function renderVerticalBars(artifact, body) {
  const series = chartSeries(artifact);
  const values = series.length > 1 ? aggregateSeriesValues(series) : (series[0]?.values || []);
  const labels = chartLabels(artifact);
  if (values.length === 0) {
    return buildText(body.x, body.y + 32, 'Tidak ada data chart.', {
      fontSize: 15,
      fontWeight: 500,
      fill: MUTED_COLOR,
      maxChars: 32,
    });
  }

  const maxValue = Math.max(
    ...series.flatMap((item) => item.values),
    1,
  );
  const minValue = Math.min(...values, 0);
  const span = Math.max(1, maxValue - Math.min(0, minValue));
  const legendHeight = series.length > 1 ? 28 : 0;
  const plotTop = body.y + legendHeight;
  const plotHeight = Math.max(80, body.height - 70 - legendHeight);
  const baseY = plotTop + plotHeight;
  const slotWidth = body.width / values.length;
  const groupWidth = Math.max(24, slotWidth - 14);
  const isPercent = artifactLooksPercent(artifact);

  const grid = Array.from({ length: 4 }, (_, index) => {
    const y = plotTop + (plotHeight * index) / 3;
    return `<line x1="${body.x}" y1="${y}" x2="${body.x + body.width}" y2="${y}" stroke="${BORDER_COLOR}" stroke-width="1" />`;
  }).join('');

  const bars = values.map((_, index) => {
    const innerGap = series.length > 1 ? 4 : 0;
    const barWidth = series.length > 1
      ? Math.max(8, (groupWidth - innerGap * Math.max(series.length - 1, 0)) / series.length)
      : Math.max(24, groupWidth);
    const barGroup = series.map((entry, seriesIndex) => {
      const value = Number(entry.values[index] || 0);
      const height = Math.max(8, (Math.max(0, value - Math.min(0, minValue)) / span) * (plotHeight - 12));
      const x = body.x + index * slotWidth + (slotWidth - groupWidth) / 2 + seriesIndex * (barWidth + innerGap);
      const y = baseY - height;
      const color = SERIES_PALETTE[seriesIndex % SERIES_PALETTE.length];
      return [
        `<rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="6" fill="${color}" />`,
        series.length === 1
          ? buildText(x + barWidth / 2, y - 8, formatCompactNumber(value, { currency: !isPercent, percent: isPercent }), {
              fontSize: 11,
              fontWeight: 700,
              fill: LABEL_COLOR,
              anchor: 'middle',
              maxChars: 12,
            })
          : '',
      ].join('');
    }).join('');
    return barGroup;
  }).join('');

  const labelAnchors = values.map((_, index) => {
    const x = body.x + index * slotWidth + slotWidth / 2;
    const labelLines = wrapText(labels[index] || `Item ${index + 1}`, 10).slice(0, 2);
    return buildText(x, baseY + 20, labelLines, {
      fontSize: 11,
      fontWeight: 600,
      fill: TEXT_COLOR,
      anchor: 'middle',
      lineHeight: 13,
    });
  }).join('');

  return `${renderSeriesLegend(series, body.x, body.y + 6)}${grid}${bars}${labelAnchors}`;
}

function renderLineChart(artifact, body) {
  const series = chartSeries(artifact);
  const values = series.length > 0 ? aggregateSeriesValues(series) : [];
  const labels = chartLabels(artifact);
  if (values.length === 0) {
    return buildText(body.x, body.y + 32, 'Tidak ada data chart.', {
      fontSize: 15,
      fontWeight: 500,
      fill: MUTED_COLOR,
      maxChars: 32,
    });
  }

  const allValues = series.flatMap((item) => item.values);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const span = maxValue - minValue || 1;
  const legendHeight = series.length > 1 ? 28 : 0;
  const plotTop = body.y + legendHeight;
  const plotHeight = Math.max(90, body.height - 60 - legendHeight);
  const stepX = values.length > 1 ? body.width / (values.length - 1) : body.width;
  const pointSets = series.map((entry) => entry.values.map((value, index) => {
    const ratio = (value - minValue) / span;
    return {
      x: body.x + index * stepX,
      y: plotTop + plotHeight - ratio * Math.max(20, plotHeight - 20),
    };
  }));

  const grid = Array.from({ length: 4 }, (_, index) => {
    const y = plotTop + (plotHeight * index) / 3;
    return `<line x1="${body.x}" y1="${y}" x2="${body.x + body.width}" y2="${y}" stroke="${BORDER_COLOR}" stroke-width="1" />`;
  }).join('');

  const firstPoints = pointSets[0] || [];
  const firstValues = series[0]?.values || [];
  const polylineMarkup = pointSets.map((points, index) => {
    const color = SERIES_PALETTE[index % SERIES_PALETTE.length];
    const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');
    const areaPoints = [`${body.x},${plotTop + plotHeight}`, ...points.map((point) => `${point.x},${point.y}`), `${body.x + body.width},${plotTop + plotHeight}`].join(' ');
    return [
      index === 0 ? `<polygon points="${areaPoints}" fill="${ACCENT_SOFT}" />` : '',
      `<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />`,
      points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" fill="${color}" />`).join(''),
    ].join('');
  }).join('');

  const peakValue = firstValues.length ? Math.max(...firstValues) : 0;
  const peakIndex = firstValues.indexOf(peakValue);
  const latestValue = firstValues[firstValues.length - 1];
  const latestIndex = firstValues.length - 1;
  const annotations = series.length === 1 && firstPoints.length
    ? [
        buildText(firstPoints[peakIndex].x, firstPoints[peakIndex].y - 10, `Puncak ${formatCompactNumber(peakValue, { currency: !artifactLooksPercent(artifact), percent: artifactLooksPercent(artifact) })}`, {
          fontSize: 11,
          fontWeight: 700,
          fill: LABEL_COLOR,
          anchor: peakIndex > firstValues.length - 3 ? 'end' : 'start',
          maxChars: 18,
        }),
        buildText(firstPoints[latestIndex].x, firstPoints[latestIndex].y - 10, `Akhir ${formatCompactNumber(latestValue, { currency: !artifactLooksPercent(artifact), percent: artifactLooksPercent(artifact) })}`, {
          fontSize: 11,
          fontWeight: 700,
          fill: LABEL_COLOR,
          anchor: 'end',
          maxChars: 18,
        }),
      ].join('')
    : '';

  const labelIndexes = values.length <= 6
    ? values.map((_, index) => index)
    : [0, Math.floor(values.length / 2), values.length - 1];
  const xLabels = labelIndexes.map((index) => buildText((firstPoints[index] || { x: body.x }).x, plotTop + plotHeight + 18, labels[index] || `Titik ${index + 1}`, {
    fontSize: 11,
    fontWeight: 600,
    fill: MUTED_COLOR,
    anchor: index === 0 ? 'start' : index === values.length - 1 ? 'end' : 'middle',
    maxChars: 12,
  })).join('');

  return [
    renderSeriesLegend(series, body.x, body.y + 6),
    grid,
    polylineMarkup,
    annotations,
    xLabels,
  ].join('');
}

function renderPieChart(artifact, body) {
  const series = chartSeries(artifact);
  const values = aggregateSeriesValues(series);
  const labels = chartLabels(artifact);
  if (values.length === 0) {
    return buildText(body.x, body.y + 32, 'Tidak ada data chart.', {
      fontSize: 15,
      fontWeight: 500,
      fill: MUTED_COLOR,
      maxChars: 32,
    });
  }

  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const radius = Math.min(body.width * 0.34, body.height * 0.35);
  const cx = body.x + radius + 20;
  const cy = body.y + body.height / 2;
  let angle = -Math.PI / 2;

  const slices = values.map((value, index) => {
    const slice = (Math.max(0, value) / total) * Math.PI * 2;
    const x1 = cx + radius * Math.cos(angle);
    const y1 = cy + radius * Math.sin(angle);
    angle += slice;
    const x2 = cx + radius * Math.cos(angle);
    const y2 = cy + radius * Math.sin(angle);
    const largeArc = slice > Math.PI ? 1 : 0;
    return `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${PIE_PALETTE[index % PIE_PALETTE.length]}" />`;
  }).join('');

  const legendX = cx + radius + 40;
  const legend = values.map((value, index) => {
    const y = body.y + 26 + index * 28;
    const label = labels[index] || `Kategori ${index + 1}`;
    const pct = ((Math.max(0, value) / total) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 });
    return [
      `<rect x="${legendX}" y="${y - 11}" width="14" height="14" rx="4" fill="${PIE_PALETTE[index % PIE_PALETTE.length]}" />`,
      buildText(legendX + 22, y, `${label} • ${pct}%`, {
        fontSize: 12,
        fontWeight: 600,
        fill: TEXT_COLOR,
        maxChars: 28,
      }),
    ].join('');
  }).join('');

  return `${slices}${legend}`;
}

function renderChartWidget(artifact, body) {
  const chartType = String(artifact.chart_type || 'line').toLowerCase();

  if (SINGLE_VALUE_VISUALS.has(chartType)) {
    const series = chartSeries(artifact);
    const value = series[0]?.values?.[0] ?? 0;
    return renderMetricWidget({
      ...artifact,
      kind: 'metric',
      value: formatCompactNumber(value, {
        currency: !artifactLooksPercent(artifact),
        percent: artifactLooksPercent(artifact),
      }),
      raw_value: value,
    }, body);
  }

  if (PIE_LIKE_TYPES.has(chartType)) {
    return renderPieChart(artifact, body);
  }

  if (BAR_LIKE_TYPES.has(chartType)) {
    const labels = chartLabels(artifact);
    const dense = labels.length > 6 || labels.some((label) => label.length > 12);
    return dense ? renderHorizontalBars(artifact, body) : renderVerticalBars(artifact, body);
  }

  if (LINE_LIKE_TYPES.has(chartType)) {
    return renderLineChart(artifact, body);
  }

  return renderLineChart(artifact, body);
}

function renderPlaceholderWidget(body) {
  return buildText(body.x, body.y + 28, 'Widget ini masih menunggu data yang cukup kuat untuk divisualkan.', {
    fontSize: 15,
    fontWeight: 500,
    fill: MUTED_COLOR,
    maxChars: 46,
    lineHeight: 19,
  });
}

function gridMetrics() {
  return {
    cellWidth: (EXPORT_WIDTH - OUTER_PAD * 2 - GRID_GAP * (DASHBOARD_GRID_COLS - 1)) / DASHBOARD_GRID_COLS,
    cellHeight: (EXPORT_HEIGHT - OUTER_PAD * 2 - GRID_GAP * (DASHBOARD_GRID_ROWS - 1)) / DASHBOARD_GRID_ROWS,
  };
}

function pageWidgets(widgets = [], page = 1) {
  return widgets
    .filter((widget) => Number(widget?.layout?.page || 1) === page)
    .map((widget) => ({
      ...widget,
      layout: normalizeDashboardLayout(widget.layout || {}, {
        kind: widget?.artifact?.kind || widget?.kind || 'chart',
        page,
      }),
    }));
}

function widgetRect(layout, pageOffsetY = 0) {
  const { cellWidth, cellHeight } = gridMetrics();
  return {
    x: OUTER_PAD + layout.x * (cellWidth + GRID_GAP),
    y: pageOffsetY + OUTER_PAD + layout.y * (cellHeight + GRID_GAP),
    w: layout.w * cellWidth + (layout.w - 1) * GRID_GAP,
    h: layout.h * cellHeight + (layout.h - 1) * GRID_GAP,
  };
}

function renderWidget(widget, pageOffsetY = 0) {
  const artifact = widget?.artifact || {};
  const rect = widgetRect(widget.layout, pageOffsetY);
  const body = {
    x: rect.x + 16,
    y: rect.y + 42,
    width: rect.w - 32,
    height: rect.h - 58,
  };

  const title = buildText(rect.x + 16, rect.y + 28, String(widget.title || artifact.title || 'Widget').slice(0, 48), {
    fontSize: 18,
    fontWeight: 700,
    fill: LABEL_COLOR,
    maxChars: 28,
  });

  let content = '';
  if (artifact.kind === 'metric') {
    content = renderMetricWidget(artifact, body);
  } else if (artifact.kind === 'table') {
    content = renderTableWidget(artifact, body);
  } else if (artifact.kind === 'placeholder') {
    content = renderPlaceholderWidget(body);
  } else {
    content = renderChartWidget(artifact, body);
  }

  return [
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" rx="16" fill="${SURFACE_COLOR}" stroke="${BORDER_COLOR}" stroke-width="1" />`,
    title,
    content,
  ].join('');
}

function distinctPages(widgets = []) {
  const pages = new Set(
    widgets.map((widget) => Number(widget?.layout?.page || 1)).filter((page) => Number.isFinite(page) && page >= 1),
  );
  return Array.from(pages).sort((a, b) => a - b);
}

function assertRenderBounds({ widgets = [], pages = [] } = {}) {
  if (widgets.length > MAX_RENDER_WIDGETS) {
    const error = new Error('widgets melebihi batas render.');
    error.code = 'RENDER_WIDGET_LIMIT';
    throw error;
  }
  if (pages.length > MAX_RENDER_PAGES) {
    const error = new Error('halaman melebihi batas render.');
    error.code = 'RENDER_PAGE_LIMIT';
    throw error;
  }
}

function renderPageFrame(page, pageIndex, totalPages) {
  const offsetY = pageIndex * (EXPORT_HEIGHT + PAGE_GAP);
  const title = totalPages > 1
    ? buildText(OUTER_PAD, offsetY + 18, `Halaman ${page}`, {
        fontSize: 14,
        fontWeight: 700,
        fill: MUTED_COLOR,
        maxChars: 18,
      })
    : '';
  return {
    offsetY,
    markup: [
      title,
      `<rect x="0" y="${offsetY}" width="${EXPORT_WIDTH}" height="${EXPORT_HEIGHT}" fill="${BACKGROUND_COLOR}" />`,
    ].join(''),
  };
}

function svgForWidgets({ widgets = [], page = null, stackPages = false, title = 'Dashboard Vistara' } = {}) {
  const safeWidgets = sanitizeWidgetsForRender(Array.isArray(widgets) ? widgets : []);
  const pages = stackPages
    ? distinctPages(safeWidgets)
    : [Number(page || distinctPages(safeWidgets)[0] || 1)];
  assertRenderBounds({ widgets: safeWidgets, pages });
  const totalPages = Math.max(1, pages.length);
  const height = totalPages * EXPORT_HEIGHT + Math.max(0, totalPages - 1) * PAGE_GAP;
  if (height > MAX_RENDER_HEIGHT) {
    const error = new Error('tinggi render melebihi batas.');
    error.code = 'RENDER_HEIGHT_LIMIT';
    throw error;
  }

  const pageMarkup = pages.map((pageNumber, pageIndex) => {
    const frame = renderPageFrame(pageNumber, pageIndex, totalPages);
    const widgetsMarkup = pageWidgets(safeWidgets, pageNumber)
      .map((widget) => renderWidget(widget, frame.offsetY))
      .join('');
    return `${frame.markup}${widgetsMarkup}`;
  }).join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${EXPORT_WIDTH}" height="${height}" viewBox="0 0 ${EXPORT_WIDTH} ${height}">
      <defs>
        <style>
          text { dominant-baseline: hanging; }
        </style>
      </defs>
      <title>${escapeXml(title)}</title>
      ${pageMarkup}
    </svg>
  `;
}

export function renderDashboardSvg(options = {}) {
  return svgForWidgets(options);
}

export function renderDashboardPng(options = {}) {
  const svg = svgForWidgets(options);
  const safeWidgets = sanitizeWidgetsForRender(Array.isArray(options.widgets) ? options.widgets : []);
  const pages = options.stackPages ? distinctPages(safeWidgets) : [Number(options.page || 1)];
  assertRenderBounds({ widgets: safeWidgets, pages });
  const height = Math.max(1, pages.length) * EXPORT_HEIGHT + Math.max(0, pages.length - 1) * PAGE_GAP;
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: EXPORT_WIDTH,
    },
    background: BACKGROUND_COLOR,
  });
  const pngData = resvg.render();
  return {
    buffer: pngData.asPng(),
    width: EXPORT_WIDTH,
    height,
  };
}
