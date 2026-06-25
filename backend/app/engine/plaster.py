"""Plaster / finishes. Unit: m2.

Face area minus openings (> 0.5 m2 per IS 1200). Reveal compensation for
small openings is handled by the no-deduct rule. See project.md section 6.
"""
from __future__ import annotations

from . import materials as mat
from .units import FormulaStep, Quantity, mm_to_m

CLAUSE = "IS 1200 Part 12"


def plaster_surface(m) -> list[Quantity]:
    L, H = mm_to_m(m.length_mm), mm_to_m(m.height_mm)
    n = m.count
    gross = L * H * m.faces

    deduct = 0.0
    for op in m.openings:
        area = mm_to_m(op.width_mm) * mm_to_m(op.height_mm)
        if area > mat.PLASTER_OPENING_DEDUCT_THRESHOLD:   # IS 1200: only > 0.5 m2
            deduct += area * m.faces * op.count

    net = max(gross - deduct, 0.0) * n
    mortar = net * mm_to_m(m.thickness_mm)
    return [
        Quantity(
            category="plaster",
            description=f"Plaster {m.label} ({m.thickness_mm:.0f} mm, {m.faces} face/s)".strip(),
            unit="m2", value=net, nos=n, length_m=L, depth_m=H,
            audit=[FormulaStep(
                "plaster.area",
                "(L*H*faces - openings(>0.5m2))*count",
                {"L_m": L, "H_m": H, "faces": m.faces,
                 "deduct_openings_m2": deduct, "count": n}, net, CLAUSE)],
            extra={"mortar_m3": round(mortar, 3)},
        )
    ]
