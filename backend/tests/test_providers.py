"""The AI-provider contract: which host a key is sent to, and how.

A key must only ever be sent to the provider that issued it, over that
provider's own auth header. These tests pin both, plus the TypeScript mirror
the static build ships, so the two engines cannot drift apart.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest

from app.ai.providers import (
    PROVIDERS,
    auth_headers,
    detect_provider,
    model_for,
    normalize_key,
    override_ignored,
    resolve_provider,
)

REPO = Path(__file__).resolve().parents[2]
TS_SOURCE = (REPO / "frontend" / "src" / "engine" / "providers.ts").read_text()
# One corpus, two engines: the TypeScript asserts the same file in
# frontend/scripts/check-providers.mjs (npm run check:providers, run in CI).
CASES = json.loads((REPO / "shared" / "provider-cases.json").read_text())


# --------------------------------------------------------------- normalising
@pytest.mark.parametrize("case", CASES["normalize"], ids=lambda c: repr(c["in"]))
def test_normalize_key_matches_the_shared_corpus(case):
    assert normalize_key(case["in"]) == case["out"]


def test_normalize_key_survives_non_strings():
    assert normalize_key(None) == ""
    assert normalize_key(12345) == "12345"


# ---------------------------------------------------------------- detection
@pytest.mark.parametrize("case", CASES["detect"], ids=lambda c: repr(c["key"]))
def test_detect_provider_matches_the_shared_corpus(case):
    assert detect_provider(case["key"]) == case["provider"]


@pytest.mark.parametrize("case", CASES["resolve"],
                         ids=lambda c: f"{c['key'][:12]}|{c['pref']}")
def test_resolve_provider_matches_the_shared_corpus(case):
    assert resolve_provider(case["key"], case["pref"])["id"] == case["provider"]
    if "ignored" in case:
        assert override_ignored(case["key"], case["pref"]) is case["ignored"]


def test_a_recognised_key_always_goes_to_its_own_provider():
    """A preference must never hand a key to a host that did not issue it."""
    assert resolve_provider("sk-kie-abcdefgh12", "anthropic")["id"] == "kie"
    assert resolve_provider("sk-ant-abcdefgh12", "kie")["id"] == "anthropic"
    assert override_ignored("sk-kie-abcdefgh12", "anthropic") is True
    # The preference still decides for a key whose prefix says nothing.
    assert resolve_provider("sk-other-abcdefgh12", "kie")["id"] == "kie"
    assert override_ignored("sk-other-abcdefgh12", "kie") is False
    # An unknown preference is ignored rather than fatal.
    assert resolve_provider("mystery", "nonsense")["id"] == "anthropic"


# ------------------------------------------------------------------ headers
@pytest.mark.parametrize("case", CASES["headers"], ids=lambda c: c["provider"])
def test_auth_headers_match_the_shared_corpus(case):
    assert auth_headers(PROVIDERS[case["provider"]], case["key"]) == case["headers"]


def test_anthropic_opts_into_browser_calls_and_kie_does_not_get_x_api_key():
    a = auth_headers(PROVIDERS["anthropic"], "sk-ant-abc")
    assert a["anthropic-dangerous-direct-browser-access"] == "true"
    assert "authorization" not in a
    k = auth_headers(PROVIDERS["kie"], "Bearer sk-kie-abc")
    assert k["authorization"] == "Bearer sk-kie-abc"   # prefix not doubled
    assert "x-api-key" not in k


def test_model_for_keeps_the_picker_honest():
    assert model_for(PROVIDERS["kie"], "claude-opus-4-8") == "claude-opus-4-8"
    # A model the provider does not serve falls back to its first one.
    assert model_for(PROVIDERS["kie"], "gpt-9") == PROVIDERS["kie"]["models"][0][0]


def test_every_provider_has_a_billing_page_distinct_from_its_key_page():
    for p in PROVIDERS.values():
        assert p["billing_url"].startswith("https://")
        assert p["billing_url"] != p["key_url"]


# ------------------------------------------------------- SDK client wiring
def _wire(client):
    """The headers and URL the Anthropic SDK would actually put on the wire."""
    from anthropic._models import FinalRequestOptions
    req = client._build_request(FinalRequestOptions(
        method="post", url="/v1/messages",
        json_data={"model": "m", "max_tokens": 1, "messages": []}))
    return str(req.url), {k.lower(): v for k, v in req.headers.items()}


def _provider(monkeypatch, key, **env):
    """Build a ClaudeProvider with a clean environment. key=None = server key."""
    for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "AI_API_PROVIDER",
              "ANTHROPIC_BASE_URL"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    # settings is read at import time, so patch the live object.
    from app.config import settings
    monkeypatch.setattr(settings, "AI_API_PROVIDER", env.get("AI_API_PROVIDER", "auto"))
    monkeypatch.setattr(settings, "ANTHROPIC_BASE_URL", env.get("ANTHROPIC_BASE_URL", ""))
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", env.get("ANTHROPIC_API_KEY", ""))
    from app.ai.claude_provider import ClaudeProvider
    return ClaudeProvider(api_key=key)


def test_anthropic_key_goes_to_anthropic(monkeypatch):
    p = _provider(monkeypatch, "sk-ant-abc")
    url, headers = _wire(p._client)
    assert url == "https://api.anthropic.com/v1/messages"
    assert headers["x-api-key"] == "sk-ant-abc"
    assert "authorization" not in headers


def test_kie_key_goes_to_kie_as_a_bearer_token(monkeypatch):
    p = _provider(monkeypatch, "sk-kie-abc")
    url, headers = _wire(p._client)
    assert url == "https://api.kie.ai/claude/v1/messages"
    assert headers["authorization"] == "Bearer sk-kie-abc"
    assert "x-api-key" not in headers


def test_a_server_side_anthropic_key_is_never_sent_to_kie(monkeypatch):
    """The SDK falls back to ANTHROPIC_API_KEY when api_key is None, and an
    x-api-key beats a bearer token. A user's kie.ai request must not carry the
    operator's Anthropic key to another host."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-server-secret")
    p = _provider(monkeypatch, "sk-kie-user", ANTHROPIC_API_KEY="sk-ant-server-secret")
    url, headers = _wire(p._client)
    assert url == "https://api.kie.ai/claude/v1/messages"
    assert headers["authorization"] == "Bearer sk-kie-user"
    assert "x-api-key" not in headers
    assert "sk-ant-server-secret" not in str(headers)


