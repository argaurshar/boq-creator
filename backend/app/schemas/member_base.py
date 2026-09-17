"""Shared building blocks of the Member schema (leaf module).

Lives apart from member_schema.py so discipline packs can inherit _MemberBase
without importing member_schema — which itself imports the packs to build the
discriminated union. Everything here is re-exported by member_schema.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class BarGroup(BaseModel):
    dia_mm: float = Field(gt=0)
    count: int = 1


class BarMesh(BaseModel):
    """A one-direction mat of bars described by spacing."""

    dia_mm: float = Field(gt=0)
    spacing_mm: float = Field(gt=0)


class StirrupZone(BaseModel):
    spacing_mm: float = Field(gt=0)
    length_mm: float = Field(ge=0)


class Stirrups(BaseModel):
    dia_mm: float = Field(gt=0)
    legs: int = 2
    spacing_mm: float | None = Field(default=None, gt=0)  # uniform spacing
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
