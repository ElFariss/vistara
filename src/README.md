# Core Application Source

This directory (`/src`) contains the primary backend logic for the Vistara Conversational Intelligence platform.

The core application runs as a lightweight, no-dependency Node.js HTTP server. It is responsible for multi-tenant data isolation, generative AI orchestration via the Gemini API, and dynamic SQL query execution against local SQLite databases.

- `server.mjs`: Entry point and HTTP server configuration.
- `db.mjs`: SQLite connection pool and schema definitions.
- `router.mjs`: Minimalist REST routing framework.
- `config.mjs`: Environment variable mapping and operational constants.
