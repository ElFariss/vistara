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

export function resolveAllowedOrigin(origin, options = {}) {
  const requestedOrigin = String(origin || '').trim();
  if (!requestedOrigin) {
    return null;
  }

  const isProduction = options.isProduction ?? config.isProduction;
  const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : config.allowedOrigins;

  if (allowedOrigins.includes(requestedOrigin)) {
    return requestedOrigin;
  }

  if (!isProduction && allowedOrigins.length === 0) {
    return isLoopbackOrigin(requestedOrigin) ? requestedOrigin : null;
  }

  return null;
}
