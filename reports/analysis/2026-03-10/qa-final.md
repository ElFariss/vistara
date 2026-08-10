# QA Analysis Report

Date: 2026-03-10
Scope: `/home/parasite/Work/umkm`

## Test Status

- `npm test`: `77/77` passing
- `node --test test/chat-sessions.test.mjs`: `9/9` passing

## Coverage Strengths

- chat/session regression coverage
- dashboard agent runtime coverage
- data-quality repair/profile coverage
- token and request parsing regressions

## Coverage Gaps

1. Missing tests for OTP abuse resistance.
   - Files: `src/routes/auth.mjs`, `test/`
   - Risk: no regression coverage for wrong-attempt lockout, resend invalidation, or abuse throttling.

2. Missing tests for trusted-proxy behavior around rate limiting.
   - Files: `src/http/request.mjs`, `src/server.mjs`, `test/`
   - Risk: spoofed forwarding headers can change effective rate-limit identity with no guardrail in tests.

3. Missing tests for public error sanitization.
   - Files: `src/routes/auth.mjs`, `src/routes/chat.mjs`, `src/routes/data.mjs`, `src/routes/goals.mjs`
   - Risk: future route changes can reintroduce leaked internal error messages without failing CI.

## Runtime Observations

- Core test suite is stable.
- Security-related runtime abuse cases are under-tested.
