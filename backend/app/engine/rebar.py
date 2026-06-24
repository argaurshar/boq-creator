"""Reinforcement / Bar Bending Schedule. Unit: kg.

Cutting length, unit weight (d^2/162), hooks, bend deductions, laps, stirrups
and slab/footing mesh — per SP 34 / IS 2502 detailing practice. Produces a BBS
table (in Quantity.extra) plus the total weight. See project.md section 6.
"""
from __future__ import annotations

from . import materials as mat
from .units import FormulaStep, Quantity, mm_to_m


def _bbs_row(mark, dia_mm, count, cut_len_m):
    unit_wt = mat.rebar_unit_weight(dia_mm)
    total_wt = cut_len_m * count * unit_wt
    return {
        "mark": mark, "dia_mm": dia_mm, "count": count,
        "cutting_length_m": round(cut_len_m, 3),
        "unit_weight_kg_m": round(unit_wt, 4),
        "total_weight_kg": round(total_wt, 3),
    }, total_wt


def _laps_extra(length_m: float, dia_mm: float) -> float:
    """Extra length from laps for bars longer than stock length."""
    n_laps = int(length_m // mat.STOCK_BAR_LENGTH_M)
    return n_laps * mat.DEFAULT_LAP_FACTOR * mm_to_m(dia_mm)


def _straight_bar_cut_length(clear_m: float, cover_m: float, dia_mm: float,
                             hooks: int = 2) -> float:
    """Clear length - 2*cover + hook allowance, plus laps for long bars."""
    base = clear_m - 2 * cover_m + hooks * mat.HOOK_ALLOWANCE * mm_to_m(dia_mm)
    base = max(base, 0.0)
    return base + _laps_extra(base, dia_mm)


def _stirrup_cut_length(a_m: float, b_m: float, dia_mm: float) -> float:
    """Rectangular stirrup: 2(a+b) + 2 hooks(9d) - 3 bends(2d) at 90 deg."""
    d = mm_to_m(dia_mm)
    perimeter = 2 * (a_m + b_m)
    hooks = 2 * mat.HOOK_ALLOWANCE * d
    bends = 3 * mat.BEND_DEDUCTION_90 * d
    return max(perimeter + hooks - bends, 0.0)


def _stirrup_count(span_m: float, cover_m: float, spacing_mm: float | None,
                   zones) -> int:
    if zones:
        total = 0
        for z in zones:
            total += int(mm_to_m(z.length_mm) // mm_to_m(z.spacing_mm))
        return total + 1
    if spacing_mm:
        usable = max(span_m - 2 * cover_m, 0.0)
        return int(usable // mm_to_m(spacing_mm)) + 1
    return 0


def _summarise(rows, member_label, n_members) -> Quantity:
    """Roll a BBS up into one weight Quantity (with wastage), per member count."""
    weight = sum(r["total_weight_kg"] for r in rows) * n_members
    wastage = weight * mat.DEFAULT_WASTAGE_PCT / 100.0
    total = weight + wastage
    # scale BBS counts to reflect member multiplicity for the export
    scaled = [{**r, "count": r["count"] * n_members,
               "total_weight_kg": round(r["total_weight_kg"] * n_members, 3)}
              for r in rows]
    return Quantity(
        category="rebar",
        description=f"Reinforcement steel for {member_label}".strip(),
        unit="kg", value=total, nos=n_members,
        audit=[FormulaStep(
            "rebar.summary", "sum(cut_len*count*d^2/162) * (1+wastage)",
            {"steel_kg": round(weight, 3), "wastage_pct": mat.DEFAULT_WASTAGE_PCT},
            total, "SP 34 / IS 2502")],
        extra={"bbs": scaled, "wastage_pct": mat.DEFAULT_WASTAGE_PCT},
    )


def column(m) -> list[Quantity]:
    if not m.main_bars:
        return []
    cover = mm_to_m(m.cover_mm)
    H = mm_to_m(m.height_mm)
    rows = []
    for i, bg in enumerate(m.main_bars):
        # main bars run full height + development/lap
        cut = H + mat.DEFAULT_LAP_FACTOR * mm_to_m(bg.dia_mm)
        cut += _laps_extra(cut, bg.dia_mm)
        row, _ = _bbs_row(f"{m.label}-M{i+1}", bg.dia_mm, bg.count, cut)
        rows.append(row)
    if m.ties and m.ties.spacing_mm:
        a = mm_to_m(m.b_mm) - 2 * cover
        b = mm_to_m(m.D_mm) - 2 * cover
        cut = _stirrup_cut_length(a, b, m.ties.dia_mm)
        cnt = _stirrup_count(H, cover, m.ties.spacing_mm, m.ties.zones)
        row, _ = _bbs_row(f"{m.label}-T", m.ties.dia_mm, cnt, cut)
        rows.append(row)
    return [_summarise(rows, f"column {m.label}", m.count)] if rows else []


def beam(m) -> list[Quantity]:
    cover = mm_to_m(m.cover_mm)
    L = mm_to_m(m.clear_span_mm)
    rows = []
    for i, bg in enumerate(m.top_bars):
        cut = _straight_bar_cut_length(L, cover, bg.dia_mm, hooks=2)
        row, _ = _bbs_row(f"{m.label}-Top{i+1}", bg.dia_mm, bg.count, cut)
        rows.append(row)
    for i, bg in enumerate(m.bottom_bars):
        cut = _straight_bar_cut_length(L, cover, bg.dia_mm, hooks=2)
        row, _ = _bbs_row(f"{m.label}-Bot{i+1}", bg.dia_mm, bg.count, cut)
        rows.append(row)
    if m.stirrups:
        a = mm_to_m(m.b_mm) - 2 * cover
        b = mm_to_m(m.depth_mm) - 2 * cover
        cut = _stirrup_cut_length(a, b, m.stirrups.dia_mm)
        cnt = _stirrup_count(L, cover, m.stirrups.spacing_mm, m.stirrups.zones)
        row, _ = _bbs_row(f"{m.label}-Stp", m.stirrups.dia_mm, cnt, cut)
        rows.append(row)
    return [_summarise(rows, f"beam {m.label}", m.count)] if rows else []


def _mesh_rows(mark, mesh, span_along_m, bar_len_m, cover_m):
    """A mat of bars: count across `span_along_m`, each `bar_len_m` long."""
    n = int(max(span_along_m - 2 * cover_m, 0.0) // mm_to_m(mesh.spacing_mm)) + 1
    cut = max(bar_len_m - 2 * cover_m, 0.0) + 2 * mat.HOOK_ALLOWANCE * mm_to_m(mesh.dia_mm)
    return _bbs_row(mark, mesh.dia_mm, n, cut)[0]


def footing(m) -> list[Quantity]:
    cover = mm_to_m(m.cover_mm)
    L, B = mm_to_m(m.length_mm), mm_to_m(m.breadth_mm)
    rows = []
    if m.mesh_bottom_x:                      # bars along length, spaced across breadth
        rows.append(_mesh_rows(f"{m.label}-X", m.mesh_bottom_x, B, L, cover))
    if m.mesh_bottom_y:                      # bars along breadth, spaced across length
        rows.append(_mesh_rows(f"{m.label}-Y", m.mesh_bottom_y, L, B, cover))
    return [_summarise(rows, f"footing {m.label}", m.count)] if rows else []


def slab(m) -> list[Quantity]:
    cover = mm_to_m(m.cover_mm)
    L, B = mm_to_m(m.length_mm), mm_to_m(m.breadth_mm)
    rows = []
    if m.main_bars:                          # short span, spaced along long span
        rows.append(_mesh_rows(f"{m.label}-Main", m.main_bars, L, B, cover))
    if m.dist_bars:
        rows.append(_mesh_rows(f"{m.label}-Dist", m.dist_bars, B, L, cover))
    return [_summarise(rows, f"slab {m.label}", m.count)] if rows else []
