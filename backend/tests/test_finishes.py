"""Golden-number tests for the finishes pack (flooring, tiling, ceiling,
painting, doors/windows, waterproofing, railing).

These lock the IS 1200 based formulas to hand-verified values and must match
the TS engine (frontend/src/engine/finishes.ts) exactly; the node parity
script executes the same goldens against the bundled TS module.
"""
import math

import pytest
from pydantic import ValidationError

from app.engine import finishes
from app.engine.finishes import CATEGORIES, REGISTRY, SQFT_PER_M2
from app.schemas.finishes_schema import (
    FINISHES_TYPES, DoorWindow, FalseCeiling, Flooring, Painting, Railing,
    Waterproofing, WallTiling,
)
from app.schemas.member_schema import Opening


def approx(a, b, tol=1e-9):
    return math.isclose(a, b, rel_tol=tol, abs_tol=tol)


def _run(m):
    out = []
    for fn in REGISTRY[m.member_type]:
        out.extend(fn(m))
    return out


def _by_cat(qs, cat):
    return [q for q in qs if q.category == cat]


# --------------------------------------------------------------------------- #
# Goldens
# --------------------------------------------------------------------------- #
def test_flooring_with_deduction_and_perimeter_skirting():
    m = Flooring(label="FL1", length_mm=4000, breadth_mm=3000, deduct_area_m2=0.5,
                 skirting_height_mm=100, count=1)
    qs = _run(m)
    fl = _by_cat(qs, "flooring")[0]
    sk = _by_cat(qs, "skirting")[0]
    assert fl.unit == "m2" and approx(fl.value, 11.5)
    assert sk.unit == "m" and approx(sk.value, 14.0)          # 2*(4+3)
    assert fl.description == "Flooring FL1 (4000x3000 mm)"
    assert sk.description == "Skirting FL1 (100 mm high)"
    assert fl.audit[0].clause_ref == "IS 1200 Part 11"
    assert fl.extra["finish"] == "600x600 vitrified tiles"
    assert fl.extra["bedding_mm"] == 20
    assert approx(fl.extra["area_sqft"], round(11.5 * SQFT_PER_M2, 2))


def test_flooring_explicit_skirting_length_and_count():
    m = Flooring(label="FL2", length_mm=4000, breadth_mm=3000, skirting_height_mm=100,
                 skirting_length_mm=10000, count=3)
    qs = _run(m)
    assert approx(_by_cat(qs, "flooring")[0].value, 36.0)
    assert approx(_by_cat(qs, "skirting")[0].value, 30.0)   # 10 m x 3


def test_flooring_no_skirting_when_height_zero():
    m = Flooring(label="FL3", length_mm=4000, breadth_mm=3000)
    qs = _run(m)
    assert len(qs) == 1 and qs[0].category == "flooring"


def test_flooring_deduct_exceeding_area_clamps_to_zero():
    m = Flooring(label="FL4", length_mm=1000, breadth_mm=1000, deduct_area_m2=5.0)
    q = _by_cat(_run(m), "flooring")[0]
    assert q.value == 0.0


def test_wall_tiling_deducts_opening_over_threshold():
    m = WallTiling(label="WT1", length_mm=3000, height_mm=2100,
                   openings=[Opening(width_mm=700, height_mm=1200)])
    q = _run(m)[0]
    assert q.category == "tiling" and q.unit == "m2"
    assert approx(q.value, 5.46)                             # 6.3 - 0.84
    assert approx(q.extra["deduct_openings_m2"], 0.84)
    assert q.audit[0].clause_ref == "IS 1200 Part 11"


def test_wall_tiling_ignores_small_opening():
    m = WallTiling(label="WT2", length_mm=3000, height_mm=2100,
                   openings=[Opening(width_mm=300, height_mm=300)])   # 0.09 <= 0.1
    q = _run(m)[0]
    assert approx(q.value, 6.3)
    assert q.extra["deduct_openings_m2"] == 0.0


def test_false_ceiling_with_cutout():
    m = FalseCeiling(label="FC1", length_mm=4000, breadth_mm=3000, cutout_area_m2=0.36)
    q = _run(m)[0]
    assert q.category == "ceiling" and q.unit == "m2"
    assert approx(q.value, 11.64)
    assert q.extra["ceiling_type"] == "gypsum"
    assert q.audit[0].clause_ref == "IS 1200 Part 12"


