"""Golden tests for the reinforcement / Bar Bending Schedule engine.

Locks cutting lengths, stirrup counts, lap allowances and bent-up cranks so the
BBS — the highest accuracy-risk module — can't drift silently. See project.md §6.
"""
import math

from app.engine.compute import compute_member
from app.engine.rebar import crank_extra
from app.schemas.member_schema import (
    BarGroup, BarMesh, Beam, Column, Slab, Stirrups, StirrupZone,
)


def approx(a, b, tol=0.005):
    return math.isclose(a, b, rel_tol=tol, abs_tol=tol)


def bbs_rows(member):
    rows = []
    for q in compute_member(member):
        if q.category == "rebar":
            rows.extend(q.extra["bbs"])
    return rows


def _row(rows, suffix):
    return next(r for r in rows if r["mark"].endswith(suffix))


def test_crank_extra_helper():
    # 2 cranks × 0.42 × 0.11 m = 0.0924 m
    assert approx(crank_extra(0.11), 0.0924)
    assert approx(crank_extra(0.11, n_cranks=1), 0.0462)
    assert crank_extra(-1.0) == 0.0  # clamped


def test_column_main_bar_cutting_length():
    m = Column(label="C1", b_mm=300, D_mm=600, height_mm=3000, cover_mm=40,
               main_bars=[BarGroup(dia_mm=16, count=8)])
    row = _row(bbs_rows(m), "M1")
    # 3.0 m height + 50*0.016 development = 3.8 m (no stock lap under 12 m)
    assert approx(row["cutting_length_m"], 3.8)
    assert row["count"] == 8


def test_tall_column_adds_one_stock_lap():
    m = Column(label="C9", b_mm=300, D_mm=600, height_mm=13000, cover_mm=40,
               main_bars=[BarGroup(dia_mm=16, count=4)])
    row = _row(bbs_rows(m), "M1")
    # 13.0 + 0.8 development + 0.8 (one lap past 12 m stock) = 14.6 m
    assert approx(row["cutting_length_m"], 14.6)


def test_beam_uniform_stirrup_count():
    m = Beam(label="B1", b_mm=230, depth_mm=450, clear_span_mm=4500, cover_mm=25,
             bottom_bars=[BarGroup(dia_mm=16, count=3)],
             stirrups=Stirrups(dia_mm=8, legs=2, spacing_mm=150))
    # floor((4.5 - 0.05)/0.15) + 1 = 29 + 1 = 30
    assert _row(bbs_rows(m), "Stp")["count"] == 30


def test_variable_zone_stirrup_count_rounds_per_zone():
    m = Beam(label="B2", b_mm=230, depth_mm=450, clear_span_mm=3500, cover_mm=25,
             bottom_bars=[BarGroup(dia_mm=16, count=3)],
             stirrups=Stirrups(dia_mm=8, legs=2, zones=[
                 StirrupZone(spacing_mm=100, length_mm=1000),
                 StirrupZone(spacing_mm=150, length_mm=2500),
             ]))
    # round(1000/100) + round(2500/150) + 1 = 10 + 17 + 1 = 28
    assert _row(bbs_rows(m), "Stp")["count"] == 28


def test_slab_bent_up_bars_add_crank():
    m = Slab(label="S1", length_mm=4000, breadth_mm=3000, thickness_mm=150,
             cover_mm=20,
             main_bars=BarMesh(dia_mm=10, spacing_mm=200),
             bent_up_bars=BarMesh(dia_mm=12, spacing_mm=200))
    rows = bbs_rows(m)
    bent = _row(rows, "BentUp")
    # bar length (B - 2*cover) + crank(2*0.42*(0.15-0.04)) = 2.96 + 0.0924 = 3.0524
    assert approx(bent["cutting_length_m"], 3.052)
    assert bent["count"] == 20
    # crank makes the bent-up bar longer than a plain main bar of the same span
    plain = _row(rows, "Main")
    assert bent["cutting_length_m"] > (3.0 - 2 * 0.02)
