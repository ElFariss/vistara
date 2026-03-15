"""Application configuration loaded from environment variables."""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """All settings for the Vistara agent backend."""

    # --- Server ---
    host: str = "0.0.0.0"
    port: int = 8001
    debug: bool = False

    # --- Gemini ---
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-pro"
    gemini_model_light: str = "gemini-2.5-flash"
    gemini_vision_model: str = "gemini-3-flash-preview"

    # --- Database ---
    database_url: str = ""

    # --- Node.js Internal API ---
    nodejs_internal_url: str = "http://localhost:8080"

    # --- Data ---
    data_dir: str = "./data"
    upload_dir: str = "./data/uploads"

    # --- Agent ---
    dashboard_agent_timeout_s: int = 120
    dashboard_agent_max_attempts: int = 2
    python_sandbox_timeout_s: int = 30

    model_config = {"env_file": "../.env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
