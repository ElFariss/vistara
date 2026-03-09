# QA Analysis Report

## Current baseline
- Full test suite currently passes.
- There is good regression coverage for chat, dashboard layout, data quality, parsing, token handling, and backup flows.

## Actionable gaps
1. No test coverage currently exercises auth throttling, CORS policy, or trusted-proxy/IP handling.
   - Files impacted: `src/server.mjs`, `src/http/request.mjs`, `src/routes/auth.mjs`

2. No browser-level acceptance suite is checked into the repo.
   - Result: UI regressions still depend on ad-hoc manual runs.

3. No coverage metric is generated, so passing tests do not quantify what remains untested.
