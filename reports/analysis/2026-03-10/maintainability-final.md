# Maintainability Analysis Report

Date: 2026-03-10
Scope: `/home/parasite/Work/umkm`

## Large File Hot Spots

- `public/app.js`: 4096 lines
- `public/styles.css`: 3307 lines
- `src/services/agentRuntime.mjs`: 2329 lines
- `src/services/chat.mjs`: 1226 lines
- `src/services/ingestion.mjs`: 1182 lines
- `src/services/queryEngine.mjs`: 748 lines

## Findings

1. High structural risk: workspace UI logic is still centralized in one mutable-state script.
   - File: `public/app.js`
   - Impact: small product changes will keep causing unrelated regressions and high merge conflict pressure.

2. High structural risk: dashboard generation packs planning, execution, review, layout repair, and insight synthesis into one service.
   - File: `src/services/agentRuntime.mjs`
   - Impact: changes to one dashboard stage are hard to isolate and test.

3. Medium: domain orchestration remains split across oversized services with weak module boundaries.
   - Files: `src/services/chat.mjs`, `src/services/ingestion.mjs`, `src/services/queryEngine.mjs`
   - Impact: maintainability cost and debugging time will continue to rise even when correctness is preserved.

## Recommendation

Refactor by vertical slices, not by helper extraction only:

- auth + abuse controls
- data ingestion/profile/repair
- chat orchestration
- dashboard agent runtime
- workspace shell + session rail + composer