def test_false_ceiling_type_normalised_and_cove_in_extra():
    m = FalseCeiling(label="FC2", length_mm=4000, breadth_mm=3000, ceiling_type="pop",
                     cove_length_mm=12000, count=2)
    q = _run(m)[0]
    assert m.ceiling_type == "POP"
    assert approx(q.value, 24.0)
    assert q.extra["cove_length_mm"] == 12000


def test_painting_two_faces_deducts_large_opening():
    m = Painting(label="PT1", length_mm=4000, height_mm=3000, faces=2,
                 openings=[Opening(width_mm=1000, height_mm=2100, count=1)])
    q = _run(m)[0]
    assert q.category == "painting" and q.unit == "m2"
    assert approx(q.value, 19.8)                             # 24 - 2.1*2
    assert q.extra["coats"] == 2 and q.extra["paint_system"] == "acrylic emulsion"
    assert q.extra["surface"] == "internal"
    assert q.audit[0].clause_ref == "IS 1200 Part 15"


def test_painting_ignores_opening_at_or_below_half_m2():
    m = Painting(label="PT2", length_mm=4000, height_mm=3000, faces=2,
                 openings=[Opening(width_mm=600, height_mm=600)])   # 0.36 <= 0.5
    q = _run(m)[0]
    assert approx(q.value, 24.0)


def test_painting_external_surface_and_count():
    m = Painting(label="PT3", length_mm=10000, height_mm=6000, faces=1, count=4,
                 surface="External", coats=3, paint_system="exterior acrylic")
    q = _run(m)[0]
    assert m.surface == "external"
    assert approx(q.value, 240.0)
    assert q.extra["coats"] == 3


def test_door_window_count_and_area():
    m = DoorWindow(label="D1", width_mm=900, height_mm=2100, count=3)
    q = _run(m)[0]
    assert q.category == "doors_windows" and q.unit == "Nos"
    assert q.value == 3 and q.nos == 3
    assert approx(q.extra["area_m2"], 5.67)
    assert q.extra["size"] == "900x2100"
    assert q.extra["kind"] == "door"
    assert q.description == "Door D1 (900x2100 mm)"
    assert q.audit[0].clause_ref == "IS 1200 Part 21"


def test_door_window_kind_window():
    m = DoorWindow(label="W1", width_mm=1200, height_mm=1200, count=2, kind="window",
                   frame_material="aluminium", shutter_material="glazed sliding")
    q = _run(m)[0]
    assert q.description == "Window W1 (1200x1200 mm)"
    assert q.extra["frame_material"] == "aluminium"
    assert approx(q.extra["area_m2"], 2.88)


def test_waterproofing_with_upturn():
    m = Waterproofing(label="WP1", length_mm=5000, breadth_mm=4000, upturn_height_mm=300)
    q = _run(m)[0]
    assert q.category == "waterproofing" and q.unit == "m2"
    assert approx(q.value, 25.4)                             # 20 + 18*0.3
    assert approx(q.extra["upturn_area_m2"], 5.4)
    assert q.extra["treatment"] == "APP membrane 3 mm"
    assert q.audit[0].clause_ref == "IS 1200 Part 16"


def test_waterproofing_without_upturn():
    m = Waterproofing(label="WP2", length_mm=5000, breadth_mm=4000, count=2)
    q = _run(m)[0]
    assert approx(q.value, 40.0)


def test_railing_length_times_count():
    m = Railing(label="RL1", length_mm=3500, count=2)
    q = _run(m)[0]
    assert q.category == "railing" and q.unit == "m"
    assert approx(q.value, 7.0)
    assert q.extra["material"] == "MS" and q.extra["height_mm"] == 900
    assert q.audit[0].clause_ref == "IS 1200 Part 8"


def test_railing_material_normalised():
    m = Railing(label="RL2", length_mm=2000, height_mm=1100, material="ss")
    assert m.material == "SS"
    assert approx(_run(m)[0].value, 2.0)


