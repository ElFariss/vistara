import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeChartArtifactForExport } from '../public/exportSummary.js';

test('summarizeChartArtifactForExport builds numeric summaries for line charts', () => {
  const lines = summarizeChartArtifactForExport({
    chart_type: 'line',
    labels: ['Jan', 'Feb', 'Mar'],
    series: [
      {
        name: 'Omzet',
        values: [1200000, 1800000, 2250000],
      },
    ],
  });

  assert.equal(lines.length, 3);
  assert.match(lines[0], /Rp/i);
  assert.match(lines[1], /Mar/i);
  assert.match(lines[2], /Puncak/i);
});

test('summarizeChartArtifactForExport builds numeric summaries for bar charts', () => {
  const lines = summarizeChartArtifactForExport({
    chart_type: 'bar',
    labels: ['Jakarta', 'Bandung', 'Surabaya'],
    series: [
      {
        name: 'Omzet Cabang',
        values: [2500000, 4100000, 3000000],
      },
    ],
  });

  assert.equal(lines.length, 2);
  assert.match(lines[0], /Puncak/i);
  assert.match(lines[1], /Bandung/i);
});
