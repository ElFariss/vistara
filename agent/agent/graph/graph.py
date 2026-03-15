"""Main agent graph — assembles the LangGraph StateGraph.

This single file replaces the legacy JS agent runtime with a unified LangGraph flow.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import AsyncGenerator

from langgraph.graph import END, StateGraph

from agent.graph.analyst import analyst_node
from agent.graph.dashboard import (
    analyst_brief_node,
    argus_node,
    dashboard_answer_node,
    planner_node,
    should_retry_dashboard,
    worker_node,
)
from agent.graph.orchestrator import orchestrator_node
from agent.graph.state import AgentState
from agent.graph.surface import surface_node, surface_with_data_node
from agent.graph.execute_analytics import execute_analytics_node

logger = logging.getLogger(__name__)


def _route_after_orchestrator(state: AgentState) -> str:
    """Conditional edge — route based on orchestrator decision."""
    route = state.get("route", {}) or {}
    action = route.get("action", "conversational")

    if action in ("conversational", "ask_clarification"):
        return "surface"

    if action == "analyze":
        return "analyst"

    if action in ("create_dashboard", "edit_dashboard"):
        return "dashboard_analyst_brief"

    if action == "inspect_dataset":
        return "analyst"

    return "surface"


def build_graph() -> StateGraph:
    """Build and compile the full Vistara agent graph.

    Graph topology:
        START → orchestrator → (route decision)
            → surface → END
            → analyst → execute_analytics → surface_with_data → END
            → dashboard_analyst_brief → planner → worker → argus
                → (pass) → dashboard_answer → END
                → (fail) → worker (retry)
    """
    graph = StateGraph(AgentState)

    graph.add_node("orchestrator", orchestrator_node)
    graph.add_node("surface", surface_node)
    graph.add_node("analyst", analyst_node)
    graph.add_node("execute_analytics", execute_analytics_node)
    graph.add_node("surface_with_data", surface_with_data_node)
    graph.add_node("dashboard_analyst_brief", analyst_brief_node)
    graph.add_node("planner", planner_node)
    graph.add_node("worker", worker_node)
    graph.add_node("argus", argus_node)
    graph.add_node("dashboard_answer", dashboard_answer_node)

    # ── Entry point ─────────────────────────────────────────────────
    graph.set_entry_point("orchestrator")

    # ── Conditional routing after orchestrator ──────────────────────
    graph.add_conditional_edges(
        "orchestrator",
        _route_after_orchestrator,
        {
            "surface": "surface",
            "analyst": "analyst",
            "dashboard_analyst_brief": "dashboard_analyst_brief",
        },
    )

    # ── Terminal nodes & Analytics Flow ─────────────────────────────
    graph.add_edge("surface", END)
    graph.add_edge("analyst", "execute_analytics")
    graph.add_edge("execute_analytics", "surface_with_data")
    graph.add_edge("surface_with_data", END)

    # ── Dashboard sub-graph flow ────────────────────────────────────
    graph.add_edge("dashboard_analyst_brief", "planner")
    graph.add_edge("planner", "worker")
    graph.add_edge("worker", "argus")

    # Argus review — pass or retry
    graph.add_conditional_edges(
        "argus",
        should_retry_dashboard,
        {
            "finish": "dashboard_answer",
            "retry": "worker",
        },
    )
    graph.add_edge("dashboard_answer", END)

    return graph.compile()


# Singleton compiled graph
_compiled_graph = None


def get_graph():
    """Get or build the compiled graph singleton."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
    return _compiled_graph


async def run_agent(
    *,
    tenant_id: str,
    user_id: str,
    message: str,
    conversation_id: str | None = None,
    dashboard_id: str | None = None,
    history: list | None = None,
    dataset_ready: bool = False,
    user_display_name: str | None = None,
    dataset_profile: dict | None = None,
    saved_dashboard: dict | None = None,
) -> dict:
    """Run the full agent graph and return the result.

    This is the main entry point — equivalent to runConversationAgent()
    from the old JS codebase.
    """
    run_id = uuid.uuid4().hex[:16]

    initial_state: AgentState = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "conversation_id": conversation_id,
        "dashboard_id": dashboard_id,
        "message": message,
        "history": history or [],
        "dataset_ready": dataset_ready,
        "user_display_name": user_display_name,
        "dataset_profile": dataset_profile,
        "saved_dashboard": saved_dashboard,
        "route": None,
        "answer": "",
        "content_format": "plain",
        "analytics_intent": None,
        "query_result": None,
        "analysis_brief": None,
        "planner_steps": [],
        "widgets": [],
        "artifacts": [],
        "dashboard_summary": "",
        "review_verdict": None,
        "review_summary": None,
        "review_completeness": 0.0,
        "presentation_mode": "chat",
        "intent": {"intent": "conversation", "nlu_source": "langgraph"},
        "draft_dashboard": None,
        "pending_approval": None,
        "agent_dialogue": [],
        "trace": [],
        "run_id": run_id,
        "error": None,
    }

    graph = get_graph()

    try:
        result = await graph.ainvoke(initial_state)
    except Exception as e:
        logger.exception("Agent graph execution failed")
        result = {
            **initial_state,
            "answer": "Maaf, terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi.",
            "error": str(e),
        }

    return {
        "answer": result.get("answer", ""),
        "content_format": result.get("content_format", "plain"),
        "widgets": result.get("widgets", []),
        "artifacts": result.get("artifacts", []),
        "presentation_mode": result.get("presentation_mode", "chat"),
        "intent": result.get("intent", {"intent": "conversation", "nlu_source": "langgraph"}),
        "draft_dashboard": result.get("draft_dashboard"),
        "pending_approval": result.get("pending_approval"),
        "agent": {
            "mode": "langgraph",
            "run_id": run_id,
            "team": {"surface": "Vira", "orchestrator": "Atlas", "analyst": "Raka", "creator": "Citra"},
            "route": result.get("route"),
            "trace": result.get("trace", []),
            "fallback_used": False,
        },
        "agent_dialogue": result.get("agent_dialogue", []),
        "analysis_brief": result.get("analysis_brief"),
        "analytics_intent": result.get("analytics_intent"),
    }


