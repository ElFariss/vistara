const chartInstances = new WeakMap();
const chartObservers = new WeakMap();

function cssColor(varName, fallback) {
  const root = document.documentElement;
  const value = getComputedStyle(root).getPropertyValue(varName).trim();
  return value || fallback;
}

function clearElement(element) {
  const existingCanvas = element.querySelector('canvas');
  if (existingCanvas && chartInstances.has(existingCanvas)) {
    chartInstances.get(existingCanvas).destroy();
    chartInstances.delete(existingCanvas);
  }
  if (existingCanvas && chartObservers.has(existingCanvas)) {
    chartObservers.get(existingCanvas).disconnect();
    chartObservers.delete(existingCanvas);
  }

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function createTitle(text) {
  const title = document.createElement('div');
  title.className = 'artifact-title';
  title.textContent = text || '';
  return title;
}

function renderMetric(element, artifact, options = {}) {
  const card = document.createElement('div');
  card.className = 'artifact-metric';

  if (!options.hideTitle) {
    card.append(createTitle(artifact.title || 'Metrik'));
  }

  const value = document.createElement('div');
  value.className = 'artifact-value';
  value.textContent = artifact.value || Number(artifact.raw_value || 0).toLocaleString('id-ID');
  card.append(value);

  if (artifact.delta && Number.isFinite(artifact.delta.deltaPct)) {
    const delta = document.createElement('div');
    delta.className = `artifact-delta ${artifact.delta.delta >= 0 ? 'up' : 'down'}`;
    delta.textContent = `${artifact.delta.delta >= 0 ? '+' : ''}${artifact.delta.deltaPct.toFixed(1)}%`;
    card.append(delta);
  }

  element.append(card);
}

function renderTable(element, artifact, options = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'artifact-table-wrap';
  if (!options.hideTitle) {
    wrap.append(createTitle(artifact.title || 'Tabel'));
  }

  const table = document.createElement('table');
  table.className = 'artifact-table';

  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const column of artifact.columns || []) {
    const th = document.createElement('th');
    th.textContent = column;
    tr.append(th);
  }
  thead.append(tr);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const row of artifact.rows || []) {
    const bodyRow = document.createElement('tr');
    for (const column of artifact.columns || []) {
      const td = document.createElement('td');
      const value = row?.[column];
      td.textContent = value === undefined || value === null ? '' : String(value);
      bodyRow.append(td);
    }
    tbody.append(bodyRow);
  }
  table.append(tbody);

  wrap.append(table);
  element.append(wrap);
}

function randomColor(index) {
  const accent = cssColor('--accent', '#e8722a');
  const palette = [accent, '#f59e42', '#d6960f', '#3a9a64', '#6c8aaf', '#b35c37', '#8d5a97'];
  return palette[index % palette.length];
}

