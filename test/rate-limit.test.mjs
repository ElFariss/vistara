import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, shouldRateLimitPath } from '../src/http/rateLimit.mjs';

test('shouldRateLimitPath bypasses health checks only', () => {
  assert.equal(shouldRateLimitPath('/api/health'), false);
  assert.equal(shouldRateLimitPath('/api/chat'), true);
  assert.equal(shouldRateLimitPath('/'), true);
});

test('createRateLimiter still throttles normal API paths', () => {
  const limiter = createRateLimiter(2);
  assert.deepEqual(limiter('client:/api/chat'), { allowed: true, remaining: 1 });
  assert.deepEqual(limiter('client:/api/chat'), { allowed: true, remaining: 0 });

  const blocked = limiter('client:/api/chat');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds >= 1);
});
