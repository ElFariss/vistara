const WINDOW_MS = 60 * 1000;
const buckets = new Map();

export function shouldRateLimitPath(pathname = '') {
  return String(pathname || '').trim() !== '/api/health';
}

export function resolveRateLimitPolicy(
  pathname = '',
  { defaultLimitPerMinute = 120, demoAuthLimitPerMinute = 5 } = {},
) {
  const normalizedPath = String(pathname || '').trim();

  if (!shouldRateLimitPath(normalizedPath)) {
    return { enabled: false, scope: 'health', limitPerMinute: 0 };
  }

  if (normalizedPath === '/api/auth/demo') {
    return {
      enabled: true,
      scope: 'auth-demo',
      limitPerMinute: demoAuthLimitPerMinute,
    };
  }

  return {
    enabled: true,
    scope: normalizedPath || 'default',
    limitPerMinute: defaultLimitPerMinute,
  };
}

export function createRateLimiter(limitPerMinute) {
  return function rateLimit(key) {
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || now - existing.windowStart >= WINDOW_MS) {
      buckets.set(key, { windowStart: now, count: 1 });
      return { allowed: true, remaining: limitPerMinute - 1 };
    }

    existing.count += 1;
    if (existing.count > limitPerMinute) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil((WINDOW_MS - (now - existing.windowStart)) / 1000),
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limitPerMinute - existing.count),
    };
  };
}
