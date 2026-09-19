"""Environment-driven settings.

ANTHROPIC_API_KEY here is the optional *server-side* key. Users may instead
bring their own key from the frontend (sent per request via the
``X-Anthropic-Api-Key`` header); either way the key only flows toward the AI
provider and is never sent back to the client.

The key may be an Anthropic key (``sk-ant-…``) or a kie.ai key (``sk-kie-…``),
which serves the same Claude models on kie.ai credits. The prefix picks the
endpoint — see ``app/ai/providers.py`` — unless AI_API_PROVIDER pins one.
"""
from __future__ import annotations

import os


class Settings:
    APP_NAME = "BOQ Creator"
    DB_URL = os.getenv("BOQ_DB_URL", "sqlite:///./boq.db")
    # AI provider: "claude" (real) or "mock" (deterministic stub, no key needed).
    AI_PROVIDER = os.getenv("AI_PROVIDER", "mock")
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    # Which host serves the Messages API: "auto" (decide from the key prefix),
    # "anthropic" or "kie". See app/ai/providers.py.
    AI_API_PROVIDER = os.getenv("AI_API_PROVIDER", "auto")
    # Explicit API root, overriding the provider's own (for a self-hosted or
    # future gateway). No trailing /v1/messages — the SDK appends that.
    ANTHROPIC_BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "")
    # Claude model for vision + structured extraction. Defaults to Sonnet
    # (faster/cheaper than Opus, ample for extraction); override via CLAUDE_MODEL.
    CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
    UPLOAD_DIR = os.getenv("BOQ_UPLOAD_DIR", "./uploads")
    CORS_ORIGINS = os.getenv("BOQ_CORS_ORIGINS", "*").split(",")


settings = Settings()
