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

import re
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
        "models_url": f"{ANTHROPIC_BASE}/v1/models",
        "key_prefixes": ["sk-ant-"],
        "key_hint": "sk-ant-",
        "article": "an",
        "key_url": "https://console.anthropic.com/settings/keys",
        "billing_url": "https://console.anthropic.com/settings/billing",
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
        "models_url": f"{KIE_BASE}/v1/models",
        "key_prefixes": ["sk-kie-"],
        "key_hint": "sk-kie-",
        "article": "a",
        "key_url": "https://kie.ai/api-key",
        "billing_url": "https://kie.ai/billing",
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


# A key token wherever it appears in pasted text: sk-ant-…, sk-kie-…, and any
# future sk-<vendor>- key. Long enough that it cannot match prose.
KEY_TOKEN = re.compile(r"(sk-[a-z][a-z0-9]*-[A-Za-z0-9_-]{8,})")
_BEARER = re.compile(r"^bearer\s+", re.I)


def normalize_key(raw: Any) -> str:
    """Tidy a pasted key.

    People paste what the docs hand them. kie.ai's Claude Code guide hands
    them a whole shell line — ``export ANTHROPIC_API_KEY="Bearer sk-kie-…"`` —
    and Anthropic's console hands them a bare key. Both must end up as the
    same token, because a key that is not recognised is routed to the wrong
    host. Kept byte-for-byte in step with normalizeKey() in providers.ts.
    """
    k = str(raw if raw is not None else "").strip()
    if len(k) >= 2 and ((k[0] == '"' and k[-1] == '"') or (k[0] == "'" and k[-1] == "'")):
        k = k[1:-1].strip()
    k = _BEARER.sub("", k).strip()
    # Anything else around the key (an export line, a JSON field, a stray
    # quote) is dropped as long as a key token is in there somewhere.
    if not _detect_prefix(k):
        m = KEY_TOKEN.search(k)
        if m:
            return m.group(1)
    return k


def _detect_prefix(k: str) -> str | None:
    """Prefix lookup on an already-normalised string (no recursion)."""
    low = k.lower()
    for p in PROVIDER_LIST:
        if any(low.startswith(prefix) for prefix in p["key_prefixes"]):
            return p["id"]
    return None


def detect_provider(key: Any) -> str | None:
    """Which provider issued this key? None when the prefix says nothing."""
    k = normalize_key(key)
    return _detect_prefix(k) if k else None


def resolve_provider(key: Any, pref: str | None = "auto") -> dict[str, Any]:
    """The provider to call with this key.

    A key goes to the provider that issued it — always. Sending an sk-ant- key
    to another host would hand that host a credential it has no business
    seeing, so a preference can never override a *recognised* key; it only
    decides where a key with an unfamiliar prefix goes. A key that looks like
    neither, with no preference, falls back to Anthropic (the historical
    behaviour, so existing deployments keep working).
    """
    detected = detect_provider(key)
    if detected:
        return PROVIDERS[detected]
    if pref and pref != "auto" and pref in PROVIDERS:
        return PROVIDERS[pref]
    return PROVIDERS[DEFAULT_PROVIDER]


def override_ignored(key: Any, pref: str | None) -> bool:
    """True when a chosen provider is ignored because the key names its own."""
    detected = detect_provider(key)
    return bool(pref and pref != "auto" and detected is not None and detected != pref)


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
    """The model id to send.

    Whatever was configured wins. The per-provider list is a convenience for
    the picker, not a catalogue we can vouch for — a gateway may serve model
    ids we have never heard of — and silently replacing a chosen model turns
    "that model is not served here" into a confusing wrong answer. Only an
    empty choice takes the default.
    """
    return str(model or "").strip() or provider["models"][0][0]
