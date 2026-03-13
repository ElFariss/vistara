# Operations

Operational notes for running Vistara in production.

## Runtime

- Node: `24+`
- Default port: `8080`
- Health endpoint: `GET /api/health`
- Data storage: PostgreSQL database plus uploaded files under `DATA_DIR/uploads`

## Required Environment

- `NODE_ENV=production`
- `JWT_SECRET=<strong random secret>`
- `DATABASE_URL=postgresql://user:pass@host:5432/dbname`
- `GEMINI_API_KEY=<key>` if Gemini-backed mapping/NLU is enabled
- `ALLOWED_ORIGINS=https://your-app.example.com`

Recommended:

- `DATA_DIR=/app/data`
- `DATABASE_URL=postgresql://postgres:<password>@postgres:5432/umkm`
- `GEMINI_MODEL=gemini-2.5-pro`
- `PYTHON_AGENT_URL=http://python-agent:8091`
- `PYTHON_AGENT_TOKEN=<shared token>`
- `DASHBOARD_AGENT_TIMEOUT_MS=180000`

## Startup

Local:

```bash
npm start
```

Docker Compose:

```bash
docker compose up --build -d
```

Checks after startup:

```bash
curl -fsS http://127.0.0.1:8080/api/health
docker compose ps
```

## Shutdown

The app now handles `SIGTERM` and `SIGINT` gracefully:

- stops accepting new API traffic
- closes the HTTP server
- closes the PostgreSQL connection pool

For controlled maintenance windows:

```bash
docker compose stop app
```

## Backup

Create a filesystem backup of the PostgreSQL tables and uploads:

```bash
npm run backup
```

Custom destination:

```bash
npm run backup -- ./backups
```

Each backup writes a timestamped directory containing:

- `manifest.json`
- `db/` (JSON table snapshots)
- `uploads/`

Recommendation:

- run backups from a quiesced app instance when possible
- persist the `backups/` directory outside the container filesystem
- keep at least one pre-deploy and one daily backup

## Restore

Restore from a backup directory:

```bash
npm run restore -- --yes ./backups/backup-YYYY-MM-DDTHH-MM-SS
```

The restore command automatically creates a safety snapshot first under `backups/pre-restore-*`.

Before restore:

- stop the app
- confirm the target backup directory contains the expected tenant data

After restore:

- start the app
- hit `/api/health`
- validate login, dataset listing, and one dashboard/chat request

## Rollback

Application rollback:

1. Deploy the previous known-good container image or previous `main` commit.
2. If data migration was not involved, keep the current `data/` volume.
3. If the deployment also corrupted data, restore the latest good backup with `npm run restore -- --yes <backup-dir>`.

Code rollback reference:

- previous release parent before this integration: `20656dd`
- current integrated main after hardening: `451f4a7`

## Production Checklist

1. `JWT_SECRET` is set and not the example value.
2. `ALLOWED_ORIGINS` is restricted to the real frontend origin.
3. `data/` and `backups/` are mounted on persistent storage.
4. `/api/health` is wired into your platform health checks.
5. A backup has been taken before each deploy.
6. Restore has been tested in a non-production environment.
