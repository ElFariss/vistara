"""Orchestrator node — classifies user messages into action routes.

Replaces the legacy JS route classifier with an LLM-backed router.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from agent.config import settings
from agent.graph.state import AgentState
from agent.llm import extract_text, get_llm
from agent.prompts import ATLAS_ORCHESTRATOR, TEAM

logger = logging.getLogger(__name__)

VALID_ACTIONS = frozenset([
    "conversational",
    "analyze",
    "inspect_dataset",
    "create_dashboard",
    "edit_dashboard",
    "ask_clarification",
])

EDIT_HINT_PATTERN = re.compile(
    r"\b(edit|ubah|update|revisi|refine|perbaiki|tambah|tambahkan|kurangi|hapus|detail|detailkan|rapikan|fokus|filter|halaman|page)\b",
    flags=re.IGNORECASE,
)

DASHBOARD_PATTERN = re.compile(r"\b(dashboard|dash|canvas)\b", flags=re.IGNORECASE)
ACK_PATTERN = re.compile(r"\b(ok|oke|siap|sip|mantap|thanks|thank you|makasih|terima kasih)\b", flags=re.IGNORECASE)


def _strip_code_fences(text: str) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    if value.startswith("```"):
        value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.IGNORECASE)
        value = re.sub(r"\s*```$", "", value)
    return value.strip()


def _extract_balanced_json_object(text: str) -> str | None:
    source = str(text or "")
    if "{" not in source:
        return None

    start = source.find("{")
    depth = 0
    in_string = False
    escaped = False

    for index in range(start, len(source)):
        char = source[index]

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start:index + 1]

    return None


def _extract_loose_route_fields(text: str) -> dict[str, Any]:
    source = str(text or "")
    route: dict[str, Any] = {}

    string_fields = ("action", "reason", "time_period", "metric")
    for field in string_fields:
        match = re.search(rf'"{field}"\s*:\s*"([^"\n\r}}]*)', source, flags=re.IGNORECASE)
        if match:
            route[field] = match.group(1).strip()
            continue

        # Fallback for single-quoted pseudo JSON
        single_match = re.search(rf"'{field}'\s*:\s*'([^'\n\r}}]*)", source, flags=re.IGNORECASE)
        if single_match:
            route[field] = single_match.group(1).strip()

    return route


def _parse_route_response(text: str) -> dict[str, Any] | None:
    cleaned = _strip_code_fences(text)
    if not cleaned:
        return None

    candidates = [cleaned]
    balanced = _extract_balanced_json_object(cleaned)
    if balanced and balanced not in candidates:
        candidates.append(balanced)

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue

    loose = _extract_loose_route_fields(cleaned)
    return loose if loose else None


def _normalize_action(value: Any) -> str:
    action = str(value or "").strip().lower()
    return action if action in VALID_ACTIONS else "ask_clarification"


def _build_system_prompt(state: AgentState) -> str:
    """Build orchestrator system prompt with context."""
    parts = [
        f"Kamu adalah {TEAM['orchestrator']}, orchestrator agent untuk Vistara.",
        ATLAS_ORCHESTRATOR,
        "Jika belum jelas, gunakan ask_clarification.",
    ]
    if state.get("user_display_name"):
        parts.append(f"Nama user: {state['user_display_name']}.")
    else:
        parts.append("Nama user belum diketahui.")

    if state.get("dataset_ready"):
        parts.append("Dataset user tersedia.")
    else:
        parts.append("Dataset user belum tersedia.")

    memory = state.get("memory") if isinstance(state.get("memory"), dict) else {}
    if state.get("draft_dashboard"):
        parts.append("Ada draft dashboard aktif di percakapan ini.")
    elif state.get("saved_dashboard"):
        parts.append("Ada dashboard tersimpan yang terkait percakapan ini.")
    if memory.get("last_analysis_summary"):
        parts.append(f"Ringkasan analisis terakhir: {memory['last_analysis_summary']}.")
    if memory.get("last_dashboard_goal"):
        parts.append(f"Tujuan dashboard terakhir: {memory['last_dashboard_goal']}.")

    return " ".join(parts)


def _build_history_context(history: list[dict[str, Any]], limit: int = 10) -> str:
    """Compact recent history into a string."""
    recent = history[-limit:] if history else []
    return "\n".join(f"{item.get('role', 'user')}: {str(item.get('content', '')).strip()}" for item in recent)


def _workflow_context(state: AgentState) -> dict[str, Any]:
    memory = state.get("memory") if isinstance(state.get("memory"), dict) else {}
    draft = state.get("draft_dashboard") if isinstance(state.get("draft_dashboard"), dict) else None
    saved = state.get("saved_dashboard") if isinstance(state.get("saved_dashboard"), dict) else None
    return {
        "has_draft_dashboard": bool(draft),
        "has_saved_dashboard": bool(saved),
        "last_route": memory.get("last_route"),
        "last_dashboard_goal": memory.get("last_dashboard_goal"),
        "last_analysis_summary": memory.get("last_analysis_summary"),
        "recent_findings": memory.get("recent_findings") if isinstance(memory.get("recent_findings"), list) else [],
    }


def _message_mentions_dashboard(message: Any) -> bool:
    return bool(DASHBOARD_PATTERN.search(str(message or "")))


def _message_looks_like_dashboard_edit(message: Any, workflow: dict[str, Any]) -> bool:
    source = str(message or "").strip()
    if not source:
        return False
    if EDIT_HINT_PATTERN.search(source):
        return True
    if (
        str(workflow.get("last_route") or "").lower() in {"create_dashboard", "edit_dashboard"}
        and len(source.split()) <= 8
        and not _message_mentions_dashboard(source)
        and not ACK_PATTERN.search(source)
    ):
        return True
    return False


def _apply_workflow_bias(state: AgentState, route: dict[str, Any]) -> dict[str, Any]:
    next_route = dict(route or {})
    action = _normalize_action(next_route.get("action"))
    workflow = _workflow_context(state)
    message = state.get("message", "")

    has_existing_dashboard = workflow["has_draft_dashboard"] or workflow["has_saved_dashboard"]
    has_analysis_context = bool(workflow.get("last_analysis_summary") or workflow.get("recent_findings"))

    if has_existing_dashboard and _message_looks_like_dashboard_edit(message, workflow):
        action = "edit_dashboard"
        next_route.setdefault("reason", "workflow_bias_existing_dashboard")

    if _message_mentions_dashboard(message) and state.get("dataset_ready"):
        if action in {"ask_clarification", "inspect_dataset"}:
            action = "create_dashboard"
            next_route["reason"] = "workflow_bias_dashboard_request"
        if has_analysis_context:
            next_route["reuse_existing_analysis"] = True

    next_route["action"] = action
    return next_route


async def orchestrator_node(state: AgentState) -> dict[str, Any]:
    """Classify the user message and produce a route decision.

    Returns a partial state dict with the 'route' key set.
    """
    llm = get_llm(
        model=settings.gemini_model_light,
        temperature=0.1,
        top_p=0.85,
        top_k=32,
        max_output_tokens=256,
        json_mode=True,
    )

    system_prompt = _build_system_prompt(state)
    user_context = json.dumps(
        {
            "message": state.get("message", ""),
            "history": _build_history_context(state.get("history", [])),
            "workflow_state": _workflow_context(state),
        },
        ensure_ascii=False,
    )

    route_schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": list(VALID_ACTIONS),
            },
            "reason": {"type": "string"},
            "time_period": {"type": "string"},
            "metric": {"type": "string"},
        },
        "required": ["action"],
    }

    try:
        response = await llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=f"Classify this request. Reply with a JSON object matching this schema: {json.dumps(route_schema)}\n\n{user_context}"
                ),
            ],
        )

        text = extract_text(response)
        route = _parse_route_response(text)
        if not route:
            raise ValueError("unable_to_parse_route_json")
        route["action"] = _normalize_action(route.get("action"))
        route = _apply_workflow_bias(state, route)

    except Exception as e:
        logger.warning("Orchestrator classification failed: %s | raw=%r", e, locals().get("text", "")[:240])
        # On LLM failure, ask user to clarify — do NOT use hardcoded keyword matching
        route = _apply_workflow_bias(state, {"action": "ask_clarification", "reason": f"classification_error: {e}"})

    return {
        "route": route,
        "trace": state.get("trace", []) + [{"step": "orchestrator", "route": route}],
    }
