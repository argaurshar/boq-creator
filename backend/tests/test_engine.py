"""Golden-number tests for the deterministic quantity engine.

These lock the IS-based formulas to hand-verified values. If a formula changes,
a test must change with it — that is the audit gate. See project.md section 12.
"""
import math

from app.engine.compute import compute_member
from app.schemas.member_schema import (
    BarGroup, BarMesh, BrickWall, Beam, Column, EarthworkPit, Footing,
    Opening, PlasterSurface, Slab, SteelMember, Stirrups,
)


def _by_cat(qs, cat):
    return [q for q in qs if q.category == cat]


def approx(a, b, tol=0.01):
    return math.isclose(a, b, rel_tol=tol, abs_tol=tol)


def test_column_concrete_and_formwork():
    m = Column(label="C1", b_mm=300, D_mm=600, height_mm=3000)
    qs = compute_member(m)
    conc = _by_cat(qs, "concrete")[0]
    form = _by_cat(qs, "formwork")[0]
    assert approx(conc.value, 0.54)
    assert approx(form.value, 5.4)


def test_column_rebar():
    m = Column(
        label="C1", b_mm=300, D_mm=600, height_mm=3000, cover_mm=40,
        main_bars=[BarGroup(dia_mm=16, count=8)],
        ties=Stirrups(dia_mm=8, legs=2, spacing_mm=150),
    )
    reb = _by_cat(compute_member(m), "rebar")[0]
    # main 48.04 kg + ties 12.45 kg = 60.49, +3% wastage = 62.31 kg
    assert approx(reb.value, 62.31, tol=0.02)
    assert reb.extra["bbs"]  # a BBS table is attached


def test_beam_concrete():
    m = Beam(label="B1", b_mm=230, depth_mm=450, clear_span_mm=4500)
    conc = _by_cat(compute_member(m), "concrete")[0]
    form = _by_cat(compute_member(m), "formwork")[0]
    assert approx(conc.value, 0.46575)
    assert approx(form.value, 5.085)


def test_footing_concrete():
    m = Footing(label="F1", length_mm=2000, breadth_mm=2000, depth_mm=400,
                mesh_bottom_x=BarMesh(dia_mm=12, spacing_mm=150),
                mesh_bottom_y=BarMesh(dia_mm=12, spacing_mm=150))
    qs = compute_member(m)
    assert approx(_by_cat(qs, "concrete")[0].value, 1.6)
    assert _by_cat(qs, "rebar")  # mesh produces reinforcement


def test_slab():
    m = Slab(label="S1", length_mm=4000, breadth_mm=3000, thickness_mm=125)
    qs = compute_member(m)
    assert approx(_by_cat(qs, "concrete")[0].value, 1.5)
    assert approx(_by_cat(qs, "formwork")[0].value, 12.0)


def test_brickwork_opening_deduction():
    m = BrickWall(label="W1", length_mm=3000, height_mm=3000, thickness_mm=230,
                  openings=[Opening(width_mm=1000, height_mm=2100)])
    q = compute_member(m)[0]
    # 2.07 gross - 0.483 opening = 1.587 m3
    assert approx(q.value, 1.587)


def test_brickwork_ignores_small_opening():
    # opening 0.09 m2 < 0.1 threshold -> NOT deducted
    m = BrickWall(label="W2", length_mm=3000, height_mm=3000, thickness_mm=230,
                  openings=[Opening(width_mm=300, height_mm=300)])
    q = compute_member(m)[0]
    assert approx(q.value, 2.07)


def test_plaster_two_faces_with_deduction():
    m = PlasterSurface(label="P1", length_mm=3000, height_mm=3000, faces=2,
                       openings=[Opening(width_mm=1000, height_mm=2100)])
    q = compute_member(m)[0]
    # 18 gross - 4.2 = 13.8 m2
    assert approx(q.value, 13.8)


def test_earthwork_vertical_backfill_surplus():
    m = EarthworkPit(label="E1", length_mm=2000, breadth_mm=2000, depth_mm=1500,
                     embedded_structure_m3=1.0)
    qs = compute_member(m)
    exc = [q for q in qs if "excavation" in q.description.lower()][0]
    back = [q for q in qs if "backfill" in q.description.lower()][0]
    surp = [q for q in qs if "surplus" in q.description.lower()][0]
    assert approx(exc.value, 6.0)
    assert approx(back.value, 5.0)
    assert approx(surp.value, 1.0)


def test_earthwork_sloped_prismoidal():
    m = EarthworkPit(label="E2", length_mm=2000, breadth_mm=2000, depth_mm=1500,
                     side_slope=0.5)
    exc = [q for q in compute_member(m) if "excavation" in q.description.lower()][0]
    assert approx(exc.value, 11.625)


def test_steel_section_weight():
    m = SteelMember(label="ST1", designation="ISMB300", length_mm=6000,
                    connection_pct=3.0)
    q = compute_member(m)[0]
    # 44.2 kg/m * 6 m * 1.03 = 273.156 kg
    assert approx(q.value, 273.156)


def test_steel_unknown_section_is_flagged_not_guessed():
    m = SteelMember(label="ST2", designation="NOPE999", length_mm=6000)
    q = compute_member(m)[0]
    assert q.value == 0.0
    assert "UNKNOWN" in q.description


def test_steel_expanded_section_table():
    # ISLB300 = 37.7 kg/m * 6 m * 1.03 connections = 232.986 kg
    m = SteelMember(label="ST3", designation="ISLB300", length_mm=6000,
                    connection_pct=3.0)
    q = compute_member(m)[0]
    assert approx(q.value, 232.986)


def test_half_brick_wall_measured_in_m2():
    # IS 1200: 115 mm (half-brick) partitions are measured in m2, not m3.
    m = BrickWall(label="HW1", length_mm=3000, height_mm=3000, thickness_mm=115,
                  openings=[Opening(width_mm=1000, height_mm=2100)])
    q = compute_member(m)[0]
    assert q.unit == "m2"
    # 9.0 gross area - 2.1 opening = 6.9 m2
    assert approx(q.value, 6.9)


def test_earthwork_working_offset_widens_dig():
    m = EarthworkPit(label="E3", length_mm=2000, breadth_mm=2000, depth_mm=1500,
                     working_offset_mm=150)
    exc = [q for q in compute_member(m) if "excavation" in q.description.lower()][0]
    # (2.0 + 0.3) x (2.0 + 0.3) x 1.5 = 7.935 m3
    assert approx(exc.value, 7.935)
