import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlexibleDate, parseIndonesianNumber } from '../src/utils/parse.mjs';

test('parseIndonesianNumber handles rupiah formats', () => {
  assert.equal(parseIndonesianNumber('Rp 50.000'), 50000);
  assert.equal(parseIndonesianNumber('50.000,50'), 50000.5);
  assert.equal(parseIndonesianNumber('1,250.75'), 1250.75);
  assert.equal(parseIndonesianNumber(''), null);
});

test('parseFlexibleDate handles Indonesian-style dates', () => {
  const first = parseFlexibleDate('01/03/2025');
  assert.ok(first instanceof Date);
  assert.equal(first.toISOString().startsWith('2025-03-01'), true);

  const second = parseFlexibleDate('2025-03-01T10:00:00Z');
  assert.ok(second instanceof Date);
  assert.equal(second.toISOString(), '2025-03-01T10:00:00.000Z');
});
