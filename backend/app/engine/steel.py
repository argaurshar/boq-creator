"""Structural / MS steel. Unit: kg (summarised to MT in export).

Rolled-section weight from IS 808 / SP 6(1) table + connection lump.
See project.md section 6.
"""
from __future__ import annotations

from . import materials as mat
from .units import FormulaStep, Quantity, mm_to_m


def steel_member(m) -> list[Quantity]:
    unit_wt = mat.section_unit_weight(m.designation)
    L = mm_to_m(m.length_mm)
    n = m.count
    if unit_wt is None:
        # Unknown section: surface as a zero-weight line with an assumption so the
        # engine never silently fabricates a number.
        return [Quantity(
            category="steel",
            description=f"Steel member {m.label} ({m.designation}) — UNKNOWN SECTION",
            unit="kg", value=0.0, nos=n, length_m=L,
            audit=[FormulaStep("steel.unknown_section",
                               "section not in IS 808/SP 6 table",
                               {"designation": m.designation}, 0.0, "IS 808")],
        )]
    base = unit_wt * L * n
    total = base * (1 + m.connection_pct / 100.0)
    return [Quantity(
        category="steel",
        description=f"Structural steel {m.label} ({m.designation})".strip(),
        unit="kg", value=total, nos=n, length_m=L,
        audit=[FormulaStep(
            "steel.section.weight",
            "unit_wt * L * count * (1 + connection_pct)",
            {"unit_wt_kg_m": unit_wt, "L_m": L, "count": n,
             "connection_pct": m.connection_pct}, total, "IS 808 / SP 6(1)")],
    )]
