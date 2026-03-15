"""Dashboard sub-graph — brief → plan → spec → execute → review."""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

import httpx
from langchain_core.messages import HumanMessage, SystemMessage

from agent.config import settings
from agent.graph.state import AgentState
from agent.llm import extract_text, get_llm
from agent.prompts import ARGUS_CURATOR, CITRA_PLANNER, CITRA_WORKER, RAKA_ANALYST, TEAM

logger = logging.getLogger(__name__)

MAX_WORKER_STEPS = 8
MAX_REVIEW_PASSES = 3

SUPPORTED_TEMPLATES: dict[str, dict[str, Any]] = {
    "total_revenue": {"kind": "metric", "title": "Omzet", "template_type": "kpi"},
    "total_profit": {"kind": "metric", "title": "Untung", "template_type": "kpi"},
    "margin_percentage": {"kind": "metric", "title": "Margin", "template_type": "kpi"},
    "revenue_trend": {"kind": "chart", "title": "Trend Omzet", "template_type": "trend"},
    "top_products": {"kind": "table", "title": "Produk Terlaris", "template_type": "breakdown"},
    "branch_performance": {"kind": "table", "title": "Performa Cabang", "template_type": "breakdown"},
    "total_expense": {"kind": "metric", "title": "Total Biaya", "template_type": "kpi"},
}

SALES_SIGNAL_TERMS = ("revenue", "omzet", "sales", "penjualan", "product", "produk", "quantity", "qty", "cogs", "discount", "transaction", "transaksi")
EXPENSE_SIGNAL_TERMS = ("expense", "expenses", "biaya", "pengeluaran", "cost", "amount", "kategori", "category", "recurring")
PRODUCT_SIGNAL_TERMS = ("product", "produk", "item", "sku", "brand", "merk", "barang")
BRANCH_SIGNAL_TERMS = ("branch", "cabang", "store", "outlet", "lokasi")
TREND_TEMPLATE_IDS = {template_id for template_id, spec in SUPPORTED_TEMPLATES.items() if spec["template_type"] == "trend"}
BREAKDOWN_TEMPLATE_IDS = {template_id for template_id, spec in SUPPORTED_TEMPLATES.items() if spec["template_type"] == "breakdown"}
PROFIT_SIGNAL_TERMS = ("profit", "untung", "laba", "margin", "gross", "net")
MARGIN_SIGNAL_TERMS = ("margin", "persen", "persentase", "%")


