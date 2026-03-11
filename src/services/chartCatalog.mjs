export const CHART_CATALOG = [
  { id: 'metric', label: 'Metric', kind: 'metric', requires: ['measure'], category: 'kpi' },
  { id: 'table', label: 'Table', kind: 'table', requires: ['columns'], category: 'detail' },
  { id: 'bar', label: 'Bar Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'comparison' },
  { id: 'pie', label: 'Pie Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'composition' },
  { id: 'donut', label: 'Donut Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'composition' },
  { id: 'half_donut', label: 'Half Donut Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'composition' },
  { id: 'multi_layer_pie', label: 'Multi-Layer Pie Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'composition' },
  { id: 'line', label: 'Line Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'trend' },
  { id: 'scatter', label: 'Scatter Plot', kind: 'chart', requires: ['dimension', 'measure'], category: 'relationship' },
  { id: 'bubble', label: 'Bubble Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'relationship' },
  { id: 'cone', label: 'Cone Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'comparison' },
  { id: 'pyramid', label: 'Pyramid Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'comparison' },
  { id: 'funnel', label: 'Funnel Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'conversion' },
  { id: 'radar_triangle', label: 'Radar Triangle', kind: 'chart', requires: ['dimension', 'measure'], category: 'comparison' },
  { id: 'radar_polygon', label: 'Radar Polygon', kind: 'chart', requires: ['dimension', 'measure'], category: 'comparison' },
  { id: 'polar', label: 'Polar Graph', kind: 'chart', requires: ['dimension', 'measure'], category: 'comparison' },
  { id: 'area', label: 'Area Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'trend' },
  { id: 'tree', label: 'Tree Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'hierarchy' },
  { id: 'flowchart', label: 'Flowchart', kind: 'chart', requires: ['dimension', 'measure'], category: 'process' },
  { id: 'map', label: 'Geographic Map', kind: 'chart', requires: ['dimension', 'measure'], category: 'geo' },
  { id: 'icon_array', label: 'Icon Array', kind: 'chart', requires: ['dimension', 'measure'], category: 'composition' },
  { id: 'percentage_bar', label: 'Percentage Bar', kind: 'chart', requires: ['measure'], category: 'kpi' },
  { id: 'gauge', label: 'Gauge', kind: 'chart', requires: ['measure'], category: 'kpi' },
  { id: 'radial_wheel', label: 'Radial Wheel', kind: 'chart', requires: ['measure'], category: 'kpi' },
  { id: 'concentric_circles', label: 'Concentric Circles', kind: 'chart', requires: ['measure'], category: 'kpi' },
  { id: 'gantt', label: 'Gantt Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'timeline' },
  { id: 'circuit', label: 'Circuit Diagram', kind: 'chart', requires: ['dimension', 'measure'], category: 'process' },
  { id: 'timeline', label: 'Timeline', kind: 'chart', requires: ['dimension', 'measure'], category: 'timeline' },
  { id: 'venn', label: 'Venn Diagram', kind: 'chart', requires: ['dimension', 'measure'], category: 'relationship' },
  { id: 'histogram', label: 'Histogram', kind: 'chart', requires: ['measure'], category: 'distribution' },
  { id: 'mind_map', label: 'Mind Map', kind: 'chart', requires: ['dimension', 'measure'], category: 'hierarchy' },
  { id: 'dichotomous_key', label: 'Dichotomous Key', kind: 'chart', requires: ['dimension', 'measure'], category: 'process' },
  { id: 'pert', label: 'Pert Chart', kind: 'chart', requires: ['dimension', 'measure'], category: 'process' },
  { id: 'choropleth', label: 'Choropleth Map', kind: 'chart', requires: ['dimension', 'measure'], category: 'geo' },
];

export const VISUALIZATION_IDS = CHART_CATALOG.map((entry) => entry.id);

export const SINGLE_VALUE_VISUALS = new Set(['metric', 'gauge', 'percentage_bar', 'radial_wheel', 'concentric_circles']);

export function chartDefinition(id) {
  const normalized = String(id || '').toLowerCase();
  return CHART_CATALOG.find((entry) => entry.id === normalized) || null;
}

export function isChartVisualization(id) {
  const def = chartDefinition(id);
  return def?.kind === 'chart';
}

export function isMetricVisualization(id) {
  const def = chartDefinition(id);
  return def?.kind === 'metric';
}

export function isTableVisualization(id) {
  const def = chartDefinition(id);
  return def?.kind === 'table';
}
