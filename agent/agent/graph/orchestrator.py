"""Orchestrator node — classifies user messages into action routes.

Replaces the legacy JS route classifier with an LLM-backed router.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import JsonOutputParser

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

        # Parse the response as JSON
        text = extract_text(response)
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)

        # Try to extract JSON object if the LLM wrapped it in extra text
        json_match = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", text, re.DOTALL)
        if json_match:
            text = json_match.group(0)

        route = json.loads(text)
        action = str(route.get("action", "ask_clarification")).strip().lower()
        if action not in VALID_ACTIONS:
            action = "ask_clarification"

        route["action"] = action

    except Exception as e:
        logger.warning("Orchestrator classification failed: %s", e)
        # On LLM failure, ask user to clarify — do NOT use hardcoded keyword matching
        route = {"action": "ask_clarification", "reason": f"classification_error: {e}"}

    return {
        "route": route,
        "trace": state.get("trace", []) + [{"step": "orchestrator", "route": route}],
    }
