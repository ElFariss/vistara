# Performance Preliminary Findings

## Baseline smoke benchmark
Local single-process benchmark on `development` build:
- `/api/health`: avg `0.47ms`, p95 `0.69ms`, max `5.72ms`
- `/`: avg `0.32ms`, p95 `0.59ms`, max `1.10ms`

## Observations
- The trivial endpoints are fast under no load.
- There is no existing load/stress tooling in the repo (`k6`, `autocannon`, `JMeter`, or equivalent).
- Performance risk is more architectural than measured at this point: very large frontend/runtime modules (`public/app.js`, `src/services/agentRuntime.mjs`, `src/services/chat.mjs`) will make targeted optimization and profiling harder.
