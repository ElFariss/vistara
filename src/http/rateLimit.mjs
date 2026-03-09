const WINDOW_MS = 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = WINDOW_MS;
const buckets = new Map();
let lastSweepAt = 0;

export function isRateLimitExemptPath(pathname = '') {
  return pathname === '/api/health';
}

function sweepExpiredBuckets(now, windowMs) {
  if (lastSweepAt !== 0 && now - lastSweepAt < DEFAULT_SWEEP_INTERVAL_MS) {
    return;
  }
  lastSweepAt = now;

  for (const [key, bucket] of buckets.entries()) {
    if (!bucket || now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }
}

export function resetRateLimiterState() {
  buckets.clear();
  lastSweepAt = 0;
}

export function createRateLimiter(limitPerMinute, { windowMs = WINDOW_MS, now = () => Date.now() } = {}) {
  return function rateLimit(key) {
    const currentTime = now();
    sweepExpiredBuckets(currentTime, windowMs);
    const existing = buckets.get(key);

    if (!existing || currentTime - existing.windowStart >= windowMs) {
      buckets.set(key, { windowStart: currentTime, count: 1 });
      return { allowed: true, remaining: limitPerMinute - 1 };
    }

    existing.count += 1;
    if (existing.count > limitPerMinute) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil((windowMs - (currentTime - existing.windowStart)) / 1000),
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limitPerMinute - existing.count),
    };
  };
}
