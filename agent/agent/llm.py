"""LLM client wrapper using langchain-google-genai.

Replaces the 579-line gemini.mjs with industry-standard SDK calls.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from langchain_google_genai import ChatGoogleGenerativeAI

from agent.config import settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=8)
def get_llm(
    model: str | None = None,
    temperature: float = 0.1,
    max_output_tokens: int = 1024,
) -> ChatGoogleGenerativeAI:
    """Get a cached LLM instance for the given model and parameters."""
    resolved_model = model or settings.gemini_model
    return ChatGoogleGenerativeAI(
        model=resolved_model,
        google_api_key=settings.gemini_api_key,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
    )


def get_default_llm() -> ChatGoogleGenerativeAI:
    """Get the default LLM (gemini-2.5-pro, low temp)."""
    return get_llm(model=settings.gemini_model, temperature=0.1, max_output_tokens=1024)


def get_light_llm() -> ChatGoogleGenerativeAI:
    """Get the lighter/faster LLM for simple tasks."""
    return get_llm(model=settings.gemini_model_light, temperature=0.4, max_output_tokens=512)


def extract_text(response) -> str:
    """Safely extract text content from an LLM response.

    Handles both simple string content and multi-part content blocks
    (e.g. thinking + text from gemini-2.5-pro).
    """
    if response is None:
        return ""

    content = response.content

    logger.debug("extract_text: content type=%s, repr=%s", type(content).__name__, repr(content)[:500])

    # If content is a plain string, return it
    if isinstance(content, str):
        return content.strip()

    # If content is a list (multi-part), extract text parts
    if isinstance(content, list):
        text_parts = []
        for part in content:
            if isinstance(part, str):
                text_parts.append(part)
            elif isinstance(part, dict):
                # Handle {"type": "text", "text": "..."} format
                if part.get("type") == "text":
                    text_parts.append(str(part.get("text", "")))
                # Handle thinking blocks — skip them
                elif part.get("type") == "thinking":
                    continue
                # Generic fallback
                elif "text" in part:
                    text_parts.append(str(part["text"]))
        return "\n".join(text_parts).strip()

    return str(content).strip()
