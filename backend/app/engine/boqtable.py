"""The BOQ table contract. Mirrors frontend/src/engine/boqtable.ts.

Exactly seven columns, in exactly this order, with exactly these headings, on
screen, in the PDF and in every spreadsheet sheet carrying BOQ lines:

    Serial Number | Item | Description | Quantity | Rate | Amount | Specification

There is NO separate Unit column — the unit travels inside the Quantity cell
(as a number format in the workbook) and stays in the row data model.
"""
from __future__ import annotations

import re
from typing import Any

BOQ_COLUMNS = ["Serial Number", "Item", "Description", "Quantity", "Rate",
               "Amount", "Specification"]


def group_serial(group_index: int) -> str:
    """Hierarchical serial: group 1 -> "1", its items -> "1.1", "1.2", ..."""
    return str(group_index + 1)


def item_serial(group_index: int, item_index: int) -> str:
    return f"{group_index + 1}.{item_index + 1}"


# Short trade name per member type, used to build the Item cell.
TYPE_NOUN = {
    "footing": "Footings", "column": "Columns", "beam": "Beams", "slab": "Slabs",
    "rcc_wall": "RCC Walls", "pcc": "PCC / Lean Concrete", "brick_wall": "Brickwork",
    "plaster_surface": "Plaster", "earthwork_pit": "Excavation",
    "steel_member": "Structural Steel", "truss": "Steel Truss",
    "anchor_bolt": "Anchor Bolts", "roof_sheeting": "Roof Sheeting",
}

# Discipline-pack nouns (finishes.ts ITEM_NOUN + interior.ts ITEM_NOUN).
PACK_NOUN = {
    "flooring": "Flooring", "wall_tiling": "Dado / Wall Tiling",
    "false_ceiling": "False Ceiling", "painting": "Painting",
    "door_window": "Doors & Windows", "waterproofing": "Waterproofing",
    "railing": "Railing", "skirting": "Skirting",
    "joinery": "Joinery", "glazing": "Glass & Mirrors",
    "loose_furniture": "Loose Furniture", "sanitary_fixture": "Sanitary & CP",
    "electrical_point": "Electrical Points",
}

# Category fallbacks when the member type is unknown.
CATEGORY_NOUN = {
    "earthwork": "Earthwork", "concrete": "Concrete", "formwork": "Formwork",
    "rebar": "Reinforcement Steel", "steel": "Structural Steel",
    "masonry": "Brickwork", "plaster": "Plaster", "roofing": "Roof Sheeting",
}

JOINERY_HUMAN = {
    "wardrobe": "Wardrobe", "kitchen_base": "Kitchen base units",
    "kitchen_wall": "Kitchen wall units", "storage": "Storage unit",
    "tv_unit": "TV unit", "vanity": "Vanity unit", "panelling": "Wall panelling",
    "other": "Other",
}

INTERIOR_CATEGORIES = {"joinery", "furniture", "glazing", "sanitary", "services"}


def _blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def _fmt0(v: Any) -> str:
    """Whole-number text with half-even ties, like units.fmt0 / Python round."""
    return str(int(round(float(v))))


