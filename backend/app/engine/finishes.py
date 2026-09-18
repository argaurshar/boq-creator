"""Finishes pack (Architecture; several types reused by Interior).

flooring, wall_tiling, false_ceiling, painting, door_window, waterproofing,
railing. Units: m2 / m / Nos (sqft carried alongside every area in extra).
Mirrors frontend/src/engine/finishes.ts — the two must produce identical
numbers for identical inputs (see backend/tests/test_finishes.py).
"""
from __future__ import annotations

from .units import FormulaStep, Quantity, mm_to_m

SQFT_PER_M2 = 10.7639

# IS 1200 deduction thresholds (m2) for this pack.
TILING_OPENING_DEDUCT_THRESHOLD = 0.1     # IS 1200 Part 11
PAINTING_OPENING_DEDUCT_THRESHOLD = 0.5   # IS 1200 Part 15

CLAUSE_TILING = "IS 1200 Part 11"
CLAUSE_CEILING = "IS 1200 Part 12"
CLAUSE_PAINTING = "IS 1200 Part 15"
CLAUSE_WATERPROOFING = "IS 1200 Part 16"
CLAUSE_DOORS = "IS 1200 Part 21"
CLAUSE_RAILING = "IS 1200 Part 8"


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


def flooring(m) -> list[Quantity]:
    L, B = mm_to_m(m.length_mm), mm_to_m(m.breadth_mm)
    n = m.count
    deduct = m.deduct_area_m2
    area = max(L * B - deduct, 0.0) * n
    out = [Quantity(
        category="flooring",
        description=f"Flooring {m.label} ({m.length_mm:.0f}x{m.breadth_mm:.0f} mm)".strip(),
        unit="m2", value=area, nos=n, length_m=L, breadth_m=B,
        audit=[FormulaStep(
            "flooring.area", "max(L*B - deduct_area_m2, 0) * count",
            {"L_m": L, "B_m": B, "deduct_area_m2": deduct, "count": n}, area, CLAUSE_TILING)],
        extra={"finish": m.finish, "bedding_mm": m.bedding_mm, "deduct_area_m2": deduct,
               "area_sqft": round(area * SQFT_PER_M2, 2)},
    )]

    h = m.skirting_height_mm
    if h > 0:
        # Explicit skirting run if given, else the room perimeter 2(L+B).
        skl = mm_to_m(m.skirting_length_mm) if m.skirting_length_mm > 0 else 2 * (L + B)
        length = skl * n
        out.append(Quantity(
            category="skirting",
            description=f"Skirting {m.label} ({h:.0f} mm high)".strip(),
            unit="m", value=length, nos=n, length_m=skl, depth_m=mm_to_m(h),
            audit=[FormulaStep(
                "flooring.skirting",
                "(skirting_length_mm>0 ? skirting_length : 2*(L+B)) * count",
                {"L_m": L, "B_m": B, "skirting_length_m": skl, "skirting_height_mm": h,
                 "count": n}, length, CLAUSE_TILING)],
            extra={"finish": m.finish, "skirting_height_mm": h,
                   "skirting_length_mm": skl * 1000.0},
        ))
    return out


def wall_tiling(m) -> list[Quantity]:
    L, H = mm_to_m(m.length_mm), mm_to_m(m.height_mm)
    n = m.count
    gross = L * H
    deduct = 0.0
    for op in m.openings:
        area = mm_to_m(op.width_mm) * mm_to_m(op.height_mm)
        if area > TILING_OPENING_DEDUCT_THRESHOLD:
            deduct += area * op.count
    net = max(gross - deduct, 0.0) * n
    return [Quantity(
        category="tiling",
        description=f"Wall tiling {m.label} ({m.length_mm:.0f}x{m.height_mm:.0f} mm)".strip(),
        unit="m2", value=net, nos=n, length_m=L, depth_m=H,
        audit=[FormulaStep(
            "tiling.area", "(L*H - openings(>0.1m2)) * count",
            {"L_m": L, "H_m": H, "deduct_openings_m2": deduct, "count": n}, net, CLAUSE_TILING)],
        extra={"finish": m.finish, "deduct_openings_m2": deduct,
               "area_sqft": round(net * SQFT_PER_M2, 2)},
    )]


