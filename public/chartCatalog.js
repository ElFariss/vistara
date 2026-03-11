const ICON_WRAP = (content) => `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    ${content}
  </svg>
`;

const ICONS = {
  metric: ICON_WRAP('<rect x="4" y="6" width="16" height="12" rx="3"></rect><path d="M7 12h10"></path>'),
  table: ICON_WRAP('<rect x="4" y="6" width="16" height="12" rx="2"></rect><path d="M4 11h16M9 6v12M15 6v12"></path>'),
  bar: ICON_WRAP('<rect x="5" y="11" width="3" height="7" rx="1"></rect><rect x="10.5" y="8" width="3" height="10" rx="1"></rect><rect x="16" y="5" width="3" height="13" rx="1"></rect>'),
  pie: ICON_WRAP('<circle cx="12" cy="12" r="7"></circle><path d="M12 5v7l5.5 4"></path>'),
  donut: ICON_WRAP('<circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 5v7l5.5 4"></path>'),
  half_donut: ICON_WRAP('<path d="M5 12a7 7 0 0 1 14 0"></path><path d="M9 12a3 3 0 0 1 6 0"></path>'),
  multi_layer_pie: ICON_WRAP('<circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="1.8"></circle>'),
  line: ICON_WRAP('<path d="M4 16l5-5 4 3 6-7"></path><circle cx="9" cy="11" r="1"></circle><circle cx="13" cy="14" r="1"></circle><circle cx="19" cy="7" r="1"></circle>'),
  scatter: ICON_WRAP('<circle cx="7" cy="15" r="1.4"></circle><circle cx="12" cy="9" r="1.4"></circle><circle cx="17" cy="13" r="1.4"></circle><circle cx="19" cy="6" r="1.4"></circle>'),
  bubble: ICON_WRAP('<circle cx="7" cy="15" r="2.2"></circle><circle cx="14" cy="9" r="3"></circle><circle cx="18" cy="15" r="1.6"></circle>'),
  cone: ICON_WRAP('<path d="M6 18l4-12 4 12H6z"></path><path d="M14 18l4-10 3 10h-7z"></path>'),
  pyramid: ICON_WRAP('<path d="M6 18h12l-2-4H8l-2 4z"></path><path d="M9 14h6l-1.5-3h-3L9 14z"></path><path d="M11 11h2l-1-3-1 3z"></path>'),
  funnel: ICON_WRAP('<path d="M5 6h14l-4 6H9l-4-6z"></path><rect x="10" y="12" width="4" height="6" rx="1"></rect>'),
  radar_triangle: ICON_WRAP('<circle cx="12" cy="12" r="7"></circle><path d="M12 5l6 12H6l6-12z"></path>'),
  radar_polygon: ICON_WRAP('<circle cx="12" cy="12" r="7"></circle><path d="M12 5l5 3v6l-5 3-5-3V8l5-3z"></path>'),
  polar: ICON_WRAP('<circle cx="12" cy="12" r="7"></circle><path d="M12 5v14M5 12h14"></path>'),
  area: ICON_WRAP('<path d="M4 16l5-6 4 4 6-8v10H4z"></path>'),
  tree: ICON_WRAP('<rect x="5" y="6" width="6" height="6" rx="1"></rect><rect x="13" y="6" width="6" height="4" rx="1"></rect><rect x="13" y="12" width="6" height="6" rx="1"></rect>'),
  flowchart: ICON_WRAP('<rect x="4" y="5" width="7" height="4" rx="1"></rect><rect x="13" y="5" width="7" height="4" rx="1"></rect><rect x="8.5" y="15" width="7" height="4" rx="1"></rect><path d="M11 7h2M11.5 9v6"></path>'),
  map: ICON_WRAP('<path d="M4 7l5-2 6 2 5-2v12l-5 2-6-2-5 2V7z"></path><path d="M9 5v12M15 7v12"></path>'),
  icon_array: ICON_WRAP('<circle cx="7" cy="8" r="1.5"></circle><circle cx="12" cy="8" r="1.5"></circle><circle cx="17" cy="8" r="1.5"></circle><circle cx="7" cy="13" r="1.5"></circle><circle cx="12" cy="13" r="1.5"></circle><circle cx="17" cy="13" r="1.5"></circle>'),
  percentage_bar: ICON_WRAP('<rect x="4" y="10" width="16" height="4" rx="2"></rect><rect x="4" y="10" width="9" height="4" rx="2"></rect>'),
  gauge: ICON_WRAP('<path d="M5 15a7 7 0 0 1 14 0"></path><path d="M12 15l4-5"></path>'),
  radial_wheel: ICON_WRAP('<circle cx="12" cy="12" r="7"></circle><path d="M12 5v7l5 5"></path>'),
  concentric_circles: ICON_WRAP('<circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="2"></circle>'),
  gantt: ICON_WRAP('<rect x="5" y="7" width="9" height="3" rx="1"></rect><rect x="9" y="12" width="10" height="3" rx="1"></rect><rect x="7" y="17" width="6" height="3" rx="1"></rect>'),
  circuit: ICON_WRAP('<circle cx="6" cy="12" r="2"></circle><circle cx="18" cy="12" r="2"></circle><path d="M8 12h8M6 10V6h12v4"></path>'),
  timeline: ICON_WRAP('<path d="M6 4v16"></path><circle cx="6" cy="7" r="1.5"></circle><circle cx="6" cy="12" r="1.5"></circle><circle cx="6" cy="17" r="1.5"></circle><path d="M10 7h8M10 12h8M10 17h8"></path>'),
  venn: ICON_WRAP('<circle cx="9" cy="12" r="4"></circle><circle cx="15" cy="12" r="4"></circle>'),
  histogram: ICON_WRAP('<rect x="5" y="11" width="3" height="7" rx="1"></rect><rect x="10.5" y="8" width="3" height="10" rx="1"></rect><rect x="16" y="6" width="3" height="12" rx="1"></rect>'),
  mind_map: ICON_WRAP('<circle cx="12" cy="12" r="2"></circle><circle cx="5" cy="7" r="1.5"></circle><circle cx="19" cy="8" r="1.5"></circle><circle cx="7" cy="18" r="1.5"></circle><path d="M10.5 11L6.5 8M13.5 11l4-2M11 13l-3 4"></path>'),
  dichotomous_key: ICON_WRAP('<path d="M6 6v5"></path><path d="M6 11h6"></path><path d="M12 11v5"></path><path d="M12 16h6"></path><circle cx="6" cy="6" r="1"></circle><circle cx="12" cy="11" r="1"></circle><circle cx="12" cy="16" r="1"></circle>'),
  pert: ICON_WRAP('<circle cx="6" cy="12" r="2"></circle><circle cx="12" cy="6" r="2"></circle><circle cx="18" cy="12" r="2"></circle><path d="M8 12l2-4M14 8l2 4M8 12h8"></path>'),
  choropleth: ICON_WRAP('<rect x="4" y="6" width="6" height="6" rx="1"></rect><rect x="12" y="6" width="8" height="6" rx="1"></rect><rect x="4" y="14" width="8" height="6" rx="1"></rect><rect x="14" y="14" width="6" height="6" rx="1"></rect>'),
};

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
].map((entry) => ({
  ...entry,
  icon: ICONS[entry.id] || ICONS.bar,
}));

export const SINGLE_VALUE_VISUALS = new Set(['metric', 'gauge', 'percentage_bar', 'radial_wheel', 'concentric_circles']);

export function chartDefinition(id) {
  const normalized = String(id || '').toLowerCase().trim();
  return CHART_CATALOG.find((entry) => entry.id === normalized) || null;
}

export function chartIconSvg(id) {
  return chartDefinition(id)?.icon || ICONS.bar;
}
