import { config } from '../config.mjs';

function isLoopbackOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function matchesAllowedOrigin(requestedOrigin, allowedOrigin) {
  const requested = String(requestedOrigin || '').trim();
  const allowed = String(allowedOrigin || '').trim();
  if (!requested || !allowed) {
    return false;
  }
  if (allowed === '*' || allowed === requested) {
    return true;
  }
  if (!allowed.includes('*')) {
    return false;
  }

  try {
    const requestedUrl = new URL(requested);
    const allowedUrl = new URL(allowed.replace('*.', 'placeholder.'));
    if (requestedUrl.protocol !== allowedUrl.protocol) {
      return false;
    }
    if (requestedUrl.port !== allowedUrl.port) {
      return false;
    }
    const [, suffix = ''] = allowedUrl.hostname.split('placeholder.');
    return Boolean(suffix) && requestedUrl.hostname.endsWith(`.${suffix}`);
  } catch {
    return false;
  }
}

export function resolveAllowedOrigin(origin, options = {}) {
  const requestedOrigin = String(origin || '').trim();
  if (!requestedOrigin) {
    return null;
  }

  const isProduction = options.isProduction ?? config.isProduction;
  const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : config.allowedOrigins;

  if (allowedOrigins.some((allowedOrigin) => matchesAllowedOrigin(requestedOrigin, allowedOrigin))) {
    return requestedOrigin;
  }

  if (!isProduction && allowedOrigins.length === 0) {
    return isLoopbackOrigin(requestedOrigin) ? requestedOrigin : null;
  }

  return null;
}
