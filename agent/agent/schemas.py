"""Pydantic models for API request/response schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ── Request Models ──────────────────────────────────────────────────────────


class ChatRequest(BaseModel):
    """Incoming chat message from the Node.js proxy."""

    tenant_id: str
    user_id: str
    conversation_id: str | None = None
    dashboard_id: str | None = None
    message: str
    history: list[dict[str, Any]] = Field(default_factory=list)
    dataset_ready: bool = False
    user_display_name: str | None = None
    dataset_profile: dict[str, Any] | None = None
    saved_dashboard: dict[str, Any] | None = None


class ApprovalRequest(BaseModel):
    """User approval/rejection of a pending action."""

    tenant_id: str
    user_id: str
    conversation_id: str
    decision: str  # "approve" or "reject"


# ── Response Models ─────────────────────────────────────────────────────────


class WidgetLayout(BaseModel):
    page: int = 1
    x: int = 0
    y: int = 0
    w: int = 4
    h: int = 2


class Widget(BaseModel):
    id: str | None = None
    title: str = "Widget"
    kind: str = "metric"
    artifact: dict[str, Any] | None = None
    layout: WidgetLayout | None = None
    query: dict[str, Any] | None = None
    finding_id: str | None = None
    rationale: str | None = None


class AgentInfo(BaseModel):
    mode: str = "langgraph"
    run_id: str = ""
    team: dict[str, str] = Field(default_factory=dict)
    route: dict[str, Any] | None = None
    trace: list[dict[str, Any]] = Field(default_factory=list)
    fallback_used: bool = False


class IntentInfo(BaseModel):
    intent: str = "conversation"
    nlu_source: str = "langgraph"


class ChatResponse(BaseModel):
    """Full response returned from the agent backend."""

    answer: str = ""
    content_format: str = "plain"  # "plain" or "markdown"
    widgets: list[Widget] = Field(default_factory=list)
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    presentation_mode: str = "chat"  # "chat" or "canvas"
    intent: IntentInfo = Field(default_factory=IntentInfo)
    draft_dashboard: dict[str, Any] | None = None
    pending_approval: dict[str, Any] | None = None
    agent: AgentInfo = Field(default_factory=AgentInfo)
    agent_dialogue: list[dict[str, Any]] = Field(default_factory=list)
    analysis_brief: dict[str, Any] | None = None
    analytics_intent: dict[str, Any] | None = None
