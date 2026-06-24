"""Engine orchestrator: Member -> list[Quantity] (with audit trail).

This is the heart of the AI/math wall. It dispatches each member to the pure
formula modules and collects every quantity it produces (a column yields
concrete + formwork + rebar, etc.). No AI, no I/O. See project.md section 5.
"""
from __future__ import annotations

from . import concrete, earthwork, masonry, plaster, rebar, steel
from .units import Quantity

# member_type -> list of formula functions to run
REGISTRY = {
    "column":          [concrete.column, rebar.column],
    "beam":            [concrete.beam, rebar.beam],
    "footing":         [concrete.footing, rebar.footing],
    "slab":            [concrete.slab, rebar.slab],
    "rcc_wall":        [concrete.rcc_wall],
    "pcc":             [concrete.pcc],
    "brick_wall":      [masonry.brick_wall],
    "plaster_surface": [plaster.plaster_surface],
    "earthwork_pit":   [earthwork.earthwork_pit],
    "steel_member":    [steel.steel_member],
}


def compute_member(member) -> list[Quantity]:
    """Compute every quantity a single member produces."""
    fns = REGISTRY.get(member.member_type)
    if not fns:
        raise ValueError(f"No engine function for member_type={member.member_type!r}")
    out: list[Quantity] = []
    for fn in fns:
        out.extend(fn(member))
    return out


def compute_all(members) -> list[Quantity]:
    out: list[Quantity] = []
    for m in members:
        out.extend(compute_member(m))
    return out


# Display order + labels for BOQ grouping (CPWD/DSR sequence).
CATEGORY_ORDER = [
    ("earthwork", "Earthwork"),
    ("concrete", "Concrete & RCC"),
    ("formwork", "Formwork / Shuttering"),
    ("rebar", "Reinforcement Steel"),
    ("steel", "Structural Steel"),
    ("masonry", "Brickwork / Masonry"),
    ("plaster", "Plaster & Finishes"),
]
