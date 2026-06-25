"""Roof sheeting / cladding. Unit: m2.

Covered area with a lap/overlap allowance (GI/AC/PPGI sheets), openings netted.
Mirrors the TS engine's roofing.roof_sheeting. See project.md section 6.
"""
from __future__ import annotations

from .units import FormulaStep, Quantity, mm_to_m

CLAUSE = "IS 1200 Part 22"


def roof_sheeting(m) -> list[Quantity]:
    L, B = mm_to_m(m.length_mm), mm_to_m(m.breadth_mm)
    n = m.count
    lap = 1 + m.lap_pct / 100.0
    area = max(L * B - m.opening_area_m2, 0.0) * n * lap
    return [Quantity(
        category="roofing",
        description=f"Roof sheeting {m.label} ({m.length_mm:.0f}x{m.breadth_mm:.0f} mm)".strip(),
        unit="m2", value=area, nos=n, length_m=L, breadth_m=B,
        audit=[FormulaStep(
            "roofing.sheeting.area",
            "max(L*B - openings, 0) * count * (1 + lap_pct)",
            {"L_m": L, "B_m": B, "opening_area_m2": m.opening_area_m2,
             "lap_pct": m.lap_pct, "count": n}, area, CLAUSE)],
    )]
