# Architecture and Maintainability Analysis

## Summary
The main scale risk is orchestration concentration, not raw feature count. Core product flows are spread across a few oversized, stateful modules with weak boundaries.

## Findings
1. `public/app.js` concentrates landing, auth, routing, session rail, chat, canvas, export, theme, and settings behavior in one mutable-state file.
2. `src/services/agentRuntime.mjs` combines planning, tool dispatch, dashboard evaluation, summary generation, and layout shaping in one service.
3. `src/services/chat.mjs` and `src/services/ingestion.mjs` are both over 1,100 lines, which makes intent handling and dataset parsing/repair hard to reason about independently.
4. Backend code imports from `public/`, specifically `src/services/agentRuntime.mjs -> ../../public/dashboard-layout.js`, which couples server behavior to frontend asset layout.

## Highest-Value Structural Next Steps
- Create a shared `dashboardLayout` module outside `public/` and use it from both client and server.
- Split `public/app.js` into route shell, workspace shell, and canvas/editor modules.
- Split `src/services/agentRuntime.mjs` into planner, worker, reviewer, and findings synthesis modules.
