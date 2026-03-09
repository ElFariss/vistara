# Security Analysis

## Summary
No third-party dependency vulnerabilities were reported by `npm audit --omit=dev`, but request identity and deployment defaults expose avoidable security risk.

## Findings
1. `src/http/request.mjs` trusts `x-forwarded-for` from any client. Without an explicit trusted-proxy gate, attackers can spoof IPs and bypass the rate limiter.
2. `src/server.mjs` allows any origin when `ALLOWED_ORIGINS` is unset. In production this leaves CORS permissive by default instead of fail-closed.
3. `src/http/rateLimit.mjs` keys limits by `ip:path`, so the spoofable client IP also weakens abuse controls globally.

## Checks Run
- `npm audit --omit=dev --json` -> no known dependency CVEs
- Grep scan over tracked sources found no hardcoded production API keys or JWT secrets

## Coverage Gaps
- No tests around trusted-proxy behavior.
- No explicit production guard for empty `ALLOWED_ORIGINS`.