# --------------------------------------------------------------------------- #
# Contract / wiring
# --------------------------------------------------------------------------- #
def test_registry_covers_every_schema_type_and_categories_order():
    assert {c.model_fields["member_type"].default for c in FINISHES_TYPES} == set(REGISTRY)
    assert [c for c, _ in CATEGORIES] == [
        "flooring", "skirting", "tiling", "ceiling", "painting", "doors_windows",
        "waterproofing", "railing",
    ]
    assert dict(CATEGORIES)["tiling"] == "Dado & Wall Tiling"
    assert set(finishes.UNITS) == set(dict(CATEGORIES)) == set(finishes.DEMO_RATES)


def test_every_quantity_carries_an_audit_step():
    samples = [
        Flooring(label="a", length_mm=1000, breadth_mm=1000, skirting_height_mm=100),
        WallTiling(label="b", length_mm=1000, height_mm=1000),
        FalseCeiling(label="c", length_mm=1000, breadth_mm=1000),
        Painting(label="d", length_mm=1000, height_mm=1000),
        DoorWindow(label="e", width_mm=900, height_mm=2100),
        Waterproofing(label="f", length_mm=1000, breadth_mm=1000),
        Railing(label="g", length_mm=1000),
    ]
    for m in samples:
        for q in _run(m):
            assert q.audit and q.audit[0].formula_id and q.audit[0].clause_ref
            assert q.audit[0].result == q.value


# --------------------------------------------------------------------------- #
# Validation: every required field must be named in the error
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("cls,kwargs,missing", [
    (Flooring, {"breadth_mm": 3000}, "length_mm"),
    (Flooring, {"length_mm": 4000}, "breadth_mm"),
    (WallTiling, {"height_mm": 2100}, "length_mm"),
    (WallTiling, {"length_mm": 3000}, "height_mm"),
    (FalseCeiling, {"breadth_mm": 3000}, "length_mm"),
    (FalseCeiling, {"length_mm": 4000}, "breadth_mm"),
    (Painting, {"height_mm": 3000}, "length_mm"),
    (Painting, {"length_mm": 4000}, "height_mm"),
    (DoorWindow, {"height_mm": 2100}, "width_mm"),
    (DoorWindow, {"width_mm": 900}, "height_mm"),
    (Waterproofing, {"breadth_mm": 4000}, "length_mm"),
    (Waterproofing, {"length_mm": 5000}, "breadth_mm"),
    (Railing, {}, "length_mm"),
])
def test_required_fields_are_named(cls, kwargs, missing):
    with pytest.raises(ValidationError) as ei:
        cls(label="x", **kwargs)
    assert missing in str(ei.value)


@pytest.mark.parametrize("cls,kwargs,field", [
    (Flooring, {"length_mm": 1, "breadth_mm": 1, "deduct_area_m2": -1}, "deduct_area_m2"),
    (Flooring, {"length_mm": 1, "breadth_mm": 1, "skirting_height_mm": -1}, "skirting_height_mm"),
    (FalseCeiling, {"length_mm": 1, "breadth_mm": 1, "cutout_area_m2": -1}, "cutout_area_m2"),
    (FalseCeiling, {"length_mm": 1, "breadth_mm": 1, "ceiling_type": "tin"}, "ceiling_type"),
    (Painting, {"length_mm": 1, "height_mm": 1, "faces": 0}, "faces"),
    (Painting, {"length_mm": 1, "height_mm": 1, "surface": "roof"}, "surface"),
    (DoorWindow, {"width_mm": 1, "height_mm": 1, "kind": "hatch"}, "kind"),
    (Waterproofing, {"length_mm": 1, "breadth_mm": 1, "upturn_height_mm": -5}, "upturn_height_mm"),
    (Railing, {"length_mm": 1, "material": "bamboo"}, "material"),
])
def test_range_and_choice_rules_are_named(cls, kwargs, field):
    with pytest.raises(ValidationError) as ei:
        cls(label="x", **kwargs)
    assert field in str(ei.value)


def test_empty_finish_is_kept_empty_not_defaulted():
    # An extractor that found no finishing schedule leaves finish "" on purpose.
    m = Flooring(label="FL", length_mm=1000, breadth_mm=1000, finish="")
    assert m.finish == ""
    assert _run(m)[0].extra["finish"] == ""
