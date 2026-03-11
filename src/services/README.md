# Business Services

The `/src/services` directory contains the core domain logic isolated from the HTTP routing layer. 

Key architectural components include:
1. **Agent Runtime (`agentRuntime.mjs`)**: A multi-agent system that coordinates planning, execution (Worker), and evaluation (Reviewer) for complex tasks like dashboard generation.
2. **AI & NLU (`gemini.mjs`, `nlu.mjs`)**: Wrappers for the Google Gemini API to handle text generation, tool calling, and natural language intent parsing.
3. **Conversational Engine (`chat.mjs`)**: Orchestrates the core chat loop, routing messages to the appropriate analytical or conversational pipeline.
4. **Data Tools (`ingestion.mjs`, `columnMapper.mjs`, `queryEngine.mjs`)**: Systems to process unmapped Excel/CSV/JSON files, dynamically map them to standard analytical schemas, and safely execute aggregate queries against them.
