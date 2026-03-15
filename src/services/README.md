# Business Services

The `/src/services` directory contains the core domain logic isolated from the HTTP routing layer. 

Key architectural components include:
1. **Agent Proxy (`agentProxy.mjs`)**: Bridges the Node.js app to the Python LangGraph backend for multi-agent orchestration.
2. **AI Helpers (`gemini.mjs`, `agents/prompts.mjs`)**: Wrappers and prompts for Gemini-backed mapping, ingestion, and lightweight text generation.
3. **Conversational Engine (`chat.mjs`)**: Orchestrates the core chat loop, routing messages to the appropriate analytical or conversational pipeline.
4. **Data Tools (`ingestion.mjs`, `columnMapper.mjs`, `queryEngine.mjs`)**: Systems to process unmapped Excel/CSV/JSON files, dynamically map them to standard analytical schemas, and safely execute aggregate queries against them.
