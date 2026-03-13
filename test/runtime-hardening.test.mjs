import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDatabaseError } from '../src/db.mjs';
import { resolveRateLimitPolicy, shouldRateLimitPath } from '../src/http/rateLimit.mjs';
import { getSecurityHeaders } from '../src/http/securityHeaders.mjs';

test('shouldRateLimitPath bypasses only the health endpoint', () => {
  assert.equal(shouldRateLimitPath('/api/health'), false);
  assert.equal(shouldRateLimitPath('/api/chat'), true);
  assert.equal(shouldRateLimitPath('/api/auth/demo'), true);
  assert.equal(shouldRateLimitPath(''), true);
});

test('resolveRateLimitPolicy applies a dedicated stricter bucket to demo auth', () => {
  assert.deepEqual(
    resolveRateLimitPolicy('/api/auth/demo', {
      defaultLimitPerMinute: 120,
      demoAuthLimitPerMinute: 5,
    }),
    {
      enabled: true,
      scope: 'auth-demo',
      limitPerMinute: 5,
    },
  );

  assert.deepEqual(
    resolveRateLimitPolicy('/api/chat', {
      defaultLimitPerMinute: 120,
      demoAuthLimitPerMinute: 5,
    }),
    {
      enabled: true,
      scope: '/api/chat',
      limitPerMinute: 120,
    },
  );
});

test('getSecurityHeaders returns hardening headers safe for the app shell', () => {
  const headers = getSecurityHeaders();

  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
});

test('normalizeDatabaseError maps Postgres contention failures to a structured 503 error', () => {
  const busyError = Object.assign(new Error('database is locked'), {
    code: '55P03',
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
