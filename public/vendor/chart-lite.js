const chartInstances = new WeakMap();

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

function renderMetric(element, artifact) {
  const card = document.createElement('div');
  card.className = 'artifact-metric';

  card.append(createTitle(artifact.title || 'Metrik'));

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

function renderTable(element, artifact) {
  const wrap = document.createElement('div');
  wrap.className = 'artifact-table-wrap';
  wrap.append(createTitle(artifact.title || 'Tabel'));

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

function allChartInstances() {
  const instances = window.Chart?.instances;
  if (!instances) return [];
  if (typeof instances.values === 'function') {
    return Array.from(instances.values());
  }
  if (Array.isArray(instances)) {
    return instances.filter(Boolean);
  }
  if (typeof instances === 'object') {
    return Object.values(instances).filter(Boolean);
  }
  return [];
}

function applyThemeToChart(chart) {
  if (!chart || !chart.options) return;
  const type = String(chart.config?.type || '').toLowerCase();
  const inkSecondary = cssColor('--ink-secondary', '#6b5a48');
  const inkPrimary = cssColor('--ink', '#2c1e0e');
  const surface = cssColor('--surface', '#ffffff');
  const gridColor = cssColor('--line', 'rgba(180,155,120,0.16)');

  chart.options.plugins = chart.options.plugins || {};
  chart.options.plugins.tooltip = {
    ...(chart.options.plugins.tooltip || {}),
    backgroundColor: surface,
    titleColor: inkPrimary,
    bodyColor: inkSecondary,
    borderColor: gridColor,
    borderWidth: 1,
  };

  if (type !== 'pie') {
    chart.options.scales = chart.options.scales || {};
    chart.options.scales.x = chart.options.scales.x || {};
    chart.options.scales.y = chart.options.scales.y || {};
    chart.options.scales.x.ticks = { ...(chart.options.scales.x.ticks || {}), color: inkSecondary };
    chart.options.scales.y.ticks = { ...(chart.options.scales.y.ticks || {}), color: inkSecondary };
    chart.options.scales.x.grid = { ...(chart.options.scales.x.grid || {}), color: gridColor };
    chart.options.scales.y.grid = { ...(chart.options.scales.y.grid || {}), color: gridColor };
  }

  if (chart.options.plugins.legend?.labels) {
    chart.options.plugins.legend.labels.color = inkSecondary;
  }
  chart.update('none');
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

function renderChartWithLibrary(element, artifact) {
  const wrap = document.createElement('div');
  wrap.className = 'artifact-chart-wrap';

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
  const values = rawValues.length ? rawValues : [0];
  const labels = (artifact.labels && artifact.labels.length ? artifact.labels : values.map((_, index) => `P${index + 1}`)).slice(0, values.length);

  const chartType = artifact.chart_type === 'pie'
    ? 'pie'
    : artifact.chart_type === 'bar'
      ? 'bar'
      : 'line';

  const config = {
    type: chartType,
    data: {
      labels,
      datasets: [
        {
          label: primarySeries.name || 'Value',
          data: values,
          borderColor: chartType === 'pie' ? undefined : accent,
          backgroundColor: chartType === 'pie'
            ? values.map((_, index) => randomColor(index))
            : chartType === 'bar'
              ? `${accent}CC`
              : `${accent}40`,
          fill: chartType === 'line',
          tension: chartType === 'line' ? 0.28 : 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: chartType === 'pie',
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
              const numeric = chartType === 'pie' ? context.raw : context.parsed?.y ?? context.raw;
              return `${label}: ${formatCompactNumber(numeric)}`;
            },
          },
        },
      },
      scales: chartType === 'pie'
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
  applyThemeToChart(chart);
}

function renderChartFallback(element, artifact) {
  const wrap = document.createElement('div');
  wrap.className = 'artifact-text';

  const fallback = document.createElement('pre');
  fallback.textContent = JSON.stringify(artifact, null, 2);

  wrap.append(fallback);
  element.append(wrap);
}

function renderText(element, artifact) {
  const wrap = document.createElement('div');
  wrap.className = 'artifact-text';
  wrap.append(createTitle(artifact.title || 'Catatan'));

  const pre = document.createElement('pre');
  pre.textContent = artifact.content || '';
  wrap.append(pre);

  element.append(wrap);
}

export function renderArtifact(element, artifact) {
  clearElement(element);

  if (!artifact || typeof artifact !== 'object') {
    return;
  }

  if (artifact.kind === 'metric') {
    renderMetric(element, artifact);
    return;
  }

  if (artifact.kind === 'table') {
    renderTable(element, artifact);
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
    renderText(element, artifact);
    return;
  }

  renderText(element, {
    title: artifact.title || 'Artifact',
    content: JSON.stringify(artifact, null, 2),
  });
}

document.addEventListener('vistara:theme-change', () => {
  for (const chart of allChartInstances()) {
    applyThemeToChart(chart);
  }
});
