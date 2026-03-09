# Static Analysis Report

## Tooling state
- No ESLint, SonarQube, CodeQL, or equivalent static analyzer is configured in `package.json`.
- The current `check` script is just the test suite.

## Actionable findings
1. Inconsistent public error sanitization leaves several routes returning raw exception text.
   - Files: `src/routes/auth.mjs`, `src/routes/data.mjs`, `src/routes/chat.mjs`
   - Risk: parser/storage/runtime details leak to clients.

2. Very large modules are carrying too many responsibilities, which raises regression risk and makes static review harder.
   - `public/app.js` `4097` LOC
   - `src/services/agentRuntime.mjs` `2330` LOC
   - `src/services/chat.mjs` `1227` LOC
   - `src/services/ingestion.mjs` `1183` LOC

3. Static quality tooling is absent, so complexity, duplication, and unused-path regressions are not being caught automatically.
   - Files affected: repo-wide
