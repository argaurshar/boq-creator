"""Interior fit-out member types. Mirrors frontend/src/engine/interior.ts.

Joinery, glazing, loose furniture, sanitary fixtures and electrical points.
All linear dimensions in millimetres, as read from a drawing.

The one hard gate of this pack: a furniture layout plan gives width x depth;
joinery and glazing are measured on width x HEIGHT, and height exists on no
layout plan. So ``height_mm`` is REQUIRED for joinery and glazing and is never
defaulted — the validator asks for the elevation instead.
"""
from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import Field, model_validator

from .member_base import _MemberBase

HEIGHT_GATE = (
    "height_mm is required: a layout plan only gives width and depth — "
    "read the height from the elevation or ask the user. Never assume 2100."
)

JOINERY_TYPES = (
    "wardrobe", "kitchen_base", "kitchen_wall", "storage", "tv_unit",
    "vanity", "panelling", "other",
)
GLAZING_KINDS = ("mirror", "partition", "shower", "window_film")
FIXTURES = ("WC", "wash basin", "shower", "faucet", "health faucet", "mixer", "other")
POINT_TYPES = ("light", "fan", "6A socket", "16A socket", "AC", "data", "switchboard")


# --------------------------------------------------------------------------- #
# Helpers (same rules as the TS validators)
# --------------------------------------------------------------------------- #
def _blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def _collapse(s: Any) -> str:
    return re.sub(r"[\s_\-]+", "", str(s).lower())


def _choice(data: dict[str, Any], key: str, options: tuple[str, ...], default: str) -> None:
    """Resolve an enumerated field to its canonical option, ignoring case,
    spaces, underscores and hyphens ("Kitchen Base" -> "kitchen_base")."""
    v = data.get(key)
    if _blank(v):
        data[key] = default
        return
    k = _collapse(v)
    for o in options:
        if _collapse(o) == k:
            data[key] = o
            return
    raise ValueError(f"Field '{key}' must be one of: {', '.join(options)}")


def _text(data: dict[str, Any], key: str, default: str) -> None:
    v = data.get(key)
    data[key] = default if _blank(v) else str(v).strip()


def _drop_blank(data: dict[str, Any], *keys: str) -> None:
    """Blank numeric inputs ("" from a form) fall back to the field default, or
    to pydantic's own 'Field required' error when there is none."""
    for k in keys:
        if k in data and _blank(data[k]):
            del data[k]


def _gate_height(data: dict[str, Any]) -> None:
    if _blank(data.get("height_mm")):
        raise ValueError(HEIGHT_GATE)


# --------------------------------------------------------------------------- #
# Member types
# --------------------------------------------------------------------------- #
class Joinery(_MemberBase):
    member_type: Literal["joinery"] = "joinery"
    width_mm: float = Field(gt=0)
    height_mm: float = Field(gt=0)             # hard gate — see _coerce
    depth_mm: float = Field(default=0.0, ge=0)  # spec only, never measured
    count: int = Field(default=1, gt=0)
    joinery_type: Literal[
        "wardrobe", "kitchen_base", "kitchen_wall", "storage", "tv_unit",
        "vanity", "panelling", "other",
    ] = "wardrobe"
    carcass: str = "BWP ply 18 mm"
    shutter_finish: str = "laminate 1 mm"
    hardware: str = "soft-close, SS"

    @model_validator(mode="before")
    @classmethod
    def _coerce(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        data = dict(data)
        _gate_height(data)
        _drop_blank(data, "width_mm", "depth_mm", "count")
        _choice(data, "joinery_type", JOINERY_TYPES, "wardrobe")
        _text(data, "carcass", "BWP ply 18 mm")
        _text(data, "shutter_finish", "laminate 1 mm")
        _text(data, "hardware", "soft-close, SS")
        return data


class Glazing(_MemberBase):
    member_type: Literal["glazing"] = "glazing"
    width_mm: float = Field(gt=0)
    height_mm: float = Field(gt=0)             # hard gate — see _coerce
    count: int = Field(default=1, gt=0)
    kind: Literal["mirror", "partition", "shower", "window_film"] = "mirror"
    glass_type: str = "6 mm mirror"

    @model_validator(mode="before")
    @classmethod
    def _coerce(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        data = dict(data)
        _gate_height(data)
        _drop_blank(data, "width_mm", "count")
        _choice(data, "kind", GLAZING_KINDS, "mirror")
        _text(data, "glass_type", "6 mm mirror")
        return data


class LooseFurniture(_MemberBase):
    member_type: Literal["loose_furniture"] = "loose_furniture"
    count: int = Field(gt=0)                    # required
    item: str = "3-seater sofa"
    finish: str = "fabric"

    @model_validator(mode="before")
    @classmethod
    def _coerce(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        data = dict(data)
        _drop_blank(data, "count")
        _text(data, "item", "3-seater sofa")
        _text(data, "finish", "fabric")
        return data


class SanitaryFixture(_MemberBase):
    member_type: Literal["sanitary_fixture"] = "sanitary_fixture"
    count: int = Field(gt=0)                    # required
    fixture: Literal[
        "WC", "wash basin", "shower", "faucet", "health faucet", "mixer", "other",
    ] = "WC"
    make: str = ""

    @model_validator(mode="before")
    @classmethod
    def _coerce(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        data = dict(data)
        _drop_blank(data, "count")
        _choice(data, "fixture", FIXTURES, "WC")
        _text(data, "make", "")
        return data


class ElectricalPoint(_MemberBase):
    member_type: Literal["electrical_point"] = "electrical_point"
    count: int = Field(gt=0)                    # required
    point_type: Literal[
        "light", "fan", "6A socket", "16A socket", "AC", "data", "switchboard",
    ] = "light"

    @model_validator(mode="before")
    @classmethod
    def _coerce(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        data = dict(data)
        _drop_blank(data, "count")
        _choice(data, "point_type", POINT_TYPES, "light")
        return data


INTERIOR_TYPES = (Joinery, Glazing, LooseFurniture, SanitaryFixture, ElectricalPoint)
