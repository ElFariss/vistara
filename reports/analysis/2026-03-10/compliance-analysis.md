# Compliance / Standards Analysis Report

## Current state
- No formal compliance target is declared in the repo.
- No automated policy checks exist for GDPR, HIPAA, OWASP ASVS, or internal coding standards.

## Actionable findings
1. A live local `.env` with a Gemini API key is present in the workspace.
   - File: `.env` (local workspace file)
   - Risk: accidental disclosure or commit.

2. Security-sensitive defaults are not fail-closed.
   - Files: `src/server.mjs`, `src/http/request.mjs`
   - Risk: environment misconfiguration weakens security posture instead of safely degrading behavior.
