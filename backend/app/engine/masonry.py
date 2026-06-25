"""Brickwork / masonry. Unit: m3.

Gross volume minus openings (> 0.1 m2 per IS 1200) and embedded RCC.
No deduction for reinforcement. See project.md section 6.
"""
from __future__ import annotations

from . import materials as mat
from .units import FormulaStep, Quantity, mm_to_m

CLAUSE = "IS 1200 Part 3"


def brick_wall(m) -> list[Quantity]:
    L, H, t = mm_to_m(m.length_mm), mm_to_m(m.height_mm), mm_to_m(m.thickness_mm)
    n = m.count

    deduct_area = 0.0
    for op in m.openings:
        area = mm_to_m(op.width_mm) * mm_to_m(op.height_mm)
        if area > mat.MASONRY_OPENING_DEDUCT_THRESHOLD:   # IS 1200: only > 0.1 m2
            deduct_area += area * op.count

    # IS 1200: half-brick (<= 115 mm) partitions are measured in m2, thickness
    # implicit; thicker walls are measured in m3.
    if m.thickness_mm <= 115:
        net = max(L * H - deduct_area, 0.0) * n
        return [Quantity(
            category="masonry",
            description=f"Half-brick masonry {m.label} ({m.thickness_mm:.0f} mm thick)".strip(),
            unit="m2", value=net, nos=n, length_m=L, depth_m=H,
            audit=[FormulaStep(
                "masonry.half_brick.area",
                "(L*H - openings(>0.1m2))*count",
                {"L_m": L, "H_m": H, "deduct_openings_m2": deduct_area,
                 "count": n}, net, CLAUSE)],
        )]

    gross = L * H * t
    net = max(gross - deduct_area * t - m.embedded_rcc_m3, 0.0) * n
    bricks = net * mat.BRICKS_PER_M3
    return [
        Quantity(
            category="masonry",
            description=f"Brickwork {m.label} ({m.thickness_mm:.0f} mm thick)".strip(),
            unit="m3", value=net, nos=n, length_m=L, breadth_m=t, depth_m=H,
            audit=[FormulaStep(
                "masonry.brickwork.volume",
                "(L*H*t - openings(>0.1m2)*t - embedded_rcc)*count",
                {"L_m": L, "H_m": H, "t_m": t,
                 "deduct_openings_m3": deduct_area * t,
                 "embedded_rcc_m3": m.embedded_rcc_m3, "count": n}, net, CLAUSE)],
            extra={"bricks_est": round(bricks)},
        )
    ]