def test_pasted_bearer_prefix_is_not_doubled(monkeypatch):
    p = _provider(monkeypatch, "Bearer sk-kie-abc")
    _, headers = _wire(p._client)
    assert headers["authorization"] == "Bearer sk-kie-abc"


def test_env_pins_apply_to_the_servers_own_key(monkeypatch):
    """AI_API_PROVIDER / ANTHROPIC_BASE_URL configure the operator's key."""
    p = _provider(monkeypatch, None, AI_API_PROVIDER="kie",
                  ANTHROPIC_API_KEY="sk-operator-key")
    url, headers = _wire(p._client)
    assert url == "https://api.kie.ai/claude/v1/messages"
    assert headers["authorization"] == "Bearer sk-operator-key"

    p = _provider(monkeypatch, None, ANTHROPIC_API_KEY="sk-ant-abc",
                  ANTHROPIC_BASE_URL="https://gateway.example.com/claude")
    url, _ = _wire(p._client)
    assert url == "https://gateway.example.com/claude/v1/messages"


def test_env_pins_never_redirect_a_users_own_key(monkeypatch):
    """A bring-your-own key follows its own prefix.

    The operator's pin describes where the operator's key goes. Applying it to
    a user's key would send that user's credential to a host they never chose.
    """
    p = _provider(monkeypatch, "sk-ant-user", AI_API_PROVIDER="kie",
                  ANTHROPIC_BASE_URL="https://gateway.example.com/claude")
    url, headers = _wire(p._client)
    assert url == "https://api.anthropic.com/v1/messages"
    assert headers["x-api-key"] == "sk-ant-user"

    p = _provider(monkeypatch, "sk-kie-user", AI_API_PROVIDER="anthropic")
    url, headers = _wire(p._client)
    assert url == "https://api.kie.ai/claude/v1/messages"
    assert headers["authorization"] == "Bearer sk-kie-user"


