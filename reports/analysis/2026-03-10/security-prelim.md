# Security Preliminary Findings

## Confirmed locally

1. High: Rate limiting trusts `X-Forwarded-For` from any client, so an attacker can rotate that header and bypass request throttling entirely. Reproduced with `RATE_LIMIT_PER_MINUTE=2`: the third request from one client returned `429`, while subsequent requests with spoofed `X-Forwarded-For` values still returned `200`.
   - File: `src/http/request.mjs`
   - Impact: brute-force and abuse controls are bypassable unless a trusted proxy overwrites the header.

2. Medium: CORS fails open when `ALLOWED_ORIGINS` is unset. Reproduced locally: a request with `Origin: https://evil.example` received `Access-Control-Allow-Origin: https://evil.example`.
   - File: `src/server.mjs`
   - Impact: any origin is allowed to call the API from a browser when the env var is missing.

3. Medium: Several routes return raw exception messages to clients.
   - Files: `src/routes/auth.mjs`, `src/routes/data.mjs`, `src/routes/chat.mjs`
   - Impact: backend/storage/parser details can leak through user-visible errors.

4. Local secret exposure risk: the workspace contains a non-example `.env` with a live `GEMINI_API_KEY`.
   - File: `.env` (local workspace file)
   - Impact: accidental commit or shell/log leakage risk; rotate if this key was ever shared.

## Dependency check
- `npm audit --omit=dev --json`: no known prod dependency vulnerabilities.
