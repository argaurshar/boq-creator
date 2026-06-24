"""The typed Member union — the single source of truth for a structural element.

This same schema is used by:
  * the AI extraction pipeline (what the model must return),
  * the natural-language edit parser,
  * the database (params stored as JSON, always validated against this),
  * the deterministic quantity engine (its input).

All linear dimensions are in **millimetres** (as read from a drawing). The AI
NEVER computes; it only fills these fields. See project.md sections 2 and 7.
"""
from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Reusable sub-structures
# --------------------------------------------------------------------------- #
class BarGroup(BaseModel):
    dia_mm: float
    count: int = 1


class BarMesh(BaseModel):
    """A one-direction mat of bars described by spacing."""

    dia_mm: float
    spacing_mm: float


class StirrupZone(BaseModel):
    spacing_mm: float
    length_mm: float


class Stirrups(BaseModel):
    dia_mm: float
    legs: int = 2
    spacing_mm: float | None = None          # uniform spacing
    zones: list[StirrupZone] = Field(default_factory=list)  # variable spacing


class Opening(BaseModel):
    width_mm: float
    height_mm: float
    count: int = 1


class Region(BaseModel):
    """Bounding box on a drawing page (for 'reference to drawing')."""

    page_no: int = 1
    x0: float = 0
    y0: float = 0
    x1: float = 0
    y1: float = 0


# --------------------------------------------------------------------------- #
# Member base + concrete types
# --------------------------------------------------------------------------- #
class _MemberBase(BaseModel):
    label: str = ""                      # "C1", "B3", "F2"
    count: int = 1
    concrete_grade: str = "M25"
    steel_grade: str = "Fe500"
    cover_mm: float = 40
    region: Region | None = None
    source: Literal["ai", "nl", "manual"] = "manual"
    confidence: float = 1.0
    evidence: str = ""
    assumptions: list[str] = Field(default_factory=list)


class Column(_MemberBase):
    member_type: Literal["column"] = "column"
    b_mm: float
    D_mm: float
    height_mm: float
    main_bars: list[BarGroup] = Field(default_factory=list)
    ties: Stirrups | None = None


class Beam(_MemberBase):
    member_type: Literal["beam"] = "beam"
    b_mm: float
    depth_mm: float
    clear_span_mm: float
    top_bars: list[BarGroup] = Field(default_factory=list)
    bottom_bars: list[BarGroup] = Field(default_factory=list)
    stirrups: Stirrups | None = None


class Footing(_MemberBase):
    member_type: Literal["footing"] = "footing"
    length_mm: float
    breadth_mm: float
    depth_mm: float
    mesh_bottom_x: BarMesh | None = None     # bars running along length
    mesh_bottom_y: BarMesh | None = None     # bars running along breadth


class Slab(_MemberBase):
    member_type: Literal["slab"] = "slab"
    length_mm: float
    breadth_mm: float
    thickness_mm: float
    main_bars: BarMesh | None = None
    dist_bars: BarMesh | None = None
    opening_area_m2: float = 0.0


class RccWall(_MemberBase):
    member_type: Literal["rcc_wall"] = "rcc_wall"
    length_mm: float
    height_mm: float
    thickness_mm: float


class Pcc(_MemberBase):
    member_type: Literal["pcc"] = "pcc"
    length_mm: float
    breadth_mm: float
    thickness_mm: float


class BrickWall(_MemberBase):
    member_type: Literal["brick_wall"] = "brick_wall"
    length_mm: float
    height_mm: float
    thickness_mm: float
    openings: list[Opening] = Field(default_factory=list)
    embedded_rcc_m3: float = 0.0             # columns/beams/lintels passing through


class PlasterSurface(_MemberBase):
    member_type: Literal["plaster_surface"] = "plaster_surface"
    length_mm: float
    height_mm: float
    faces: int = 1                            # 1 or 2
    thickness_mm: float = 12
    openings: list[Opening] = Field(default_factory=list)


class EarthworkPit(_MemberBase):
    member_type: Literal["earthwork_pit"] = "earthwork_pit"
    length_mm: float
    breadth_mm: float
    depth_mm: float
    side_slope: float = 0.0                   # horizontal per unit depth (0 = vertical)
    embedded_structure_m3: float = 0.0        # footing+pcc volume, for backfill netting


class SteelMember(_MemberBase):
    member_type: Literal["steel_member"] = "steel_member"
    designation: str                          # e.g. "ISMB300"
    length_mm: float
    connection_pct: float = 3.0               # connections/gusset lump %


Member = Annotated[
    Union[
        Column, Beam, Footing, Slab, RccWall, Pcc,
        BrickWall, PlasterSurface, EarthworkPit, SteelMember,
    ],
    Field(discriminator="member_type"),
]


class MemberList(BaseModel):
    members: list[Member]
