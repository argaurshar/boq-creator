"""Earthwork: excavation, backfilling, surplus disposal. Unit: m3.

Vertical or side-sloped (prismoidal) excavation; backfill by netting the
embedded structure volume (not a heuristic). See project.md section 6.
"""
from __future__ import annotations

from .units import FormulaStep, Quantity, mm_to_m

CLAUSE = "IS 1200 Part 1"


def earthwork_pit(m) -> list[Quantity]:
    L, B, D = mm_to_m(m.length_mm), mm_to_m(m.breadth_mm), mm_to_m(m.depth_mm)
    n = m.count
    s = m.side_slope

    if s and s > 0:
        # Prismoidal: V = D/6 * (A_top + 4*A_mid + A_bottom)
        a_bot = L * B
        a_top = (L + 2 * s * D) * (B + 2 * s * D)
        a_mid = (L + s * D) * (B + s * D)
        exc = (D / 6.0) * (a_top + 4 * a_mid + a_bot) * n
        step = FormulaStep(
            "earthwork.excavation.prismoidal",
            "D/6*(A_top+4*A_mid+A_bot)*count",
            {"L_m": L, "B_m": B, "D_m": D, "side_slope": s, "count": n}, exc, CLAUSE)
    else:
        exc = L * B * D * n
        step = FormulaStep(
            "earthwork.excavation.vertical", "L*B*D*count",
            {"L_m": L, "B_m": B, "D_m": D, "count": n}, exc, CLAUSE)

    out = [Quantity(
        category="earthwork", description=f"Earthwork excavation {m.label}".strip(),
        unit="m3", value=exc, nos=n, length_m=L, breadth_m=B, depth_m=D, audit=[step])]

    embedded = m.embedded_structure_m3 * n
    backfill = max(exc - embedded, 0.0)
    out.append(Quantity(
        category="earthwork", description=f"Backfilling / refilling {m.label}".strip(),
        unit="m3", value=backfill, nos=n,
        audit=[FormulaStep("earthwork.backfill", "excavation - embedded_structure",
                           {"excavation_m3": exc, "embedded_m3": embedded},
                           backfill, CLAUSE)]))
    surplus = max(exc - backfill, 0.0)
    out.append(Quantity(
        category="earthwork", description=f"Surplus earth disposal {m.label}".strip(),
        unit="m3", value=surplus, nos=n,
        audit=[FormulaStep("earthwork.surplus", "excavation - backfill",
                           {"excavation_m3": exc, "backfill_m3": backfill},
                           surplus, CLAUSE)]))
    return out
