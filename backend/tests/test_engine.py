"""Golden-number tests for the deterministic quantity engine.

These lock the IS-based formulas to hand-verified values. If a formula changes,
a test must change with it — that is the audit gate. See project.md section 12.
"""
import math

from app.engine.compute import compute_member
from app.engine.materials import resolve_steel
from app.schemas.member_schema import (
    AnchorBolt, BarGroup, BarMesh, BrickWall, Beam, Column, EarthworkPit, Footing,
    Opening, PlasterSurface, RoofSheeting, Slab, SteelMember, Stirrups, Truss,
    TrussSegment,
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


def test_truss_sums_segments_with_connection_and_count():
    # ISA75X75X6 = 6.8 kg/m, ISA50X50X6 = 4.5 kg/m (IS 808 table).
    #   rafter : 6.8 * 6  * 2 = 81.6
    #   tie    : 6.8 * 12 * 1 = 81.6
    #   strut  : 4.5 * 1  * 4 = 18.0
    #   per_truss = 181.2 ; *1.05 connections = 190.26 ; *3 trusses = 570.78
    m = Truss(label="T1", count=3, connection_pct=5.0, segments=[
        TrussSegment(component="rafter", designation="ISA75X75X6", length_mm=6000, count=2),
        TrussSegment(component="bottom tie", designation="ISA75X75X6", length_mm=12000, count=1),
        TrussSegment(component="strut", designation="ISA50X50X6", length_mm=1000, count=4),
    ])
    qs = compute_member(m)
    assert len(qs) == 1
    q = qs[0]
    assert q.category == "steel" and q.unit == "kg"
    assert approx(q.value, 570.78)
    assert approx(q.extra["per_truss_kg"], 181.2)
    assert len(q.extra["truss_segments"]) == 3


def test_truss_flags_unknown_segment_section():
    m = Truss(label="T2", count=1, connection_pct=0.0, segments=[
        TrussSegment(component="rafter", designation="ISA75X75X6", length_mm=1000, count=1),
        TrussSegment(component="mystery", designation="NOPE999", length_mm=1000, count=1),
    ])
    q = compute_member(m)[0]
    # only the known segment contributes: 6.8 * 1 * 1 = 6.8
    assert approx(q.value, 6.8)
    assert "unknown" in q.description.lower()


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


def test_masonry_clamp_to_zero_is_flagged_not_silent():
    # A 1.0 x 2.4 x 0.229 wall = 0.55 m3 gross; embedded RCC of 1.0 m3 > gross,
    # so the net clamps to 0 — but the line must carry a warning, not vanish.
    m = BrickWall(label="PIER", length_mm=1000, height_mm=2400, thickness_mm=229,
                  embedded_rcc_m3=1.0)
    q = compute_member(m)[0]
    assert q.value == 0.0
    assert "review" in q.description.lower()
    assert "warning" in q.extra


def test_plate_inch_plan_dims_converted():
    # A 12"x12"x20mm base plate: plan size given in inches, thickness in mm.
    #   305 x 305 x 20 mm -> 305*305*20 /1e9 * 7850 ~= 14.6 kg
    r = resolve_steel("MS PLATE 12X12X20MM")
    assert r["piece_wt_kg"] is not None and approx(r["piece_wt_kg"], 14.6, tol=0.05)
    # explicit inch marks give the same answer
    r2 = resolve_steel('PLATE 12"x12"x20mm')
    assert approx(r2["piece_wt_kg"], 14.6, tol=0.05)
    # a normal all-mm plate is untouched: 200*200*10 /1e9 *7850 = 3.14 kg
    r3 = resolve_steel("PLATE 200X200X10")
    assert approx(r3["piece_wt_kg"], 3.14, tol=0.02)


def test_anchor_bolt_weight():
    # 25 mm dia, 0.6 m long, 24 nos: (25^2/162) * 0.6 * 1.10 * 24 ~= 61.11 kg
    m = AnchorBolt(label="AB1", count=24, dia_mm=25, length_mm=600)
    q = compute_member(m)[0]
    assert q.category == "steel" and q.unit == "kg" and q.nos == 24
    assert approx(q.value, 61.11, tol=0.05)


def test_concrete_material_conversion_m20_m25():
    from app.engine.material_takeoff import concrete_materials
    # M20 1:1.5:3 (sum 5.5), dry 1.54: cement 0.28 m3 -> 8.06 bags; sand 0.42; agg 0.84
    m20 = concrete_materials("M20", 1.0)
    assert approx(m20["cement_bags"], 8.06, tol=0.02)
    assert approx(m20["sand_m3"], 0.42, tol=0.02)
    assert approx(m20["agg_m3"], 0.84, tol=0.02)
    # M25 1:1:2 (sum 4): cement 0.385 m3 -> 11.1 bags
    assert approx(concrete_materials("M25", 1.0)["cement_bags"], 11.1, tol=0.1)
    # PCC ratio parsed from grade string "PCC 1:4:8" (sum 13): cement 0.1185 -> 3.41 bags
    assert approx(concrete_materials("PCC 1:4:8", 1.0)["cement_bags"], 3.41, tol=0.05)


def test_material_takeoff_aggregates_from_boq():
    from types import SimpleNamespace
    from app.services import build_boq
    from app.engine.material_takeoff import material_takeoff

    def row(i, params):
        return SimpleNamespace(id=i, params=params, source="manual", confidence=1.0,
                               is_verified=True, label=params.get("label", ""))
    members = [
        row(1, {"member_type": "footing", "label": "F1", "concrete_grade": "M25",
                "length_mm": 2000, "breadth_mm": 2000, "depth_mm": 500,
                "mesh_bottom_x": {"dia_mm": 12, "spacing_mm": 150},
                "mesh_bottom_y": {"dia_mm": 12, "spacing_mm": 150}}),
        row(2, {"member_type": "brick_wall", "label": "W1", "length_mm": 3000,
                "height_mm": 3000, "thickness_mm": 230}),
    ]
    sections = material_takeoff(build_boq(members, {}))
    titles = [s["title"] for s in sections]
    assert "Cement & aggregates" in titles
    assert any("Reinforcement steel" in t for t in titles)
    cement = next(r for s in sections if s["title"] == "Cement & aggregates"
                  for r in s["rows"] if r["material"].startswith("Cement"))
    assert cement["qty"] > 0
    # bricks surfaced from masonry
    assert any(r["material"].startswith("Bricks") for s in sections for r in s["rows"])


def test_truss_steel_dedup_removes_duplicate_members_and_warns():
    from types import SimpleNamespace
    from app.services import build_boq

    def row(i, params):
        return SimpleNamespace(id=i, params=params, source="ai", confidence=1.0,
                               is_verified=False, label=params.get("label", ""))

    members = [
        row(1, {"member_type": "truss", "label": "T1", "count": 1,
                "segments": [{"component": "top chord", "designation": "RHS 100X200X4",
                              "length_mm": 6000, "count": 2}]}),
        row(2, {"member_type": "steel_member", "label": "Top chord longitudinal",
                "designation": "RHS 100X200X4", "length_mm": 6000}),
        row(3, {"member_type": "steel_member", "label": "Diagonal web bracing",
                "designation": "SHS 60X60X4.8", "length_mm": 1450}),
        row(4, {"member_type": "steel_member", "label": "BP1 Base Plate",
                "designation": "MS PLATE 305X305X20", "length_mm": 305}),
    ]
    boq = build_boq(members, {"steel": 90})
    steel = next(g for g in boq["groups"] if g["category"] == "steel")
    descs = " ".join(it["description"] for it in steel["items"])
    assert "truss" in descs.lower() and "Base Plate" in descs   # kept
    assert "longitudinal" not in descs.lower() and "web" not in descs.lower()  # dropped
    warnings = [e for e in boq["errors"] if e.get("warning")]
    assert len(warnings) == 2


def test_footing_top_mesh_adds_rebar():
    bottom_only = Footing(label="F1", length_mm=1829, breadth_mm=1829, depth_mm=508,
                          mesh_bottom_x=BarMesh(dia_mm=12, spacing_mm=102),
                          mesh_bottom_y=BarMesh(dia_mm=12, spacing_mm=102))
    doubly = Footing(label="F1", length_mm=1829, breadth_mm=1829, depth_mm=508,
                     mesh_bottom_x=BarMesh(dia_mm=12, spacing_mm=102),
                     mesh_bottom_y=BarMesh(dia_mm=12, spacing_mm=102),
                     mesh_top_x=BarMesh(dia_mm=10, spacing_mm=203),
                     mesh_top_y=BarMesh(dia_mm=10, spacing_mm=203))
    b = _by_cat(compute_member(bottom_only), "rebar")[0].value
    d = _by_cat(compute_member(doubly), "rebar")[0].value
    assert d > b  # top mat increases footing steel
    # 4 BBS rows when doubly reinforced (BX, BY, TX, TY)
    assert len(_by_cat(compute_member(doubly), "rebar")[0].extra["bbs"]) == 4


def test_column_inner_tie_adds_rebar():
    single = Column(label="C1", b_mm=457, D_mm=457, height_mm=2438, cover_mm=40,
                    main_bars=[BarGroup(dia_mm=20, count=12)],
                    ties=Stirrups(dia_mm=10, legs=2, spacing_mm=102))
    double = Column(label="C1", b_mm=457, D_mm=457, height_mm=2438, cover_mm=40,
                    main_bars=[BarGroup(dia_mm=20, count=12)],
                    ties=Stirrups(dia_mm=10, legs=2, spacing_mm=102),
                    ties_inner=Stirrups(dia_mm=8, legs=2, spacing_mm=102))
    s = _by_cat(compute_member(single), "rebar")[0].value
    d = _by_cat(compute_member(double), "rebar")[0].value
    assert d > s  # inner ring increases tie steel


def test_roof_sheeting_area_with_lap():
    # 6.0 x 3.0 = 18 m2 per sheet x 2 x 1.10 lap = 39.6 m2
    m = RoofSheeting(label="RS1", count=2, length_mm=6000, breadth_mm=3000, lap_pct=10)
    q = compute_member(m)[0]
    assert q.category == "roofing" and q.unit == "m2"
    assert approx(q.value, 39.6)
