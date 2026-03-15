"""Main agent graph — assembles the LangGraph StateGraph.

This single file replaces the legacy JS agent runtime with a unified LangGraph flow.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, AsyncGenerator

from langgraph.graph import END, StateGraph

from agent.graph.analyst import analyst_node
from agent.graph.dashboard import (
    analyst_brief_node,
    argus_node,
    dashboard_answer_node,
    dashboard_spec_node,
    planner_node,
    should_retry_dashboard,
    worker_node,
)
from agent.graph.execute_analytics import execute_analytics_node
from agent.graph.orchestrator import orchestrator_node
from agent.graph.state import AgentState
from agent.graph.surface import surface_node, surface_with_data_node

logger = logging.getLogger(__name__)

TEAM = {
    "surface": "Vira",
    "orchestrator": "Atlas",
    "analyst": "Raka",
    "creator": "Citra",
    "curator": "Argus",
}


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
    """Build and compile the full Vistara agent graph."""
    graph = StateGraph(AgentState)

    graph.add_node("orchestrator", orchestrator_node)
    graph.add_node("surface", surface_node)
    graph.add_node("analyst", analyst_node)
    graph.add_node("execute_analytics", execute_analytics_node)
    graph.add_node("surface_with_data", surface_with_data_node)
    graph.add_node("dashboard_analyst_brief", analyst_brief_node)
    graph.add_node("planner", planner_node)
    graph.add_node("dashboard_spec", dashboard_spec_node)
    graph.add_node("worker", worker_node)
    graph.add_node("argus", argus_node)
    graph.add_node("dashboard_answer", dashboard_answer_node)

    graph.set_entry_point("orchestrator")

    graph.add_conditional_edges(
        "orchestrator",
        _route_after_orchestrator,
        {
            "surface": "surface",
            "analyst": "analyst",
            "dashboard_analyst_brief": "dashboard_analyst_brief",
        },
    )

    graph.add_edge("surface", END)
    graph.add_edge("analyst", "execute_analytics")
    graph.add_edge("execute_analytics", "surface_with_data")
    graph.add_edge("surface_with_data", END)

    graph.add_edge("dashboard_analyst_brief", "planner")
    graph.add_edge("planner", "dashboard_spec")
    graph.add_edge("dashboard_spec", "worker")
    graph.add_edge("worker", "argus")
    graph.add_conditional_edges(
        "argus",
        should_retry_dashboard,
        {
            "finish": "dashboard_answer",
            "retry": "dashboard_spec",
        },
    )
    graph.add_edge("dashboard_answer", END)

    return graph.compile()


_compiled_graph = None


def get_graph():
    """Get or build the compiled graph singleton."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
    return _compiled_graph


def _normalize_text(value: Any, max_length: int = 320) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return None
    if len(text) <= max_length:
        return text
    return f"{text[: max_length - 1].rstrip()}…"


