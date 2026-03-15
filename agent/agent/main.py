"""FastAPI application entry point.

Run with: uvicorn agent.main:app --port 8001 --reload
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from agent.config import settings
from agent.graph.graph import run_agent
from agent.schemas import ApprovalRequest, ChatRequest, ChatResponse

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — startup and shutdown hooks."""
    logger.info("Vistara Agent Backend starting on port %s", settings.port)

    if not settings.gemini_api_key:
        logger.warning("GEMINI_API_KEY is not set — LLM calls will fail!")

    # Pre-build the graph on startup
    from agent.graph.graph import get_graph
    get_graph()
    logger.info("Agent graph compiled successfully")

    yield

    logger.info("Vistara Agent Backend shutting down")


app = FastAPI(
    title="Vistara Agent Backend",
    description="LangGraph-powered AI agent for business analytics",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health Check ────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "ok": True,
        "service": "vistara-agent",
        "gemini_configured": bool(settings.gemini_api_key),
        "model": settings.gemini_model,
    }


# ── Chat Endpoint ──────────────────────────────────────────────────────────


@app.post("/agent/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Process a chat message through the agent graph.

    This is the main endpoint called by the Node.js proxy (agentProxy.mjs).
    The request/response shapes are designed to be drop-in compatible with
    the existing runConversationAgent() return value.
    """
    try:
        result = await run_agent(
            tenant_id=request.tenant_id,
            user_id=request.user_id,
            message=request.message,
            conversation_id=request.conversation_id,
            dashboard_id=request.dashboard_id,
            history=request.history,
            dataset_ready=request.dataset_ready,
            user_display_name=request.user_display_name,
            dataset_profile=request.dataset_profile,
            saved_dashboard=request.saved_dashboard,
        )

        return JSONResponse(content={"ok": True, **result})

    except Exception as e:
        logger.exception("Chat endpoint failed")
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "error": {
                    "code": "AGENT_FAILED",
                    "message": "Gagal memproses permintaan AI.",
                    "status": 503,
                },
                "answer": "Maaf, terjadi kesalahan saat memproses permintaan Anda.",
            },
        )


@app.post("/agent/chat/stream")
async def chat_stream(request: ChatRequest):
    """Stream NDJSON events from LangGraph execution."""
    from agent.graph.graph import run_agent_stream
    return StreamingResponse(
        run_agent_stream(
            tenant_id=request.tenant_id,
            user_id=request.user_id,
            message=request.message,
            conversation_id=request.conversation_id,
            dashboard_id=request.dashboard_id,
            history=request.history,
            dataset_ready=request.dataset_ready,
            user_display_name=request.user_display_name,
            dataset_profile=request.dataset_profile,
            saved_dashboard=request.saved_dashboard,
        ),
        media_type="application/x-ndjson",
    )


# ── Approval Endpoint ──────────────────────────────────────────────────────


@app.post("/agent/approvals/{approval_id}")
async def handle_approval(approval_id: str, request: ApprovalRequest):
    """Handle user approval/rejection of a pending action."""
    # TODO: Implement approval handling (dataset repair, etc.)
    return JSONResponse(content={
        "ok": True,
        "approval_id": approval_id,
        "decision": request.decision,
        "message": "Approval diproses.",
    })


# ── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.host, port=settings.port)