async def run_agent_stream(
    *,
    tenant_id: str,
    user_id: str,
    message: str,
    conversation_id: str | None = None,
    dashboard_id: str | None = None,
    history: list | None = None,
    dataset_ready: bool = False,
    user_display_name: str | None = None,
    dataset_profile: dict | None = None,
    saved_dashboard: dict | None = None,
) -> AsyncGenerator[str, None]:
    """Stream NDJSON events from LangGraph execution."""
    run_id = uuid.uuid4().hex[:16]

    initial_state: AgentState = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "conversation_id": conversation_id,
        "dashboard_id": dashboard_id,
        "message": message,
        "history": history or [],
        "dataset_ready": dataset_ready,
        "user_display_name": user_display_name,
        "dataset_profile": dataset_profile,
        "saved_dashboard": saved_dashboard,
        "route": None,
        "answer": "",
        "content_format": "plain",
        "analytics_intent": None,
        "query_result": None,
        "analysis_brief": None,
        "planner_steps": [],
        "widgets": [],
        "artifacts": [],
        "dashboard_summary": "",
        "review_verdict": None,
        "review_summary": None,
        "review_completeness": 0.0,
        "presentation_mode": "chat",
        "intent": {"intent": "conversation", "nlu_source": "langgraph"},
        "draft_dashboard": None,
        "pending_approval": None,
        "agent_dialogue": [],
        "trace": [],
        "run_id": run_id,
        "error": None,
    }

    graph = get_graph()

    # Emit start event
    start_payload = {
        "type": "start",
        "payload": {
            "run_id": run_id,
            "agent": "Vira",
            "title": "Vira membaca permintaan Anda"
        }
    }
    yield json.dumps(start_payload) + "\n"

    try:
        # stream_mode=["updates", "values"] yields (mode, payload)
        # But we need to make sure we don't hit import issues. Let's just use updates and track state manually for the simple fields we need.
        async for chunk_type, chunk in graph.astream(initial_state, stream_mode=["updates", "values"]):
            if chunk_type == "values":
                final_state = chunk
            elif chunk_type == "updates":
                for node_name, state_update in chunk.items():
                    if node_name == "orchestrator":
                        route = state_update.get("route", {})
                        yield json.dumps({
                            "type": "step",
                            "payload": {
                                "run_id": run_id,
                                "agent": "Atlas",
                                "title": f"Atlas memilih jalur {route.get('action')}",
                                "status": "done"
                            }
                        }) + "\n"
                    elif node_name == "dashboard_analyst_brief":
                        yield json.dumps({
                            "type": "timeline",
                            "payload": {
                                "id": f"analyst_{uuid.uuid4().hex[:8]}",
                                "status": "done",
                                "title": "Raka menyusun temuan utama sebelum dashboard dibuat",
                                "agent": "analyst"
                            }
                        }) + "\n"
                    elif node_name == "planner":
                        yield json.dumps({
                            "type": "timeline",
                            "payload": {
                                "id": f"planner_{uuid.uuid4().hex[:8]}",
                                "status": "done",
                                "title": "Citra membuat rencana eksekusi dashboard",
                                "agent": "creator"
                            }
                        }) + "\n"
                    elif node_name == "worker":
                        widgets = state_update.get("widgets", [])
                        yield json.dumps({
                            "type": "timeline",
                            "payload": {
                                "id": f"worker_{uuid.uuid4().hex[:8]}",
                                "status": "done",
                                "title": f"Citra menyusun {len(widgets)} widget visual",
                                "agent": "creator"
                            }
                        }) + "\n"
                    elif node_name == "argus":
                        verdict = state_update.get("review_verdict")
                        yield json.dumps({
                            "type": "timeline",
                            "payload": {
                                "id": f"argus_{uuid.uuid4().hex[:8]}",
                                "status": "done" if verdict == "pass" else "error",
                                "title": f"Argus mereview hasil: {verdict}",
                                "agent": "curator"
                            }
                        }) + "\n"

        # After the loop, final_state holds the last state
        final_result = {
            "answer": final_state.get("answer", ""),
            "content_format": final_state.get("content_format", "plain"),
            "widgets": final_state.get("widgets", []),
            "artifacts": final_state.get("artifacts", []),
            "presentation_mode": final_state.get("presentation_mode", "chat"),
            "intent": final_state.get("intent", {"intent": "conversation", "nlu_source": "langgraph"}),
            "draft_dashboard": final_state.get("draft_dashboard"),
            "pending_approval": final_state.get("pending_approval"),
            "agent": {
                "mode": "langgraph",
                "run_id": run_id,
                "team": {"surface": "Vira", "orchestrator": "Atlas", "analyst": "Raka", "creator": "Citra", "curator": "Argus"},
                "route": final_state.get("route"),
                "trace": final_state.get("trace", []),
                "fallback_used": False,
            },
            "agent_dialogue": final_state.get("agent_dialogue", []),
            "analysis_brief": final_state.get("analysis_brief"),
            "analytics_intent": final_state.get("analytics_intent"),
        }
        yield json.dumps({
            "type": "final",
            "payload": final_result
        }) + "\n"
        
    except Exception as e:
        logger.exception("Agent graph stream execution failed")
        yield json.dumps({
            "type": "error",
            "payload": {
                "message": "Maaf, terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi.",
                "error": str(e)
            }
        }) + "\n"
