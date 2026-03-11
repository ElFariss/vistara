# API Routes

The `/src/routes` directory contains all HTTP endpoint controllers for the REST API. 

Each file exposes a registration function (e.g., `registerChatRoutes(router)`) which maps specific HTTP verbs and URL paths to their corresponding service functions and handles HTTP request/response payloads (JSON serialization, error handling, auth gating).