function formatCompactNumber(rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return '0';
  }

  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  }
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')} Jt`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')} Rb`;
  }
  return value.toLocaleString('id-ID');
}

const CHART_JS_TYPES = new Set([
  'bar',
  'line',
  'pie',
  'donut',
  'half_donut',
  'multi_layer_pie',
  'radar_triangle',
  'radar_polygon',
  'polar',
  'scatter',
  'bubble',
  'area',
  'histogram',
]);

function normalizeChartType(rawType = '') {
  const type = String(rawType || '').toLowerCase();
  if (type === 'donut') return 'donut';
  if (type === 'half_donut') return 'half_donut';
  if (type === 'multi_layer_pie') return 'multi_layer_pie';
  if (type === 'radar_triangle') return 'radar_triangle';
  if (type === 'radar_polygon') return 'radar_polygon';
  if (type === 'polar') return 'polar';
  if (type === 'scatter') return 'scatter';
  if (type === 'bubble') return 'bubble';
  if (type === 'area') return 'area';
  if (type === 'histogram') return 'histogram';
  if (type === 'pie') return 'pie';
  if (type === 'bar') return 'bar';
  if (type === 'line') return 'line';
  return type || 'line';
}

function buildHistogram(values = [], bins = 6) {
  if (!values.length) return { labels: [], counts: [] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = span / bins;
  const counts = Array(bins).fill(0);
  values.forEach((value) => {
    const idx = Math.min(bins - 1, Math.floor((value - min) / step));
    counts[idx] += 1;
  });
  const labels = counts.map((_, index) => {
    const start = min + index * step;
    const end = start + step;
    return `${formatCompactNumber(start)}-${formatCompactNumber(end)}`;
  });
  return { labels, counts };
}

function renderCustomChart(element, artifact) {
  const type = normalizeChartType(artifact.chart_type || 'line');
  const series = Array.isArray(artifact.series) ? artifact.series : [];
  const values = (series[0]?.values || []).map((value) => Number(value || 0));
  const labels = Array.isArray(artifact.labels) ? artifact.labels : values.map((_, idx) => `Item ${idx + 1}`);
  const palette = values.map((_, idx) => randomColor(idx));
  const max = Math.max(...values, 1);
  const total = values.reduce((sum, val) => sum + Math.max(0, val), 0) || 1;

  const wrap = document.createElement('div');
  wrap.className = 'artifact-chart-wrap';
  if (element.classList.contains('widget-body')) {
    wrap.classList.add('artifact-chart-wrap-compact');
  }
  const plot = document.createElement('div');
  plot.className = 'artifact-chart-plot';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 60');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.width = '100%';
  svg.style.height = '100%';

  const add = (markup) => {
    const temp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    temp.innerHTML = markup;
    svg.append(...temp.childNodes);
  };

  if (type === 'cone' || type === 'pyramid' || type === 'funnel') {
    const sorted = values.map((value, index) => ({ value, label: labels[index] })).sort((a, b) => b.value - a.value);
    const stackHeight = 42;
    const segmentHeight = stackHeight / Math.max(1, sorted.length);
    sorted.forEach((entry, idx) => {
      const ratio = Math.max(0.15, entry.value / max);
      const width = ratio * 70;
      const center = 50;
      const y = 8 + idx * segmentHeight;
      const topWidth = type === 'funnel' ? width * 0.7 : width;
      const bottomWidth = type === 'pyramid' ? width * 0.7 : width;
      add(`<polygon points="${center - topWidth / 2} ${y}, ${center + topWidth / 2} ${y}, ${center + bottomWidth / 2} ${y + segmentHeight}, ${center - bottomWidth / 2} ${y + segmentHeight}" fill="${palette[idx % palette.length]}" opacity="0.8"></polygon>`);
    });
  } else if (type === 'tree') {
    let x = 8;
    values.forEach((value, idx) => {
      const width = (value / total) * 84;
      add(`<rect x="${x}" y="14" width="${Math.max(4, width)}" height="32" rx="2" fill="${palette[idx % palette.length]}" opacity="0.8"></rect>`);
      x += width;
    });
  } else if (type === 'flowchart' || type === 'pert' || type === 'circuit') {
    const count = Math.min(values.length, 5);
    const gap = 84 / Math.max(1, count - 1);
    for (let i = 0; i < count; i += 1) {
      const cx = 8 + i * gap;
      add(`<rect x="${cx - 6}" y="24" width="12" height="10" rx="2" fill="${palette[i % palette.length]}" opacity="0.85"></rect>`);
      if (i < count - 1) {
        add(`<path d="M${cx + 6} 29H${cx + gap - 6}" stroke="#6b5a48" stroke-width="1.2" />`);
      }
    }
  } else if (type === 'icon_array') {
    const totalIcons = 25;
    let iconIndex = 0;
    values.forEach((value, idx) => {
      const share = Math.round((Math.max(0, value) / total) * totalIcons);
      for (let i = 0; i < share && iconIndex < totalIcons; i += 1) {
        const row = Math.floor(iconIndex / 5);
        const col = iconIndex % 5;
        add(`<circle cx="${16 + col * 12}" cy="${14 + row * 9}" r="3" fill="${palette[idx % palette.length]}" />`);
        iconIndex += 1;
      }
    });
  } else if (type === 'percentage_bar' || type === 'gauge' || type === 'radial_wheel' || type === 'concentric_circles') {
    const value = Math.max(0, values[0] || 0);
    const ratio = Math.min(1, total > 0 ? value / total : 0.5);
    if (type === 'percentage_bar') {
      add(`<rect x="10" y="26" width="80" height="8" rx="4" fill="#e2e8f0"></rect>`);
      add(`<rect x="10" y="26" width="${Math.max(6, ratio * 80)}" height="8" rx="4" fill="${palette[0]}"></rect>`);
    } else if (type === 'gauge') {
      add(`<path d="M20 40a20 20 0 0 1 60 0" stroke="#e2e8f0" stroke-width="6" fill="none"></path>`);
      const angle = Math.PI * ratio;
      const x = 50 + 20 * Math.cos(Math.PI - angle);
      const y = 40 - 20 * Math.sin(Math.PI - angle);
      add(`<circle cx="50" cy="40" r="3" fill="${palette[0]}"></circle>`);
      add(`<line x1="50" y1="40" x2="${x}" y2="${y}" stroke="${palette[0]}" stroke-width="2"></line>`);
    } else if (type === 'radial_wheel') {
      let start = -Math.PI / 2;
      values.slice(0, 6).forEach((val, idx) => {
        const slice = (Math.max(0, val) / total) * Math.PI * 2;
        const x1 = 50 + 22 * Math.cos(start);
        const y1 = 30 + 22 * Math.sin(start);
        const x2 = 50 + 22 * Math.cos(start + slice);
        const y2 = 30 + 22 * Math.sin(start + slice);
        const large = slice > Math.PI ? 1 : 0;
        add(`<path d="M50 30 L${x1} ${y1} A22 22 0 ${large} 1 ${x2} ${y2} Z" fill="${palette[idx % palette.length]}" opacity="0.8"></path>`);
        start += slice;
      });
    } else {
      values.slice(0, 3).forEach((val, idx) => {
        const radius = 8 + (Math.max(0.2, val / max) * 16);
        add(`<circle cx="50" cy="30" r="${radius}" fill="${palette[idx % palette.length]}" opacity="0.2"></circle>`);
      });
    }
  } else if (type === 'gantt') {
    const count = Math.min(values.length, 5);
    for (let i = 0; i < count; i += 1) {
      const width = Math.max(10, (values[i] / max) * 70);
      add(`<rect x="12" y="${12 + i * 9}" width="${width}" height="5" rx="2" fill="${palette[i % palette.length]}"></rect>`);
    }
  } else if (type === 'timeline') {
    add('<line x1="20" y1="10" x2="20" y2="50" stroke="#94a3b8" stroke-width="1.5"></line>');
    values.slice(0, 4).forEach((_, idx) => {
      const y = 14 + idx * 10;
      add(`<circle cx="20" cy="${y}" r="2.4" fill="${palette[idx % palette.length]}"></circle>`);
      add(`<rect x="26" y="${y - 2}" width="50" height="4" rx="2" fill="#e2e8f0"></rect>`);
    });
  } else if (type === 'venn') {
    add('<circle cx="40" cy="30" r="14" fill="#f97316" opacity="0.25"></circle>');
    add('<circle cx="60" cy="30" r="14" fill="#fb923c" opacity="0.25"></circle>');
  } else if (type === 'mind_map') {
    add('<circle cx="50" cy="30" r="6" fill="#f97316"></circle>');
    const nodes = Math.min(labels.length, 4);
    for (let i = 0; i < nodes; i += 1) {
      const angle = (Math.PI * 2 * i) / nodes;
      const x = 50 + 22 * Math.cos(angle);
      const y = 30 + 16 * Math.sin(angle);
      add(`<circle cx="${x}" cy="${y}" r="4" fill="${palette[i % palette.length]}"></circle>`);
      add(`<line x1="50" y1="30" x2="${x}" y2="${y}" stroke="#6b5a48" stroke-width="1"></line>`);
    }
  } else if (type === 'dichotomous_key') {
    add('<line x1="20" y1="12" x2="20" y2="48" stroke="#6b5a48" stroke-width="1.2"></line>');
    add('<line x1="20" y1="22" x2="50" y2="22" stroke="#6b5a48" stroke-width="1.2"></line>');
    add('<line x1="20" y1="36" x2="50" y2="36" stroke="#6b5a48" stroke-width="1.2"></line>');
    add('<circle cx="20" cy="22" r="2" fill="#f97316"></circle>');
    add('<circle cx="20" cy="36" r="2" fill="#fb923c"></circle>');
  } else if (type === 'map' || type === 'choropleth') {
    const cells = Math.min(values.length, 8);
    for (let i = 0; i < cells; i += 1) {
      const row = Math.floor(i / 4);
      const col = i % 4;
      const intensity = Math.max(0.2, values[i] / max);
      add(`<rect x="${12 + col * 18}" y="${12 + row * 14}" width="14" height="10" rx="2" fill="${palette[i % palette.length]}" opacity="${intensity}"></rect>`);
    }
  } else {
    add('<rect x="12" y="18" width="76" height="24" rx="6" fill="#f1f5f9"></rect>');
  }

  plot.append(svg);
  wrap.append(plot);
  element.append(wrap);
}

function renderChartWithLibrary(element, artifact) {
  const rawType = normalizeChartType(artifact.chart_type || 'line');
  if (!CHART_JS_TYPES.has(rawType)) {
    renderCustomChart(element, artifact);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'artifact-chart-wrap';
  if (element.classList.contains('widget-body')) {
    wrap.classList.add('artifact-chart-wrap-compact');
  }

  const plot = document.createElement('div');
  plot.className = 'artifact-chart-plot';

  const canvas = document.createElement('canvas');
  canvas.className = 'artifact-chart-canvas';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  plot.append(canvas);
  wrap.append(plot);
  element.append(wrap);

  const accent = cssColor('--accent', '#e8722a');
  const inkSecondary = cssColor('--ink-secondary', '#6b5a48');
  const inkPrimary = cssColor('--ink', '#2c1e0e');
  const surface = cssColor('--surface', '#ffffff');
  const gridColor = cssColor('--line', 'rgba(180,155,120,0.16)');

  const primarySeries = (artifact.series && artifact.series.length ? artifact.series[0] : null) || { values: [] };
  const rawValues = (primarySeries.values || artifact.values || artifact.data || []).map((value) => Number(value || 0));
  let values = rawValues.length ? rawValues : [0];
  let labels = (artifact.labels && artifact.labels.length ? artifact.labels : values.map((_, index) => `P${index + 1}`)).slice(0, values.length);

  let chartType = rawType;
  let chartConfigType = rawType === 'donut' || rawType === 'half_donut' || rawType === 'multi_layer_pie'
    ? 'doughnut'
    : rawType === 'radar_triangle' || rawType === 'radar_polygon'
      ? 'radar'
      : rawType === 'polar'
        ? 'polarArea'
        : rawType === 'area'
          ? 'line'
          : rawType === 'histogram'
            ? 'bar'
            : rawType;

  if (rawType === 'radar_triangle' && labels.length > 3) {
    labels = labels.slice(0, 3);
    values = values.slice(0, 3);
  }

  if (rawType === 'histogram') {
    const hist = buildHistogram(values, 6);
    labels = hist.labels;
    values = hist.counts;
  }

  const scatterPoints = values.map((value, index) => ({
    x: index + 1,
    y: value,
  }));

  const bubblePoints = values.map((value, index) => ({
    x: index + 1,
    y: value,
    r: Math.max(3, Math.min(12, (value / Math.max(...values, 1)) * 12)),
  }));

  const config = {
    type: chartConfigType,
    data: {
      labels,
      datasets: rawType === 'scatter'
        ? [{
          label: primarySeries.name || 'Value',
          data: scatterPoints,
          borderColor: accent,
          backgroundColor: `${accent}80`,
        }]
        : rawType === 'bubble'
          ? [{
            label: primarySeries.name || 'Value',
            data: bubblePoints,
            borderColor: accent,
            backgroundColor: `${accent}70`,
          }]
          : rawType === 'multi_layer_pie'
            ? [
              {
                label: primarySeries.name || 'Layer 1',
                data: values,
                backgroundColor: values.map((_, index) => randomColor(index)),
              },
              {
                label: 'Layer 2',
                data: values.map((value) => Math.max(0, value * 0.6)),
                backgroundColor: values.map((_, index) => `${randomColor(index)}66`),
              },
            ]
            : [
              {
                label: primarySeries.name || 'Value',
                data: values,
                borderColor: chartConfigType === 'pie' || chartConfigType === 'doughnut' || chartConfigType === 'polarArea' ? undefined : accent,
                backgroundColor: chartConfigType === 'pie' || chartConfigType === 'doughnut' || chartConfigType === 'polarArea'
                  ? values.map((_, index) => randomColor(index))
                  : chartConfigType === 'bar'
                    ? `${accent}CC`
                    : `${accent}40`,
                fill: chartConfigType === 'line' || rawType === 'area',
                tension: chartConfigType === 'line' ? 0.28 : 0,
              },
            ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: chartConfigType === 'pie' || chartConfigType === 'doughnut' || chartConfigType === 'polarArea',
          labels: {
            color: inkSecondary,
          },
        },
        title: {
          display: false,
        },
        tooltip: {
          backgroundColor: surface,
          titleColor: inkPrimary,
          bodyColor: inkSecondary,
          borderColor: gridColor,
          borderWidth: 1,
          callbacks: {
            label: (context) => {
              const label = context.dataset?.label || 'Value';
              const numeric = chartConfigType === 'pie' || chartConfigType === 'doughnut' || chartConfigType === 'polarArea'
                ? context.raw
                : context.parsed?.y ?? context.raw;
              return `${label}: ${formatCompactNumber(numeric)}`;
            },
          },
        },
      },
      scales: chartConfigType === 'pie' || chartConfigType === 'doughnut' || chartConfigType === 'polarArea' || chartConfigType === 'radar'
        ? {}
        : {
            x: {
              ticks: { color: inkSecondary },
              grid: { color: gridColor },
            },
            y: {
              ticks: {
                color: inkSecondary,
                callback: (value) => formatCompactNumber(value),
              },
              grid: { color: gridColor },
            },
          },
    },
  };

  const chart = new window.Chart(canvas, config);
  chartInstances.set(canvas, chart);

  if (typeof window.ResizeObserver === 'function') {
    const observer = new window.ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        try {
          chart.resize();
        } catch {
          // Ignore late resize calls after teardown.
        }
      });
    });
    observer.observe(plot);
    chartObservers.set(canvas, observer);
  }

  window.requestAnimationFrame(() => {
    try {
      chart.resize();
    } catch {
      // Ignore late resize calls after teardown.
    }
  });
  window.setTimeout(() => {
    try {
      chart.resize();
    } catch {
      // Ignore late resize calls after teardown.
    }
  }, 90);
}

function renderChartFallback(element, artifact) {
  const wrap = document.createElement('div');
  wrap.className = 'artifact-text';

  const fallback = document.createElement('pre');
  fallback.textContent = JSON.stringify(artifact, null, 2);

  wrap.append(fallback);
  element.append(wrap);
}

function renderText(element, artifact, options = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'artifact-text';
  if (!options.hideTitle) {
    wrap.append(createTitle(artifact.title || 'Catatan'));
  }

  const pre = document.createElement('pre');
  pre.textContent = artifact.content || '';
  wrap.append(pre);

  element.append(wrap);
}

export function renderArtifact(element, artifact, options = {}) {
  clearElement(element);

  if (!artifact || typeof artifact !== 'object') {
    return;
  }

  if (artifact.kind === 'metric') {
    renderMetric(element, artifact, options);
    return;
  }

  if (artifact.kind === 'table') {
    renderTable(element, artifact, options);
    return;
  }

  if (artifact.kind === 'chart') {
    if (window.Chart) {
      renderChartWithLibrary(element, artifact);
    } else {
      renderChartFallback(element, artifact);
    }
    return;
  }

  if (artifact.kind === 'placeholder') {
    const placeholder = document.createElement('div');
    placeholder.className = 'placeholder-artifact';
    placeholder.innerHTML = `
      <div class="placeholder-chart-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64" role="presentation">
          <rect x="10" y="36" width="9" height="18" rx="2"></rect>
          <rect x="26" y="28" width="9" height="26" rx="2"></rect>
          <rect x="42" y="20" width="9" height="34" rx="2"></rect>
          <path d="M8 18L22 24L33 16L56 24"></path>
        </svg>
      </div>
      <p>Pilih data di panel kanan</p>
    `;
    element.append(placeholder);
    return;
  }

  if (artifact.kind === 'text') {
    renderText(element, artifact, options);
    return;
  }

  renderText(element, {
    title: artifact.title || 'Artifact',
    content: JSON.stringify(artifact, null, 2),
  }, options);
}
