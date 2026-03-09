# Audit Summary

Date: 2026-03-10

## Priority Order

1. Fix OTP brute-force exposure.
2. Lock down Python sidecar defaults.
3. Stop trusting spoofed `X-Forwarded-For` by default.
4. Sanitize public error responses.
5. Stop sending Gemini API key in the URL.

## Performance Snapshot

- `/api/health`: 60 requests, avg `22.65ms`, p95 `25ms`, max `25ms`
- `/api/auth/demo`: 5 sequential requests, `6.4s` to `7.5s`

## Recommendation

Remediate the security/runtime findings immediately on dedicated branches.
Track the architecture and maintainability items as a refactor stream rather than mixing them into the security patch set.
