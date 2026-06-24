"""End-to-end API smoke test using the deterministic mock provider (no API key)."""
import os

os.environ.setdefault("BOQ_DB_URL", "sqlite:///./test_boq.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def _new_project():
    r = client.post("/api/projects", json={"name": "Test Tower", "client": "ACME"})
    assert r.status_code == 200
    return r.json()["id"]


def test_health():
    assert client.get("/api/health").json()["status"] == "ok"


def test_manual_member_and_boq():
    pid = _new_project()
    r = client.post(f"/api/projects/{pid}/members", json={
        "member_type": "column", "label": "C1", "b_mm": 300, "D_mm": 600,
        "height_mm": 3000, "count": 4,
        "main_bars": [{"dia_mm": 16, "count": 8}],
        "ties": {"dia_mm": 8, "legs": 2, "spacing_mm": 150},
    })
    assert r.status_code == 200

    boq = client.get(f"/api/projects/{pid}/boq").json()
    cats = {g["category"] for g in boq["groups"]}
    assert {"concrete", "formwork", "rebar"} <= cats
    conc = next(g for g in boq["groups"] if g["category"] == "concrete")
    # 0.54 m3 per column * 4 = 2.16
    assert abs(conc["items"][0]["quantity"] - 2.16) < 0.01


def test_nl_edit_flow():
    pid = _new_project()
    r = client.post(f"/api/projects/{pid}/nl-edit",
                    json={"text": "add 5 columns 300x600 3m high with 8-16mm bars M25"})
    body = r.json()
    assert body["result"]["op"] == "add"
    assert body["preview"]["member"]["member_type"] == "column"
    assert body["preview"]["member"]["count"] == 5

    applied = client.post(f"/api/projects/{pid}/nl-edit/apply",
                          json={"member": body["result"]["member"]})
    assert applied.status_code == 200
    assert len(client.get(f"/api/projects/{pid}/members").json()) == 1


def test_nl_bars_not_confused_with_section_dims():
    # Regression: "300x600" must not be mis-read as 300 bars of 600 mm dia.
    pid = _new_project()
    r = client.post(f"/api/projects/{pid}/nl-edit",
                    json={"text": "add column 300x600 3m high with 8-16mm bars M25"})
    m = r.json()["result"]["member"]
    assert m["b_mm"] == 300 and m["D_mm"] == 600
    assert m["main_bars"] == [{"dia_mm": 16, "count": 8}]


def test_nl_delete_is_not_silently_added():
    # Regression: a "delete" command must not be parsed into an add op.
    pid = _new_project()
    r = client.post(f"/api/projects/{pid}/nl-edit", json={"text": "delete C1"})
    assert r.json()["result"]["op"] == "noop"


def test_unknown_rate_category_rejected():
    pid = _new_project()
    r = client.post(f"/api/projects/{pid}/rates", json={"category": "concret", "rate": 5})
    assert r.status_code == 422


def test_rates_and_amounts():
    pid = _new_project()
    client.post(f"/api/projects/{pid}/members", json={
        "member_type": "footing", "label": "F1", "length_mm": 2000,
        "breadth_mm": 2000, "depth_mm": 400, "count": 1})
    client.post(f"/api/projects/{pid}/rates", json={"category": "concrete", "rate": 6000})
    boq = client.get(f"/api/projects/{pid}/boq").json()
    conc = next(g for g in boq["groups"] if g["category"] == "concrete")
    # 1.6 m3 * 6000 = 9600
    assert abs(conc["items"][0]["amount"] - 9600.0) < 1.0
    assert boq["grand_total"] >= 9600.0


def test_excel_export():
    pid = _new_project()
    client.post(f"/api/projects/{pid}/members", json={
        "member_type": "brick_wall", "label": "W1", "length_mm": 3000,
        "height_mm": 3000, "thickness_mm": 230, "count": 1})
    r = client.get(f"/api/projects/{pid}/export/xlsx")
    assert r.status_code == 200
    assert r.content[:2] == b"PK"  # xlsx is a zip
