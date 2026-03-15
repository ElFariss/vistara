"""Agent state definition for LangGraph.

This TypedDict is the shared state passed between all nodes in the graph.
It replaces the ad-hoc state objects from the legacy JS agent runtime.
"""

from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import MessagesState


class AgentState(TypedDict, total=False):
    """Shared state flowing through the Vistara agent graph.

    Every node reads from and writes to this state dict.
    LangGraph handles merging between nodes automatically.
    """

    # ── Input fields (set once at entry) ────────────────────────────────
    tenant_id: str
    user_id: str
    conversation_id: str | None
    dashboard_id: str | None
    message: str
    history: list[dict[str, Any]]
    dataset_ready: bool
    user_display_name: str | None
    dataset_profile: dict[str, Any] | None
    saved_dashboard: dict[str, Any] | None

    # ── Orchestrator output ─────────────────────────────────────────────
    route: dict[str, Any] | None  # {"action": "conversational"|"analyze"|..., "reason": ...}

    # ── Surface output ──────────────────────────────────────────────────
    answer: str
    content_format: str  # "plain" or "markdown"

    # ── Analyst output ──────────────────────────────────────────────────
    analytics_intent: dict[str, Any] | None

    # ── Query engine output ─────────────────────────────────────────────
    query_result: dict[str, Any] | None

    # ── Dashboard sub-graph output ──────────────────────────────────────
    analysis_brief: dict[str, Any] | None
    planner_steps: list[str]
    widgets: list[dict[str, Any]]
    artifacts: list[dict[str, Any]]
    dashboard_summary: str

    # ── Argus review ────────────────────────────────────────────────────
    review_verdict: str | None  # "pass" | "fail"
    review_summary: str | None
    review_completeness: float

    # ── Shared output ───────────────────────────────────────────────────
    presentation_mode: str  # "chat" or "canvas"
    intent: dict[str, Any]
    draft_dashboard: dict[str, Any] | None
    pending_approval: dict[str, Any] | None
    agent_dialogue: list[dict[str, Any]]
    trace: list[dict[str, Any]]
    run_id: str

    # ── Error handling ──────────────────────────────────────────────────
    error: str | None
