import { config } from '../config.mjs';

function normalizeOrigin(value = '') {
  try {
    const url = new URL(String(value));
    return url.origin;
  } catch {
    return '';
  }
}

function buildConnectSrcList() {
  const sources = new Set(["'self'"]);
  const apiOrigin = normalizeOrigin(config.apiBaseUrl);
  if (apiOrigin) {
    sources.add(apiOrigin);
  }
  (config.allowedOrigins || []).forEach((origin) => {
    const normalized = normalizeOrigin(origin);
    if (normalized) {
      sources.add(normalized);
    }
  });
  (config.cspConnectSrc || []).forEach((origin) => {
    const normalized = normalizeOrigin(origin);
    if (normalized) {
      sources.add(normalized);
    }
  });
  return Array.from(sources);
}

function buildContentSecurityPolicy() {
  const connectSrc = buildConnectSrcList();
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    "form-action 'self'",
  ].join('; ');
}

const SECURITY_HEADERS = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

export function getSecurityHeaders() {
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Security-Policy': buildContentSecurityPolicy(),
  };
  if (config.isProduction) {
    headers['Strict-Transport-Security'] = 'max-age=15552000; includeSubDomains';
  }
  return headers;
}

export function applySecurityHeaders(res) {
  const headers = getSecurityHeaders();
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
}
