function buildContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    // Runtime API base can be injected client-side, so connect-src cannot be locked to self only.
    "connect-src 'self' http: https: ws: wss:",
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
  return {
    ...SECURITY_HEADERS,
    'Content-Security-Policy': buildContentSecurityPolicy(),
  };
}

export function applySecurityHeaders(res) {
  const headers = getSecurityHeaders();
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
}
