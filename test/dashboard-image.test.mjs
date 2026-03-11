import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboardSvg } from '../src/services/dashboardImage.mjs';

function barWidget() {
  return {
    id: 'chart-1',
    title: 'Produk Terlaris',
    artifact: {
      kind: 'chart',
      chart_type: 'bar',
      title: 'Produk Terlaris',
      labels: ['Infinix Note 40', 'Samsung A15', 'Redmi 13C'],
      series: [
        {
          name: 'Omzet',
          values: [5400000, 4200000, 3600000],
        },
      ],
    },
    layout: {
      x: 0,
      y: 0,
      w: 8,
      h: 4,
      page: 1,
    },
  };
}

test('renderDashboardSvg keeps every visible bar label in export output', () => {
  const svg = renderDashboardSvg({
    title: 'Export Dashboard',
    page: 1,
    widgets: [barWidget()],
  });

  assert.match(svg, /Infinix Note 40/);
  assert.match(svg, /Samsung A15/);
  assert.match(svg, /Redmi 13C/);
});

test('renderDashboardSvg preserves multiple chart series in export output', () => {
  const svg = renderDashboardSvg({
    title: 'Export Dashboard',
    page: 1,
    widgets: [
      {
        id: 'chart-2',
        title: 'Perbandingan Omzet',
        artifact: {
          kind: 'chart',
          chart_type: 'line',
          title: 'Perbandingan Omzet',
          labels: ['Sen', 'Sel', 'Rab'],
          series: [
            { name: 'Omzet 2025', values: [10, 12, 14] },
            { name: 'Omzet 2026', values: [11, 13, 16] },
          ],
        },
        layout: {
          x: 0,
          y: 0,
          w: 8,
          h: 4,
          page: 1,
        },
      },
    ],
  });

  assert.match(svg, /Omzet 2025/);
  assert.match(svg, /Omzet 2026/);
});
