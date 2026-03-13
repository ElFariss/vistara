import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeDatabase, get } from '../src/db.mjs';

await initializeDatabase();

test('database schema initializes core tables', async () => {
  const row = await get(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'tenants'
      LIMIT 1
    `,
  );
  assert.equal(row?.table_name, 'tenants');
});
