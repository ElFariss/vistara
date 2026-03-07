import test from 'node:test';
import assert from 'node:assert/strict';
import { db, get, run } from '../src/db.mjs';

test('database helpers ignore extra named parameters that are not in SQL', () => {
  db.exec('CREATE TEMP TABLE IF NOT EXISTS temp_param_guard (id INTEGER NOT NULL)');
  db.exec('DELETE FROM temp_param_guard');

  run(
    `
      INSERT INTO temp_param_guard (id)
      VALUES (:id)
    `,
    { id: 7, limit: 999, unused: 'ignored' },
  );

  const row = get(
    `
      SELECT id
      FROM temp_param_guard
      WHERE id = :id
    `,
    { id: 7, extra_param: true },
  );

  assert.equal(row?.id, 7);
});
