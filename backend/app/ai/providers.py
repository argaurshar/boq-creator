"""Where the AI key goes. Mirrors frontend/src/engine/providers.ts.

The app talks to the Anthropic Messages API. That API is served by more than
one host: Anthropic itself, and gateways that re-expose it (kie.ai resells the
same Claude models on credits). The request body is identical; only the base
URL and the auth header differ, so this module is the only place that knows the
difference.

The user should never have to say which one they are on: the key prefix says
it. ``sk-ant-…`` is Anthropic, ``sk-kie-…`` is kie.ai.
"""
from __future__ import annotations

from typing import Any

ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_BASE = "https://api.anthropic.com"
KIE_BASE = "https://api.kie.ai/claude"

# Both providers serve the same models, so switching provider never silently
# changes which model reads your drawings.
MODELS: list[tuple[str, str]] = [
    ("claude-sonnet-4-6", "Sonnet (fast)"),
    ("claude-opus-4-8", "Opus (most thorough)"),
]

PROVIDERS: dict[str, dict[str, Any]] = {
    "anthropic": {
        "id": "anthropic",
        "label": "Anthropic (direct)",
        "short": "Anthropic",
        "base_url": ANTHROPIC_BASE,
        "url": f"{ANTHROPIC_BASE}/v1/messages",
        "key_prefixes": ["sk-ant-"],
        "key_hint": "starts with sk-ant-",
        "key_url": "https://console.anthropic.com/settings/keys",
        "auth": "x-api-key",
        "blurb": "Your own Anthropic account — billed by Anthropic.",
        "models": MODELS,
    },
    "kie": {
        "id": "kie",
        "label": "Kie.ai",
        "short": "Kie.ai",
        # kie.ai documents the base URL as https://api.kie.ai/claude and says
        # the client appends /v1/messages itself.
        "base_url": KIE_BASE,
        "url": f"{KIE_BASE}/v1/messages",
        "key_prefixes": ["sk-kie-"],
        "key_hint": "starts with sk-kie-",
        "key_url": "https://kie.ai/api-key",
        # kie.ai accepts the key as a bearer token (their ANTHROPIC_AUTH_TOKEN
        # route); the x-api-key route wants the literal text "Bearer <key>",
        # so bearer is the unambiguous one to send.
        "auth": "bearer",
        "blurb": "Same Claude models through kie.ai credits — billed by kie.ai.",
        "models": MODELS,
    },
}

DEFAULT_PROVIDER = "anthropic"
PROVIDER_LIST = [PROVIDERS["anthropic"], PROVIDERS["kie"]]


def normalize_key(raw: str | None) -> str:
    """Tidy a pasted key.

    People paste what the docs show them: quotes, stray whitespace, and — from
    kie.ai's Claude Code instructions — a literal ``Bearer `` prefix. All of
    those mean the same key.
    """
    k = (raw or "").strip()
    if len(k) >= 2 and ((k[0] == '"' and k[-1] == '"') or (k[0] == "'" and k[-1] == "'")):
        k = k[1:-1].strip()
    if k[:7].lower() == "bearer ":
        k = k[7:].strip()
    return k


def detect_provider(key: str | None) -> str | None:
    """Which provider issued this key? None when the prefix says nothing."""
    k = normalize_key(key).lower()
    if not k:
        return None
    for p in PROVIDER_LIST:
        if any(k.startswith(prefix) for prefix in p["key_prefixes"]):
            return p["id"]
    return None


def resolve_provider(key: str | None, pref: str | None = "auto") -> dict[str, Any]:
    """The provider to call with this key.

    An explicit preference wins; otherwise the key's own prefix decides; a key
    that looks like neither falls back to Anthropic (the historical behaviour,
    so existing deployments keep working).
    """
    if pref and pref != "auto" and pref in PROVIDERS:
        return PROVIDERS[pref]
    return PROVIDERS[detect_provider(key) or DEFAULT_PROVIDER]


def provider_info(pid: str | None) -> dict[str, Any]:
    return PROVIDERS.get(pid or "", PROVIDERS[DEFAULT_PROVIDER])


def auth_headers(provider: dict[str, Any], key: str) -> dict[str, str]:
    """Request headers for one provider — the only thing that differs per host.

    The SDK builds these itself; this function exists so the header contract is
    stated once and can be asserted in tests against the TypeScript client.
    """
    k = normalize_key(key)
    headers = {
        "content-type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
    }
    if provider["auth"] == "bearer":
        headers["authorization"] = f"Bearer {k}"
    else:
        headers["x-api-key"] = k
        # Anthropic blocks browser calls unless the caller opts in explicitly.
        headers["anthropic-dangerous-direct-browser-access"] = "true"
    return headers


def model_for(provider: dict[str, Any], model: str) -> str:
    """Keep a configured model only if the active provider serves it."""
    ids = [m for m, _ in provider["models"]]
    return model if model in ids else ids[0]
