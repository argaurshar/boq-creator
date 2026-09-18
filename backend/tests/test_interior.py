"""Golden-number and validation tests for the interior fit-out pack.

The goldens here are the same ones the TS module is proven against in the node
parity script; SQFT_PER_M2 = 10.7639 and values are asserted before rounding.
"""
import math

import pytest
from pydantic import TypeAdapter, ValidationError

from app.engine import interior as eng
from app.schemas.interior_schema import (
    HEIGHT_GATE, INTERIOR_TYPES, ElectricalPoint, Glazing, Joinery,
    LooseFurniture, SanitaryFixture,
)


def approx(a, b, tol=1e-4):
    return math.isclose(a, b, rel_tol=tol, abs_tol=tol)


def run(m):
    out = []
    for fn in eng.REGISTRY[m.member_type]:
        out.extend(fn(m))
    return out


def validate(raw):
    """Validate through the pack's own union — what the integrator adds to Member."""
    return TypeAdapter(INTERIOR_TYPES[0] | INTERIOR_TYPES[1] | INTERIOR_TYPES[2]
                       | INTERIOR_TYPES[3] | INTERIOR_TYPES[4]).validate_python(raw)


# ------------------------------------------------------------------ goldens
def test_joinery_golden():
    m = Joinery(label="JN1", width_mm=2400, height_mm=2400, count=1)
    q = run(m)[0]
    assert q.category == "joinery" and q.unit == "sqft"
    assert approx(q.extra["area_m2"], 5.76)
    assert approx(q.value, 62.0000)
    assert q.value == 2.4 * 2.4 * 1 * 10.7639  # bit-identical formula order
    assert q.description == "Joinery JN1 (2400x2400 mm)"
    assert q.audit[0].formula_id == "interior.joinery.area"
    assert q.audit[0].clause_ref == "Trade practice — front elevation area"
    # spec attributes travel in extra for the Specification cell
    assert q.extra["joinery_type"] == "wardrobe"
    assert q.extra["carcass"] == "BWP ply 18 mm"
    assert q.extra["shutter_finish"] == "laminate 1 mm"
    assert q.extra["hardware"] == "soft-close, SS"


def test_joinery_count_multiplies():
    m = Joinery(label="JN1", width_mm=2400, height_mm=2400, count=2, depth_mm=600)
    q = run(m)[0]
    assert approx(q.value, 124.000128)
    assert approx(q.extra["area_m2"], 11.52)
    assert q.nos == 2 and q.extra["depth_mm"] == 600


def test_glazing_golden():
    m = Glazing(label="GL1", width_mm=1200, height_mm=1800, count=2)
    q = run(m)[0]
    assert q.category == "glazing" and q.unit == "sqft"
    assert approx(q.extra["area_m2"], 4.32)
    assert approx(q.value, 46.5000)
    assert q.value == 1.2 * 1.8 * 2 * 10.7639
    assert q.extra["kind"] == "mirror" and q.extra["glass_type"] == "6 mm mirror"
    assert q.audit[0].clause_ref == "Trade practice"


def test_loose_furniture_golden():
    q = run(LooseFurniture(label="LF1", count=4))[0]
    assert q.category == "furniture" and q.unit == "Nos"
    assert q.value == 4 and q.nos == 4
    assert q.extra == {"item": "3-seater sofa", "finish": "fabric"}
    assert q.description == "Loose furniture LF1 (3-seater sofa)"


def test_sanitary_fixture_golden():
    q = run(SanitaryFixture(label="SN1", count=6, make="Jaquar"))[0]
    assert q.category == "sanitary" and q.unit == "Nos"
    assert q.value == 6
    assert q.extra == {"fixture": "WC", "make": "Jaquar"}
    assert q.audit[0].clause_ref == "IS 1200 Part 16"


def test_electrical_point_golden():
    q = run(ElectricalPoint(label="EP1", count=24, point_type="16A socket"))[0]
    assert q.category == "services" and q.unit == "Nos"
    assert q.value == 24
    assert q.extra == {"point_type": "16A socket"}
    assert q.audit[0].clause_ref == "IS 1200 Part 18"
    assert q.description == "Electrical point EP1 (16A socket)"


# --------------------------------------------------------------- hard gate
def test_joinery_without_height_is_gated():
    with pytest.raises(ValidationError) as ei:
        Joinery(label="JN1", width_mm=3000)
    msg = str(ei.value)
    assert "height_mm is required" in msg
    assert "Never assume 2100" in msg
    assert HEIGHT_GATE in msg


@pytest.mark.parametrize("height", [None, ""])
def test_joinery_blank_height_is_gated(height):
    with pytest.raises(ValidationError, match="height_mm is required"):
        Joinery(label="JN1", width_mm=3000, height_mm=height)


def test_glazing_without_height_is_gated():
    with pytest.raises(ValidationError) as ei:
        Glazing(label="GL1", width_mm=1200)
    assert "height_mm is required" in str(ei.value)
    assert "Never assume 2100" in str(ei.value)


def test_gate_applies_through_the_union():
    with pytest.raises(ValidationError, match="Never assume 2100"):
        validate({"member_type": "joinery", "label": "JN1", "width_mm": 3000, "depth_mm": 600})


def test_joinery_3000x600_layout_read_is_not_an_engine_error():
    # A wardrobe read off a layout (width x depth as height) is a wrong *read*,
    # not something the engine can detect — the gate is only on a missing height.
    q = run(Joinery(label="JN1", width_mm=3000, height_mm=600))[0]
    assert approx(q.value, 1.8 * 10.7639)


