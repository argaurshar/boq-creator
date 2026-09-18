"""The discipline gate. Mirrors frontend/src/engine/disciplines.ts.

A take-off run is focused on exactly ONE discipline. Elements belonging to
other disciplines are NOT measured — but they are never silently dropped:
build_boq returns them in an out-of-scope register so the user can see what was
set aside and why. A quiet drop would be indistinguishable from an element that
was never read at all.
"""
from __future__ import annotations

from typing import Any

DEFAULT_DISCIPLINE = "structure"

# A member type may legitimately belong to more than one discipline: foundation
# excavation is read by a structural take-off as well as a civil one, and the
# lean-concrete layer under a footing belongs to both.
DISCIPLINES: list[dict[str, Any]] = [
    {
        "key": "structure",
        "label": "Structure",
        "blurb": "RCC frame and structural steel — footings, columns, beams, "
                 "slabs, walls, trusses.",
        "types": ["footing", "column", "beam", "slab", "rcc_wall", "pcc",
                  "steel_member", "truss", "anchor_bolt", "earthwork_pit"],
        "categories": ["earthwork", "concrete", "formwork", "rebar", "steel"],
    },
    {
        "key": "civil",
        "label": "Civil",
        "blurb": "Site, substructure and external works — excavation, filling, "
                 "lean concrete.",
        "types": ["earthwork_pit", "pcc"],
        "categories": ["earthwork", "concrete"],
    },
    {
        "key": "architecture",
        "label": "Architecture",
        "blurb": "Building fabric and finishes — masonry, plaster, roof covering.",
        "types": ["brick_wall", "plaster_surface", "roof_sheeting",
                  "flooring", "wall_tiling", "false_ceiling", "painting",
                  "door_window", "waterproofing", "railing"],
        "categories": ["masonry", "plaster", "roofing", "flooring", "skirting",
                       "tiling", "ceiling", "painting", "doors_windows",
                       "waterproofing", "railing"],
    },
    {
        "key": "interior",
        "label": "Interior",
        "blurb": "Fit-out — joinery, finishes, ceilings, loose furniture.",
        "types": ["joinery", "glazing", "loose_furniture", "sanitary_fixture",
                  "electrical_point", "flooring", "wall_tiling", "false_ceiling",
                  "painting", "door_window"],
        "categories": ["joinery", "furniture", "glazing", "sanitary", "services",
                       "flooring", "skirting", "tiling", "ceiling", "painting",
                       "doors_windows"],
    },
]


def discipline_info(key: str | None) -> dict[str, Any]:
    for d in DISCIPLINES:
        if d["key"] == key:
            return d
    return DISCIPLINES[0]


def in_scope(member_type: str, discipline: str | None) -> bool:
    """Is this member type measured by the active discipline?"""
    return member_type in discipline_info(discipline)["types"]


def disciplines_for(member_type: str) -> list[dict[str, Any]]:
    return [d for d in DISCIPLINES if member_type in d["types"]]


def out_of_scope_reason(member_type: str, discipline: str | None) -> str:
    """Human-readable reason a member was set aside, naming where it belongs."""
    active = discipline_info(discipline)
    owners = disciplines_for(member_type)
    if not owners:
        return (f'No discipline pack measures "{member_type}" yet — it was read '
                f"but not quantified.")
    names = " or ".join(o["label"] for o in owners)
    return (f"Measured by {names}, not by {active['label']}. "
            f"Switch discipline to include it.")
