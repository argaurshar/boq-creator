"""AI layer. The AI ONLY extracts typed members; it never computes quantities.

Provider is pluggable (project.md section 5): the default is Claude, but a
deterministic mock provider lets the whole app run without an API key.

The key may come from the server environment (ANTHROPIC_API_KEY) OR be supplied
per request by the user from the frontend (passed in here as `api_key`). A
per-request key always wins, so a hosted instance can stay key-less and let each
user bring their own. The key only ever flows browser -> backend -> Anthropic;
it is never sent back to the client.
"""
from __future__ import annotations

from ..config import settings
from .provider import AIProvider


def get_provider(api_key: str | None = None) -> AIProvider:
    key = (api_key or "").strip()
    if key:  # user-supplied key from the frontend wins
        from .claude_provider import ClaudeProvider
        return ClaudeProvider(api_key=key)
    if settings.AI_PROVIDER == "claude" and settings.ANTHROPIC_API_KEY:
        from .claude_provider import ClaudeProvider
        return ClaudeProvider()
    from .mock_provider import MockProvider
    return MockProvider()
