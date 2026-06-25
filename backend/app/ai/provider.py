"""The AI provider contract.

Two jobs only, both *extraction*:
  1. extract_members  — drawing page (image + text) -> typed members
  2. parse_nl_edit    — plain-English instruction -> a single edit operation

Neither returns a quantity. All numeric math happens later, deterministically,
in app.engine. See project.md sections 2 and 7.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class AIProvider(ABC):
    name: str = "abstract"

    @abstractmethod
    def extract_members(
        self,
        *,
        page_no: int,
        page_text: str,
        page_image_b64: str | None,
        scale: str,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """Return an ExtractionResult dict: {members: [...], unresolved: [...]}.

        Every member must already match the Member schema (dimensions in mm),
        carry a confidence, region and evidence, and NEVER include a computed
        quantity. Missing dimensions are null + listed in `unresolved`.
        """

    @abstractmethod
    def parse_nl_edit(
        self, *, text: str, context: dict[str, Any]
    ) -> dict[str, Any]:
        """Return an EditOperation dict: {op, member?, target_label?, message}."""
