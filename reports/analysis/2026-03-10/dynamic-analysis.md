# Dynamic Analysis Report

## Runtime checks run
- `npm test` passes on the current branch baseline.
- Live benchmark smoke on local server:
  - `/api/health`: avg `0.47ms`, p95 `0.69ms`
  - `/`: avg `0.32ms`, p95 `0.59ms`

## Actionable findings
1. Rate-limit behavior can be bypassed dynamically by spoofing `X-Forwarded-For`.
   - Files: `src/http/request.mjs`, `src/server.mjs`
   - Reproduction: with `RATE_LIMIT_PER_MINUTE=2`, same-client requests hit `429`, but requests with rotating spoofed `X-Forwarded-For` values still returned `200`.

2. Browser CORS behavior is permissive by default when `ALLOWED_ORIGINS` is unset.
   - File: `src/server.mjs`
   - Reproduction: `Origin: https://evil.example` was echoed as `Access-Control-Allow-Origin` with an empty allowlist.
