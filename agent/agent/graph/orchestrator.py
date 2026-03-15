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

    return " ".join(parts)


def _build_history_context(history: list[dict[str, Any]], limit: int = 10) -> str:
    """Compact recent history into a string."""
    recent = history[-limit:] if history else []
    return "\n".join(f"{item.get('role', 'user')}: {str(item.get('content', '')).strip()}" for item in recent)


async def orchestrator_node(state: AgentState) -> dict[str, Any]:
    """Classify the user message and produce a route decision.

    Returns a partial state dict with the 'route' key set.
    """
    llm = get_llm(
        model=settings.gemini_model_light,
        temperature=0.1,
        max_output_tokens=512,
    )

    system_prompt = _build_system_prompt(state)
    user_context = json.dumps(
        {
            "message": state.get("message", ""),
            "history": _build_history_context(state.get("history", [])),
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

    except Exception as e:
        logger.warning("Orchestrator classification failed: %s | raw=%r", e, locals().get("text", "")[:240])
        # On LLM failure, ask user to clarify — do NOT use hardcoded keyword matching
        route = {"action": "ask_clarification", "reason": f"classification_error: {e}"}

    return {
        "route": route,
        "trace": state.get("trace", []) + [{"step": "orchestrator", "route": route}],
    }
