"""Business logic bridging the API, the engine and the DB.

Validates raw member dicts (from AI / NL / forms) against the typed schema,
then builds the grouped BOQ by running the deterministic engine and applying
user rates. Quantities are always recomputed from members — never hand-stored —
so there is nothing to keep in sync. See project.md section 5.
"""
from __future__ import annotations

from typing import Any

from pydantic import TypeAdapter

from .engine.compute import CATEGORY_ORDER, compute_member
from .engine.units import round_qty
from .schemas.member_schema import Member

_member_adapter: TypeAdapter[Member] = TypeAdapter(Member)


def validate_member(raw: dict[str, Any]) -> Member:
    """Validate a raw member dict against the typed discriminated union."""
    return _member_adapter.validate_python(raw)


def member_to_dict(m: Member) -> dict[str, Any]:
    return m.model_dump()


def build_boq(members_orm, rates: dict[str, float]) -> dict[str, Any]:
    """Compute the full BOQ from stored members + a {category: rate} map.

    `members_orm` is a list of ORM Member rows (id, params, source,
    confidence, is_verified, label).
    """
    cat_groups: dict[str, list[dict[str, Any]]] = {c: [] for c, _ in CATEGORY_ORDER}

    for row in members_orm:
        try:
            member = validate_member(row.params)
        except Exception as exc:  # a malformed member shouldn't break the whole BOQ
            cat_groups.setdefault("_errors", []).append(
                {"member_id": row.id, "error": str(exc), "label": row.label})
            continue

        for q in compute_member(member):
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