def test_the_configured_model_is_sent_unchanged(monkeypatch):
    """CLAUDE_MODEL is the operator's choice; the UI picker does the filtering."""
    from app.config import settings
    monkeypatch.setattr(settings, "CLAUDE_MODEL", "claude-opus-4-6")
    import importlib

    import app.ai.claude_provider as cp
    importlib.reload(cp)
    try:
        monkeypatch.setattr(settings, "AI_API_PROVIDER", "auto")
        monkeypatch.setattr(settings, "ANTHROPIC_BASE_URL", "")
        assert cp.ClaudeProvider(api_key="sk-kie-abc").model == "claude-opus-4-6"
    finally:
        monkeypatch.setattr(settings, "CLAUDE_MODEL", "claude-sonnet-4-6")
        importlib.reload(cp)


# ------------------------------------------------- parity with the TS mirror
def _ts_const(name: str) -> str:
    m = re.search(rf'const {name} = "([^"]+)"', TS_SOURCE)
    assert m, f"{name} missing from providers.ts"
    return m.group(1)


def _ts_block(provider_id: str) -> str:
    m = re.search(rf"\n  {provider_id}: \{{(.+?)\n  \}},", TS_SOURCE, re.S)
    assert m, f"{provider_id} block missing from providers.ts"
    return m.group(1)


def test_ts_and_python_agree_on_endpoints():
    assert _ts_const("ANTHROPIC_BASE") == PROVIDERS["anthropic"]["base_url"]
    assert _ts_const("KIE_BASE") == PROVIDERS["kie"]["base_url"]


@pytest.mark.parametrize("pid", ["anthropic", "kie"])
def test_ts_and_python_agree_on_auth_prefixes_and_links(pid):
    block = _ts_block(pid)
    py = PROVIDERS[pid]
    assert re.search(rf'auth: "{py["auth"]}"', block)
    assert re.search(rf'keyUrl: "{re.escape(py["key_url"])}"', block)
    for prefix in py["key_prefixes"]:
        assert f'"{prefix}"' in block
    assert f'short: "{py["short"]}"' in block


def test_ts_and_python_offer_the_same_models():
    ts_models = re.findall(r'\["(claude-[^"]+)", "([^"]+)"\]', TS_SOURCE)
    assert ts_models == [tuple(m) for m in PROVIDERS["anthropic"]["models"]]
    assert ts_models == [tuple(m) for m in PROVIDERS["kie"]["models"]]
    assert ts_models == [tuple(m) for m in CASES["models"]]


def test_the_corpus_covers_both_engines():
    """The corpus is only worth having if the TypeScript side runs it too."""
    script = (REPO / "frontend" / "scripts" / "check-providers.mjs").read_text()
    assert "shared/provider-cases.json" in script
    pkg = json.loads((REPO / "frontend" / "package.json").read_text())
    assert pkg["scripts"]["check:providers"] == "node scripts/check-providers.mjs"
    ci = (REPO / ".github" / "workflows" / "ci.yml").read_text()
    assert "npm run check:providers" in ci


def test_corpus_endpoints_match_python():
    for pid, url in CASES["endpoints"].items():
        assert PROVIDERS[pid]["url"] == url


def test_no_api_key_is_hard_coded_anywhere():
    """Keys belong in the browser or the environment, never in the repo."""
    root = Path(__file__).resolve().parents[2]
    hits = []
    for path in list(root.glob("backend/app/**/*.py")) + \
            list(root.glob("frontend/src/**/*.ts*")) + [root / ".env.example"]:
        text = path.read_text()
        for m in re.finditer(r"sk-(?:ant|kie)-[A-Za-z0-9_\-]{8,}", text):
            hits.append(f"{path.name}: {m.group(0)[:16]}…")
    assert hits == [], f"possible real key committed: {hits}"


def test_no_key_is_logged_or_echoed_by_the_api():
    """The key flows browser -> backend -> provider and never comes back."""
    routes = (Path(__file__).resolve().parents[1] / "app" / "api" / "routes.py").read_text()
    assert "x_anthropic_api_key" in routes
    # It may be forwarded to get_provider, but never returned or printed.
    for line in routes.splitlines():
        if "x_anthropic_api_key" in line:
            assert not line.strip().startswith(("return", "print")), line
