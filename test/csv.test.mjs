import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsvBuffer } from '../src/utils/csv.mjs';

test('CSV parser recovers wrapped quoted rows like test.csv', () => {
  const buffer = fs.readFileSync('./test.csv');
  const parsed = parseCsvBuffer(buffer);

  assert.equal(parsed.columns[0], 'no');
  assert.equal(parsed.columns.length, 6);
  assert.ok(parsed.rows.length > 100);

  const first = parsed.rows[0];
  assert.equal(first.no, '1');
  assert.equal(first.tanggal, '01-01-2024');
  assert.equal(first.merk, 'Oppo');
  assert.equal(first.type, 'A18');
  assert.equal(first.Harga, '1498000');
});
