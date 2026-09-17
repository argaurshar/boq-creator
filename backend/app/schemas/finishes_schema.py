"""Finishes pack schema (Architecture; several types reused by Interior).

Pydantic member types for flooring, wall tiling, false ceiling, painting,
doors/windows, waterproofing and railings. Mirrors the TS validators in
frontend/src/engine/finishes.ts. All linear dimensions in **millimetres**.
The AI NEVER computes; it only fills these fields.
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from .member_schema import Opening, _MemberBase

CEILING_TYPES = ("gypsum", "POP", "grid", "wood")
PAINT_SURFACES = ("internal", "external")
OPENING_KINDS = ("door", "window", "ventilator")
RAILING_MATERIALS = ("MS", "SS", "glass", "wood")


def _norm_choice(value, options):
    """Map a free-cased string onto its canonical option (case-insensitive).

    Unknown values pass through unchanged so the Literal check raises a
    clear validation error naming the field.
    """
    if value is None:
        return value
    s = str(value).strip()
    if s == "":
        return None
    low = s.lower()
    for o in options:
        if o.lower() == low:
            return o
    return value


def _norm_text(value, default):
    """Free-text spec field: absent/None -> default; present -> kept verbatim
    (even ""), so an extractor that found no finishing schedule can leave it
    empty on purpose instead of having a finish invented for it."""
    if value is None:
        return default
    return str(value).strip()


class Flooring(_MemberBase):
    member_type: Literal["flooring"] = "flooring"
    length_mm: float
    breadth_mm: float
    deduct_area_m2: float = Field(default=0.0, ge=0)      # columns / ducts inside the room
    skirting_height_mm: float = Field(default=0.0, ge=0)  # 0 = no skirting
    skirting_length_mm: float = Field(default=0.0, ge=0)  # 0 = room perimeter 2(L+B)
    finish: str = "600x600 vitrified tiles"
    bedding_mm: float = Field(default=20.0, ge=0)

    @field_validator("finish", mode="before")
    @classmethod
    def _finish(cls, v):
        return _norm_text(v, "600x600 vitrified tiles")


class WallTiling(_MemberBase):
    member_type: Literal["wall_tiling"] = "wall_tiling"
    length_mm: float
    height_mm: float
    openings: list[Opening] = Field(default_factory=list)
    finish: str = "300x600 ceramic tiles"

    @field_validator("finish", mode="before")
    @classmethod
    def _finish(cls, v):
        return _norm_text(v, "300x600 ceramic tiles")


class FalseCeiling(_MemberBase):
    member_type: Literal["false_ceiling"] = "false_ceiling"
    length_mm: float
    breadth_mm: float
    cutout_area_m2: float = Field(default=0.0, ge=0)
    ceiling_type: Literal["gypsum", "POP", "grid", "wood"] = "gypsum"
    cove_length_mm: float = Field(default=0.0, ge=0)      # spec-only

    @field_validator("ceiling_type", mode="before")
    @classmethod
    def _ceiling_type(cls, v):
        v = _norm_choice(v, CEILING_TYPES)
        return "gypsum" if v is None else v


class Painting(_MemberBase):
    member_type: Literal["painting"] = "painting"
    length_mm: float
    height_mm: float
    faces: int = Field(default=1, gt=0)
    openings: list[Opening] = Field(default_factory=list)
    coats: int = Field(default=2, gt=0)
    paint_system: str = "acrylic emulsion"
    surface: Literal["internal", "external"] = "internal"

    @field_validator("paint_system", mode="before")
    @classmethod
    def _paint_system(cls, v):
        return _norm_text(v, "acrylic emulsion")

    @field_validator("surface", mode="before")
    @classmethod
    def _surface(cls, v):
        v = _norm_choice(v, PAINT_SURFACES)
        return "internal" if v is None else v


class DoorWindow(_MemberBase):
    member_type: Literal["door_window"] = "door_window"
    width_mm: float
    height_mm: float
    kind: Literal["door", "window", "ventilator"] = "door"
    frame_material: str = "hardwood"
    shutter_material: str = "flush shutter"

    @field_validator("kind", mode="before")
    @classmethod
    def _kind(cls, v):
        v = _norm_choice(v, OPENING_KINDS)
        return "door" if v is None else v

    @field_validator("frame_material", mode="before")
    @classmethod
    def _frame(cls, v):
        return _norm_text(v, "hardwood")

    @field_validator("shutter_material", mode="before")
    @classmethod
    def _shutter(cls, v):
        return _norm_text(v, "flush shutter")


class Waterproofing(_MemberBase):
    member_type: Literal["waterproofing"] = "waterproofing"
    length_mm: float
    breadth_mm: float
    upturn_height_mm: float = Field(default=0.0, ge=0)
    treatment: str = "APP membrane 3 mm"

    @field_validator("treatment", mode="before")
    @classmethod
    def _treatment(cls, v):
        return _norm_text(v, "APP membrane 3 mm")


class Railing(_MemberBase):
    member_type: Literal["railing"] = "railing"
    length_mm: float
    height_mm: float = Field(default=900.0, ge=0)
    material: Literal["MS", "SS", "glass", "wood"] = "MS"

    @field_validator("material", mode="before")
    @classmethod
    def _material(cls, v):
        v = _norm_choice(v, RAILING_MATERIALS)
        return "MS" if v is None else v


FINISHES_TYPES = (
    Flooring, WallTiling, FalseCeiling, Painting, DoorWindow, Waterproofing, Railing,
)
