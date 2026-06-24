"""Units, rounding (IS 1200) and the core result types of the engine.

Every quantity the engine produces is a :class:`Quantity` carrying an audit
trail of :class:`FormulaStep` objects, so any number can be explained back to
its formula, inputs and IS clause. See project.md section 6.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

MM_PER_M = 1000.0


def mm_to_m(value_mm: float | None) -> float:
    """Convert a millimetre dimension (as read from a drawing) to metres."""
    return (value_mm or 0.0) / MM_PER_M


# Presentation rounding per IS 1200 conventions. Raw values are kept full
# precision internally; rounding is applied only when presenting a line item,
# and the rule is recorded so totals stay reproducible.
ROUNDING = {
    "m": 2,      # linear
    "m2": 2,     # area
    "m3": 3,     # volume (DSR often 2; engine keeps 3, UI may show 2)
    "kg": 2,     # steel weight
    "MT": 3,
    "Nos": 0,
}


def round_qty(value: float, unit: str) -> float:
    return round(value, ROUNDING.get(unit, 3))


@dataclass
class FormulaStep:
    """One auditable step in a calculation."""

    formula_id: str            # e.g. "concrete.column.volume"
    expression: str            # human-readable, e.g. "b*D*H*count"
    inputs: dict[str, Any]     # {"b_m": 0.3, "D_m": 0.6, ...}
    result: float
    clause_ref: str = ""       # e.g. "IS 1200 Part 2"

    def to_dict(self) -> dict[str, Any]:
        return {
            "formula_id": self.formula_id,
            "expression": self.expression,
            "inputs": self.inputs,
            "result": self.result,
            "clause_ref": self.clause_ref,
        }


@dataclass
class Quantity:
    """A single computed BOQ quantity produced from a member."""

    category: str              # concrete | rebar | steel | earthwork | masonry | plaster | formwork
    description: str
    unit: str                  # m3 | m2 | kg | MT | Nos
    value: float               # raw (unrounded) value
    # Traditional measurement-sheet basis columns (No / L / B / D), for the
    # CPWD/DSR-style export. Any may be None.
    nos: float | None = None
    length_m: float | None = None
    breadth_m: float | None = None
    depth_m: float | None = None
    audit: list[FormulaStep] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)  # e.g. a BBS table

    def rounded(self) -> float:
        return round_qty(self.value, self.unit)

    def to_dict(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "description": self.description,
            "unit": self.unit,
            "value": self.value,
            "rounded": self.rounded(),
            "nos": self.nos,
            "length_m": self.length_m,
            "breadth_m": self.breadth_m,
            "depth_m": self.depth_m,
            "audit": [s.to_dict() for s in self.audit],
            "extra": self.extra,
        }
