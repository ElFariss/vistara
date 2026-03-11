import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_GRID_COLS,
  DASHBOARD_GRID_ROWS,
  layoutsIntersect,
  normalizeDashboardLayout,
  packDashboardLayout,
  suggestDashboardLayout,
} from '../public/dashboard-layout.js';

test('normalizeDashboardLayout clamps values into the supported grid', () => {
  const layout = normalizeDashboardLayout({
    x: 99,
    y: 99,
    w: 30,
    h: 20,
    minW: 99,
    minH: 99,
    page: 0,
  }, {
    page: 1,
    kind: 'chart',
  });

  assert.deepEqual(layout, {
    x: 0,
    y: 0,
    w: DASHBOARD_GRID_COLS,
    h: DASHBOARD_GRID_ROWS,
    minW: DASHBOARD_GRID_COLS,
    minH: DASHBOARD_GRID_ROWS,
    page: 1,
  });
});

test('packDashboardLayout preserves explicit non-colliding layouts', () => {
  const widgets = packDashboardLayout([
    { id: 'metric', kind: 'metric', layout: { x: 0, y: 0, w: 4, h: 2, page: 1 } },
    { id: 'chart', kind: 'chart', layout: { x: 4, y: 0, w: 8, h: 4, page: 1 } },
  ]);

  assert.equal(widgets[0].layout.x, 0);
  assert.equal(widgets[1].layout.x, 4);
  assert.equal(layoutsIntersect(widgets[0].layout, widgets[1].layout), false);
});

test('packDashboardLayout compacts explicit widgets upward to remove top dead space', () => {
  const widgets = packDashboardLayout([
    { id: 'trend', kind: 'chart', layout: { x: 0, y: 4, w: 8, h: 4, page: 2 } },
    { id: 'table', kind: 'table', layout: { x: 8, y: 4, w: 8, h: 4, page: 2 } },
  ]);

  assert.equal(widgets[0].layout.page, 2);
  assert.equal(widgets[1].layout.page, 2);
  assert.equal(widgets[0].layout.y, 0);
  assert.equal(widgets[1].layout.y, 0);
});

test('packDashboardLayout repairs colliding explicit layouts', () => {
  const widgets = packDashboardLayout([
    { id: 'metric', kind: 'metric', layout: { x: 0, y: 0, w: 4, h: 2, page: 1 } },
    { id: 'chart', kind: 'chart', layout: { x: 0, y: 0, w: 8, h: 4, page: 1 } },
  ]);

  assert.equal(layoutsIntersect(widgets[0].layout, widgets[1].layout), false);
});

test('packDashboardLayout preserves authored dimensions while repairing collisions', () => {
  const widgets = packDashboardLayout([
    { id: 'a', kind: 'chart', layout: { x: 0, y: 0, w: 6, h: 5, minW: 4, minH: 3, page: 1 } },
    { id: 'b', kind: 'chart', layout: { x: 0, y: 0, w: 6, h: 5, minW: 4, minH: 3, page: 1 } },
  ]);

  assert.equal(layoutsIntersect(widgets[0].layout, widgets[1].layout), false);
  assert.deepEqual(
    {
      w: widgets[1].layout.w,
      h: widgets[1].layout.h,
      minW: widgets[1].layout.minW,
      minH: widgets[1].layout.minH,
    },
    { w: 6, h: 5, minW: 4, minH: 3 },
  );
});

test('packDashboardLayout moves overflow widgets to the next page', () => {
  const widgets = packDashboardLayout([
    { id: 'a', kind: 'chart', layout: { x: 0, y: 0, w: 8, h: 4, page: 1 } },
    { id: 'b', kind: 'chart', layout: { x: 8, y: 0, w: 8, h: 4, page: 1 } },
    { id: 'c', kind: 'chart', layout: { x: 0, y: 4, w: 8, h: 4, page: 1 } },
    { id: 'd', kind: 'chart', layout: { x: 8, y: 4, w: 8, h: 4, page: 1 } },
    { id: 'e', kind: 'chart' },
  ]);

  assert.equal(widgets.at(-1)?.layout.page, 2);
});

test('suggestDashboardLayout scans sparse later pages instead of overlapping at origin', () => {
  const suggested = suggestDashboardLayout([
    { id: 'a', kind: 'chart', layout: { x: 0, y: 0, w: 8, h: 4, page: 10 } },
    { id: 'b', kind: 'chart', layout: { x: 8, y: 0, w: 8, h: 4, page: 10 } },
  ], 'chart', 10);

  assert.equal(suggested.page, 10);
  assert.equal(suggested.x, 0);
  assert.equal(suggested.y, 4);
});

test('packDashboardLayout keeps implicit widgets on the authored later-page context', () => {
  const widgets = packDashboardLayout([
    { id: 'a', kind: 'chart', layout: { x: 0, y: 0, w: 8, h: 4, page: 6 } },
    { id: 'b', kind: 'chart' },
  ]);

  assert.equal(widgets[0].layout.page, 6);
  assert.equal(widgets[1].layout.page, 6);
  assert.equal(layoutsIntersect(widgets[0].layout, widgets[1].layout), false);
});
