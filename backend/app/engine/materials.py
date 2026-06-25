"""Material constants and reference tables.

Centralised so every formula references one documented source of truth
(project.md section 3).
"""
from __future__ import annotations

# Rebar unit weight: w = d^2 / 162 kg/m  (d in mm). Derived from
# 7850 kg/m3 * (pi d^2 / 4 / 1e6) ~= d^2 / 162.28, standardised to 162.
REBAR_WEIGHT_DIVISOR = 162.0

# Default lap length for tension (configurable per grade/exposure in IS 456).
DEFAULT_LAP_FACTOR = 50          # Ld = 50 * d
STOCK_BAR_LENGTH_M = 12.0        # laps added beyond this

# Hook / bend allowances (multiples of bar diameter d), SP 34.
HOOK_ALLOWANCE = 9               # +9d per 180-deg hook
BEND_DEDUCTION_90 = 2            # -2d per 90-deg bend
BEND_DEDUCTION_45 = 1            # -1d per 45-deg bend
CRANK_EXTRA_FACTOR = 0.42        # +0.42*D per 45-deg crank

# Densities
STEEL_DENSITY = 7850.0           # kg/m3
RCC_DENSITY = 2500.0             # kg/m3

# Default wastage applied at summary (recorded in export Assumptions sheet).
DEFAULT_WASTAGE_PCT = 3.0

# IS 1200 deduction thresholds (m2).
MASONRY_OPENING_DEDUCT_THRESHOLD = 0.1
PLASTER_OPENING_DEDUCT_THRESHOLD = 0.5

# Bricks per m3 for nominal modular brick (190x90x90 + 10mm mortar).
BRICKS_PER_M3 = 500

# Structural steel section unit weights (kg/m), IS 808 / SP 6(1).
# A representative starter set; extend as needed.
STEEL_SECTIONS: dict[str, float] = {
    # ISMB (I-beams)
    "ISMB100": 11.5, "ISMB125": 13.3, "ISMB150": 14.9, "ISMB175": 19.3,
    "ISMB200": 25.4, "ISMB225": 31.2, "ISMB250": 37.3, "ISMB300": 44.2,
    "ISMB350": 52.4, "ISMB400": 61.6, "ISMB450": 72.4, "ISMB500": 86.9,
    "ISMB600": 122.6,
    # ISMC (channels)
    "ISMC75": 6.8, "ISMC100": 9.2, "ISMC125": 12.7, "ISMC150": 16.4,
    "ISMC175": 19.1, "ISMC200": 22.1, "ISMC250": 30.4, "ISMC300": 36.3,
    "ISMC400": 49.4,
    # ISA (equal angles) — designation includes leg x leg x thk
    "ISA50X50X6": 4.5, "ISA65X65X6": 5.8, "ISA75X75X6": 6.8,
    "ISA75X75X8": 8.9, "ISA90X90X8": 10.8, "ISA100X100X8": 12.1,
    "ISA100X100X10": 14.9, "ISA130X130X10": 19.7, "ISA150X150X12": 27.3,
    # ISHB
    "ISHB150": 27.1, "ISHB200": 37.3, "ISHB250": 51.0, "ISHB300": 58.8,
    # ISLB (light beams)
    "ISLB75": 6.1, "ISLB100": 8.0, "ISLB125": 11.9, "ISLB150": 14.2,
    "ISLB175": 16.7, "ISLB200": 19.8, "ISLB225": 23.5, "ISLB250": 27.9,
    "ISLB300": 37.7, "ISLB350": 49.5, "ISLB400": 56.9, "ISLB450": 65.3,
    "ISLB500": 75.0, "ISLB600": 99.5,
    # ISWB (wide-flange beams)
    "ISWB150": 17.0, "ISWB175": 22.1, "ISWB200": 28.8, "ISWB225": 33.9,
    "ISWB250": 40.9, "ISWB300": 48.1, "ISWB350": 56.9, "ISWB400": 66.7,
    "ISWB450": 79.7, "ISWB500": 95.2, "ISWB550": 112.5, "ISWB600": 133.7,
    # more channels
    "ISMC350": 42.1, "ISMC375": 50.6,
}


