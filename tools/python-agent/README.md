# Python Execution Agent

This directory contains `server.py`, a specialized micro-service functioning as a highly restricted sandboxed Python execution environment.

It allows the primary Node.js AI agent process (`src/services/agentRuntime.mjs`) to offload and run complex, dynamically generated Python scripts against analytical contexts safely. All executions run in memory-constrained, time-boxed subprocesses with limited AST parsers (blocking `exec`, `eval`, `open`, external imports).
