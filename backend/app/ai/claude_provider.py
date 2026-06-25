"""Claude-backed provider (default when ANTHROPIC_API_KEY is set).

Uses Anthropic's Claude Opus 4.8 with adaptive thinking for vision extraction
and NL parsing. The model returns JSON which we validate against the Member
schema (Pydantic) server-side, retrying once on invalid output. The model never
computes a quantity — that wall is enforced by the engine, not the model.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..config import settings
from .provider import AIProvider

_PROMPTS = Path(__file__).parent / "prompts"
_MODEL = settings.CLAUDE_MODEL  # default "claude-opus-4-8"


def _load(name: str) -> str:
    return (_PROMPTS / name).read_text()


class ClaudeProvider(AIProvider):
    name = "claude"

    def __init__(self, api_key: str | None = None) -> None:
        import anthropic  # imported lazily so the app runs without the package
        # A per-request key (from the frontend) takes precedence over the env.
        self._client = anthropic.Anthropic(
            api_key=api_key or settings.ANTHROPIC_API_KEY)

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
            model=_MODEL,
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