async def analyst_brief_node(state: AgentState) -> dict[str, Any]:
    """Generate an analysis brief with findings for dashboard creation."""
    llm = get_llm(
        model=settings.gemini_model_light,
        temperature=0.25,
        top_p=0.9,
        top_k=32,
        max_output_tokens=4096,
        json_mode=True,
    )

    dataset_info = _format_dataset_info(state.get("dataset_profile"))
    memory = state.get("memory") if isinstance(state.get("memory"), dict) else {}
    existing_dashboard = _existing_dashboard_context(state)

    system_prompt = (
        f"Kamu adalah {TEAM['analyst']}, analyst agent untuk dashboard bisnis.\n"
        f"{RAKA_ANALYST}\n\n"
        f"Dataset info:\n{dataset_info}"
    )

    user_prompt = (
        f"User meminta: {state.get('message', '')}\n"
        f"Route saat ini: {json.dumps(state.get('route') or {}, ensure_ascii=False)}\n"
        f"Ringkasan analisis terakhir: {json.dumps(memory.get('recent_findings') or [], ensure_ascii=False)}\n"
        f"Dashboard yang sedang aktif: {json.dumps(existing_dashboard, ensure_ascii=False)}\n\n"
        "Buat analysis brief yang grounded pada data dan konteks workflow. "
        "Kalau user sedang mengedit dashboard, pakai dashboard aktif sebagai baseline. "
        "Reply sebagai JSON dengan keys: headline, business_goal, primary_question, time_scope, executive_summary, findings (array)."
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        text = _strip_code_fences(extract_text(response))
        brief = _safe_parse_json(text)
    except Exception as exc:
        logger.warning("Analyst brief generation failed: %s", exc)
        brief = {
            "headline": "Analisis berdasarkan data yang tersedia",
            "business_goal": state.get("message", "Dashboard bisnis"),
            "primary_question": state.get("message", "Apa ringkasan bisnis utama?"),
            "time_scope": memory.get("last_time_scope") or "30 hari terakhir",
            "executive_summary": memory.get("last_analysis_summary") or "Susun dashboard yang langsung menjawab kebutuhan utama user.",
            "findings": memory.get("recent_findings") if isinstance(memory.get("recent_findings"), list) else [],
        }

    return {
        "analysis_brief": brief,
        "trace": state.get("trace", []) + [{"step": "analyst_brief", "findings_count": len(brief.get("findings", []))}],
    }


async def planner_node(state: AgentState) -> dict[str, Any]:
    """Create an execution plan for the dashboard flow."""
    llm = get_llm(
        model=settings.gemini_model_light,
        temperature=0.2,
        top_p=0.85,
        top_k=32,
        max_output_tokens=2048,
        json_mode=True,
    )

    brief = state.get("analysis_brief", {}) or {}
    dataset_info = _format_dataset_info(state.get("dataset_profile"))
    existing_dashboard = _existing_dashboard_context(state)

    system_prompt = (
        f"Kamu adalah planner agent.\n{CITRA_PLANNER}\n\n"
        f"Dataset info:\n{dataset_info}"
    )

    user_prompt = (
        f"Analysis brief: {json.dumps(brief, ensure_ascii=False)}\n\n"
        f"Dashboard aktif saat ini: {json.dumps(existing_dashboard, ensure_ascii=False)}\n\n"
        "Buat execution plan ringkas untuk menyusun dashboard. "
        "Reply as JSON: {\"steps\": [\"step1\", \"step2\", ...]}"
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        text = _strip_code_fences(extract_text(response))
        plan = _safe_parse_json(text)
        steps = [str(step).strip() for step in plan.get("steps", []) if str(step).strip()][:MAX_WORKER_STEPS]
    except Exception as exc:
        logger.warning("Planner failed, using fallback: %s", exc)
        steps = [
            "Tentukan KPI utama yang menjawab tujuan user.",
            "Tambahkan tren bila data tanggal tersedia.",
            "Tambahkan breakdown atau ranking yang menjelaskan sumber perubahan.",
        ]

    return {
        "planner_steps": steps,
        "trace": state.get("trace", []) + [{"step": "planner", "steps_count": len(steps)}],
    }


async def dashboard_spec_node(state: AgentState) -> dict[str, Any]:
    """Generate a dashboard spec contract before any widget execution happens."""
    llm = get_llm(
        model=settings.gemini_model_light,
        temperature=0.2,
        top_p=0.85,
        top_k=32,
        max_output_tokens=4096,
        json_mode=True,
    )

    brief = state.get("analysis_brief", {}) or {}
    steps = state.get("planner_steps", []) or []
    dataset_info = _format_dataset_info(state.get("dataset_profile"))
    existing_dashboard = _existing_dashboard_context(state)
    previous_validation = state.get("dashboard_validation") if isinstance(state.get("dashboard_validation"), dict) else {}

    system_prompt = (
        f"Kamu adalah {TEAM['creator']}, pembuat dashboard teknis.\n"
        f"{CITRA_WORKER}\n\n"
        f"Dataset info:\n{dataset_info}\n\n"
        f"Template yang diizinkan: {json.dumps(_template_catalog_for_prompt(state.get('dataset_profile')), ensure_ascii=False)}\n"
        "Aturan keras: selalu usulkan minimal 1 KPI. Jika data tanggal tersedia, usulkan minimal 1 trend. "
        "Usulkan minimal 1 breakdown/ranking. Jangan duplikat widget dengan intent yang sama."
    )

    user_prompt = (
        f"Analysis brief: {json.dumps(brief, ensure_ascii=False)}\n\n"
        f"Execution plan: {json.dumps(steps, ensure_ascii=False)}\n\n"
        f"Dashboard aktif: {json.dumps(existing_dashboard, ensure_ascii=False)}\n\n"
        f"Feedback review sebelumnya: {json.dumps(previous_validation.get('issues') or [], ensure_ascii=False)}\n\n"
        "Reply sebagai JSON dengan shape: "
        "{"
        "\"goal\": string, "
        "\"primary_business_question\": string, "
        "\"time_scope\": string, "
        "\"primary_kpis\": [string], "
        "\"required_sections\": [{\"name\": string, \"purpose\": string}], "
        "\"candidate_widgets\": [{"
        "\"title\": string, "
        "\"kind\": \"metric\"|\"chart\"|\"table\", "
        "\"template_id\": string, "
        "\"measure\": string|null, "
        "\"dimension\": string|null, "
        "\"visualization\": string|null, "
        "\"rationale\": string, "
        "\"expected_signal\": string, "
        "\"page\": number"
        "}]}"
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        spec = _safe_parse_json(_strip_code_fences(extract_text(response)))
    except Exception as exc:
        logger.warning("Dashboard spec generation failed: %s", exc)
        spec = {
            "goal": brief.get("business_goal") or state.get("message", "Dashboard bisnis"),
            "primary_business_question": brief.get("primary_question") or state.get("message", "Apa yang perlu dipantau?"),
            "time_scope": brief.get("time_scope") or "30 hari terakhir",
            "primary_kpis": [],
            "required_sections": [],
            "candidate_widgets": [],
        }

    spec = _normalize_dashboard_spec(spec, state.get("dataset_profile"))
    spec_issues, requirement_state = _validate_dashboard_spec(spec, state.get("dataset_profile"))
    validation = {
        "issues": spec_issues,
        "phase": "spec",
        "requirements": requirement_state,
        "completeness_pct": _completion_percentage(requirement_state),
    }

    return {
        "dashboard_spec": spec,
        "dashboard_validation": validation,
        "trace": state.get("trace", []) + [{"step": "dashboard_spec", "candidate_count": len(spec.get("candidate_widgets", []))}],
    }


async def worker_node(state: AgentState) -> dict[str, Any]:
    """Execute a validated dashboard spec through the internal analytics API."""
    spec = state.get("dashboard_spec") if isinstance(state.get("dashboard_spec"), dict) else {}
    spec = _normalize_dashboard_spec(spec, state.get("dataset_profile"))
    spec_validation = state.get("dashboard_validation") if isinstance(state.get("dashboard_validation"), dict) else {}
    spec_issues = list(spec_validation.get("issues") or [])
    if spec_issues:
        spec_issues, _ = _validate_dashboard_spec(spec, state.get("dataset_profile"))
    candidate_widgets = spec.get("candidate_widgets") if isinstance(spec.get("candidate_widgets"), list) else []

    if spec_issues:
        note = "Spesifikasi dashboard belum lolos validasi. Menyusun ulang kandidat visual yang lebih fokus."
        return {
            "widgets": [],
            "artifacts": [],
            "dashboard_summary": note,
            "dashboard_validation": {
                **spec_validation,
                "phase": "execution",
                "executed_count": 0,
            },
            "draft_dashboard": _preserve_existing_dashboard(state, note=note, status="needs_review"),
            "presentation_mode": "canvas",
            "trace": state.get("trace", []) + [{"step": "worker", "widgets_count": 0, "status": "spec_invalid"}],
        }

    tenant_id = state.get("tenant_id")
    user_id = state.get("user_id")
    internal_url = f"{settings.nodejs_internal_url}/api/internal/analytics"
    time_scope = spec.get("time_scope") or (state.get("analysis_brief") or {}).get("time_scope") or "30 hari terakhir"

    executed_widgets: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    execution_issues: list[str] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        for index, candidate in enumerate(candidate_widgets[:MAX_WORKER_STEPS]):
            if not isinstance(candidate, dict):
                execution_issues.append("Ada kandidat widget yang bukan object valid.")
                continue

            template_id = str(candidate.get("template_id") or "").strip()
            allowed_templates = _allowed_template_ids(state.get("dataset_profile"))
            if template_id not in allowed_templates:
                execution_issues.append(f"Template {template_id or '(kosong)'} tidak didukung.")
                continue

            intent = _build_intent_from_candidate(candidate, time_scope)
            try:
                response = await client.post(
                    internal_url,
                    json={
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "intent": intent,
                    },
                )
                if response.status_code != 200:
                    execution_issues.append(f"Template {template_id} gagal dieksekusi (HTTP {response.status_code}).")
                    continue

                payload = response.json()
                result = payload.get("data") if payload.get("ok") else None
                artifact = _primary_artifact(result)
                if not artifact or not _artifact_is_interpretable(artifact):
                    execution_issues.append(f"Template {template_id} tidak menghasilkan hasil yang cukup kuat untuk dashboard.")
                    continue

                widget = {
                    "id": candidate.get("id") or f"widget_{uuid.uuid4().hex[:8]}",
                    "title": str(candidate.get("title") or artifact.get("title") or SUPPORTED_TEMPLATES[template_id]["title"]).strip(),
                    "kind": _normalize_widget_kind(candidate.get("kind") or artifact.get("kind") or SUPPORTED_TEMPLATES[template_id]["kind"]),
                    "artifact": {**artifact, "title": str(candidate.get("title") or artifact.get("title") or SUPPORTED_TEMPLATES[template_id]["title"]).strip()},
                    "layout": _normalize_layout(candidate.get("layout"), index, candidate.get("page")),
                    "query": intent,
                    "template_id": template_id,
                    "rationale": candidate.get("rationale"),
                    "expected_signal": candidate.get("expected_signal"),
                }
                executed_widgets.append(widget)
                artifacts.append(widget["artifact"])
            except Exception as exc:
                logger.warning("Failed to execute dashboard candidate %s: %s", template_id, exc)
                execution_issues.append(f"Template {template_id} gagal dieksekusi.")

    execution_validation = _validate_executed_dashboard(
        spec=spec,
        widgets=executed_widgets,
        artifacts=artifacts,
        dataset_profile=state.get("dataset_profile"),
        execution_issues=execution_issues,
    )
    renderable_widgets = _filter_renderable_widgets(executed_widgets)
    renderable_artifacts = [widget.get("artifact") for widget in renderable_widgets if isinstance(widget.get("artifact"), dict)]
    passed = len(execution_validation["issues"]) == 0
    note = (
        "Draft dashboard tervalidasi dan siap disajikan."
        if passed
        else (
            "Sebagian visual valid dan ditampilkan. Komponen yang lemah atau kosong disisihkan dari draft saat ini."
            if renderable_widgets
            else "Draft dashboard belum lolos validasi. Menyusun ulang kandidat visual yang lebih fokus."
        )
    )

    return {
        "widgets": renderable_widgets,
        "artifacts": renderable_artifacts,
        "dashboard_summary": spec.get("goal") or note,
        "dashboard_validation": execution_validation,
        "draft_dashboard": _build_draft_dashboard(
            state,
            widgets=renderable_widgets,
            artifacts=renderable_artifacts,
            goal=spec.get("goal") or (state.get("analysis_brief") or {}).get("business_goal") or state.get("message"),
            note=note,
            status="drafting" if passed else "needs_review",
        ) if renderable_widgets else _empty_draft_dashboard(
            state,
            goal=spec.get("goal") or (state.get("analysis_brief") or {}).get("business_goal") or state.get("message"),
            note=note,
            status="needs_review",
        ),
        "presentation_mode": "canvas",
        "trace": state.get("trace", []) + [{"step": "worker", "widgets_count": len(executed_widgets), "status": "ok" if passed else "needs_retry"}],
    }


async def argus_node(state: AgentState) -> dict[str, Any]:
    """Review the dashboard deterministically and add a curator summary."""
    validation = state.get("dashboard_validation") if isinstance(state.get("dashboard_validation"), dict) else {}
    issues = [str(issue).strip() for issue in validation.get("issues") or [] if str(issue).strip()]
    widgets = state.get("widgets", []) if isinstance(state.get("widgets"), list) else []

    if issues or not widgets:
        retry_count = int(state.get("dashboard_retry_count") or 0) + 1
        summary = "Dashboard belum lolos kurasi: " + "; ".join(issues[:4]) if issues else "Dashboard belum memiliki visual yang cukup kuat untuk ditampilkan."
        return {
            "review_verdict": "fail",
            "review_summary": summary,
            "review_completeness": float(validation.get("completeness_pct") or 0),
            "dashboard_retry_count": retry_count,
            "trace": state.get("trace", []) + [{"step": "argus_review", "verdict": "fail", "retry_count": retry_count}],
        }

    summary = validation.get("summary") or "Dashboard sudah seimbang antara KPI, tren, dan breakdown."
    try:
        llm = get_llm(
            model=settings.gemini_model_light,
            temperature=0.15,
            top_p=0.85,
            top_k=32,
            max_output_tokens=256,
            json_mode=True,
        )
        response = await llm.ainvoke([
            SystemMessage(content=f"Kamu adalah Argus, kurator dashboard.\n{ARGUS_CURATOR}"),
            HumanMessage(
                content=(
                    f"Widget dashboard: {json.dumps([{'title': widget.get('title'), 'template_id': widget.get('template_id')} for widget in widgets], ensure_ascii=False)}\n\n"
                    f"Validation summary: {json.dumps(validation, ensure_ascii=False)}\n\n"
                    "Reply sebagai JSON: {\"summary\": string, \"completeness_pct\": number}"
                )
            ),
        ])
        review = _safe_parse_json(_strip_code_fences(extract_text(response)))
        summary = review.get("summary") or summary
        completeness = float(review.get("completeness_pct") or validation.get("completeness_pct") or 100)
    except Exception as exc:
        logger.warning("Argus review summary failed, using deterministic summary: %s", exc)
        completeness = float(validation.get("completeness_pct") or 100)

    return {
        "review_verdict": "pass",
        "review_summary": summary,
        "review_completeness": completeness,
        "trace": state.get("trace", []) + [{"step": "argus_review", "verdict": "pass", "completeness_pct": completeness}],
    }


async def dashboard_answer_node(state: AgentState) -> dict[str, Any]:
    """Build the final dashboard response and persist the validated draft contract."""
    route = state.get("route") or {}
    route_action = str(route.get("action") or "create_dashboard").lower()
    is_edit = route_action == "edit_dashboard"
    passed = str(state.get("review_verdict") or "fail").lower() == "pass"

    if not passed:
        renderable_widgets = _filter_renderable_widgets(state.get("widgets") or [])
        renderable_artifacts = [widget.get("artifact") for widget in renderable_widgets if isinstance(widget.get("artifact"), dict)]
        draft_dashboard = _build_draft_dashboard(
            state,
            widgets=renderable_widgets,
            artifacts=renderable_artifacts,
            goal=(state.get("dashboard_spec") or {}).get("goal") or (state.get("analysis_brief") or {}).get("business_goal") or state.get("message"),
            note=state.get("review_summary") or "Draft dashboard belum cukup kuat. Coba persempit permintaan atau fokus ke satu tujuan utama.",
            status="needs_review",
        ) if renderable_widgets else _empty_draft_dashboard(
            state,
            goal=(state.get("dashboard_spec") or {}).get("goal") or (state.get("analysis_brief") or {}).get("business_goal") or state.get("message"),
            note=state.get("review_summary") or "Draft dashboard belum cukup kuat. Coba persempit permintaan atau fokus ke satu tujuan utama.",
            status="needs_review",
        )
        answer = (
            "Sebagian visual yang valid tetap ditampilkan. "
            f"{state.get('review_summary') or 'Komponen yang lemah disisihkan dari draft ini.'}"
            if renderable_widgets
            else state.get("review_summary") or "Draft dashboard belum cukup kuat untuk ditampilkan. Coba persempit permintaan atau fokus ke satu tujuan utama."
        )
        widgets = draft_dashboard.get("widgets") if isinstance(draft_dashboard, dict) else []
        artifacts = draft_dashboard.get("artifacts") if isinstance(draft_dashboard, dict) else []
        return {
            "answer": answer,
            "content_format": "markdown",
            "widgets": widgets,
            "artifacts": artifacts,
            "presentation_mode": "canvas",
            "draft_dashboard": draft_dashboard,
            "intent": {"intent": "modify_dashboard" if is_edit else "create_dashboard", "nlu_source": "langgraph"},
        }

    draft_dashboard = _build_draft_dashboard(
        state,
        widgets=state.get("widgets") or [],
        artifacts=state.get("artifacts") or [],
        goal=(state.get("dashboard_spec") or {}).get("goal") or (state.get("analysis_brief") or {}).get("business_goal") or state.get("message"),
        note=state.get("review_summary") or state.get("dashboard_summary") or "Dashboard siap digunakan.",
        status="ready",
    )

    answer = await _generate_dashboard_answer(state, draft_dashboard)

    return {
        "answer": answer,
        "content_format": "markdown",
        "widgets": draft_dashboard.get("widgets", []),
        "artifacts": draft_dashboard.get("artifacts", []),
        "presentation_mode": "canvas",
        "draft_dashboard": draft_dashboard,
        "intent": {"intent": "modify_dashboard" if is_edit else "create_dashboard", "nlu_source": "langgraph"},
    }


def _normalize_text(value: Any, max_length: int = 320) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return None
    if len(text) <= max_length:
        return text
    return f"{text[: max_length - 1].rstrip()}…"


def _supports_trend(dataset_profile: dict[str, Any] | None) -> bool:
    detected = (dataset_profile or {}).get("detected") if isinstance(dataset_profile, dict) else {}
    date_columns = detected.get("date_columns") if isinstance(detected, dict) else []
    return bool(date_columns) and "revenue_trend" in _allowed_template_ids(dataset_profile)


def _supports_breakdown(dataset_profile: dict[str, Any] | None) -> bool:
    return bool(BREAKDOWN_TEMPLATE_IDS.intersection(_allowed_template_ids(dataset_profile)))


def _template_catalog_for_prompt(dataset_profile: dict[str, Any] | None) -> list[dict[str, Any]]:
    return [
        {
            "template_id": template_id,
            "kind": spec["kind"],
            "template_type": spec["template_type"],
            "default_title": spec["title"],
        }
        for template_id, spec in SUPPORTED_TEMPLATES.items()
        if template_id in _allowed_template_ids(dataset_profile)
    ]


def _existing_dashboard_context(state: AgentState) -> dict[str, Any]:
    draft = state.get("draft_dashboard") if isinstance(state.get("draft_dashboard"), dict) else None
    if draft:
        return {
            "name": draft.get("name"),
            "goal": draft.get("goal"),
            "status": draft.get("status"),
            "saved_dashboard_id": draft.get("saved_dashboard_id"),
            "widget_titles": [widget.get("title") for widget in draft.get("widgets", []) if isinstance(widget, dict)][:8],
        }

    saved = state.get("saved_dashboard") if isinstance(state.get("saved_dashboard"), dict) else None
    components = ((saved or {}).get("config") or {}).get("components") if saved else []
    return {
        "name": (saved or {}).get("name"),
        "saved_dashboard_id": (saved or {}).get("id"),
        "widget_titles": [component.get("title") for component in components if isinstance(component, dict)][:8],
    }


def _infer_template_id(candidate: dict[str, Any], allowed_templates: set[str], dataset_profile: dict[str, Any] | None) -> str | None:
    if not allowed_templates:
        return None

    kind = _normalize_widget_kind(candidate.get("kind"))
    text_bits = [
        candidate.get("title"),
        candidate.get("measure"),
        candidate.get("dimension"),
        candidate.get("rationale"),
        candidate.get("expected_signal"),
        candidate.get("visualization"),
    ]
    text = " ".join(str(bit or "") for bit in text_bits).lower()

    trend_options = [template_id for template_id in TREND_TEMPLATE_IDS if template_id in allowed_templates]
    breakdown_options = [template_id for template_id in BREAKDOWN_TEMPLATE_IDS if template_id in allowed_templates]
    kpi_options = [
        template_id
        for template_id, spec in SUPPORTED_TEMPLATES.items()
        if spec["template_type"] == "kpi" and template_id in allowed_templates
    ]

    if kind == "chart" and trend_options:
        return "revenue_trend" if "revenue_trend" in trend_options else trend_options[0]

    if kind == "table" and breakdown_options:
        if _contains_any(text, PRODUCT_SIGNAL_TERMS) and "top_products" in breakdown_options:
            return "top_products"
        if _contains_any(text, BRANCH_SIGNAL_TERMS) and "branch_performance" in breakdown_options:
            return "branch_performance"
        return breakdown_options[0]

    if kind == "metric" and kpi_options:
        if _contains_any(text, MARGIN_SIGNAL_TERMS) and "margin_percentage" in kpi_options:
            return "margin_percentage"
        if _contains_any(text, PROFIT_SIGNAL_TERMS) and "total_profit" in kpi_options:
            return "total_profit"
        if _contains_any(text, EXPENSE_SIGNAL_TERMS) and "total_expense" in kpi_options:
            return "total_expense"
        if _contains_any(text, SALES_SIGNAL_TERMS) and "total_revenue" in kpi_options:
            return "total_revenue"
        return kpi_options[0]

    fallback = next(iter(allowed_templates), None)
    return fallback


def _normalize_dashboard_spec(spec: dict[str, Any], dataset_profile: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(spec, dict):
        return {"candidate_widgets": []}
    allowed_templates = _allowed_template_ids(dataset_profile)
    widgets = spec.get("candidate_widgets") if isinstance(spec.get("candidate_widgets"), list) else []
    normalized_widgets: list[dict[str, Any]] = []

    for candidate in widgets:
        if not isinstance(candidate, dict):
            continue
        normalized = {**candidate}
        normalized["kind"] = _normalize_widget_kind(normalized.get("kind"))
        template_id = str(normalized.get("template_id") or "").strip()
        if template_id not in allowed_templates:
            template_id = _infer_template_id(normalized, allowed_templates, dataset_profile) or ""
        if template_id:
            normalized["template_id"] = template_id
            if not str(normalized.get("title") or "").strip() and template_id in SUPPORTED_TEMPLATES:
                normalized["title"] = SUPPORTED_TEMPLATES[template_id]["title"]
        normalized_widgets.append(normalized)

    return {
        **spec,
        "candidate_widgets": normalized_widgets,
    }


def _validate_dashboard_spec(spec: dict[str, Any], dataset_profile: dict[str, Any] | None) -> tuple[list[str], dict[str, Any]]:
    issues: list[str] = []
    widgets = spec.get("candidate_widgets") if isinstance(spec.get("candidate_widgets"), list) else []
    allowed_templates = _allowed_template_ids(dataset_profile)
    seen_keys: set[str] = set()
    metric_count = 0
    trend_count = 0
    breakdown_count = 0

    if not widgets:
        issues.append("Spec dashboard belum memiliki kandidat widget.")

    for candidate in widgets:
        if not isinstance(candidate, dict):
            issues.append("Ada kandidat widget yang tidak valid.")
            continue
        template_id = str(candidate.get("template_id") or "").strip()
        title = str(candidate.get("title") or "").strip()
        key = f"{template_id}|{title.lower()}|{str(candidate.get('measure') or '').lower()}|{str(candidate.get('dimension') or '').lower()}"

        if template_id not in allowed_templates:
            issues.append(f"Template {template_id or '(kosong)'} tidak diizinkan.")
            continue
        if key in seen_keys:
            issues.append(f"Widget duplikat terdeteksi untuk template {template_id}.")
        seen_keys.add(key)

        if SUPPORTED_TEMPLATES[template_id]["template_type"] == "kpi":
            metric_count += 1
        elif SUPPORTED_TEMPLATES[template_id]["template_type"] == "trend":
            trend_count += 1
        elif SUPPORTED_TEMPLATES[template_id]["template_type"] == "breakdown":
            breakdown_count += 1

    requires_trend = _supports_trend(dataset_profile)
    requires_breakdown = _supports_breakdown(dataset_profile)

    if metric_count < 1:
        issues.append("Dashboard wajib punya minimal satu KPI utama.")
    if requires_trend and trend_count < 1:
        issues.append("Dashboard wajib punya minimal satu widget tren karena data tanggal tersedia.")
    if requires_breakdown and breakdown_count < 1:
        issues.append("Dashboard wajib punya minimal satu breakdown atau ranking.")

    return issues, {
        "requires_kpi": True,
        "requires_trend": requires_trend,
        "requires_breakdown": requires_breakdown,
        "metric_count": metric_count,
        "trend_count": trend_count,
        "breakdown_count": breakdown_count,
    }


def _validate_executed_dashboard(
    *,
    spec: dict[str, Any],
    widgets: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
    dataset_profile: dict[str, Any] | None,
    execution_issues: list[str],
) -> dict[str, Any]:
    issues, requirement_state = _validate_dashboard_spec(spec, dataset_profile)
    issues.extend(str(issue).strip() for issue in execution_issues if str(issue).strip())

    seen_titles: set[str] = set()
    metric_count = 0
    trend_count = 0
    breakdown_count = 0

    for widget in widgets:
        if not isinstance(widget, dict):
            issues.append("Widget hasil eksekusi tidak valid.")
            continue
        template_id = str(widget.get("template_id") or "").strip()
        title = str(widget.get("title") or "").strip().lower()
        artifact = widget.get("artifact") if isinstance(widget.get("artifact"), dict) else None
        if title in seen_titles:
            issues.append(f"Widget hasil eksekusi duplikat: {widget.get('title')}")
        seen_titles.add(title)
        if template_id not in SUPPORTED_TEMPLATES:
            issues.append(f"Widget memakai template yang tidak didukung: {template_id or '(kosong)'}.")
            continue
        if not artifact or not _artifact_is_interpretable(artifact):
            issues.append(f"Widget {widget.get('title') or template_id} tidak memiliki hasil yang dapat diinterpretasi.")
            continue

        template_type = SUPPORTED_TEMPLATES[template_id]["template_type"]
        if template_type == "kpi":
            metric_count += 1
        elif template_type == "trend":
            trend_count += 1
        elif template_type == "breakdown":
            breakdown_count += 1

    requires_trend = requirement_state["requires_trend"]
    requires_breakdown = requirement_state["requires_breakdown"]
    if metric_count < 1:
        issues.append("Eksekusi final belum menghasilkan KPI yang layak tampil.")
    if requires_trend and trend_count < 1:
        issues.append("Eksekusi final belum menghasilkan tren yang layak tampil.")
    if requires_breakdown and breakdown_count < 1:
        issues.append("Eksekusi final belum menghasilkan breakdown/ranking yang layak tampil.")

    summary = "Dashboard tervalidasi dengan KPI, tren, dan breakdown yang saling melengkapi." if not issues else "Dashboard perlu disusun ulang karena masih ada komponen yang lemah atau kosong."
    return {
        "issues": _dedupe_ordered(issues),
        "phase": "execution",
        "requirements": {
            **requirement_state,
            "metric_count": metric_count,
            "trend_count": trend_count,
            "breakdown_count": breakdown_count,
        },
        "executed_count": len(widgets),
        "artifact_count": len(artifacts),
        "summary": summary,
        "completeness_pct": _completion_percentage({
            **requirement_state,
            "metric_count": metric_count,
            "trend_count": trend_count,
            "breakdown_count": breakdown_count,
        }),
    }


def _completion_percentage(requirements: dict[str, Any]) -> float:
    checks = 1
    score = 1 if int(requirements.get("metric_count") or 0) >= 1 else 0
    if requirements.get("requires_trend"):
        checks += 1
        score += 1 if int(requirements.get("trend_count") or 0) >= 1 else 0
    if requirements.get("requires_breakdown"):
        checks += 1
        score += 1 if int(requirements.get("breakdown_count") or 0) >= 1 else 0
    return round((score / max(checks, 1)) * 100, 1)


def _normalize_widget_kind(value: Any) -> str:
    kind = str(value or "").strip().lower()
    if kind in {"metric", "chart", "table"}:
        return kind
    return "chart"


def _normalize_layout(layout: Any, index: int, page: Any = None) -> dict[str, Any]:
    if isinstance(layout, dict):
        normalized = {
            "page": max(1, int(layout.get("page") or page or 1)),
            "x": max(0, int(layout.get("x") or 0)),
            "y": max(0, int(layout.get("y") or 0)),
            "w": max(3, int(layout.get("w") or 4)),
            "h": max(2, int(layout.get("h") or 2)),
        }
        return normalized

    col = index % 3
    row = index // 3
    return {
        "page": max(1, int(page or 1)),
        "x": col * 4,
        "y": row * 2,
        "w": 4,
        "h": 2,
    }


def _build_intent_from_candidate(candidate: dict[str, Any], time_scope: str) -> dict[str, Any]:
    intent = {
        "intent": "analyze",
        "template_id": candidate.get("template_id"),
        "time_period": candidate.get("time_scope") or time_scope or "30 hari terakhir",
    }
    for key in ("measure", "dimension", "visualization", "limit", "branch", "channel", "metric"):
        value = candidate.get(key)
        if value not in (None, "", []):
            intent[key if key != "dimension" else "group_by"] = value
    return intent


def _primary_artifact(result: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(result, dict):
        return None
    artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), list) else []
    first = artifacts[0] if artifacts else None
    return first if isinstance(first, dict) else None


def _artifact_is_interpretable(artifact: dict[str, Any]) -> bool:
    kind = str(artifact.get("kind") or "").lower()
    if kind == "metric":
        value = artifact.get("value")
        return value not in (None, "", "—")
    if kind == "chart":
        labels = artifact.get("labels") or []
        series = artifact.get("series") or []
        return bool(labels) and any((item.get("values") or []) for item in series if isinstance(item, dict))
    if kind == "table":
        return bool(artifact.get("rows") or [])
    return False


def _widget_has_bound_data(widget: dict[str, Any] | None) -> bool:
    if not isinstance(widget, dict):
        return False
    artifact = widget.get("artifact") if isinstance(widget.get("artifact"), dict) else None
    if artifact and _artifact_is_interpretable(artifact):
        return True
    widget_type = str(widget.get("type") or "").strip()
    if widget_type == "MetricCard":
        return widget.get("displayValue") not in (None, "") or widget.get("value") not in (None, "")
    if widget_type == "TrendChart":
        return bool(widget.get("points") or [])
    if widget_type == "TopList":
        return bool(widget.get("items") or [])
    return False


def _build_draft_dashboard(
    state: AgentState,
    *,
    widgets: list[dict[str, Any]] | None,
    artifacts: list[dict[str, Any]] | None,
    goal: Any,
    note: Any,
    status: str,
) -> dict[str, Any]:
    next_widgets = widgets if isinstance(widgets, list) else []
    next_artifacts = artifacts if isinstance(artifacts, list) else [widget.get("artifact") for widget in next_widgets if isinstance(widget, dict) and isinstance(widget.get("artifact"), dict)]
    current_draft = state.get("draft_dashboard") if isinstance(state.get("draft_dashboard"), dict) else None
    saved_dashboard = state.get("saved_dashboard") if isinstance(state.get("saved_dashboard"), dict) else None

    return {
        "run_id": state.get("run_id"),
        "name": _dashboard_name(goal, current_draft=current_draft, saved_dashboard=saved_dashboard),
        "goal": _normalize_text(goal, 240) or _normalize_text(state.get("message"), 240),
        "pages": _page_count(next_widgets) or 1,
        "widgets": next_widgets,
        "artifacts": next_artifacts,
        "saved_dashboard_id": (current_draft or {}).get("saved_dashboard_id") or (saved_dashboard or {}).get("id"),
        "note": _normalize_text(note, 280),
        "status": status,
        "updated_at": None,
    }


def _empty_draft_dashboard(state: AgentState, *, goal: Any, note: Any, status: str) -> dict[str, Any]:
    current_draft = state.get("draft_dashboard") if isinstance(state.get("draft_dashboard"), dict) else None
    saved_dashboard = state.get("saved_dashboard") if isinstance(state.get("saved_dashboard"), dict) else None
    return {
        "run_id": state.get("run_id"),
        "name": _dashboard_name(goal, current_draft=current_draft, saved_dashboard=saved_dashboard),
        "goal": _normalize_text(goal, 240) or _normalize_text(state.get("message"), 240),
        "pages": 1,
        "widgets": [],
        "artifacts": [],
        "saved_dashboard_id": (current_draft or {}).get("saved_dashboard_id") or (saved_dashboard or {}).get("id"),
        "note": _normalize_text(note, 280),
        "status": status,
        "updated_at": None,
    }


def _filter_renderable_widgets(widgets: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for widget in widgets or []:
        if not isinstance(widget, dict):
            continue
        artifact = widget.get("artifact") if isinstance(widget.get("artifact"), dict) else None
        if not artifact or not _artifact_is_interpretable(artifact):
            continue
        result.append(widget)
    return result


def _draft_from_saved_dashboard(saved_dashboard: dict[str, Any], state: AgentState, note: Any, status: str) -> dict[str, Any] | None:
    config = saved_dashboard.get("config") if isinstance(saved_dashboard.get("config"), dict) else {}
    components = config.get("components") if isinstance(config.get("components"), list) else []
    widgets = [component for component in components if isinstance(component, dict) and _widget_has_bound_data(component)]
    artifacts = [widget.get("artifact") for widget in widgets if isinstance(widget.get("artifact"), dict)]
    if not widgets:
        return None
    return {
        "run_id": state.get("run_id"),
        "name": saved_dashboard.get("name") or "Dashboard Tersimpan",
        "goal": _normalize_text((state.get("analysis_brief") or {}).get("business_goal") or state.get("message"), 240),
        "pages": max(1, int(config.get("pages") or _page_count(widgets) or 1)),
        "widgets": widgets,
        "artifacts": artifacts,
        "saved_dashboard_id": saved_dashboard.get("id"),
        "note": _normalize_text(note, 280),
        "status": status,
        "updated_at": saved_dashboard.get("updated_at"),
    }


def _preserve_existing_dashboard(state: AgentState, *, note: Any, status: str) -> dict[str, Any] | None:
    current_draft = state.get("draft_dashboard") if isinstance(state.get("draft_dashboard"), dict) else None
    if current_draft and any(_widget_has_bound_data(widget) for widget in current_draft.get("widgets", [])):
        return {
            **current_draft,
            "run_id": state.get("run_id"),
            "note": _normalize_text(note, 280),
            "status": status,
        }
    saved_dashboard = state.get("saved_dashboard") if isinstance(state.get("saved_dashboard"), dict) else None
    if saved_dashboard:
        return _draft_from_saved_dashboard(saved_dashboard, state, note, status)
    goal = (state.get("analysis_brief") or {}).get("business_goal") or state.get("message")
    return {
        "run_id": state.get("run_id"),
        "name": _dashboard_name(goal),
        "goal": _normalize_text(goal, 240),
        "pages": 1,
        "widgets": [],
        "artifacts": [],
        "saved_dashboard_id": None,
        "note": _normalize_text(note, 280),
        "status": status,
        "updated_at": None,
    }


async def _generate_dashboard_answer(state: AgentState, draft_dashboard: dict[str, Any]) -> str:
    brief = state.get("analysis_brief", {}) or {}
    widgets = draft_dashboard.get("widgets") if isinstance(draft_dashboard.get("widgets"), list) else []
    pages: dict[int, list[str]] = {}
    for widget in widgets:
        layout = widget.get("layout") if isinstance(widget.get("layout"), dict) else {}
        page = int(layout.get("page") or 1)
        pages.setdefault(page, []).append(widget.get("title", "Widget"))

    page_count = len(pages) or 1
    widget_count = len(widgets)
    exec_summary = brief.get("executive_summary") or draft_dashboard.get("note") or "Dashboard bisnis"

    prompt_lines = [
        f"Dashboard selesai dibuat dengan {widget_count} visual di {page_count} halaman.",
        f"Ringkasan analisis: {exec_summary}",
    ]
    if page_count == 1:
        prompt_lines.append(f"Isi halaman: {', '.join(pages.get(1, []))}")
        prompt_lines.append("Buat penjelasan singkat maksimal 3 kalimat tentang apa yang bisa dilihat user dari dashboard ini.")
    else:
        for page, titles in sorted(pages.items()):
            prompt_lines.append(f"Halaman {page}: {', '.join(titles[:4])}")
        prompt_lines.append("Buat penjelasan singkat maksimal 4 kalimat tentang fokus tiap halaman.")

    fallback = f"Dashboard dengan **{widget_count} visual** siap. Buka canvas untuk melihat detail dan lanjutkan iterasi jika perlu."

    try:
        llm = get_llm(
            model=settings.gemini_model_light,
            temperature=0.35,
            top_p=0.9,
            top_k=40,
            max_output_tokens=400,
        )
        response = await llm.ainvoke([
            SystemMessage(
                content="Kamu Vira dari Vistara. Jawab ringkas dalam Bahasa Indonesia. Gunakan Markdown dan fokus pada insight, bukan daftar widget."
            ),
            HumanMessage(content="\n".join(prompt_lines)),
        ])
        answer = extract_text(response)
        return answer if answer and len(answer.strip()) >= 10 else fallback
    except Exception as exc:
        logger.warning("dashboard_answer_node llm failed: %s", exc)
        return fallback


def _dashboard_name(goal: Any, *, current_draft: dict[str, Any] | None = None, saved_dashboard: dict[str, Any] | None = None) -> str:
    if current_draft and current_draft.get("name"):
        return str(current_draft["name"])
    if saved_dashboard and saved_dashboard.get("name"):
        return str(saved_dashboard["name"])
    text = _normalize_text(goal, 80) or "Draft Dashboard"
    return text if len(text) <= 80 else f"{text[:77].rstrip()}…"


def _page_count(widgets: list[dict[str, Any]] | None) -> int:
    pages = [int((widget.get("layout") or {}).get("page") or 1) for widget in widgets or [] if isinstance(widget, dict)]
    return max(pages) if pages else 1


def _dedupe_ordered(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        key = item.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _allowed_template_ids(dataset_profile: dict[str, Any] | None) -> set[str]:
    column_names = _profile_column_names(dataset_profile)
    summary_text = _profile_summary_text(dataset_profile)
    catalog_text = " ".join(column_names)

    has_sales = _contains_any(summary_text, SALES_SIGNAL_TERMS) or _contains_any(catalog_text, SALES_SIGNAL_TERMS)
    has_expense = _contains_any(summary_text, EXPENSE_SIGNAL_TERMS) or _contains_any(catalog_text, EXPENSE_SIGNAL_TERMS)
    has_product_breakdown = _contains_any(catalog_text, PRODUCT_SIGNAL_TERMS)
    has_branch_breakdown = _contains_any(catalog_text, BRANCH_SIGNAL_TERMS)

    allowed: set[str] = set()
    if has_sales:
        allowed.update({"total_revenue", "total_profit", "margin_percentage", "revenue_trend"})
    if has_product_breakdown:
        allowed.add("top_products")
    if has_branch_breakdown:
        allowed.add("branch_performance")
    if has_expense:
        allowed.add("total_expense")

    if not allowed:
        return set(SUPPORTED_TEMPLATES.keys())

    return allowed


def _profile_column_names(dataset_profile: dict[str, Any] | None) -> list[str]:
    columns = (dataset_profile or {}).get("columns") if isinstance(dataset_profile, dict) else []
    return [
        str(column.get("name") or "").strip().lower()
        for column in columns
        if isinstance(column, dict) and str(column.get("name") or "").strip()
    ]


def _profile_summary_text(dataset_profile: dict[str, Any] | None) -> str:
    return str((dataset_profile or {}).get("summary") or "").lower()


def _contains_any(text: str, terms: tuple[str, ...]) -> bool:
    haystack = str(text or "").lower()
    return any(term in haystack for term in terms)


def _format_dataset_info(profile: dict[str, Any] | None) -> str:
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
        if detected.get("categorical_columns"):
            parts.append(f"Categorical: {', '.join(detected['categorical_columns'][:8])}")

    return "\n".join(parts) if parts else "Dataset info minimal."


def _strip_code_fences(text: str) -> str:
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text


def _safe_parse_json(text: str) -> dict[str, Any]:
    text = _strip_code_fences(text.strip())

    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        pass

    cleaned = re.sub(r",\s*([}\]])", r"\1", text)
    cleaned = re.sub(r"//.*$", "", cleaned, flags=re.MULTILINE)

    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        extracted = re.sub(r",\s*([}\]])", r"\1", match.group(0))
        parsed = json.loads(extracted)
        return parsed if isinstance(parsed, dict) else {}

    raise json.JSONDecodeError("Could not parse JSON from LLM response", text, 0)


def should_retry_dashboard(state: AgentState) -> str:
    verdict = str(state.get("review_verdict") or "fail").lower()
    retry_count = int(state.get("dashboard_retry_count") or 0)
    if verdict == "pass":
        return "finish"
    if retry_count >= MAX_REVIEW_PASSES:
        return "finish"
    return "retry"
