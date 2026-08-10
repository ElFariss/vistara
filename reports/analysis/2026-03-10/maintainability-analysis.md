# Maintainability Analysis Report

## Actionable findings
1. The frontend shell remains concentrated in a single mutable-state file.
   - File: `public/app.js` (`4097` LOC)
   - Risk: high merge-conflict probability, hard-to-isolate regressions, difficult targeted testing.

2. Backend orchestration is concentrated in oversized services.
   - Files:
     - `src/services/agentRuntime.mjs` (`2330` LOC)
     - `src/services/chat.mjs` (`1227` LOC)
     - `src/services/ingestion.mjs` (`1183` LOC)
   - Risk: weak module boundaries and slow review/debug cycles.

3. There is no automated static-quality gate.
   - Result: maintainability regressions are not blocked before merge.
