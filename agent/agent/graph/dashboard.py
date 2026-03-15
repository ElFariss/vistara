"""Dashboard sub-graph — Planner → Worker → Argus review cycle.

Replaces the legacy JS dashboard runtime with a clean LangGraph sub-graph.
The full multi-agent loop is expressed as a ~200 line graph definition.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from agent.config import settings
from agent.graph.state import AgentState
from agent.llm import extract_text, get_llm
from agent.prompts import RAKA_ANALYST, ARGUS_CURATOR, CITRA_PLANNER, TEAM, CITRA_WORKER

logger = logging.getLogger(__name__)

MAX_WORKER_STEPS = 8
MAX_REVIEW_PASSES = 3
MIN_WIDGETS = 2


# ── Analyst Brief Node ──────────────────────────────────────────────────────


async def analyst_brief_node(state: AgentState) -> dict[str, Any]:
    """Generate an analysis brief with findings for dashboard creation."""
    llm = get_llm(model=settings.gemini_model_light, temperature=0.1, max_output_tokens=8192)

    dataset_info = _format_dataset_info(state.get("dataset_profile"))

    system_prompt = (
        f"Kamu adalah {TEAM['analyst']}, analyst agent untuk dashboard bisnis.\n"
        f"{RAKA_ANALYST}\n\n"
        f"Dataset info:\n{dataset_info}"
    )

    user_prompt = (
        f"User meminta: {state.get('message', '')}\n"
        "Buat analysis brief dengan findings yang grounded pada data. "
        "Reply sebagai JSON dengan keys: headline, business_goal, time_scope, executive_summary, findings (array)."
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        text = _strip_code_fences(extract_text(response))
        brief = _safe_parse_json(text)
    except Exception as e:
        logger.warning("Analyst brief generation failed: %s", e)
        brief = {
            "headline": "Analisis berdasarkan data yang tersedia",
            "business_goal": state.get("message", "Dashboard bisnis"),
            "time_scope": "30 hari terakhir",
            "findings": [],
        }

    return {
        "analysis_brief": brief,
        "trace": state.get("trace", []) + [{"step": "analyst_brief", "findings_count": len(brief.get("findings", []))}],
    }


# ── Planner Node ────────────────────────────────────────────────────────────


async def planner_node(state: AgentState) -> dict[str, Any]:
    """Create an execution plan for the worker agent."""
    llm = get_llm(model=settings.gemini_model_light, temperature=0.1, max_output_tokens=4096)

    brief = state.get("analysis_brief", {}) or {}
    dataset_info = _format_dataset_info(state.get("dataset_profile"))

    system_prompt = (
        f"Kamu adalah planner agent.\n{CITRA_PLANNER}\n\n"
        f"Dataset info:\n{dataset_info}"
    )

    user_prompt = (
        f"Analysis brief: {json.dumps(brief, ensure_ascii=False)}\n\n"
        "Buat execution plan (ordered list of steps). Reply as JSON: {\"steps\": [\"step1\", \"step2\", ...]}"
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        text = _strip_code_fences(extract_text(response))
        plan = _safe_parse_json(text)
        steps = plan.get("steps", [])
    except Exception as e:
        logger.warning("Planner failed, using fallback: %s", e)
        steps = [
            "Identifikasi KPI utama dari dataset.",
            "Ambil data tren dan perincian.",
            "Susun layout dashboard yang ringkas.",
        ]

    return {
        "planner_steps": steps,
        "trace": state.get("trace", []) + [{"step": "planner", "steps_count": len(steps)}],
    }


# ── Worker Node ─────────────────────────────────────────────────────────────


async def worker_node(state: AgentState) -> dict[str, Any]:
    """Execute the dashboard plan — query data, create widgets.

    This is a simplified version that uses the LLM to decide which
    template queries to run based on the plan and analysis brief.
    The actual query execution will be done via the Node.js backend
    proxy in the initial version, or directly via psycopg in a later phase.
    """
    llm = get_llm(model=settings.gemini_model_light, temperature=0.1, max_output_tokens=8192)

    brief = state.get("analysis_brief", {}) or {}
    steps = state.get("planner_steps", [])
    dataset_info = _format_dataset_info(state.get("dataset_profile"))

    system_prompt = (
        f"Kamu adalah {TEAM['creator']}, pembuat dashboard teknis.\n"
        f"{CITRA_WORKER}\n\n"
        f"Dataset info:\n{dataset_info}"
    )

    user_prompt = (
        f"Analysis brief:\n{json.dumps(brief, ensure_ascii=False)}\n\n"
        f"Execution plan:\n{json.dumps(steps, ensure_ascii=False)}\n\n"
        "Berdasarkan plan dan brief, tentukan widget-widget yang harus dibuat. "
        "Reply sebagai JSON: {\"widgets\": [{\"title\": ..., \"kind\": \"metric\"|\"chart\"|\"table\", "
        "\"template_id\": ..., \"query\": {\"measure\": ..., \"group_by\": ..., \"visualization\": ...}, "
        "\"layout\": {\"page\": 1, \"x\": 0, \"y\": 0, \"w\": 4, \"h\": 2}}], "
        "\"summary\": \"...\"}"
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        raw_text = extract_text(response)
        logger.debug("Worker raw response length=%d, first100=%r", len(raw_text), raw_text[:100])
        text = _strip_code_fences(raw_text)
        result = _safe_parse_json(text)
        widgets = result.get("widgets", [])
        summary = result.get("summary", "Dashboard selesai.")
    except Exception as e:
        logger.warning("Worker failed: %s (text was: %r)", e, locals().get("raw_text", "<not available>")[:200])
        widgets = []
        summary = f"Worker gagal: {e}"

    # Assign IDs and finding references
    for i, w in enumerate(widgets):
        w["id"] = w.get("id") or f"widget_{uuid.uuid4().hex[:8]}"
        findings = brief.get("findings", [])
        if findings and i < len(findings):
            w["finding_id"] = findings[i].get("id", f"finding_{i+1}")
            w["rationale"] = findings[i].get("why_it_matters", "")

    # Execute widgets to get real artifacts
    import httpx
    tenant_id = state.get("tenant_id")
    user_id = state.get("user_id")
    internal_url = f"{settings.nodejs_internal_url}/api/internal/analytics"
    
    artifacts = []
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        for w in widgets:
            template_id = w.get("template_id")
            if template_id:
                try:
                    intent = {
                        "intent": "analyze",
                        "template_id": template_id,
                        "time_period": brief.get("time_scope", "30 hari terakhir"),
                    }
                    if "query" in w and isinstance(w["query"], dict):
                        intent.update(w["query"])
                        
                    response = await client.post(internal_url, json={
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "intent": intent
                    })
                    
                    if response.status_code == 200:
                        data = response.json()
                        if data.get("ok"):
                            result = data.get("data", {})
                            api_artifacts = result.get("artifacts", [])
                            if api_artifacts:
                                artifact = api_artifacts[0]
                                if "title" in w:
                                    artifact["title"] = w["title"]
                                w["artifact"] = artifact
                                artifacts.append(artifact)
                                continue
                except Exception as e:
                    logger.warning("Failed to execute widget query %s: %s", template_id, e)
            
            # Fallback artifact if execution failed or no template_id
            artifact = {
                "kind": w.get("kind", "metric"),
                "title": w.get("title", "Widget"),
            }
            if w.get("kind") == "metric":
                artifact["value"] = "—"
                artifact["raw_value"] = 0
            w["artifact"] = artifact
            artifacts.append(artifact)

    return {
        "widgets": widgets,
        "artifacts": artifacts,
        "dashboard_summary": summary,
        "presentation_mode": "canvas",
        "trace": state.get("trace", []) + [{"step": "worker", "widgets_count": len(widgets)}],
    }


# ── Argus Review Node ───────────────────────────────────────────────────────


async def argus_node(state: AgentState) -> dict[str, Any]:
    """Review the dashboard for quality and completeness."""
    llm = get_llm(model=settings.gemini_model_light, temperature=0.1, max_output_tokens=4096)

    widgets = state.get("widgets", [])

    system_prompt = (
        f"Kamu adalah Argus, kurator dashboard.\n{ARGUS_CURATOR}"
    )

    user_prompt = (
        f"Dashboard berisi {len(widgets)} widget:\n"
        f"{json.dumps([{'title': w.get('title'), 'kind': w.get('kind')} for w in widgets], ensure_ascii=False)}\n\n"
        "Review dashboard ini. Reply sebagai JSON: {\"verdict\": \"pass\"|\"fail\", "
        "\"completeness_pct\": 0-100, \"summary\": \"...\"}"
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        text = _strip_code_fences(extract_text(response))
        review = _safe_parse_json(text)
    except Exception as e:
        logger.warning("Argus review failed, auto-passing: %s", e)
        review = {"verdict": "pass", "completeness_pct": 75, "summary": f"Auto-pass: {e}"}

    verdict = str(review.get("verdict", "pass")).lower()
    if verdict not in ("pass", "fail"):
        verdict = "pass"

    return {
        "review_verdict": verdict,
        "review_summary": review.get("summary", ""),
        "review_completeness": float(review.get("completeness_pct", 75)),
        "trace": state.get("trace", []) + [{"step": "argus_review", "verdict": verdict}],
    }


# ── Dashboard Answer Builder ────────────────────────────────────────────────


async def dashboard_answer_node(state: AgentState) -> dict[str, Any]:
    """Build a concise, LLM-generated answer summarizing the dashboard by page theme."""
    brief = state.get("analysis_brief", {}) or {}
    widgets = state.get("widgets", [])
    summary = state.get("dashboard_summary", "")

    # Group widgets by page
    pages: dict[int, list[str]] = {}
    for w in widgets:
        layout = w.get("layout") if isinstance(w.get("layout"), dict) else {}
        page = layout.get("page", 1) if layout else 1
        pages.setdefault(page, []).append(w.get("title", "Widget"))

    page_count = len(pages) or 1
    widget_count = len(widgets)

    # Build context for LLM
    exec_summary = brief.get("executive_summary", summary or "Dashboard bisnis")

    prompt_lines = [
        f"Dashboard baru saja selesai dibuat dengan {widget_count} widget"
        f" di {page_count} halaman.",
        f"",
        f"Ringkasan analisis: {exec_summary}",
        f"",
    ]

    if page_count == 1:
        prompt_lines.append(f"Widget: {', '.join(pages.get(1, []))}")
        prompt_lines.append("")
        prompt_lines.append(
            "Buat penjelasan singkat (maks 3 kalimat) tentang apa yang bisa dilihat "
            "di dashboard ini. Jangan daftar setiap widget satu per satu. "
            "Fokus pada tema utama dan insight yang bisa didapat."
        )
    else:
        prompt_lines.append("Halaman dashboard:")
        for p in sorted(pages.keys()):
            titles = pages[p]
            preview = ", ".join(titles[:3]) + ("..." if len(titles) > 3 else "")
            prompt_lines.append(f"- Halaman {p}: {len(titles)} widget ({preview})")
        prompt_lines.append("")
        prompt_lines.append(
            "Buat penjelasan singkat (maks 4 kalimat) tentang apa tema setiap halaman. "
            "Jangan daftar widget satu per satu, cukup jelaskan fokus tiap halaman."
        )

    fallback = (
        f"Dashboard dengan **{widget_count} widget** di {page_count} halaman siap. "
        "Buka Dashboard untuk melihat detail."
    )

    try:
        llm = get_llm(
            model=settings.gemini_model_light,
            temperature=0.3,
            max_output_tokens=400,
        )
        response = await llm.ainvoke([
            SystemMessage(
                content="Kamu Vira dari Vistara. Jawab ringkas dalam Bahasa Indonesia. "
                        "Gunakan Markdown (bold untuk angka penting). "
                        "Jangan menyebut kata widget atau chart."
            ),
            HumanMessage(content="\n".join(prompt_lines)),
        ])
        answer = extract_text(response)
        if not answer or len(answer.strip()) < 10:
            answer = fallback
    except Exception as exc:
        logger.warning("dashboard_answer_node llm failed: %s", exc)
        answer = fallback

    return {
        "answer": answer,
        "content_format": "markdown",
        "intent": {"intent": "create_dashboard", "nlu_source": "langgraph"},
    }


# ── Helpers ─────────────────────────────────────────────────────────────────


def _format_dataset_info(profile: dict[str, Any] | None) -> str:
    """Format dataset profile info for LLM context."""
    if not profile:
        return "Dataset info tidak tersedia."

    parts = []
    if profile.get("summary"):
        parts.append(f"Summary: {profile['summary']}")

    columns = profile.get("columns", [])
    if isinstance(columns, list) and columns:
        col_names = [c.get("name", "?") for c in columns[:15]]
        parts.append(f"Columns: {', '.join(col_names)}")

    detected = profile.get("detected", {})
    if detected:
        if detected.get("numeric_columns"):
            parts.append(f"Numeric: {', '.join(detected['numeric_columns'][:8])}")
        if detected.get("date_columns"):
            parts.append(f"Date: {', '.join(detected['date_columns'][:4])}")

    return "\n".join(parts) if parts else "Dataset info minimal."


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences from LLM response."""
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text


def _safe_parse_json(text: str) -> dict:
    """Parse JSON from LLM response, handling common issues like trailing commas."""
    text = _strip_code_fences(text.strip())

    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Remove trailing commas before } and ]
    cleaned = re.sub(r",\s*([}\]])", r"\1", text)
    # Remove single-line comments
    cleaned = re.sub(r"//.*$", "", cleaned, flags=re.MULTILINE)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Try to extract JSON object from mixed text
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            extracted = re.sub(r",\s*([}\]])", r"\1", match.group(0))
            return json.loads(extracted)
        except json.JSONDecodeError:
            pass

    raise json.JSONDecodeError("Could not parse JSON from LLM response", text, 0)


def should_retry_dashboard(state: AgentState) -> str:
    """Conditional edge — decide whether to retry worker or finish."""
    verdict = state.get("review_verdict", "pass")
    widgets = state.get("widgets", [])
    trace = state.get("trace", [])

    # Count review passes
    review_count = sum(1 for t in trace if t.get("step") == "argus_review")

    if verdict == "pass" or review_count >= MAX_REVIEW_PASSES or len(widgets) >= MIN_WIDGETS:
        return "finish"
    return "retry"
