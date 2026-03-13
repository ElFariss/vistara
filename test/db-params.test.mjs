import test from 'node:test';
import assert from 'node:assert/strict';
import { get, run, initializeDatabase } from '../src/db.mjs';

await initializeDatabase();

test('database helpers ignore extra named parameters that are not in SQL', async () => {
  await run('CREATE TABLE IF NOT EXISTS param_guard (id INTEGER NOT NULL)');
  await run('DELETE FROM param_guard');

  try {
    await run(
      `
        INSERT INTO param_guard (id)
        VALUES (:id)
      `,
      { id: 7, limit: 999, unused: 'ignored' },
    );

    const row = await get(
      `
        SELECT id
        FROM param_guard
        WHERE id = :id
      `,
      { id: 7, extra_param: true },
    );

    assert.equal(row?.id, 7);
  } finally {
    await run('DROP TABLE IF EXISTS param_guard');
  }
});
