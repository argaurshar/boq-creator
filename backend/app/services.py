"""Business logic bridging the API, the engine and the DB.

Validates raw member dicts (from AI / NL / forms) against the typed schema,
then builds the grouped BOQ by running the deterministic engine and applying
user rates. Quantities are always recomputed from members — never hand-stored —
so there is nothing to keep in sync. See project.md section 5.
"""
from __future__ import annotations

import re
from typing import Any

from pydantic import TypeAdapter

from .engine.compute import CATEGORY_ORDER, compute_member, concrete_volume
from .engine.units import round_qty
from .schemas.member_schema import Member

_member_adapter: TypeAdapter[Member] = TypeAdapter(Member)


def validate_member(raw: dict[str, Any]) -> Member:
    """Validate a raw member dict against the typed discriminated union."""
    return _member_adapter.validate_python(raw)


def member_to_dict(m: Member) -> dict[str, Any]:
    return m.model_dump()


def _apply_netting(m: Member, vol_by_label: dict[str, float]) -> Member:
    """Resolve cross-member links into per-unit embedded volumes.

    Keeps the engine a pure function of a single member: the linkage is computed
    here and injected as the member's embedded_* field. Embedded totals are
    divided by the member's count because the engine applies the field per unit
    and then multiplies by count.
    """
    labels = getattr(m, "contains_labels", None) or getattr(m, "embedded_labels", None)
    if not labels:
        return m
    total = sum(vol_by_label.get(lbl, 0.0) for lbl in labels)
    per_unit = total / max(m.count, 1)
    if getattr(m, "contains_labels", None):
        return m.model_copy(update={"embedded_structure_m3": per_unit})
    return m.model_copy(update={"embedded_rcc_m3": per_unit})


def build_boq(members_orm, rates: dict[str, float]) -> dict[str, Any]:
    """Compute the full BOQ from stored members + a {category: rate} map.

    `members_orm` is a list of ORM Member rows (id, params, source,
    confidence, is_verified, label).
    """
    cat_groups: dict[str, list[dict[str, Any]]] = {c: [] for c, _ in CATEGORY_ORDER}

    # Pass 1: validate everything and map label -> total concrete volume, so the
    # netting resolver can subtract embedded structure / RCC by reference.
    validated: list[tuple[Any, Member]] = []
    vol_by_label: dict[str, float] = {}
    for row in members_orm:
        try:
            member = validate_member(row.params)
        except Exception as exc:  # a malformed member shouldn't break the whole BOQ
            cat_groups.setdefault("_errors", []).append(
                {"member_id": row.id, "error": str(exc), "label": row.label})
            continue
        validated.append((row, member))
        if member.label:
            vol_by_label[member.label] = (
                vol_by_label.get(member.label, 0.0) + concrete_volume(member))

    # Dedup: when a truss assembly is present, drop loose steel_member lines that
    # re-list its parts (the AI sometimes emits a truss AND its chords/webs/struts
    # as separate members). Match on truss-part wording; never touch base plates,
    # anchor bolts, stiffeners or column-connection pieces. Removed lines are
    # reported as warnings, not silently dropped. Mirrors the TS engine.
    has_truss = any(mem.member_type == "truss" for _, mem in validated)
    dup_re = re.compile(
        r"top chord|bottom chord|\bchord\b|bottom tie|\btie\b|rafter|\bweb\b|"
        r"\bstrut\b|purlin|transverse|longitudinal|bracing|diagonal|vertical",
        re.IGNORECASE,
    )
    kept: list[tuple[Any, Member]] = []
    for row, member in validated:
        if has_truss and member.member_type == "steel_member":
            hay = f"{member.label or ''} {member.evidence or ''} {getattr(member, 'designation', '') or ''}"
            if dup_re.search(hay):
                cat_groups.setdefault("_errors", []).append({
                    "member_id": row.id, "label": member.label, "warning": True,
                    "error": ("Removed probable duplicate steel (already counted in "
                              f"the truss): {(getattr(member, 'designation', '') or '').strip()} "
                              f"{(member.label or '').strip()}").strip(),
                })
                continue
        kept.append((row, member))

    # Pass 2: compute quantities, applying netting links.
    for row, member in kept:
        effective = _apply_netting(member, vol_by_label)
        for q in compute_member(effective):
            rate = float(rates.get(q.category, 0.0))
            qty = round_qty(q.value, q.unit)
            cat_groups.setdefault(q.category, []).append({
                "member_id": row.id,
                "source": row.source,
                "confidence": row.confidence,
                "is_verified": row.is_verified,
                "category": q.category,
                "description": q.description,
                "unit": q.unit,
                "quantity": qty,
                "nos": q.nos,
                "length_m": q.length_m,
                "breadth_m": q.breadth_m,
                "depth_m": q.depth_m,
                "rate": rate,
                "amount": round(qty * rate, 2),
                "audit": [s.to_dict() for s in q.audit],
                "extra": q.extra,
            })

    groups = []
    grand_total = 0.0
    for cat, label in CATEGORY_ORDER:
        items = cat_groups.get(cat, [])
        if not items:
            continue
        subtotal = round(sum(i["amount"] for i in items), 2)
        grand_total += subtotal
        groups.append({"category": cat, "label": label,
                       "items": items, "subtotal": subtotal})

    return {
        "groups": groups,
        "grand_total": round(grand_total, 2),
        "errors": cat_groups.get("_errors", []),
    }
