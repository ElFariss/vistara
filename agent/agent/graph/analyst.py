"""Analyst node — builds analytics intents from user questions.

Replaces the legacy JS analytics intent builder.
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
from agent.prompts import RAKA_ANALYST, TEAM

logger = logging.getLogger(__name__)

VALID_INTENTS = frozenset(["show_metric", "compare", "rank", "explain"])


async def analyst_node(state: AgentState) -> dict[str, Any]:
    """Transform a user question into a structured analytics intent.

    This intent is then used to execute the appropriate query.
    """
    llm = get_llm(
        model=settings.gemini_model_light,
        temperature=0.1,
        max_output_tokens=512,
    )

    route = state.get("route", {}) or {}

    system_prompt = (
        f"Kamu adalah {TEAM['analyst']}, data analyst agent Vistara.\n"
        f"{RAKA_ANALYST}\n"
        "Ubah pertanyaan bisnis user menjadi parameter analytics yang aman dan grounded.\n"
        "PENTING: Kamu WAJIB menyertakan 'template_id' yang paling cocok untuk menjawab pertanyaan user.\n"
        "Daftar template_id yang valid:\n"
        "- total_revenue : Untuk total omzet/penjualan/revenue\n"
        "- total_profit : Untuk total keuntungan/laba\n"
        "- margin_percentage : Untuk mencar% margin keuntungan\n"
        "- revenue_trend : Untuk melihat tren omzet dari waktu ke waktu (grafik garis)\n"
        "- top_products : Untuk melihat produk paling laku/terlaris\n"
        "- branch_performance : Untuk melihat performa per cabang\n"
        "- total_expense : Untuk total pengeluaran/biaya\n\n"
        "Pilih rank bila user meminta top/ranking, compare bila membandingkan periode, explain bila meminta penjelasan, selain itu show_metric."
    )

    intent_schema = {
        "type": "object",
        "properties": {
            "intent": {"type": "string", "enum": list(VALID_INTENTS)},
            "metric": {"type": "string"},
            "visualization": {"type": "string"},
            "dimension": {"type": "string"},
            "time_period": {"type": "string"},
            "limit": {"type": "number"},
            "branch": {"type": "string"},
            "channel": {"type": "string"},
            "template_id": {
                "type": "string",
                "enum": [
                    "total_revenue", "total_profit", "margin_percentage",
                    "revenue_trend", "top_products", "branch_performance",
                    "total_expense"
                ]
            },
        },
        "required": ["intent", "metric", "template_id"],
    }

    user_context = json.dumps(
        {
            "message": state.get("message", ""),
            "route": route,
            "dataset_profile": _compact_dataset_profile(state.get("dataset_profile")),
        },
        ensure_ascii=False,
    )

    try:
        response = await llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=f"Convert to analytics intent. Reply as JSON matching: {json.dumps(intent_schema)}\n\n{user_context}"
                ),
            ],
        )

        text = extract_text(response)
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)

        # Try to extract JSON object if the LLM wrapped it in extra text
        json_match = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", text, re.DOTALL)
        if json_match:
            text = json_match.group(0)

        intent = json.loads(text)

        # Normalize
        parsed_intent = str(intent.get("intent", "show_metric")).strip().lower()
        if parsed_intent not in VALID_INTENTS:
            parsed_intent = "show_metric"
        intent["intent"] = parsed_intent
        intent.setdefault("metric", route.get("metric", "revenue"))
        intent.setdefault("time_period", route.get("time_period", "7 hari terakhir"))
        if not intent.get("template_id"):
            intent["template_id"] = "total_revenue"
        intent["nlu_source"] = "langgraph_analyst"

    except Exception as e:
        logger.warning("Analyst intent extraction failed: %s", e)
        intent = {
            "intent": "show_metric",
            "metric": route.get("metric", "revenue"),
            "template_id": "total_revenue",
            "time_period": route.get("time_period", "7 hari terakhir"),
            "nlu_source": "langgraph_analyst_fallback",
        }

    return {
        "analytics_intent": intent,
        "intent": {"intent": intent["intent"], "nlu_source": intent.get("nlu_source", "langgraph")},
        "trace": state.get("trace", []) + [{"step": "analyst", "intent": intent}],
    }


def _compact_dataset_profile(profile: dict[str, Any] | None) -> dict[str, Any] | None:
    """Compact a dataset profile for the LLM context window."""
    if not profile:
        return None

    columns = profile.get("columns", [])
    return {
        "summary": profile.get("summary"),
        "detected": profile.get("detected"),
        "columns": [
            {
                "name": c.get("name"),
                "kind": c.get("kind"),
                "sample_values": (c.get("sample_values") or [])[:3],
            }
            for c in (columns[:12] if isinstance(columns, list) else [])
        ],
    }
