import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonText } from '../src/utils/json.mjs';

test('JSON parser normalizes arrays of objects', () => {
  const parsed = parseJsonText(
    JSON.stringify([
      { product: 'A', revenue: 1000 },
      { product: 'B', revenue: 2000 },
    ]),
  );

  assert.deepEqual(parsed.columns.sort(), ['product', 'revenue']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].product, 'A');
});

test('JSON parser flattens nested object payloads', () => {
  const parsed = parseJsonText(
    JSON.stringify({
      summary: { period: 'minggu ini' },
      items: [{ name: 'x', metrics: { revenue: 10 } }],
    }),
  );

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]['metrics.revenue'], '10');
});
