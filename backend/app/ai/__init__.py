"""AI layer. The AI ONLY extracts typed members; it never computes quantities.

Provider is pluggable (project.md section 5): the default is Claude, but a
deterministic mock provider lets the whole app run without an API key.
"""
from __future__ import annotations

from ..config import settings
from .provider import AIProvider


def get_provider() -> AIProvider:
    if settings.AI_PROVIDER == "claude" and settings.ANTHROPIC_API_KEY:
        from .claude_provider import ClaudeProvider
        return ClaudeProvider()
    from .mock_provider import MockProvider
    return MockProvider()