def false_ceiling(m) -> list[Quantity]:
    L, B = mm_to_m(m.length_mm), mm_to_m(m.breadth_mm)
    n = m.count
    cut = m.cutout_area_m2
    area = max(L * B - cut, 0.0) * n
    return [Quantity(
        category="ceiling",
        description=f"False ceiling {m.label} ({m.length_mm:.0f}x{m.breadth_mm:.0f} mm)".strip(),
        unit="m2", value=area, nos=n, length_m=L, breadth_m=B,
        audit=[FormulaStep(
            "ceiling.area", "(L*B - cutout_area_m2) * count",
            {"L_m": L, "B_m": B, "cutout_area_m2": cut, "count": n}, area, CLAUSE_CEILING)],
        extra={"ceiling_type": m.ceiling_type, "cove_length_mm": m.cove_length_mm,
               "cutout_area_m2": cut, "area_sqft": round(area * SQFT_PER_M2, 2)},
    )]


def painting(m) -> list[Quantity]:
    L, H = mm_to_m(m.length_mm), mm_to_m(m.height_mm)
    n = m.count
    faces = m.faces
    gross = L * H * faces
    deduct = 0.0
    for op in m.openings:
        area = mm_to_m(op.width_mm) * mm_to_m(op.height_mm)
        if area > PAINTING_OPENING_DEDUCT_THRESHOLD:
            deduct += area * faces * op.count
    net = max(gross - deduct, 0.0) * n
    return [Quantity(
        category="painting",
        description=(f"Painting {m.label} ({m.length_mm:.0f}x{m.height_mm:.0f} mm, "
                     f"{faces} face/s)").strip(),
        unit="m2", value=net, nos=n, length_m=L, depth_m=H,
        audit=[FormulaStep(
            "painting.area", "(L*H*faces - openings(>0.5m2)*faces) * count",
            {"L_m": L, "H_m": H, "faces": faces, "deduct_openings_m2": deduct, "count": n},
            net, CLAUSE_PAINTING)],
        extra={"coats": m.coats, "paint_system": m.paint_system, "surface": m.surface,
               "faces": faces, "deduct_openings_m2": deduct,
               "area_sqft": round(net * SQFT_PER_M2, 2)},
    )]


def door_window(m) -> list[Quantity]:
    W, H = mm_to_m(m.width_mm), mm_to_m(m.height_mm)
    n = m.count
    area = W * H * n
    size = f"{m.width_mm:.0f}x{m.height_mm:.0f}"
    return [Quantity(
        category="doors_windows",
        description=f"{_cap(m.kind)} {m.label} ({size} mm)".strip(),
        unit="Nos", value=n, nos=n, breadth_m=W, depth_m=H,
        audit=[FormulaStep(
            "doors_windows.count", "count (area W*H*count recorded for reference)",
            {"W_m": W, "H_m": H, "count": n, "area_m2": area}, n, CLAUSE_DOORS)],
        extra={"kind": m.kind, "size": size, "width_mm": m.width_mm, "height_mm": m.height_mm,
               "frame_material": m.frame_material, "shutter_material": m.shutter_material,
               "area_m2": area, "area_sqft": round(area * SQFT_PER_M2, 2)},
    )]


def waterproofing(m) -> list[Quantity]:
    L, B = mm_to_m(m.length_mm), mm_to_m(m.breadth_mm)
    n = m.count
    up = mm_to_m(m.upturn_height_mm)
    upturn = 2 * (L + B) * up
    area = (L * B + upturn) * n
    return [Quantity(
        category="waterproofing",
        description=f"Waterproofing {m.label} ({m.length_mm:.0f}x{m.breadth_mm:.0f} mm)".strip(),
        unit="m2", value=area, nos=n, length_m=L, breadth_m=B,
        audit=[FormulaStep(
            "waterproofing.area", "(L*B + 2*(L+B)*upturn) * count",
            {"L_m": L, "B_m": B, "upturn_m": up, "upturn_area_m2": upturn, "count": n},
            area, CLAUSE_WATERPROOFING)],
        extra={"treatment": m.treatment, "upturn_height_mm": m.upturn_height_mm,
               "upturn_area_m2": upturn, "area_sqft": round(area * SQFT_PER_M2, 2)},
    )]


