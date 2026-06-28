"""Concrete & RCC volumes and formwork (shuttering). Units: m3 / m2.

See project.md section 6. All inputs in mm, converted to m here.
"""
from __future__ import annotations

from .units import FormulaStep, Quantity, mm_to_m

CLAUSE = "IS 1200 Part 2 / IS 456"


def _grade_desc(member) -> str:
    return getattr(member, "concrete_grade", "M25")


def column(m) -> list[Quantity]:
    b, D, H = mm_to_m(m.b_mm), mm_to_m(m.D_mm), mm_to_m(m.height_mm)
    n = m.count
    vol = b * D * H * n
    shutter = 2 * (b + D) * H * n
    label = f"{_grade_desc(m)} RCC column {m.label}".strip()
    return [
        Quantity(
            category="concrete", description=f"{label} ({m.b_mm:.0f}x{m.D_mm:.0f} mm)",
            unit="m3", value=vol, nos=n, length_m=b, breadth_m=D, depth_m=H,
            audit=[FormulaStep("concrete.column.volume", "b*D*H*count",
                               {"b_m": b, "D_m": D, "H_m": H, "count": n}, vol, CLAUSE)],
            extra={"grade": _grade_desc(m)},
        ),
        Quantity(
            category="formwork", description=f"Formwork to column {m.label}".strip(),
            unit="m2", value=shutter, nos=n,
            audit=[FormulaStep("concrete.column.formwork", "2*(b+D)*H*count",
                               {"b_m": b, "D_m": D, "H_m": H, "count": n}, shutter, CLAUSE)],
        ),
    ]


def beam(m) -> list[Quantity]:
    b, d, L = mm_to_m(m.b_mm), mm_to_m(m.depth_mm), mm_to_m(m.clear_span_mm)
    n = m.count
    vol = b * d * L * n
    shutter = (2 * d + b) * L * n          # two sides + soffit
    label = f"{_grade_desc(m)} RCC beam {m.label}".strip()
    return [
        Quantity(
            category="concrete", description=f"{label} ({m.b_mm:.0f}x{m.depth_mm:.0f} mm)",
            unit="m3", value=vol, nos=n, length_m=L, breadth_m=b, depth_m=d,
            audit=[FormulaStep("concrete.beam.volume", "b*d*L*count",
                               {"b_m": b, "d_m": d, "L_m": L, "count": n}, vol, CLAUSE)],
            extra={"grade": _grade_desc(m)},
        ),
        Quantity(
            category="formwork", description=f"Formwork to beam {m.label}".strip(),
            unit="m2", value=shutter, nos=n,
            audit=[FormulaStep("concrete.beam.formwork", "(2*d+b)*L*count",
                               {"b_m": b, "d_m": d, "L_m": L, "count": n}, shutter, CLAUSE)],
        ),
    ]


def footing(m) -> list[Quantity]:
    L, B, D = mm_to_m(m.length_mm), mm_to_m(m.breadth_mm), mm_to_m(m.depth_mm)
    n = m.count
    vol = L * B * D * n
    shutter = 2 * (L + B) * D * n          # vertical side shuttering of the pad
    label = f"{_grade_desc(m)} RCC footing {m.label}".strip()
    return [
        Quantity(
            category="concrete", description=f"{label} ({m.length_mm:.0f}x{m.breadth_mm:.0f} mm)",
            unit="m3", value=vol, nos=n, length_m=L, breadth_m=B, depth_m=D,
            audit=[FormulaStep("concrete.footing.volume", "L*B*D*count",
                               {"L_m": L, "B_m": B, "D_m": D, "count": n}, vol, CLAUSE)],
            extra={"grade": _grade_desc(m)},
        ),
        Quantity(
            category="formwork", description=f"Formwork to footing {m.label}".strip(),
            unit="m2", value=shutter, nos=n,
            audit=[FormulaStep("concrete.footing.formwork", "2*(L+B)*D*count",
                               {"L_m": L, "B_m": B, "D_m": D, "count": n}, shutter, CLAUSE)],
        ),
    ]


def slab(m) -> list[Quantity]:
    L, B, t = mm_to_m(m.length_mm), mm_to_m(m.breadth_mm), mm_to_m(m.thickness_mm)
    n = m.count
    gross_area = L * B
    net_area = max(gross_area - m.opening_area_m2, 0.0)
    vol = net_area * t * n
    shutter = net_area * n
    label = f"{_grade_desc(m)} RCC slab {m.label}".strip()
    return [
        Quantity(
            category="concrete", description=f"{label} ({m.thickness_mm:.0f} mm thick)",
            unit="m3", value=vol, nos=n, length_m=L, breadth_m=B, depth_m=t,
            audit=[FormulaStep("concrete.slab.volume", "(L*B - openings)*t*count",
                               {"L_m": L, "B_m": B, "openings_m2": m.opening_area_m2,
                                "t_m": t, "count": n}, vol, CLAUSE)],
            extra={"grade": _grade_desc(m)},
        ),
        Quantity(
            category="formwork", description=f"Formwork (soffit) to slab {m.label}".strip(),
            unit="m2", value=shutter, nos=n,
            audit=[FormulaStep("concrete.slab.formwork", "(L*B - openings)*count",
                               {"net_area_m2": net_area, "count": n}, shutter, CLAUSE)],
        ),
    ]


def rcc_wall(m) -> list[Quantity]:
    L, H, t = mm_to_m(m.length_mm), mm_to_m(m.height_mm), mm_to_m(m.thickness_mm)
    n = m.count
    vol = L * t * H * n
    shutter = 2 * L * H * n
    label = f"{_grade_desc(m)} RCC wall {m.label}".strip()
    return [
        Quantity(
            category="concrete", description=f"{label} ({m.thickness_mm:.0f} mm thick)",
            unit="m3", value=vol, nos=n, length_m=L, breadth_m=t, depth_m=H,
            audit=[FormulaStep("concrete.wall.volume", "L*t*H*count",
                               {"L_m": L, "t_m": t, "H_m": H, "count": n}, vol, CLAUSE)],
            extra={"grade": _grade_desc(m)},
        ),
        Quantity(
            category="formwork", description=f"Formwork to wall {m.label}".strip(),
            unit="m2", value=shutter, nos=n,
            audit=[FormulaStep("concrete.wall.formwork", "2*L*H*count",
                               {"L_m": L, "H_m": H, "count": n}, shutter, CLAUSE)],
        ),
    ]


def pcc(m) -> list[Quantity]:
    L, B, t = mm_to_m(m.length_mm), mm_to_m(m.breadth_mm), mm_to_m(m.thickness_mm)
    n = m.count
    vol = L * B * t * n
    return [
        Quantity(
            category="concrete", description=f"PCC / lean concrete {m.label} ({m.thickness_mm:.0f} mm)".strip(),
            unit="m3", value=vol, nos=n, length_m=L, breadth_m=B, depth_m=t,
            audit=[FormulaStep("concrete.pcc.volume", "L*B*t*count",
                               {"L_m": L, "B_m": B, "t_m": t, "count": n}, vol, CLAUSE)],
            extra={"grade": _grade_desc(m)},
        ),
    ]