def _normalize_memory(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _summarize_artifacts(artifacts: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    summary: list[dict[str, Any]] = []
    for artifact in artifacts or []:
        kind = str(artifact.get("kind", "")).lower()
        title = _normalize_text(artifact.get("title"), 120) or "Insight"
        if kind == "metric":
            signal = _normalize_text(artifact.get("value"), 80)
        elif kind == "chart":
            signal = f"{len(artifact.get('labels') or [])} titik tren"
        elif kind == "table":
            signal = f"{len(artifact.get('rows') or [])} baris peringkat"
        else:
            signal = None
        summary.append({"title": title, "kind": kind or "unknown", "signal": signal})
        if len(summary) >= 4:
            break
    return summary


def _summarize_findings(analysis_brief: dict[str, Any] | None, artifacts: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    findings = analysis_brief.get("findings") if isinstance(analysis_brief, dict) else None
    if isinstance(findings, list) and findings:
        normalized: list[dict[str, Any]] = []
        for finding in findings[:4]:
            if not isinstance(finding, dict):
                continue
            normalized.append(
                {
                    "title": _normalize_text(finding.get("insight") or finding.get("headline") or finding.get("title"), 140),
                    "why_it_matters": _normalize_text(finding.get("why_it_matters"), 200),
                    "recommended_visual": finding.get("recommended_visual"),
                    "priority": finding.get("priority"),
                }
            )
        normalized = [item for item in normalized if item.get("title")]
        if normalized:
            return normalized
    return _summarize_artifacts(artifacts)


def _build_initial_state(
    *,
    tenant_id: str,
    user_id: str,
    message: str,
    run_id: str,
    conversation_id: str | None = None,
    dashboard_id: str | None = None,
    history: list | None = None,
    dataset_ready: bool = False,
    user_display_name: str | None = None,
    dataset_profile: dict | None = None,
    saved_dashboard: dict | None = None,
    agent_state: dict | None = None,
) -> AgentState:
    persisted = agent_state if isinstance(agent_state, dict) else {}
    resolved_dataset_profile = dataset_profile or persisted.get("dataset_profile")

    return {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "conversation_id": conversation_id,
        "dashboard_id": dashboard_id,
        "message": message,
        "history": history or [],
        "dataset_ready": dataset_ready,
        "user_display_name": user_display_name,
        "dataset_profile": resolved_dataset_profile,
        "saved_dashboard": saved_dashboard,
        "memory": _normalize_memory(persisted.get("memory")),
        "active_run": persisted.get("active_run") if isinstance(persisted.get("active_run"), dict) else None,
        "route": None,
        "answer": "",
        "content_format": "plain",
        "analytics_intent": None,
        "query_result": None,
        "analysis_brief": None,
        "planner_steps": [],
        "dashboard_spec": None,
        "dashboard_validation": None,
        "widgets": [],
        "artifacts": [],
        "dashboard_summary": "",
        "review_verdict": None,
        "review_summary": None,
        "review_completeness": 0.0,
        "presentation_mode": "chat",
        "intent": {"intent": "conversation", "nlu_source": "langgraph"},
        "draft_dashboard": persisted.get("draft_dashboard") if isinstance(persisted.get("draft_dashboard"), dict) else None,
        "pending_approval": persisted.get("pending_approval") if isinstance(persisted.get("pending_approval"), dict) else None,
        "agent_dialogue": [],
        "trace": [],
        "run_id": run_id,
        "dashboard_retry_count": 0,
        "error": None,
    }


def _build_agent_state_snapshot(result: dict[str, Any], initial_state: AgentState) -> dict[str, Any]:
    prior_memory = _normalize_memory(initial_state.get("memory"))
    route = result.get("route") or {}
    analysis_brief = result.get("analysis_brief") or {}
    artifacts = result.get("artifacts") or []
    incoming_profile = result.get("dataset_profile") or initial_state.get("dataset_profile")
    draft_dashboard = result.get("draft_dashboard") if result.get("draft_dashboard") is not None else initial_state.get("draft_dashboard")
    pending_approval = result.get("pending_approval")

    route_action = str(route.get("action") or prior_memory.get("last_route") or "conversation").lower()
    analysis_summary = (
        analysis_brief.get("executive_summary")
        or analysis_brief.get("headline")
        or (result.get("answer") if route_action in {"analyze", "create_dashboard", "edit_dashboard", "inspect_dataset"} else None)
        or prior_memory.get("last_analysis_summary")
    )
    dashboard_goal = (
        (draft_dashboard.get("goal") if isinstance(draft_dashboard, dict) else None)
        or analysis_brief.get("business_goal")
        or prior_memory.get("last_dashboard_goal")
    )
    dashboard_id = (
        (draft_dashboard.get("saved_dashboard_id") if isinstance(draft_dashboard, dict) else None)
        or (initial_state.get("saved_dashboard") or {}).get("id")
        or prior_memory.get("current_dashboard_id")
    )
    dashboard_name = (
        (draft_dashboard.get("name") if isinstance(draft_dashboard, dict) else None)
        or (initial_state.get("saved_dashboard") or {}).get("name")
        or prior_memory.get("current_dashboard_name")
    )

    next_memory = {
        **prior_memory,
        "active_dataset_summary": _normalize_text((incoming_profile or {}).get("summary"), 280)
        or prior_memory.get("active_dataset_summary"),
        "last_route": route_action,
        "last_user_goal": _normalize_text(result.get("message") or initial_state.get("message"), 240),
        "last_time_scope": _normalize_text(
            (result.get("dashboard_spec") or {}).get("time_scope")
            or analysis_brief.get("time_scope")
            or prior_memory.get("last_time_scope"),
            120,
        ),
        "last_analysis_summary": _normalize_text(analysis_summary, 420) or prior_memory.get("last_analysis_summary"),
        "last_dashboard_goal": _normalize_text(dashboard_goal, 240) or prior_memory.get("last_dashboard_goal"),
        "current_dashboard_id": dashboard_id,
        "current_dashboard_name": _normalize_text(dashboard_name, 180) or prior_memory.get("current_dashboard_name"),
        "recent_findings": _summarize_findings(analysis_brief, artifacts) or prior_memory.get("recent_findings") or [],
    }

    return {
        "memory": next_memory,
        "dataset_profile": incoming_profile,
        "draft_dashboard": draft_dashboard,
        "pending_approval": pending_approval,
        "active_run": None,
    }


def _build_final_payload(result: dict[str, Any], run_id: str, initial_state: AgentState) -> dict[str, Any]:
    route_action = str((result.get("route") or {}).get("action") or "").lower()
    expose_draft = result.get("presentation_mode") == "canvas" or route_action in {"create_dashboard", "edit_dashboard"}
    return {
        "answer": result.get("answer", ""),
        "content_format": result.get("content_format", "plain"),
        "widgets": result.get("widgets", []),
        "artifacts": result.get("artifacts", []),
        "presentation_mode": result.get("presentation_mode", "chat"),
        "intent": result.get("intent", {"intent": "conversation", "nlu_source": "langgraph"}),
        "draft_dashboard": result.get("draft_dashboard") if expose_draft else None,
        "pending_approval": result.get("pending_approval"),
        "agent": {
            "mode": "langgraph",
            "run_id": run_id,
            "team": TEAM,
            "route": result.get("route"),
            "trace": result.get("trace", []),
            "fallback_used": False,
        },
        "agent_dialogue": result.get("agent_dialogue", []),
        "analysis_brief": result.get("analysis_brief"),
        "analytics_intent": result.get("analytics_intent"),
        "agent_state": _build_agent_state_snapshot(result, initial_state),
    }


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
    agent_state: dict | None = None,
) -> dict:
    """Run the full agent graph and return the result."""
    run_id = uuid.uuid4().hex[:16]
    initial_state = _build_initial_state(
        tenant_id=tenant_id,
        user_id=user_id,
        message=message,
        run_id=run_id,
        conversation_id=conversation_id,
        dashboard_id=dashboard_id,
        history=history,
        dataset_ready=dataset_ready,
        user_display_name=user_display_name,
        dataset_profile=dataset_profile,
        saved_dashboard=saved_dashboard,
        agent_state=agent_state,
    )

    graph = get_graph()

    try:
        result = await graph.ainvoke(initial_state)
    except Exception as exc:
        logger.exception("Agent graph execution failed")
        result = {
            **initial_state,
            "answer": "Maaf, terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi.",
            "error": str(exc),
        }

    return _build_final_payload(result, run_id, initial_state)


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
    agent_state: dict | None = None,
) -> AsyncGenerator[str, None]:
    """Stream NDJSON events from LangGraph execution."""
    run_id = uuid.uuid4().hex[:16]
    initial_state = _build_initial_state(
        tenant_id=tenant_id,
        user_id=user_id,
        message=message,
        run_id=run_id,
        conversation_id=conversation_id,
        dashboard_id=dashboard_id,
        history=history,
        dataset_ready=dataset_ready,
        user_display_name=user_display_name,
        dataset_profile=dataset_profile,
        saved_dashboard=saved_dashboard,
        agent_state=agent_state,
    )

    graph = get_graph()

    yield json.dumps(
        {
            "type": "start",
            "payload": {
                "run_id": run_id,
                "agent": TEAM["surface"],
                "title": "Vira membaca permintaan Anda",
            },
        }
    ) + "\n"

    final_state: dict[str, Any] = dict(initial_state)

    try:
        async for chunk_type, chunk in graph.astream(initial_state, stream_mode=["updates", "values"]):
            if chunk_type == "values":
                final_state = chunk
                continue

            if chunk_type != "updates":
                continue

            for node_name, state_update in chunk.items():
                if node_name == "orchestrator":
                    route = state_update.get("route", {})
                    yield json.dumps(
                        {
                            "type": "step",
                            "payload": {
                                "run_id": run_id,
                                "agent": TEAM["orchestrator"],
                                "title": f"Atlas memilih jalur {route.get('action')}",
                                "status": "done",
                            },
                        }
                    ) + "\n"
                elif node_name == "dashboard_analyst_brief":
                    yield json.dumps(
                        {
                            "type": "timeline",
                            "payload": {
                                "id": f"analyst_{uuid.uuid4().hex[:8]}",
                                "status": "done",
                                "title": "Raka menyusun temuan utama sebelum dashboard dibuat",
                                "agent": "analyst",
                            },
                        }
                    ) + "\n"
                elif node_name == "planner":
                    yield json.dumps(
                        {
                            "type": "timeline",
                            "payload": {
                                "id": f"planner_{uuid.uuid4().hex[:8]}",
                                "status": "done",
                                "title": "Citra membuat rencana dashboard",
                                "agent": "creator",
                            },
                        }
                    ) + "\n"
                elif node_name == "dashboard_spec":
                    candidate_widgets = ((state_update.get("dashboard_spec") or {}).get("candidate_widgets") or [])
                    yield json.dumps(
                        {
                            "type": "timeline",
                            "payload": {
                                "id": f"spec_{uuid.uuid4().hex[:8]}",
                                "status": "done",
                                "title": f"Spesifikasi dashboard disusun untuk {len(candidate_widgets)} kandidat visual",
                                "agent": "creator",
                            },
                        }
                    ) + "\n"
                elif node_name == "worker":
                    widgets = state_update.get("widgets", [])
                    draft_dashboard = state_update.get("draft_dashboard") or {}
                    yield json.dumps(
                        {
                            "type": "timeline",
                            "payload": {
                                "id": f"worker_{uuid.uuid4().hex[:8]}",
                                "status": "done" if widgets else "error",
                                "title": draft_dashboard.get("note") or f"Citra mengeksekusi {len(widgets)} visual tervalidasi",
                                "agent": "creator",
                            },
                        }
                    ) + "\n"
                    if draft_dashboard:
                        yield json.dumps(
                            {
                                "type": "dashboard_patch",
                                "payload": {
                                    "run_id": run_id,
                                    "note": draft_dashboard.get("note"),
                                    "draft_dashboard": draft_dashboard,
                                },
                            }
                        ) + "\n"
                elif node_name == "argus":
                    verdict = state_update.get("review_verdict")
                    yield json.dumps(
                        {
                            "type": "timeline",
                            "payload": {
                                "id": f"argus_{uuid.uuid4().hex[:8]}",
                                "status": "done" if verdict == "pass" else "error",
                                "title": state_update.get("review_summary") or f"Argus mereview hasil: {verdict}",
                                "agent": "curator",
                            },
                        }
                    ) + "\n"

        yield json.dumps(
            {
                "type": "final",
                "payload": _build_final_payload(final_state, run_id, initial_state),
            }
        ) + "\n"
    except Exception as exc:
        logger.exception("Agent graph stream execution failed")
        yield json.dumps(
            {
                "type": "error",
                "payload": {
                    "message": "Maaf, terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi.",
                    "error": str(exc),
                },
            }
        ) + "\n"
