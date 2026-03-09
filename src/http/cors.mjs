import { config } from '../config.mjs';

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
    return requestedOrigin;
  }

  return null;
}
