"""Structural / MS steel. Unit: kg (summarised to MT in export).

Rolled-section weight from IS 808 / SP 6(1) table + connection lump.
See project.md section 6.
"""
from __future__ import annotations

from . import materials as mat
from .units import FormulaStep, Quantity, mm_to_m


def steel_member(m) -> list[Quantity]:
    L = mm_to_m(m.length_mm)
    n = m.count
    conn = 1 + m.connection_pct / 100.0
    r = mat.resolve_steel(m.designation)

    if r["unit_wt_kg_m"] is not None:
        total = r["unit_wt_kg_m"] * L * n * conn
        return [Quantity(
            category="steel",
            description=f"Structural steel {m.label} ({m.designation})".strip(),
            unit="kg", value=total, nos=n, length_m=L,
            audit=[FormulaStep(
                "steel.section.weight",
                "unit_wt * L * count * (1 + connection_pct)",
                {"unit_wt_kg_m": r["unit_wt_kg_m"], "basis": r["basis"], "L_m": L,
                 "count": n, "connection_pct": m.connection_pct}, total, "IS 808 / SP 6(1)")],
        )]

    if r["piece_wt_kg"] is not None:
        total = r["piece_wt_kg"] * n * conn
        return [Quantity(
            category="steel",
            description=f"Steel plate {m.label} ({m.designation})".strip(),
            unit="kg", value=total, nos=n,
            audit=[FormulaStep(
                "steel.plate.weight",
                "L*W*t*7850 * count * (1 + connection_pct)",
                {"piece_wt_kg": r["piece_wt_kg"], "basis": r["basis"], "count": n,
                 "connection_pct": m.connection_pct}, total, "IS 808 / SP 6(1)")],
        )]

    # Truly unknown: surface a zero-weight line with an assumption so the engine
    # never silently fabricates a number.
    return [Quantity(
        category="steel",
        description=f"Steel member {m.label} ({m.designation}) — UNKNOWN SECTION",
        unit="kg", value=0.0, nos=n, length_m=L,
        audit=[FormulaStep("steel.unknown_section",
                           "section not recognised (table or geometry)",
                           {"designation": m.designation}, 0.0, "IS 808")],
    )]
