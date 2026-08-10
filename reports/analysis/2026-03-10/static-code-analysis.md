# Static Code Analysis

## Summary
Static review found no dependency CVEs in `npm audit`, but it did find high-value maintainability and correctness risks in core runtime modules.

## Findings
1. `public/app.js` is a 4,096-line frontend orchestrator that owns routing, auth, settings, chat, canvas, and landing behavior. This creates a high merge-conflict surface and makes regressions hard to isolate. Evidence: `wc -l public/app.js`.
2. `src/services/agentRuntime.mjs` is a 2,329-line backend orchestrator. Planning, Gemini tool execution, review logic, findings synthesis, and layout normalization are tightly coupled in one file. Evidence: `wc -l src/services/agentRuntime.mjs`.
3. The backend imports layout logic from a frontend path: `src/services/agentRuntime.mjs` imports `../../public/dashboard-layout.js`. This is a structural boundary violation and makes server logic depend on public asset layout.
4. The in-memory rate limiter never evicts old keys. `src/http/rateLimit.mjs` keeps entries in a process-global `Map` forever, which is a memory-growth risk under sustained diverse traffic.

## Metrics
- `public/app.js`: 4,096 lines
- `src/services/agentRuntime.mjs`: 2,329 lines
- `src/services/chat.mjs`: 1,226 lines
- `src/services/ingestion.mjs`: 1,182 lines
- `src/services/queryEngine.mjs`: 748 lines

## Recommended Remediation
- Split shell state, landing/auth flows, and canvas behavior out of `public/app.js`.
- Extract planner/worker/reviewer phases out of `src/services/agentRuntime.mjs`.
- Move shared dashboard layout logic into a neutral shared module.
- Add eviction to the rate limiter.
