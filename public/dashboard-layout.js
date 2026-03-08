export const DASHBOARD_GRID_COLS = 16;
export const DASHBOARD_GRID_ROWS = 9;

const KIND_LAYOUTS = {
  metric: { w: 4, h: 2, minW: 3, minH: 2 },
  chart: { w: 8, h: 4, minW: 5, minH: 3 },
  table: { w: 8, h: 4, minW: 5, minH: 3 },
  text: { w: 8, h: 4, minW: 4, minH: 3 },
  placeholder: { w: 8, h: 4, minW: 4, minH: 3 },
};

function normalizedKind(value = 'chart') {
  const text = String(value || '').toLowerCase().trim();
  if (text === 'metric') {
    return 'metric';
  }
  if (text === 'table' || text === 'toplist') {
    return 'table';
  }
  if (text === 'text') {
    return 'text';
  }
  if (text === 'placeholder') {
    return 'placeholder';
  }
  return 'chart';
}

export function inferDashboardWidgetKind(widget = {}) {
  if (widget?.artifact?.kind) {
    return normalizedKind(widget.artifact.kind);
  }

  const type = String(widget?.type || '').toLowerCase();
  if (type === 'metriccard') {
    return 'metric';
  }
  if (type === 'toplist') {
    return 'table';
  }
  if (type === 'trendchart') {
    return 'chart';
  }

  return normalizedKind(widget?.kind);
}

export function baseDashboardLayout(kind = 'chart') {
  const resolvedKind = normalizedKind(kind);
  return {
    ...KIND_LAYOUTS[resolvedKind],
  };
}

export function normalizeDashboardLayout(layout = {}, options = {}) {
  const fallbackPage = Math.max(1, Number(options.page || layout.page || 1));
  const base = {
    ...baseDashboardLayout(options.kind),
    ...layout,
  };

  const w = Math.max(1, Math.min(Number(base.w || 1), DASHBOARD_GRID_COLS));
  const h = Math.max(1, Math.min(Number(base.h || 1), DASHBOARD_GRID_ROWS));
  const x = Math.max(0, Math.min(Number(base.x || 0), DASHBOARD_GRID_COLS - w));
  const y = Math.max(0, Math.min(Number(base.y || 0), DASHBOARD_GRID_ROWS - h));
  const minW = Math.max(1, Math.min(Number(base.minW || 1), w));
  const minH = Math.max(1, Math.min(Number(base.minH || 1), h));

  return {
    x,
    y,
    w,
    h,
    page: fallbackPage,
    minW,
    minH,
  };
}

export function layoutsIntersect(a, b) {
  if ((a.page || 1) !== (b.page || 1)) {
    return false;
  }

  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function findOpenSlot(occupiedLayouts, layoutTemplate, preferredPage = 1) {
  const startPage = Math.max(1, Number(preferredPage || layoutTemplate?.page || 1));
  const lastOccupiedPage = occupiedLayouts.reduce((max, entry) => (
    Math.max(max, Number(entry?.page || 1))
  ), startPage);

  for (let page = startPage; page <= lastOccupiedPage + 1; page += 1) {
    for (let y = 0; y <= Math.max(0, DASHBOARD_GRID_ROWS - layoutTemplate.h); y += 1) {
      for (let x = 0; x <= Math.max(0, DASHBOARD_GRID_COLS - layoutTemplate.w); x += 1) {
        const candidate = normalizeDashboardLayout({
          ...layoutTemplate,
          x,
          y,
          page,
        });
        if (!occupiedLayouts.some((entry) => layoutsIntersect(candidate, entry))) {
          return candidate;
        }
      }
    }
  }

  return normalizeDashboardLayout({
    ...layoutTemplate,
    x: 0,
    y: 0,
    page: lastOccupiedPage + 1,
  });
}

export function suggestDashboardLayout(existingWidgets = [], kind = 'chart', preferredPage = 1) {
  const occupiedLayouts = existingWidgets
    .map((widget) => widget?.layout)
    .filter(Boolean)
    .map((layout) => normalizeDashboardLayout(layout));

  return findOpenSlot(
    occupiedLayouts,
    normalizeDashboardLayout(baseDashboardLayout(kind), {
      kind,
      page: preferredPage,
    }),
    preferredPage,
  );
}

export function packDashboardLayout(items = []) {
  const occupiedLayouts = [];

  return items.map((item) => {
    const kind = inferDashboardWidgetKind(item);
    const explicitLayout = item?.layout
      ? normalizeDashboardLayout(item.layout, {
          kind,
          page: Number(item.layout.page || 1),
        })
      : null;

    if (explicitLayout && !occupiedLayouts.some((entry) => layoutsIntersect(explicitLayout, entry))) {
      occupiedLayouts.push(explicitLayout);
      return {
        ...item,
        layout: explicitLayout,
      };
    }

    const preferredPage = explicitLayout
      ? explicitLayout.page
      : Number(item?.page || item?.layout?.page || occupiedLayouts.at(-1)?.page || 1);
    const layoutTemplate = explicitLayout || normalizeDashboardLayout(baseDashboardLayout(kind), {
      kind,
      page: preferredPage,
    });
    const packed = findOpenSlot(
      occupiedLayouts,
      layoutTemplate,
      preferredPage,
    );
    occupiedLayouts.push(packed);
    return {
      ...item,
      layout: packed,
    };
  });
}
