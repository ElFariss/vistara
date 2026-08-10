# Security Analysis Report

Date: 2026-03-10
Scope: `/home/parasite/Work/umkm`

## Methods

- Manual review of auth, transport, runtime, and error-handling paths
- Dependency scan with `npm audit --json`
- Targeted grep for secrets, auth, rate limiting, and raw exception leakage

## Findings

1. High: OTP verification has no brute-force protection.
   - Files: `src/routes/auth.mjs`, `src/http/rateLimit.mjs`
   - Detail: `/api/auth/otp/verify` accepts unlimited wrong-code retries while the OTP remains valid. The current rate limit is only per `IP:path`, so distributed guessing still works and wrong attempts do not invalidate the code.
   - Impact: 6-digit OTPs can be brute-forced during the validity window.

2. High: Python agent is unauthenticated by default and binds to `0.0.0.0`.
   - File: `tools/python-agent/server.py`
   - Detail: `TOKEN` defaults to empty, `_authorized()` returns `True` when it is unset, and the server listens on all interfaces by default.
   - Impact: if this sidecar is deployed outside an isolated private network, it exposes remote code execution without authentication.

3. Medium: Rate limiting trusts `X-Forwarded-For` from any client.
   - Files: `src/http/request.mjs`, `src/server.mjs`
   - Detail: `getClientIp()` always prefers `x-forwarded-for`, with no trusted-proxy gate.
   - Impact: a client can spoof IPs and bypass request throttling and audit attribution.

4. Medium: Gemini API key is sent in the request URL query string.
   - File: `src/services/gemini.mjs`
   - Detail: requests use `...?key=${config.geminiApiKey}` instead of `x-goog-api-key`.
   - Impact: API keys are more likely to leak into proxy logs, traces, and upstream diagnostics.

5. Medium: Multiple routes leak raw internal exception messages to clients.
   - Files: `src/routes/auth.mjs`, `src/routes/chat.mjs`, `src/routes/data.mjs`, `src/routes/goals.mjs`
   - Detail: several handlers return `error.message` directly in public API responses.
   - Impact: storage paths, parser internals, and runtime details can leak to untrusted clients.

6. Configuration risk: CORS fails open when `ALLOWED_ORIGINS` is empty.
   - File: `src/server.mjs`
   - Detail: the server reflects any `Origin` when the env var is unset.
   - Impact: browser-based access is allowed from arbitrary origins by default.

## Dependency Scan

- `npm audit --json`: no known prod dependency vulnerabilities at scan time.
