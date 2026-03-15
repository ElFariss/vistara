"""Execute Analytics Node - Bridges Python LangGraph with Node.js Analytics Engine"""
import httpx
import logging
from typing import Any
from agent.graph.state import AgentState
from agent.config import settings

logger = logging.getLogger(__name__)

async def execute_analytics_node(state: AgentState) -> dict[str, Any]:
    """Execute the analytics intent via the Node.js internal API."""
    intent = state.get("analytics_intent")
    
    if not intent:
        logger.warning("No analytics intent found in state")
        return {
            "query_result": None,
            "error": "Tidak ada intent analisis yang terdeteksi.",
            "trace": state.get("trace", []) + [{"step": "execute_analytics", "status": "no_intent"}]
        }

    tenant_id = state.get("tenant_id")
    user_id = state.get("user_id")
    url = f"{settings.nodejs_internal_url}/api/internal/analytics"
    
    logger.info("Calling Node.js internal analytics API: %s with intent: %s", url, intent.get("intent"))
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                json={
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "intent": intent
                }
            )
            
            if response.status_code != 200:
                logger.error("Internal analytics API returned %s: %s", response.status_code, response.text)
                return {
                    "query_result": None,
                    "error": "Gagal mengeksekusi analisis data.",
                    "trace": state.get("trace", []) + [{"step": "execute_analytics", "status": "error", "message": f"HTTP {response.status_code}"}]
                }
                
            data = response.json()
            if not data.get("ok"):
                return {
                    "query_result": None,
                    "error": data.get("error", {}).get("message", "Gagal mengeksekusi analisis data."),
                    "trace": state.get("trace", []) + [{"step": "execute_analytics", "status": "error", "message": "API returned ok=false"}]
                }
                
            # The Node.js API returns raw_data, widgets, artifacts, etc.
            result = data.get("data", {})
            
            return {
                "query_result": result,
                "widgets": result.get("widgets", []),
                "artifacts": result.get("artifacts", []),
                "trace": state.get("trace", []) + [{"step": "execute_analytics", "status": "success"}]
            }
            
    except Exception as e:
        logger.exception("Failed to call Node.js internal analytics API")
        return {
            "query_result": None,
            "error": "Terjadi kesalahan koneksi saat menarik data.",
            "trace": state.get("trace", []) + [{"step": "execute_analytics", "status": "error", "message": str(e)}]
        }
