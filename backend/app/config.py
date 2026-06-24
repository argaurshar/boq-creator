"""Environment-driven settings. AI keys stay server-side (never sent to client)."""
from __future__ import annotations

import os


class Settings:
    APP_NAME = "BOQ Creator"
    DB_URL = os.getenv("BOQ_DB_URL", "sqlite:///./boq.db")
    # AI provider: "claude" (real) or "mock" (deterministic stub, no key needed).
    AI_PROVIDER = os.getenv("AI_PROVIDER", "mock")
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    # Latest Claude model for vision + structured extraction.
    CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-4-8")
    UPLOAD_DIR = os.getenv("BOQ_UPLOAD_DIR", "./uploads")
    CORS_ORIGINS = os.getenv("BOQ_CORS_ORIGINS", "*").split(",")


settings = Settings()
