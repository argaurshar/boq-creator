"""The AI-provider contract: which host a key is sent to, and how.

A key must only ever be sent to the provider that issued it, over that
provider's own auth header. These tests pin both, plus the TypeScript mirror
the static build ships, so the two engines cannot drift apart.
"""
from __future__ import annotations

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
    resolve_provider,
)

TS_SOURCE = (Path(__file__).resolve().parents[2]
             / "frontend" / "src" / "engine" / "providers.ts").read_text()


# --------------------------------------------------------------- normalising
@pytest.mark.parametrize("raw, expected", [
    ("sk-ant-abc", "sk-ant-abc"),
    ("  sk-kie-abc  ", "sk-kie-abc"),
    # kie.ai's Claude Code docs tell users the value must start with "Bearer ".
    ("Bearer sk-kie-abc", "sk-kie-abc"),
    ("bearer  sk-kie-abc", "sk-kie-abc"),
    ('"sk-ant-abc"', "sk-ant-abc"),
    ("'sk-kie-abc'", "sk-kie-abc"),
    ('"Bearer sk-kie-abc"', "sk-kie-abc"),
    ("", ""),
    (None, ""),
])
def test_normalize_key_strips_what_people_paste(raw, expected):
    assert normalize_key(raw) == expected


# ---------------------------------------------------------------- detection
@pytest.mark.parametrize("key, expected", [
    ("sk-ant-api03-xyz", "anthropic"),
    ("sk-kie-abc123", "kie"),
    ("Bearer sk-kie-abc123", "kie"),
    ("sk-something-else", None),
    ("", None),
])
def test_detect_provider_reads_the_prefix(key, expected):
    assert detect_provider(key) == expected


def test_resolve_prefers_the_key_then_falls_back_to_anthropic():
    assert resolve_provider("sk-kie-abc")["id"] == "kie"
    assert resolve_provider("sk-ant-abc")["id"] == "anthropic"
    # An unrecognised prefix keeps the historical behaviour.
    assert resolve_provider("whatever")["id"] == "anthropic"
    assert resolve_provider("")["id"] == "anthropic"


def test_an_explicit_choice_overrides_the_prefix():
    assert resolve_provider("sk-ant-abc", "kie")["id"] == "kie"
    assert resolve_provider("sk-kie-abc", "anthropic")["id"] == "anthropic"
    assert resolve_provider("sk-kie-abc", "auto")["id"] == "kie"
    # An unknown preference is ignored rather than fatal.
    assert resolve_provider("sk-kie-abc", "nonsense")["id"] == "kie"


# ------------------------------------------------------------------ headers
def test_anthropic_uses_x_api_key_and_opts_into_browser_calls():
    h = auth_headers(PROVIDERS["anthropic"], "sk-ant-abc")
    assert h["x-api-key"] == "sk-ant-abc"
    assert h["anthropic-dangerous-direct-browser-access"] == "true"
    assert "authorization" not in h
    assert h["anthropic-version"] == "2023-06-01"


def test_kie_uses_a_bearer_token_and_never_x_api_key():
    h = auth_headers(PROVIDERS["kie"], "Bearer sk-kie-abc")
    assert h["authorization"] == "Bearer sk-kie-abc"   # prefix not doubled
    assert "x-api-key" not in h
    assert h["anthropic-version"] == "2023-06-01"


def test_model_for_keeps_the_picker_honest():
    assert model_for(PROVIDERS["kie"], "claude-opus-4-8") == "claude-opus-4-8"
    # A model the provider does not serve falls back to its first one.
    assert model_for(PROVIDERS["kie"], "gpt-9") == PROVIDERS["kie"]["models"][0][0]


# ------------------------------------------------------- SDK client wiring
def _wire(client):
    """The headers and URL the Anthropic SDK would actually put on the wire."""
    from anthropic._models import FinalRequestOptions
    req = client._build_request(FinalRequestOptions(
        method="post", url="/v1/messages",
        json_data={"model": "m", "max_tokens": 1, "messages": []}))
    return str(req.url), {k.lower(): v for k, v in req.headers.items()}


def _provider(monkeypatch, key, **env):
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


def test_env_can_pin_a_provider_and_an_explicit_base_url(monkeypatch):
    p = _provider(monkeypatch, "sk-ant-abc", AI_API_PROVIDER="kie")
    url, headers = _wire(p._client)
    assert url == "https://api.kie.ai/claude/v1/messages"
    assert headers["authorization"] == "Bearer sk-ant-abc"

    p = _provider(monkeypatch, "sk-ant-abc",
                  ANTHROPIC_BASE_URL="https://gateway.example.com/claude")
    url, _ = _wire(p._client)
    assert url == "https://gateway.example.com/claude/v1/messages"


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