# ------------------------------------------------------------- required rules
def test_joinery_width_required():
    with pytest.raises(ValidationError, match="width_mm"):
        Joinery(label="JN1", height_mm=2400)


def test_joinery_width_must_be_positive():
    with pytest.raises(ValidationError, match="width_mm"):
        Joinery(label="JN1", width_mm=0, height_mm=2400)


def test_joinery_height_must_be_positive():
    with pytest.raises(ValidationError, match="height_mm"):
        Joinery(label="JN1", width_mm=2400, height_mm=-5)


def test_joinery_depth_non_negative():
    with pytest.raises(ValidationError, match="depth_mm"):
        Joinery(label="JN1", width_mm=2400, height_mm=2400, depth_mm=-1)


def test_glazing_width_required():
    with pytest.raises(ValidationError, match="width_mm"):
        Glazing(label="GL1", height_mm=1800)


@pytest.mark.parametrize("cls", [LooseFurniture, SanitaryFixture, ElectricalPoint])
def test_count_zero_rejected(cls):
    with pytest.raises(ValidationError, match="count"):
        cls(label="X", count=0)


@pytest.mark.parametrize("cls", [LooseFurniture, SanitaryFixture, ElectricalPoint])
def test_count_required(cls):
    with pytest.raises(ValidationError, match="count"):
        cls(label="X")


@pytest.mark.parametrize("cls", [LooseFurniture, SanitaryFixture, ElectricalPoint])
def test_count_blank_string_rejected(cls):
    with pytest.raises(ValidationError, match="count"):
        cls(label="X", count="")


def test_joinery_count_zero_rejected():
    with pytest.raises(ValidationError, match="count"):
        Joinery(label="JN1", width_mm=2400, height_mm=2400, count=0)


# ------------------------------------------------------------ choices / text
def test_choice_normalisation():
    assert Joinery(width_mm=1, height_mm=1, joinery_type="Kitchen Base").joinery_type == "kitchen_base"
    assert Joinery(width_mm=1, height_mm=1, joinery_type="TV Unit").joinery_type == "tv_unit"
    assert SanitaryFixture(count=1, fixture="washbasin").fixture == "wash basin"
    assert SanitaryFixture(count=1, fixture="wc").fixture == "WC"
    assert ElectricalPoint(count=1, point_type="16 A Socket").point_type == "16A socket"
    assert Glazing(width_mm=1, height_mm=1, kind="Window Film").kind == "window_film"


def test_bad_choice_rejected():
    with pytest.raises(ValidationError, match="joinery_type"):
        Joinery(width_mm=1, height_mm=1, joinery_type="cupboard")
    with pytest.raises(ValidationError, match="point_type"):
        ElectricalPoint(count=1, point_type="geyser")
    with pytest.raises(ValidationError, match="fixture"):
        SanitaryFixture(count=1, fixture="bathtub")
    with pytest.raises(ValidationError, match="kind"):
        Glazing(width_mm=1, height_mm=1, kind="louvre")


def test_blank_strings_fall_back_to_defaults():
    m = Joinery(width_mm=1, height_mm=1, joinery_type="", carcass="", shutter_finish=None, hardware="  ")
    assert (m.joinery_type, m.carcass, m.shutter_finish, m.hardware) == (
        "wardrobe", "BWP ply 18 mm", "laminate 1 mm", "soft-close, SS")
    lf = LooseFurniture(count=1, item="", finish=None)
    assert (lf.item, lf.finish) == ("3-seater sofa", "fabric")
    assert Glazing(width_mm=1, height_mm=1, glass_type="").glass_type == "6 mm mirror"


def test_blank_depth_and_count_use_defaults():
    m = Joinery(width_mm=2400, height_mm=2400, depth_mm="", count="")
    assert m.depth_mm == 0 and m.count == 1


# ---------------------------------------------------------------- contract
def test_registry_and_categories_contract():
    assert list(eng.REGISTRY) == [
        "joinery", "glazing", "loose_furniture", "sanitary_fixture", "electrical_point"]
    assert [c.model_fields["member_type"].default for c in INTERIOR_TYPES] == list(eng.REGISTRY)
    assert eng.CATEGORIES == [
        ("joinery", "Joinery & Panelling"),
        ("furniture", "Loose Furniture"),
        ("glazing", "Glass & Mirrors"),
        ("sanitary", "Sanitary & CP Fittings"),
        ("services", "Electrical Points"),
    ]
    assert eng.SQFT_PER_M2 == 10.7639
    assert eng.UNITS == {"joinery": "sqft", "furniture": "Nos", "glazing": "sqft",
                         "sanitary": "Nos", "services": "Nos"}
    assert eng.DEMO_RATES == {"joinery": 1450, "furniture": 25000, "glazing": 650,
                              "sanitary": 12000, "services": 850}


def test_every_quantity_carries_an_audit_step():
    members = [
        Joinery(label="JN1", width_mm=2400, height_mm=2400),
        Glazing(label="GL1", width_mm=1200, height_mm=1800),
        LooseFurniture(label="LF1", count=1),
        SanitaryFixture(label="SN1", count=1),
        ElectricalPoint(label="EP1", count=1),
    ]
    for m in members:
        for q in run(m):
            assert len(q.audit) == 1
            s = q.audit[0]
            assert s.formula_id.startswith("interior.")
            assert s.expression and s.inputs and s.clause_ref
            assert s.result == q.value
            assert q.to_dict()["rounded"] is not None
