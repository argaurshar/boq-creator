"""Deterministic, key-free provider.

Lets the whole app run end-to-end with no API key. It is NOT a stand-in for
real vision extraction — `extract_members` returns nothing and flags that a
real provider is needed. But `parse_nl_edit` ships a genuinely useful
regex/heuristic parser for plain-English commands like:

    "add 5 columns 300x600 3m high with 8-16mm bars M25"
    "add brick wall 3m long 3m high 230 thick with a 1000x2100 door"
    "add footing 2000x2000x400"
    "add beam 230x450 span 4500 with 3-16 bottom 2-16 top stirrups 8 @150"
"""
from __future__ import annotations

import re
from typing import Any

from .provider import AIProvider


def _num(s: str) -> float:
    return float(s)


def _to_mm(value: float, unit: str | None) -> float:
    if unit in ("m", "meter", "metre", "meters", "metres"):
        return value * 1000
    if unit in ("cm",):
        return value * 10
    if unit in ("ft", "feet", "foot", "'"):
        return value * 304.8
    return value  # already mm


# e.g. "300x600", "300 x 600", "2000x2000x400"
DIMS = re.compile(r"(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)(?:\s*[xX*]\s*(\d+(?:\.\d+)?))?")
GRADE = re.compile(r"\bM\s?(\d{2})\b", re.I)
COUNT = re.compile(r"(?:add|create)?\s*(\d+)\s+(column|beam|footing|slab|wall|brick\s*wall)", re.I)
HEIGHT = re.compile(r"(\d+(?:\.\d+)?)\s*(m|cm|mm|ft|feet)?\s*(?:high|height|tall|ht)", re.I)
SPAN = re.compile(r"(?:span|long|length)\s*(?:of)?\s*(\d+(?:\.\d+)?)\s*(m|cm|mm|ft)?", re.I)
THICK = re.compile(r"(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*(?:thick|thk)", re.I)
# bar spec like "8-16mm", "3-16", "8 x 16mm", "8 nos 16"
BARS = re.compile(r"(\d+)\s*[-x ]\s*(\d+)\s*(?:mm)?\s*(?:dia|ø|bars?|nos)?", re.I)


class MockProvider(AIProvider):
    name = "mock"

    def extract_members(self, *, page_no, page_text, page_image_b64, scale, context):
        return {
            "page_no": page_no,
            "members": [],
            "unresolved": [
                {
                    "issue": "Automatic drawing extraction needs the Claude provider "
                             "(set AI_PROVIDER=claude and ANTHROPIC_API_KEY). "
                             "You can still add members via natural language or the form.",
                    "needs_user_input": True,
                }
            ],
        }

    def parse_nl_edit(self, *, text, context):
        t = text.strip().lower()
        if t.startswith(("delete", "remove")):
            # The apply path only adds members; don't return a delete op the
            # backend can't honour. Point the user at the delete button instead.
            return {
                "op": "noop",
                "message": "Deleting via chat isn't supported yet — use the "
                           "delete button on the element in the left panel.",
            }
        member = self._parse_member(text)
        if member is None:
            return {
                "op": "noop",
                "message": "Sorry, I couldn't parse that. Try e.g. "
                           "'add 5 columns 300x600 3m high with 8-16mm bars M25'.",
            }
        return {
            "op": "add",
            "member": member,
            "message": f"Parsed a {member['member_type']} ({member.get('label','')}).",
        }

    # ------------------------------------------------------------------ #
    def _parse_member(self, text: str) -> dict[str, Any] | None:
        t = text.lower()
        grade = "M" + GRADE.search(t).group(1) if GRADE.search(t) else "M25"
        count = 1
        cm = COUNT.search(t)
        if cm:
            count = int(cm.group(1))

        common = {"count": count, "concrete_grade": grade, "source": "nl", "confidence": 0.9}

        if "column" in t:
            d = DIMS.search(t)
            h = HEIGHT.search(t)
            if not d:
                return None
            # Strip the section dims (first DIMS match, e.g. "300x600") before
            # reading the bar spec, so "8-16mm" isn't mis-read as 300 bars of 600.
            seg = DIMS.sub(" ", t, count=1)
            bars = BARS.search(seg) if "bar" in t else None
            main = ([{"dia_mm": _num(bars.group(2)), "count": int(bars.group(1))}]
                    if bars else [])
            return {
                "member_type": "column", "label": "C-nl",
                "b_mm": _num(d.group(1)), "D_mm": _num(d.group(2)),
                "height_mm": _to_mm(_num(h.group(1)), h.group(2)) if h else 3000,
                "main_bars": main,
                "ties": self._ties(t),
                **common,
            }

        if "beam" in t:
            d = DIMS.search(t)
            sp = SPAN.search(t)
            if not d:
                return None
            return {
                "member_type": "beam", "label": "B-nl",
                "b_mm": _num(d.group(1)), "depth_mm": _num(d.group(2)),
                "clear_span_mm": _to_mm(_num(sp.group(1)), sp.group(2)) if sp else 4000,
                "stirrups": self._ties(t),
                **common,
            }

        if "footing" in t:
            d = DIMS.search(t)
            if not d:
                return None
            return {
                "member_type": "footing", "label": "F-nl",
                "length_mm": _num(d.group(1)), "breadth_mm": _num(d.group(2)),
                "depth_mm": _num(d.group(3)) if d.group(3) else 400,
                **common,
            }

        if "slab" in t:
            d = DIMS.search(t)
            th = THICK.search(t)
            if not d:
                return None
            return {
                "member_type": "slab", "label": "S-nl",
                "length_mm": _num(d.group(1)), "breadth_mm": _num(d.group(2)),
                "thickness_mm": _to_mm(_num(th.group(1)), th.group(2)) if th else 125,
                **common,
            }

        if "brick" in t or "wall" in t:
            d = DIMS.search(t)
            h = HEIGHT.search(t)
            sp = SPAN.search(t)
            th = THICK.search(t)
            length = (_to_mm(_num(sp.group(1)), sp.group(2)) if sp
                      else (_num(d.group(1)) if d else 3000))
            return {
                "member_type": "brick_wall", "label": "W-nl",
                "length_mm": length,
                "height_mm": _to_mm(_num(h.group(1)), h.group(2)) if h else 3000,
                "thickness_mm": _to_mm(_num(th.group(1)), th.group(2)) if th else 230,
                "openings": self._openings(t),
                "count": count,
                "source": "nl", "confidence": 0.85,
            }

        return None

    def _ties(self, t: str) -> dict[str, Any] | None:
        m = re.search(r"(?:stirrup|tie|ties)s?\s*(\d+)?\s*(?:mm)?\s*@?\s*(\d+)", t)
        if m:
            return {"dia_mm": _num(m.group(1) or "8"), "legs": 2,
                    "spacing_mm": _num(m.group(2))}
        return None

    def _openings(self, t: str) -> list[dict[str, Any]]:
        out = []
        for w, h in re.findall(r"(\d{3,4})\s*[xX]\s*(\d{3,4})\s*(?:door|window|opening)", t):
            out.append({"width_mm": _num(w), "height_mm": _num(h), "count": 1})
        return out
