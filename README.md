# UMKM Conversational Intelligence (Production-Ready MVP)

Bahasa Indonesia-first conversational business intelligence layer for growing UMKM.

## Implemented Scope

This build now focuses on a linear, production-ready MVP flow:

- Linear flow: Landing → Login/Register → Business Context → Workspace
- Static dataset architecture (no streaming pipeline), snapshot replace per upload
- Multi-format ingestion: CSV/TSV, JSON, XLSX/XLS + AI-assisted fallback for text-like files
- One-click demo import (`test.csv`) for hackathon onboarding
- AI-powered column mapping (Gemini + heuristic fallback)
- Multi-agent runtime (Planner/Worker/Reviewer) with Gemini function-calling + deterministic fallback
- Optional isolated Python tool runtime (separate container) for safe code-based review/analysis steps
- Conversational analytics in Bahasa Indonesia with inline metric/table/chart artifacts
- Canvas mode with draggable/resizable widgets and manual query builder
- Dashboard persistence via existing dashboards API
- Safe query execution with whitelisted logic and parameterized SQL
- Responsive mobile-ready web UI

## Tech Stack

- Runtime: Node.js 24+
- Database: SQLite (`node:sqlite`, WAL mode)
- API: native HTTP server + custom router
- AI: Gemini API using model **`gemini-3.1-pro-preview`** (configurable)
- Frontend: vanilla JS + GridStack + Chart.js (self-hosted vendor assets)

## Environment Variables

Copy `.env.example` to `.env` and set values.

Key fields:

- `GEMINI_API` or `GEMINI_API_KEY` (required for AI mapping/NLU)
- `GEMINI_MODEL=gemini-3.1-pro-preview`
- `PYTHON_AGENT_URL` (optional, enables Python execution tool)
- `PYTHON_AGENT_TOKEN` (recommended when Python tool is enabled)
- `PYTHON_AGENT_TIMEOUT_MS=3500`
- `JWT_SECRET` (required in production)

Existing `.env` is already supported directly by the app.

## Run Locally

```bash
npm start
```

Dev watch mode:

```bash
npm run dev
```

Open:

- `http://localhost:8080`
- Health: `http://localhost:8080/api/health`

## API Coverage

Current primary endpoints:

- Auth: `/api/auth/demo`, `/api/auth/register`, `/api/auth/login`, `/api/auth/otp/send`, `/api/auth/otp/verify`
- Business: `/api/business/setup`, `/api/business/profile` (GET, PUT)
- Data: `/api/data/upload`, `/api/data/demo/import`, `/api/data/sources`, `/api/data/sources/:id/mapping` (GET, PUT), `/api/data/schema`, `/api/data/query`, `/api/data/sources/:id` (DELETE)
- Chat: `/api/chat`, `/api/chat/history`, `/api/chat/feedback`
- Dashboards: `/api/dashboards` (GET, POST), `/api/dashboards/:id` (GET, PUT, DELETE)
- Insights: `/api/insights/verdict`, `/api/insights/anomalies`, `/api/insights/trends`
- Reports: `/api/reports/generate`, `/api/reports`, `/api/reports/:id/download`
- Goals: `/api/goals` (POST, GET), `/api/goals/:id/progress`

## Security & Safety Controls

- Tenant-scoped data access in every query
- Authenticated endpoints protected by HMAC-signed token
- Passwords hashed with `scrypt`
- OTP hash storage (not plaintext)
- Rate limiting per route/IP
- Query engine uses whitelisted templates + bound parameters
- Audit trail for chat/query/report/data processing actions

## Testing

Run:

```bash
npm test
```

Current automated tests cover:

- Indonesian number/date parsing
- Token signing/verification
- Query-template registry and SQL-injection safety via parameterization
- Agentic runtime fallback on stale dataset periods and canvas dashboard generation
- CSV wrapped-row recovery regression (`test.csv`)
- JSON dataset normalization

## Deployment

### Docker

```bash
docker compose up --build
```

Services started:

- `app` on `8080`
- `python-agent` internal on `8091` (used by app when configured)

## Notes

- Endpoint `/api/data/sources/:id/process` is deprecated because upload now does parse+ingest in one step.
- XLSX ingestion supports common single-sheet exports (`.xlsx`).
- Legacy `.xls` is supported via `ssconvert` conversion to CSV before normalization.
- For production-scale multi-tenant SaaS, switch DB to PostgreSQL and enforce RLS at database level.
