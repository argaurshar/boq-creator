"""Interior fit-out pack. Mirrors frontend/src/engine/interior.ts.

Joinery and glazing are measured on the front elevation (width x height) and
reported in sqft, trade practice in India. Loose furniture, sanitary fixtures
and electrical points are enumerated (Nos). Every function is pure; the same
formula text is implemented in the TS module and the numbers must be identical.
"""
from __future__ import annotations

from .units import FormulaStep, Quantity, mm_to_m

SQFT_PER_M2 = 10.7639

CLAUSE_JOINERY = "Trade practice — front elevation area"
CLAUSE_TRADE = "Trade practice"
CLAUSE_SANITARY = "IS 1200 Part 16"
CLAUSE_ELECTRICAL = "IS 1200 Part 18"


def joinery(m) -> list[Quantity]:
    W, H = mm_to_m(m.width_mm), mm_to_m(m.height_mm)
    n = m.count
    area = W * H * n
    sqft = W * H * n * SQFT_PER_M2
    return [Quantity(
        category="joinery",
        description=f"Joinery {m.label} ({m.width_mm:.0f}x{m.height_mm:.0f} mm)".strip(),
        unit="sqft", value=sqft, nos=n, length_m=W, depth_m=H,
        audit=[FormulaStep(
            "interior.joinery.area", "W*H*count*SQFT_PER_M2",
            {"W_m": W, "H_m": H, "count": n, "SQFT_PER_M2": SQFT_PER_M2},
            sqft, CLAUSE_JOINERY)],
        extra={
            "area_m2": area, "joinery_type": m.joinery_type, "depth_mm": m.depth_mm,
            "carcass": m.carcass, "shutter_finish": m.shutter_finish,
            "hardware": m.hardware,
        },
    )]


def glazing(m) -> list[Quantity]:
    W, H = mm_to_m(m.width_mm), mm_to_m(m.height_mm)
    n = m.count
    area = W * H * n
    sqft = W * H * n * SQFT_PER_M2
    return [Quantity(
        category="glazing",
        description=f"Glazing {m.label} ({m.width_mm:.0f}x{m.height_mm:.0f} mm)".strip(),
        unit="sqft", value=sqft, nos=n, length_m=W, depth_m=H,
        audit=[FormulaStep(
            "interior.glazing.area", "W*H*count*SQFT_PER_M2",
            {"W_m": W, "H_m": H, "count": n, "SQFT_PER_M2": SQFT_PER_M2},
            sqft, CLAUSE_TRADE)],
        extra={"area_m2": area, "kind": m.kind, "glass_type": m.glass_type},
    )]


def loose_furniture(m) -> list[Quantity]:
    n = m.count
    return [Quantity(
        category="furniture",
        description=f"Loose furniture {m.label} ({m.item})".strip(),
        unit="Nos", value=float(n), nos=n,
        audit=[FormulaStep("interior.furniture.count", "count", {"count": n}, n, CLAUSE_TRADE)],
        extra={"item": m.item, "finish": m.finish},
    )]


def sanitary_fixture(m) -> list[Quantity]:
    n = m.count
    return [Quantity(
        category="sanitary",
        description=f"Sanitary fixture {m.label} ({m.fixture})".strip(),
        unit="Nos", value=float(n), nos=n,
        audit=[FormulaStep("interior.sanitary.count", "count", {"count": n}, n, CLAUSE_SANITARY)],
        extra={"fixture": m.fixture, "make": m.make},
    )]


def electrical_point(m) -> list[Quantity]:
    n = m.count
    return [Quantity(
        category="services",
        description=f"Electrical point {m.label} ({m.point_type})".strip(),
        unit="Nos", value=float(n), nos=n,
        audit=[FormulaStep("interior.services.count", "count", {"count": n}, n, CLAUSE_ELECTRICAL)],
        extra={"point_type": m.point_type},
    )]


# member_type -> list of formula functions to run (merge into compute.REGISTRY)
REGISTRY = {
    "joinery":          [joinery],
    "glazing":          [glazing],
    "loose_furniture":  [loose_furniture],
    "sanitary_fixture": [sanitary_fixture],
    "electrical_point": [electrical_point],
}

# Display order + labels for BOQ grouping — identical to interior.ts CATEGORIES.
CATEGORIES = [
    ("joinery", "Joinery & Panelling"),
    ("furniture", "Loose Furniture"),
    ("glazing", "Glass & Mirrors"),
    ("sanitary", "Sanitary & CP Fittings"),
    ("services", "Electrical Points"),
]

UNITS = {"joinery": "sqft", "furniture": "Nos", "glazing": "sqft",
         "sanitary": "Nos", "services": "Nos"}

DEMO_RATES = {"joinery": 1450, "furniture": 25000, "glazing": 650,
              "sanitary": 12000, "services": 850}

# Demo elements — identical to the pack's DEMO_MEMBERS in the TypeScript
# engine, so the seed endpoint and the static build show the same demo.
DEMO_MEMBERS: list[dict] = [
    {"member_type": "joinery", "label": "JN1", "count": 2, "width_mm": 2400, "height_mm": 2400, "depth_mm": 600, "joinery_type": "wardrobe", "carcass": "BWP ply 18 mm", "shutter_finish": "laminate 1 mm", "hardware": "soft-close, SS"},
    {"member_type": "joinery", "label": "JN2", "count": 1, "width_mm": 3000, "height_mm": 850, "depth_mm": 600, "joinery_type": "kitchen_base", "carcass": "BWP ply 18 mm", "shutter_finish": "acrylic 1 mm", "hardware": "soft-close, SS"},
    {"member_type": "glazing", "label": "GL1", "count": 2, "width_mm": 1200, "height_mm": 1800, "kind": "mirror", "glass_type": "6 mm mirror"},
    {"member_type": "loose_furniture", "label": "LF1", "count": 1, "item": "3-seater sofa", "finish": "fabric"},
    {"member_type": "sanitary_fixture", "label": "SN1", "count": 2, "fixture": "WC", "make": ""},
    {"member_type": "electrical_point", "label": "EP1", "count": 12, "point_type": "6A socket"},
]