def rebar_unit_weight(dia_mm: float) -> float:
    """Unit weight of a reinforcement bar in kg/m: w = d^2 / 162."""
    return (dia_mm * dia_mm) / REBAR_WEIGHT_DIVISOR


def section_unit_weight(designation: str) -> float | None:
    """Look up a rolled-section unit weight (kg/m). Case/space insensitive."""
    if not designation:
        return None
    key = designation.upper().replace(" ", "").replace("-", "")
    return STEEL_SECTIONS.get(key)


import math as _math
import re as _re


def _w_per_m(area_mm2: float) -> float:
    return (area_mm2 / 1e6) * STEEL_DENSITY


def resolve_steel(designation: str) -> dict:
    """Resolve a steel weight from a free-text designation.

    Falls back from the rolled-section table to geometry-derived weights for
    parametric sections (SHS/RHS, angles, pipes, flats, rounds) and plates, so a
    section not in the table still gets a real weight instead of zero. Pure
    deterministic geometry (density x area, IS 808 / SP 6 conventions); no AI.

    Returns {"unit_wt_kg_m": float|None, "piece_wt_kg": float|None, "basis": str}.
    """
    none = {"unit_wt_kg_m": None, "piece_wt_kg": None, "basis": ""}
    if not designation:
        return none
    D = designation.upper()
    key = D.replace(" ", "").replace("-", "")
    if key in STEEL_SECTIONS:
        return {"unit_wt_kg_m": STEEL_SECTIONS[key], "piece_wt_kg": None,
                "basis": "IS 808 / SP 6 table"}

    n = [float(x) for x in _re.findall(r"\d+(?:\.\d+)?", D)]
    has = lambda pat: bool(_re.search(pat, D))

    if has(r"PLATE|PLT|GUSSET") and len(n) >= 3:
        L, W, t = n[0], n[1], n[2]
        return {"unit_wt_kg_m": None, "piece_wt_kg": (L * W * t / 1e9) * STEEL_DENSITY,
                "basis": f"plate {L:g}x{W:g}x{t:g} mm"}
    if has(r"\bSHS\b|\bRHS\b|\bHSS\b|TUBE|HOLLOW"):
        h = b = t = 0.0
        if len(n) >= 3:
            h, b, t = n[0], n[1], n[2]
        elif len(n) == 2:
            h, t = n[0], n[1]; b = h
        if h and b and t and h > 2 * t and b > 2 * t:
            return {"unit_wt_kg_m": _w_per_m(h * b - (h - 2 * t) * (b - 2 * t)),
                    "piece_wt_kg": None, "basis": f"hollow section {h:g}x{b:g}x{t:g} mm"}
    if has(r"\bISA\b|ANGLE") and len(n) >= 2:
        if len(n) >= 3:
            a, b, t = n[0], n[1], n[2]
        else:
            a, t = n[0], n[1]; b = a
        if a and b and t:
            return {"unit_wt_kg_m": _w_per_m((a + b - t) * t), "piece_wt_kg": None,
                    "basis": f"angle {a:g}x{b:g}x{t:g} mm"}
    if has(r"PIPE|\bCHS\b|CIRCULAR") and len(n) >= 2:
        od, t = n[0], n[1]
        if od and t and od > 2 * t:
            return {"unit_wt_kg_m": _w_per_m(_math.pi * (od - t) * t), "piece_wt_kg": None,
                    "basis": f"pipe {od:g}x{t:g} mm"}
    if has(r"FLAT|\bFLT\b|\bISF\b") and len(n) >= 2:
        w, t = n[0], n[1]
        if w and t:
            return {"unit_wt_kg_m": _w_per_m(w * t), "piece_wt_kg": None,
                    "basis": f"flat {w:g}x{t:g} mm"}
    if has(r"ROUND|\bRND\b|Ø") and len(n) >= 1:
        d = n[0]
        if d:
            return {"unit_wt_kg_m": _w_per_m((_math.pi / 4) * d * d), "piece_wt_kg": None,
                    "basis": f"round {d:g} mm dia"}
    return none
