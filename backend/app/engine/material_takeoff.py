"""Indicative material / resource take-off derived from the computed BOQ.

Deterministic (dry-volume basis, IS 10262 / textbook nominal mixes). Mirrors the
TS engine's takeoff.ts. Operates on the dict returned by services.build_boq.
"""
from __future__ import annotations

import re
from typing import Any

BAG_M3 = 0.0347   # 1 cement bag (50 kg) ~= 0.0347 m3
DRY = 1.54        # dry-volume factor for concrete

# Nominal mix ratios cement:sand:aggregate. Design mixes / unknowns -> M25.
MIX: dict[str, tuple[float, float, float]] = {
    "M5": (1, 5, 10), "M7.5": (1, 4, 8), "M10": (1, 3, 6),
    "M15": (1, 2, 4), "M20": (1, 1.5, 3), "M25": (1, 1, 2),
}


def ratio_for(grade: str) -> tuple[float, float, float]:
    g = str(grade or "").upper().replace(" ", "")
    m = re.search(r"(\d+(?:\.\d+)?):(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)", g)
    if m:
        return (float(m.group(1)), float(m.group(2)), float(m.group(3)))
    for k, v in MIX.items():
        if k.upper() == g:
            return v
    return MIX["M25"]


def concrete_materials(grade: str, vol_m3: float) -> dict[str, float]:
    """Cement (bags), sand (m3), aggregate (m3) for a concrete volume + grade."""
    a, b, c = ratio_for(grade)
    s = a + b + c
    cement_m3 = DRY * a / s * vol_m3
    return {
        "cement_bags": cement_m3 / BAG_M3,
        "sand_m3": DRY * b / s * vol_m3,
        "agg_m3": DRY * c / s * vol_m3,
    }


def material_takeoff(boq: dict) -> list[dict[str, Any]]:
    """Return [{title, rows:[{material, qty, unit}]}], mirroring takeoff.ts."""
    cement_bags = sand = agg = bricks = formwork = excavation = steel_kg = 0.0
    by_dia: dict[float, float] = {}

    items = [it for g in boq.get("groups", []) for it in g.get("items", [])]
    for it in items:
        cat, extra = it.get("category"), (it.get("extra") or {})
        q = it.get("quantity", 0.0)
        if cat == "concrete":
            cm = concrete_materials(str(extra.get("grade", "M25")), q)
            cement_bags += cm["cement_bags"]; sand += cm["sand_m3"]; agg += cm["agg_m3"]
        elif cat == "masonry" and it.get("unit") == "m3":
            mortar_dry = q * 0.30 * 1.33
            cement_bags += (mortar_dry / 7) / BAG_M3
            sand += mortar_dry * 6 / 7
            bricks += float(extra.get("bricks_est", 0) or 0)
        elif cat == "plaster":
            mortar_dry = float(extra.get("mortar_m3", 0) or 0) * 1.33
            cement_bags += (mortar_dry / 5) / BAG_M3
            sand += mortar_dry * 4 / 5
        elif cat == "rebar":
            for r in extra.get("bbs", []) or []:
                d = r.get("dia_mm")
                by_dia[d] = by_dia.get(d, 0.0) + float(r.get("total_weight_kg", 0) or 0)
        elif cat == "steel":
            steel_kg += q
        elif cat == "formwork":
            formwork += q
        elif cat == "earthwork" and re.search(r"excavat", it.get("description", ""), re.I):
            excavation += q

    sections: list[dict[str, Any]] = []
    if cement_bags or sand or agg:
        sections.append({"title": "Cement & aggregates", "rows": [
            {"material": "Cement (OPC, 50 kg bags)", "qty": round(cement_bags), "unit": "bags"},
            {"material": "Sand (fine aggregate)", "qty": round(sand, 2), "unit": "m3"},
            {"material": "Coarse aggregate", "qty": round(agg, 2), "unit": "m3"},
        ]})
    if by_dia:
        dias = sorted(by_dia)
        total = sum(by_dia.values())
        sections.append({"title": "Reinforcement steel (TMT, by diameter)", "rows": [
            *[{"material": f"{int(d)} mm dia", "qty": round(by_dia[d], 1), "unit": "kg"} for d in dias],
            {"material": "Total reinforcement", "qty": round(total, 1), "unit": "kg"},
        ]})
    if steel_kg:
        sections.append({"title": "Structural steel", "rows": [
            {"material": "MS sections / plates", "qty": round(steel_kg, 1), "unit": "kg"},
            {"material": "  = in tonnes", "qty": round(steel_kg / 1000, 3), "unit": "MT"},
        ]})
    misc = []
    if bricks:
        misc.append({"material": "Bricks (modular, nos)", "qty": round(bricks), "unit": "nos"})
    if formwork:
        misc.append({"material": "Formwork / shuttering", "qty": round(formwork, 2), "unit": "m2"})
    if excavation:
        misc.append({"material": "Excavation (soil)", "qty": round(excavation, 2), "unit": "m3"})
    if misc:
        sections.append({"title": "Masonry, formwork & earthwork", "rows": misc})
    return sections
