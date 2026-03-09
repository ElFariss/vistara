import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDatabaseError } from '../src/db.mjs';
import { shouldRateLimitPath } from '../src/http/rateLimit.mjs';

test('shouldRateLimitPath bypasses only the health endpoint', () => {
  assert.equal(shouldRateLimitPath('/api/health'), false);
  assert.equal(shouldRateLimitPath('/api/chat'), true);
  assert.equal(shouldRateLimitPath('/api/auth/demo'), true);
  assert.equal(shouldRateLimitPath(''), true);
});

test('normalizeDatabaseError maps SQLite busy failures to a structured 503 error', () => {
  const busyError = Object.assign(new Error('database is locked'), {
    code: 'ERR_SQLITE_ERROR',
  });

  const normalized = normalizeDatabaseError(busyError);
  assert.notEqual(normalized, busyError);
  assert.equal(normalized.code, 'DATABASE_BUSY');
  assert.equal(normalized.statusCode, 503);
  assert.equal(normalized.publicMessage, 'Database sedang sibuk. Coba lagi sebentar.');
  assert.equal(normalized.cause, busyError);

  const otherError = new Error('some_other_failure');
  assert.equal(normalizeDatabaseError(otherError), otherError);
});