def railing(m) -> list[Quantity]:
    L = mm_to_m(m.length_mm)
    n = m.count
    length = L * n
    return [Quantity(
        category="railing",
        description=(f"Railing {m.label} ({m.length_mm:.0f} mm long, "
                     f"{m.height_mm:.0f} mm high)").strip(),
        unit="m", value=length, nos=n, length_m=L, depth_m=mm_to_m(m.height_mm),
        audit=[FormulaStep(
            "railing.length", "L * count",
            {"L_m": L, "height_mm": m.height_mm, "count": n}, length, CLAUSE_RAILING)],
        extra={"material": m.material, "height_mm": m.height_mm},
    )]


# member_type -> list of formula functions to run (merge into compute.REGISTRY)
REGISTRY = {
    "flooring":      [flooring],
    "wall_tiling":   [wall_tiling],
    "false_ceiling": [false_ceiling],
    "painting":      [painting],
    "door_window":   [door_window],
    "waterproofing": [waterproofing],
    "railing":       [railing],
}

# Display order + labels (append to compute.CATEGORY_ORDER). Identical to TS.
CATEGORIES = [
    ("flooring", "Flooring"),
    ("skirting", "Skirting"),
    ("tiling", "Dado & Wall Tiling"),
    ("ceiling", "False Ceiling"),
    ("painting", "Painting"),
    ("doors_windows", "Doors & Windows"),
    ("waterproofing", "Waterproofing"),
    ("railing", "Railings"),
]

UNITS = {
    "flooring": "m2", "skirting": "m", "tiling": "m2", "ceiling": "m2", "painting": "m2",
    "doors_windows": "Nos", "waterproofing": "m2", "railing": "m",
}

DEMO_RATES = {
    "flooring": 1200, "skirting": 150, "tiling": 1100, "ceiling": 950, "painting": 180,
    "doors_windows": 8500, "waterproofing": 450, "railing": 2200,
}

# Demo elements — identical to the pack's DEMO_MEMBERS in the TypeScript
# engine, so the seed endpoint and the static build show the same demo.
DEMO_MEMBERS: list[dict] = [
    {"member_type": "flooring", "label": "FL1 Living", "length_mm": 4500, "breadth_mm": 4000, "count": 1, "deduct_area_m2": 0, "skirting_height_mm": 100, "finish": "600x600 vitrified tiles", "bedding_mm": 20},
    {"member_type": "wall_tiling", "label": "WT1 Toilet", "length_mm": 7200, "height_mm": 2100, "count": 2, "openings": [{"width_mm": 750, "height_mm": 2100, "count": 1}], "finish": "300x600 ceramic tiles"},
    {"member_type": "false_ceiling", "label": "FC1 Living", "length_mm": 4500, "breadth_mm": 4000, "count": 1, "cutout_area_m2": 0.36, "ceiling_type": "gypsum", "cove_length_mm": 17000},
    {"member_type": "painting", "label": "PT1 Internal walls", "length_mm": 17000, "height_mm": 3000, "faces": 1, "count": 1, "coats": 2, "paint_system": "acrylic emulsion", "surface": "internal", "openings": [{"width_mm": 1000, "height_mm": 2100, "count": 1}, {"width_mm": 1200, "height_mm": 1200, "count": 2}]},
    {"member_type": "door_window", "label": "D1", "width_mm": 900, "height_mm": 2100, "count": 4, "kind": "door", "frame_material": "hardwood", "shutter_material": "flush shutter"},
    {"member_type": "waterproofing", "label": "WP1 Toilet sunk", "length_mm": 2100, "breadth_mm": 1500, "count": 2, "upturn_height_mm": 300, "treatment": "APP membrane 3 mm"},
    {"member_type": "railing", "label": "RL1 Balcony", "length_mm": 3500, "height_mm": 900, "count": 2, "material": "MS"},
]
