"""Surface node — generates natural conversational replies.

Replaces the legacy JS surface reply generator.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from agent.config import settings
from agent.graph.state import AgentState
from agent.llm import extract_text, get_llm
from agent.prompts import VIRA_SURFACE, VIRA_SURFACE_WITH_DATA, TEAM

logger = logging.getLogger(__name__)


def _build_history_context(history: list[dict[str, Any]], limit: int = 10) -> str:
    recent = history[-limit:] if history else []
    return "\n".join(f"{item.get('role', 'user')}: {str(item.get('content', '')).strip()}" for item in recent)


def _workflow_summary(state: AgentState) -> str:
    memory = state.get("memory") if isinstance(state.get("memory"), dict) else {}
    parts = []
    if state.get("draft_dashboard"):
        parts.append("Ada draft dashboard aktif yang bisa dilanjutkan.")
    elif state.get("saved_dashboard"):
        parts.append("Ada dashboard tersimpan yang masih relevan.")
    if memory.get("last_analysis_summary"):
        parts.append(f"Ringkasan analisis terakhir: {memory['last_analysis_summary']}")
    if memory.get("last_dashboard_goal"):
        parts.append(f"Tujuan dashboard terakhir: {memory['last_dashboard_goal']}")
    return "\n".join(parts)


async def surface_node(state: AgentState) -> dict[str, Any]:
    """Generate a natural conversational reply for the user.

    Used for greetings, smalltalk, clarification, and no-dataset prompts.
    """
    llm = get_llm(
        model=settings.gemini_model_light,
        temperature=0.4,
        top_p=0.9,
        top_k=40,
        max_output_tokens=320,
    )

    route = state.get("route", {}) or {}
    route_reason = route.get("reason", "")

    system_parts = [
        f"Kamu adalah {TEAM['surface']}, wajah percakapan Vistara untuk user bisnis non-teknis.",
        VIRA_SURFACE,
        "Dataset tersedia." if state.get("dataset_ready") else "Dataset belum tersedia.",
        f"Konteks keputusan Atlas: {route_reason}." if route_reason else "",
        _workflow_summary(state),
    ]
    system_prompt = "\n\n".join(p for p in system_parts if p)

    history_ctx = _build_history_context(state.get("history", []))
    message = state.get("message", "")

    if history_ctx:
        user_prompt = f"Riwayat:\n{history_ctx}\n\nPesan terbaru: {message}"
    else:
        user_prompt = f"Pesan terbaru: {message}"

    try:
        response = await llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt),
            ],
        )
        answer = extract_text(response)
        if not answer:
            answer = "Saya siap membantu. Ada yang bisa saya bantu terkait analisis bisnis Anda?"
    except Exception as e:
        logger.warning("Surface reply generation failed: %s", e)
        answer = "Saya siap membantu. Ada yang bisa saya bantu terkait analisis bisnis Anda?"

    return {
        "answer": answer,
        "content_format": "plain",
        "presentation_mode": "chat",
        "widgets": [],
        "artifacts": [],
        "intent": {
            "intent": route.get("action", "conversation"),
            "nlu_source": "langgraph",
        },
    }

async def surface_with_data_node(state: AgentState) -> dict[str, Any]:
    """Generate a natural explanation of analytics data.
    
    This replaces the hardcoded `describeResult` function in Node.js,
    allowing the LLM to humanize the raw data dynamically.
    """
    query_result = state.get("query_result", {})
    error = state.get("error")

    # If analytics execution failed, generate an error-aware reply
    # instead of falling back to generic surface_node (which might say "upload data")
    if not query_result and error:
        logger.warning("Analytics execution failed, generating error-aware response: %s", error)
        return {
            "answer": (
                "Maaf, saat ini saya mengalami kendala teknis saat menarik data Anda. "
                "Data Anda sudah tersimpan dengan aman — silakan coba kirim permintaan yang sama lagi, "
                "atau ajukan pertanyaan lain tentang data Anda."
            ),
            "content_format": "plain",
            "presentation_mode": "chat",
            "widgets": [],
            "artifacts": [],
            "intent": {
                "intent": "analyze",
                "nlu_source": "langgraph_analytics_error",
            },
        }

    # If no result and no error (shouldn't normally happen), give a contextual response
    if not query_result:
        dataset_hint = (
            "Data Anda sudah tersimpan. Coba ajukan pertanyaan spesifik seperti "
            "\"berapa total omzet bulan ini?\" atau \"produk apa yang paling laku?\""
        ) if state.get("dataset_ready") else (
            "Silakan unggah file data Anda terlebih dahulu, lalu ajukan pertanyaan tentang data tersebut."
        )
        return {
            "answer": dataset_hint,
            "content_format": "plain",
            "presentation_mode": "chat",
            "widgets": [],
            "artifacts": [],
            "intent": {
                "intent": "analyze",
                "nlu_source": "langgraph_analytics_empty",
            },
        }

    llm = get_llm(
        model=settings.gemini_model_light,
        temperature=0.35,
        top_p=0.9,
        top_k=40,
        max_output_tokens=320,
    )
    
    system_prompt = f"Kamu adalah {TEAM['surface']}, asisten bisnis UMKM.\n\n{VIRA_SURFACE_WITH_DATA}"
    workflow_summary = _workflow_summary(state)
    if workflow_summary:
        system_prompt = f"{system_prompt}\n\nKonteks workflow:\n{workflow_summary}"
    
    # We ask the LLM to explain the raw data it received
    user_prompt = (
        f"Pertanyaan/Request User: {state.get('message', '')}\n\n"
        f"Hasil Data Analytics (JSON):\n{query_result}"
    )
    
    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ])
        answer = extract_text(response)
        if not answer:
            answer = "Berikut adalah data yang Anda minta."
    except Exception as e:
        logger.warning("Data humanization failed: %s", e)
        answer = "Berikut adalah data yang Anda minta."
        
    intent = state.get("analytics_intent", {})
    
    return {
        "answer": answer,
        "content_format": "markdown",
        "presentation_mode": "chat",
        "intent": {
            "intent": intent.get("intent", "analyze"),
            "nlu_source": "langgraph_analytics",
        },
    }
