"""Claude-backed provider (default when ANTHROPIC_API_KEY is set).

Runs Claude with vision for drawing extraction and NL parsing. The model
returns JSON which we validate against the Member schema (Pydantic)
server-side, retrying once on invalid output. The model never computes a
quantity — that wall is enforced by the engine, not the model.

The same Messages API is served by Anthropic and by kie.ai (same models, kie.ai
credits). The key prefix decides which host this client talks to; see
``providers.py``.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..config import settings
from .provider import AIProvider
from .providers import normalize_key, resolve_provider

_PROMPTS = Path(__file__).parent / "prompts"
_MODEL = settings.CLAUDE_MODEL  # default "claude-sonnet-4-6"


def _load(name: str) -> str:
    return (_PROMPTS / name).read_text()


class ClaudeProvider(AIProvider):
    name = "claude"

    def __init__(self, api_key: str | None = None) -> None:
        import anthropic  # imported lazily so the app runs without the package
        # A per-request key (from the frontend) takes precedence over the env.
        # The operator's pinned host and base URL apply to the operator's own
        # key only: a user's key follows its own prefix, so bringing your own
        # key never hands it to a host you did not choose.
        byo = bool((api_key or "").strip())
        key = normalize_key(api_key or settings.ANTHROPIC_API_KEY)
        self.provider = resolve_provider(key, "auto" if byo else settings.AI_API_PROVIDER)
        # The operator chose CLAUDE_MODEL deliberately; pass it through.
        self.model = _MODEL
        base_url = (self.provider["base_url"] if byo
                    else (settings.ANTHROPIC_BASE_URL or self.provider["base_url"]))
        if self.provider["auth"] == "bearer":
            self._client = anthropic.Anthropic(
                api_key=None, auth_token=key, base_url=base_url)
            # The SDK resolves api_key from ANTHROPIC_API_KEY when it is None,
            # and an x-api-key beats a bearer token. Clearing it keeps a
            # server-side Anthropic key from being sent to another host with
            # this user's kie.ai request — the key must never leave for a
            # provider it does not belong to.
            self._client.api_key = None
        else:
            self._client = anthropic.Anthropic(api_key=key, base_url=base_url)

    # ------------------------------------------------------------------ #
    def extract_members(self, *, page_no, page_text, page_image_b64, scale, context):
        content: list[dict[str, Any]] = []
        if page_image_b64:
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png",
                           "data": page_image_b64},
            })
        content.append({
            "type": "text",
            "text": (
                f"Page number: {page_no}\nScale: {scale}\n"
                f"Project defaults: {json.dumps(context)}\n\n"
                f"Extracted page text (may include schedule tables):\n{page_text[:24000]}"
            ),
        })
        data = self._json_call(_load("extract_members.md"), content)
        data.setdefault("page_no", page_no)
        data.setdefault("members", [])
        data.setdefault("unresolved", [])
        return data

    def parse_nl_edit(self, *, text, context):
        content = [{
            "type": "text",
            "text": f"Project defaults: {json.dumps(context)}\n\nInstruction:\n{text}",
        }]
        return self._json_call(_load("nl_edit.md"), content)

    # ------------------------------------------------------------------ #
    # Extended thinking + high effort improve extraction, but only newer SDK
    # versions accept these kwargs. We try them and transparently fall back to
    # a plain call so the provider works across anthropic SDK versions.
    _extra: dict[str, Any] = {"thinking": {"type": "adaptive"},
                              "output_config": {"effort": "high"}}

    def _create(self, system: str, content: list[dict[str, Any]]):
        base = dict(
            model=self.model,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": content}],
        )
        try:
            return self._client.messages.create(**base, **self._extra)
        except TypeError:
            # SDK doesn't support thinking/output_config — drop and retry plainly
            # (and remember, so we don't pay the failed call again).
            self._extra = {}
            return self._client.messages.create(**base)

    def _json_call(self, system: str, content: list[dict[str, Any]]) -> dict[str, Any]:
        last_err = None
        for attempt in range(2):
            sys = system if attempt == 0 else (
                system + "\n\nYour previous reply was not valid JSON. "
                         "Return ONLY the JSON object.")
            msg = self._create(sys, content)
            text = next((b.text for b in msg.content if b.type == "text"), "")
            try:
                return json.loads(self._strip_fences(text))
            except json.JSONDecodeError as e:  # retry once
                last_err = e
        raise ValueError(f"Claude did not return valid JSON: {last_err}")

    @staticmethod
    def _strip_fences(text: str) -> str:
        t = text.strip()
        if t.startswith("```"):
            t = t.split("```", 2)[1]
            if t.startswith("json"):
                t = t[4:]
        return t.strip()