def _n(v: Any) -> str:
    """Numbers the way the TypeScript template prints them: 230, not 230.0."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return str(int(f)) if f.is_integer() else str(f)


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


def human_joinery(t: Any) -> str:
    if _blank(t):
        return ""
    s = str(t)
    if s in JOINERY_HUMAN:
        return JOINERY_HUMAN[s]
    words = s.replace("_", " ").strip()
    return words[:1].upper() + words[1:]


def _pack_item_noun(it: dict[str, Any]) -> str | None:
    mt = it.get("member_type", "")
    if mt == "joinery":
        t = human_joinery((it.get("extra") or {}).get("joinery_type"))
        return f"Joinery — {t}" if t else "Joinery"
    return PACK_NOUN.get(mt)


def item_name_of(it: dict[str, Any]) -> str:
    """The Item cell: the short trade name plus only the attributes that change
    the rate (grade, thickness class). e.g. "RCC M25 — Columns"."""
    cat = it.get("category", "")
    mt = it.get("member_type", "")
    if cat == "skirting":
        return "Skirting"
    noun = TYPE_NOUN.get(mt) or _pack_item_noun(it) or CATEGORY_NOUN.get(cat) or cat
    grade = str((it.get("extra") or {}).get("grade") or "").strip()
    if cat == "concrete":
        if mt == "pcc":
            return f"PCC {grade}" if grade else "PCC / Lean Concrete"
        return f"RCC {grade} — {noun}" if grade else f"RCC — {noun}"
    if cat == "formwork":
        return f"Formwork — {noun}"
    if cat == "rebar":
        return f"Reinforcement {grade}" if grade else "Reinforcement Steel"
    return noun


def _finishes_spec(it: dict[str, Any]) -> str | None:
    e = it.get("extra") or {}
    has = lambda v: not _blank(v)  # noqa: E731
    finish = str(e.get("finish")) if has(e.get("finish")) else "finish not specified"
    cat = it.get("category")
    if cat == "flooring":
        b = e.get("bedding_mm")
        return f"{finish} on {_fmt0(b)} mm bedding" if has(b) and float(b) > 0 else finish
    if cat == "skirting":
        h = e.get("skirting_height_mm")
        return f"{finish} skirting, {_fmt0(h)} mm high" if has(h) else f"{finish} skirting"
    if cat == "tiling":
        return f"{finish} dado / wall tiling"
    if cat == "ceiling":
        parts = [f"{e.get('ceiling_type') if has(e.get('ceiling_type')) else 'gypsum'} false ceiling"]
        cove = e.get("cove_length_mm")
        if has(cove) and float(cove) > 0:
            parts.append(f"{_fmt0(cove)} mm cove")
        return ", ".join(parts)
    if cat == "painting":
        parts: list[str] = []
        if has(e.get("coats")):
            parts.append(f"{e.get('coats')} coats")
        if has(e.get("paint_system")):
            parts.append(str(e.get("paint_system")))
        head = " ".join(parts)
        bits = [b for b in (head, str(e.get("surface")) if has(e.get("surface")) else "") if b]
        return ", ".join(bits) or "Painting as specified"
    if cat == "doors_windows":
        kind = _cap(str(e.get("kind"))) if has(e.get("kind")) else "Door"
        size = e.get("size") if has(e.get("size")) else ""
        parts = [f"{kind} {size}".strip()]
        if has(e.get("frame_material")):
            parts.append(f"{e.get('frame_material')} frame")
        if has(e.get("shutter_material")):
            parts.append(str(e.get("shutter_material")))
        return ", ".join(parts)
    if cat == "waterproofing":
        t = str(e.get("treatment")) if has(e.get("treatment")) else "treatment not specified"
        up = e.get("upturn_height_mm")
        return f"{t} incl. {_fmt0(up)} mm upturn" if has(up) and float(up) > 0 else t
    if cat == "railing":
        parts = [f"{e.get('material') if has(e.get('material')) else 'MS'} railing"]
        if has(e.get("height_mm")):
            parts.append(f"{_fmt0(e.get('height_mm'))} mm high")
        return ", ".join(parts)
    return None


def _interior_spec(it: dict[str, Any]) -> str | None:
    cat = it.get("category")
    if cat not in INTERIOR_CATEGORIES:
        return None
    e = it.get("extra") or {}
    bits: list[str] = []
    if cat == "joinery":
        jt = e.get("joinery_type")
        t = "Joinery" if jt == "other" else (human_joinery(jt) or "Joinery")
        try:
            depth = float(e.get("depth_mm"))
        except (TypeError, ValueError):
            depth = 0.0
        bits.append(f"{t} {_fmt0(depth)} mm deep" if depth > 0 else t)
        if not _blank(e.get("carcass")):
            bits.append(f"{e.get('carcass')} carcass")
        if not _blank(e.get("shutter_finish")):
            bits.append(f"{e.get('shutter_finish')} shutters")
        if not _blank(e.get("hardware")):
            hw = re.sub(r",\s*", " ", str(e.get("hardware")))
            bits.append(f"{hw} hardware")
        return ", ".join(bits)
    if cat == "glazing":
        gt = "" if _blank(e.get("glass_type")) else str(e.get("glass_type"))
        kind = "" if _blank(e.get("kind")) else str(e.get("kind")).replace("_", " ")
        if gt:
            bits.append(gt)
        if kind and kind.lower() not in gt.lower():
            bits.append(kind)
        return " — ".join(bits)
    if cat == "furniture":
        if not _blank(e.get("item")):
            bits.append(str(e.get("item")))
        if not _blank(e.get("finish")):
            bits.append(f"{e.get('finish')} finish")
        return ", ".join(bits)
    if cat == "sanitary":
        fx = "Sanitary fixture" if _blank(e.get("fixture")) else str(e.get("fixture"))
        return fx if _blank(e.get("make")) else f"{fx} — {e.get('make')}"
    if cat == "services":
        pt = "Electrical" if _blank(e.get("point_type")) else str(e.get("point_type"))
        return ("Switchboard incl. wiring & switches" if pt == "switchboard"
                else f"{pt} point incl. wiring & switch")
    return None


def spec_text_of(it: dict[str, Any]) -> str:
    """The Specification cell: grade, mix, cover, make, finish, class — built only
    from values the engine actually recorded; never invented."""
    for fn in (_finishes_spec, _interior_spec):
        t = fn(it)
        if t:
            return t
    e = it.get("extra") or {}
    cat = it.get("category")
    bits: list[str] = []

    def push(v: Any, fmt) -> None:
        if not _blank(v):
            bits.append(fmt(v))

    if cat == "concrete":
        push(e.get("grade"), lambda g: f"Concrete grade {g}")
        push(e.get("cover_mm"), lambda c: f"clear cover {_n(c)} mm")
    elif cat == "formwork":
        bits.append("Shuttering to concrete faces, including props, removal and cleaning")
    elif cat == "rebar":
        push(e.get("steel_grade") or e.get("grade"), lambda g: f"Reinforcement {g}")
        push(e.get("bar_dia_mm"), lambda d: f"{_n(d)} mm dia")
        if not bits:
            bits.append("HYSD reinforcement, cut, bent and placed")
    elif cat == "steel":
        push(e.get("designation"), lambda d: f"Section {d}")
        push(e.get("steel_grade"), lambda g: f"Grade {g}")
        push(e.get("connection_pct"), lambda p: f"{_n(p)}% gusset/connection allowance")
    elif cat == "masonry":
        push(e.get("mortar"), lambda m: f"Mortar {m}")
        push(e.get("thickness_mm"), lambda t: f"{_n(t)} mm thick")
        if not bits:
            bits.append("Brick/block masonry in cement mortar")
    elif cat == "plaster":
        push(e.get("thickness_mm"), lambda t: f"{_n(t)} mm thick")
        push(e.get("mortar"), lambda m: f"cement mortar {m}")
        push(e.get("faces"), lambda f: f"{_n(f)} face(s)")
    elif cat == "earthwork":
        push(e.get("soil_class"), lambda s: f"Soil class {s}")
        if not bits:
            bits.append("Excavation in ordinary soil, including lead and lift")
    elif cat == "roofing":
        push(e.get("sheet_type"), lambda s: f"{s} sheeting")
        push(e.get("lap_pct"), lambda l: f"{_n(l)}% lap allowance")
    return ", ".join(bits)
