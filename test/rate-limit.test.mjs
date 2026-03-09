import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRateLimiter,
  isRateLimitExemptPath,
  resetRateLimiterState,
} from '../src/http/rateLimit.mjs';

test('isRateLimitExemptPath exempts only the health endpoint', () => {
  assert.equal(isRateLimitExemptPath('/api/health'), true);
  assert.equal(isRateLimitExemptPath('/api/chat'), false);
});

test('createRateLimiter blocks after the configured limit within one window', () => {
  resetRateLimiterState();
  let currentTime = 0;
  const limit = createRateLimiter(2, {
    windowMs: 1000,
    now: () => currentTime,
  });

  assert.deepEqual(limit('127.0.0.1:/api/chat'), {
    allowed: true,
    remaining: 1,
  });
  assert.deepEqual(limit('127.0.0.1:/api/chat'), {
    allowed: true,
    remaining: 0,
  });
  assert.deepEqual(limit('127.0.0.1:/api/chat'), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 1,
  });

  currentTime = 1001;
  assert.deepEqual(limit('127.0.0.1:/api/chat'), {
    allowed: true,
    remaining: 1,
  });
});

test('createRateLimiter evicts expired buckets during sweeps', () => {
  resetRateLimiterState();
  let currentTime = 0;
  const limit = createRateLimiter(1, {
    windowMs: 1000,
    now: () => currentTime,
  });

  limit('ip-a:/api/chat');
  currentTime = 1500;
  limit('ip-b:/api/chat');
  currentTime = 3000;

  assert.deepEqual(limit('ip-a:/api/chat'), {
    allowed: true,
    remaining: 0,
  });
});
