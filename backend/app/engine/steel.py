"""Structural / MS steel. Unit: kg (summarised to MT in export).

Rolled-section weight from IS 808 / SP 6(1) table + connection lump.
See project.md section 6.
"""
from __future__ import annotations

from . import materials as mat
from .units import FormulaStep, Quantity, mm_to_m


def steel_member(m) -> list[Quantity]:
    L = mm_to_m(m.length_mm)
    n = m.count
    conn = 1 + m.connection_pct / 100.0
    r = mat.resolve_steel(m.designation)

    if r["unit_wt_kg_m"] is not None:
        total = r["unit_wt_kg_m"] * L * n * conn
        return [Quantity(
            category="steel",
            description=f"Structural steel {m.label} ({m.designation})".strip(),
            unit="kg", value=total, nos=n, length_m=L,
            audit=[FormulaStep(
                "steel.section.weight",
                "unit_wt * L * count * (1 + connection_pct)",
                {"unit_wt_kg_m": r["unit_wt_kg_m"], "basis": r["basis"], "L_m": L,
                 "count": n, "connection_pct": m.connection_pct}, total, "IS 808 / SP 6(1)")],
        )]

    if r["piece_wt_kg"] is not None:
        total = r["piece_wt_kg"] * n * conn
        return [Quantity(
            category="steel",
            description=f"Steel plate {m.label} ({m.designation})".strip(),
            unit="kg", value=total, nos=n,
            audit=[FormulaStep(
                "steel.plate.weight",
                "L*W*t*7850 * count * (1 + connection_pct)",
                {"piece_wt_kg": r["piece_wt_kg"], "basis": r["basis"], "count": n,
                 "connection_pct": m.connection_pct}, total, "IS 808 / SP 6(1)")],
        )]

    # Truly unknown: surface a zero-weight line with an assumption so the engine
    # never silently fabricates a number.
    return [Quantity(
        category="steel",
        description=f"Steel member {m.label} ({m.designation}) — UNKNOWN SECTION",
        unit="kg", value=0.0, nos=n, length_m=L,
        audit=[FormulaStep("steel.unknown_section",
                           "section not recognised (table or geometry)",
                           {"designation": m.designation}, 0.0, "IS 808")],
    )]


def truss(m) -> list[Quantity]:
    """A truss: an assembly of steel segments summed to a single weight.

    Each segment's weight reuses :func:`resolve_steel`, so any rolled or
    parametric section already resolves. One BOQ line per truss type, with the
    per-segment breakdown carried in ``extra`` for the export. Mirrors the TS
    engine's ``steel.truss``.
    """
    segments = m.segments or []
    pct = 5.0 if m.connection_pct is None else m.connection_pct
    conn = 1 + pct / 100.0
    n = m.count
    unknown: list[str] = []

    per_truss = 0.0
    breakdown = []
    for s in segments:
        L = mm_to_m(s.length_mm)
        r = mat.resolve_steel(s.designation)
        wt = 0.0
        basis = r["basis"]
        if r["unit_wt_kg_m"] is not None:
            wt = r["unit_wt_kg_m"] * L * s.count
        elif r["piece_wt_kg"] is not None:
            wt = r["piece_wt_kg"] * s.count
        else:
            basis = "UNKNOWN SECTION"
            unknown.append(s.designation)
        per_truss += wt
        breakdown.append({
            "component": s.component, "designation": s.designation, "basis": basis,
            "length_m": L, "count": s.count, "weight_kg": wt,
        })

    total = per_truss * conn * n
    desc = f"Steel truss {m.label}".strip()
    if unknown:
        desc += f" — {len(unknown)} unknown section(s)"
    return [Quantity(
        category="steel",
        description=desc,
        unit="kg", value=total, nos=n,
        audit=[FormulaStep(
            "steel.truss.weight",
            "sum(segment_wt) * (1 + connection_pct) * count",
            {"per_truss_kg": per_truss, "connection_pct": pct,
             "count": n, "segments": breakdown}, total, "IS 808 / SP 6(1)")],
        extra={"truss_segments": breakdown, "per_truss_kg": per_truss},
    )]
