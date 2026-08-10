# Performance Analysis

## Summary
The app is responsive for normal local requests, but one infrastructure endpoint is currently throttled in a way that makes it unsuitable for liveness checks.

## Measurements
- Autocannon against `GET /api/health` for 5 seconds with 10 connections produced:
  - `200`: 119
  - `429`: 212563
  - no transport errors or 5xx responses

## Findings
1. Health-check traffic is treated like user traffic, so burst or clustered probes quickly exhaust the limiter.
2. The in-memory limiter uses a never-pruned `Map`, which creates memory growth risk as unique keys accumulate.

## Limits
- No deeper CPU/heap profiling was run yet.
- No multi-endpoint benchmark was run yet.
