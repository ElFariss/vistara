# Core Application Source

This directory (`/src`) contains the primary backend logic for the Vistara Conversational Intelligence platform.

The core application runs as a lightweight Node.js HTTP server without a heavy web framework (no Express). It is responsible for multi-tenant data isolation, generative AI orchestration via the Gemini API, and dynamic SQL query execution against PostgreSQL.

- `server.mjs`: Entry point and HTTP server configuration.
- `db.mjs`: PostgreSQL connection pool and schema definitions.
- `router.mjs`: Minimalist REST routing framework.
- `config.mjs`: Environment variable mapping and operational constants.
