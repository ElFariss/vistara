# Architecture Analysis Report

Date: 2026-03-10
Scope: `/home/parasite/Work/umkm`

## Current Shape

- Native Node HTTP server with custom router
- SQLite single-process persistence
- Frontend SPA in vanilla JS
- Gemini-backed multi-step dashboard runtime
- Optional Python sidecar for code execution

## Findings

1. High: abuse controls are implemented as process-local middleware only.
   - Files: `src/http/rateLimit.mjs`, `src/server.mjs`
   - Impact: protections are weak under horizontal scaling and trivially bypassed when forwarding headers are trusted incorrectly.

2. High: security boundaries for the Python execution sidecar depend on deployment assumptions, not enforced defaults.
   - Files: `tools/python-agent/server.py`, `docker-compose.yml`, `src/services/pythonRuntime.mjs`
   - Impact: one deployment mistake turns an internal helper into an unauthenticated execution service.

3. Medium: workspace/dashboard behavior mixes conversation-scoped and tenant-scoped state.
   - Files: `public/app.js`, `public/workspaceState.js`
   - Impact: state-reset regressions keep recurring around empty conversations and saved dashboards.

4. Medium: runtime integration boundaries are thin between chat, dashboard generation, and persistence.
   - Files: `src/services/chat.mjs`, `src/services/agentRuntime.mjs`, `src/services/dashboards.mjs`
   - Impact: failures in one subsystem propagate widely and require broad regression coverage for small changes.

## Recommendation

- enforce deployment-safe defaults at module boundaries
- separate workspace state into conversation state and tenant/dashboard state
- move abuse controls from process-local assumptions toward explicit trusted-proxy config and stronger auth/verification rules
