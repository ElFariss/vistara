import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.mjs';

test('sqlite busy timeout is configured for runtime contention', () => {
  const pragma = db.prepare('PRAGMA busy_timeout').get();
  assert.ok(Number(pragma?.timeout) >= 5000);
});
