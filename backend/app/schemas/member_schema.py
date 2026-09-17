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
# Shared sub-structures and the member base live in a leaf module so the
# discipline packs can import them without a circular import; re-exported here
# so existing `from .member_schema import Opening` style imports keep working.
from .member_base import (  # noqa: E402,F401
    BarGroup, BarMesh, StirrupZone, Stirrups, Opening, Region, _MemberBase,
)


class Column(_MemberBase):
    member_type: Literal["column"] = "column"
    b_mm: float
    D_mm: float
    height_mm: float
    main_bars: list[BarGroup] = Field(default_factory=list)
    ties: Stirrups | None = None
    ties_inner: Stirrups | None = None       # 2nd/inner ring ("2 SETS")


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
    mesh_top_x: BarMesh | None = None        # top mat (doubly reinforced footing)
    mesh_top_y: BarMesh | None = None


class Slab(_MemberBase):
    member_type: Literal["slab"] = "slab"
    length_mm: float
    breadth_mm: float
    thickness_mm: float
    main_bars: BarMesh | None = None
    dist_bars: BarMesh | None = None
    bent_up_bars: BarMesh | None = None      # cranked-up bars over supports
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
    # Labels of RCC members embedded in this wall — when set, their concrete
    # volume is netted automatically (overrides embedded_rcc_m3).
    embedded_labels: list[str] = Field(default_factory=list)


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
    working_offset_mm: float = 0.0            # extra working space added each side
    embedded_structure_m3: float = 0.0        # footing+pcc volume, for backfill netting
    # Labels of members (footings, PCC) inside this pit — when set, their
    # concrete volume is netted from backfill automatically (overrides
    # embedded_structure_m3).
    contains_labels: list[str] = Field(default_factory=list)


class SteelMember(_MemberBase):
    member_type: Literal["steel_member"] = "steel_member"
    designation: str                          # e.g. "ISMB300"
    length_mm: float
    connection_pct: float = 3.0               # connections/gusset lump %


class TrussSegment(BaseModel):
    """One member of a truss (rafter, tie, strut, vertical…)."""

    component: str = ""                        # role, e.g. "top chord/rafter"
    designation: str                          # section, e.g. "ISA 75X75X6"
    length_mm: float = Field(gt=0)
    count: int = 1                            # how many of this segment per ONE truss


class Truss(_MemberBase):
    member_type: Literal["truss"] = "truss"
    span_mm: float = 0.0                       # informational only
    connection_pct: float = 5.0               # gusset/bolt/weld lump %
    segments: list[TrussSegment] = Field(min_length=1)


class AnchorBolt(_MemberBase):
    member_type: Literal["anchor_bolt"] = "anchor_bolt"
    dia_mm: float = Field(gt=0)
    length_mm: float = Field(gt=0)            # incl. embedment + projection


class RoofSheeting(_MemberBase):
    member_type: Literal["roof_sheeting"] = "roof_sheeting"
    length_mm: float
    breadth_mm: float
    lap_pct: float = 0.0                       # side/end lap allowance
    opening_area_m2: float = 0.0


# Discipline packs are imported here, after _MemberBase exists, so the pack
# schema modules can inherit from it without a circular-import failure.
from .finishes_schema import FINISHES_TYPES  # noqa: E402
from .interior_schema import INTERIOR_TYPES  # noqa: E402

Member = Annotated[
    Union[tuple([
        Column, Beam, Footing, Slab, RccWall, Pcc,
        BrickWall, PlasterSurface, EarthworkPit, SteelMember, Truss,
        AnchorBolt, RoofSheeting,
        *FINISHES_TYPES, *INTERIOR_TYPES,
    ])],
    Field(discriminator="member_type"),
]


class MemberList(BaseModel):
    members: list[Member]
