"""All HTTP endpoints for BOQ Creator.

Thin layer: validate input, call services/engine/AI, return JSON. The member is
the source of truth; the BOQ is always computed on demand. See project.md §5.
"""
from __future__ import annotations

import base64
import os
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import services
from ..ai import get_provider
from ..config import settings
from ..db import get_db
from ..engine.compute import CATEGORY_ORDER
from ..export.xlsx import build_workbook
from ..models import ChatMessage, Drawing, Member, Project, Rate

router = APIRouter(prefix="/api")


# --------------------------------------------------------------------------- #
# DTOs
# --------------------------------------------------------------------------- #
class ProjectIn(BaseModel):
    name: str = "Untitled Project"
    client: str = ""
    location: str = ""
    currency: str = "INR"


class RateIn(BaseModel):
    category: str
    rate: float
    unit: str = ""
    description: str = ""


class NlIn(BaseModel):
    text: str


class ScaleIn(BaseModel):
    scale: str


def _project_dict(p: Project) -> dict[str, Any]:
    return {"id": p.id, "name": p.name, "client": p.client,
            "location": p.location, "currency": p.currency}


def _get_project(db: Session, pid: int) -> Project:
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


def _rate_map(db: Session, pid: int) -> dict[str, float]:
    return {r.category: r.rate for r in db.query(Rate).filter_by(project_id=pid)}


# --------------------------------------------------------------------------- #
# Projects
# --------------------------------------------------------------------------- #
@router.post("/projects")
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    p = Project(**body.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return _project_dict(p)


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    return [_project_dict(p) for p in db.query(Project).order_by(Project.id.desc())]


@router.get("/projects/{pid}")
def get_project(pid: int, db: Session = Depends(get_db)):
    return _project_dict(_get_project(db, pid))


@router.patch("/projects/{pid}")
def update_project(pid: int, body: ProjectIn, db: Session = Depends(get_db)):
    p = _get_project(db, pid)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    return _project_dict(p)


# --------------------------------------------------------------------------- #
# Drawings
# --------------------------------------------------------------------------- #
@router.post("/projects/{pid}/drawings")
async def upload_drawing(pid: int, file: UploadFile, db: Session = Depends(get_db)):
    _get_project(db, pid)
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    # Never trust the client filename for a path — strip any directory parts.
    safe_name = os.path.basename(file.filename or "upload.pdf")
    path = os.path.join(settings.UPLOAD_DIR, f"{uuid.uuid4().hex}_{safe_name}")
    with open(path, "wb") as f:
        f.write(await file.read())

    pages, is_vector, scales = 0, True, {}
    try:
        from ..pdf import loader
        pages = loader.page_count(path)
        first = loader.render_page(path, 1)
        is_vector = first.is_vector
        for n in range(1, pages + 1):
            txt = loader.render_page(path, n).text
            scales[str(n)] = loader.detect_scale(txt)
    except Exception as exc:  # pragma: no cover - depends on PyMuPDF wheel
        scales = {"error": str(exc)}

    d = Drawing(project_id=pid, filename=file.filename, storage_path=path,
                page_count=pages, is_vector=is_vector, scale_per_page=scales,
                status="uploaded")
    db.add(d)
    db.commit()
    db.refresh(d)
    return _drawing_dict(d)


def _drawing_dict(d: Drawing) -> dict[str, Any]:
    return {"id": d.id, "project_id": d.project_id, "filename": d.filename,
            "page_count": d.page_count, "is_vector": d.is_vector,
            "scale_per_page": d.scale_per_page, "status": d.status}


@router.get("/drawings/{did}")
def get_drawing(did: int, db: Session = Depends(get_db)):
    d = db.get(Drawing, did)
    if not d:
        raise HTTPException(404, "Drawing not found")
    return _drawing_dict(d)


@router.get("/drawings/{did}/pages/{n}/image")
def page_image(did: int, n: int, db: Session = Depends(get_db)):
    d = db.get(Drawing, did)
    if not d:
        raise HTTPException(404, "Drawing not found")
    from ..pdf import loader
    page = loader.render_page(d.storage_path, n)
    return Response(content=base64.b64decode(page.image_b64), media_type="image/png")


@router.post("/drawings/{did}/pages/{n}/scale")
def set_scale(did: int, n: int, body: ScaleIn, db: Session = Depends(get_db)):
    d = db.get(Drawing, did)
    if not d:
        raise HTTPException(404, "Drawing not found")
    scales = dict(d.scale_per_page or {})
    scales[str(n)] = body.scale
    d.scale_per_page = scales
    db.commit()
    return _drawing_dict(d)


@router.post("/drawings/{did}/pages/{n}/extract")
def extract_page(did: int, n: int, db: Session = Depends(get_db)):
    d = db.get(Drawing, did)
    if not d:
        raise HTTPException(404, "Drawing not found")
    project = _get_project(db, d.project_id)
    from ..pdf import loader
    page = loader.render_page(d.storage_path, n)
    scale = (d.scale_per_page or {}).get(str(n)) or "unknown"
    provider = get_provider()
    result = provider.extract_members(
        page_no=n, page_text=page.text, page_image_b64=page.image_b64,
        scale=scale,
        context={"concrete_grade": "M25", "cover_mm": 40, "currency": project.currency},
    )

    saved, rejected = [], []
    for raw in result.get("members", []):
        raw.setdefault("source", "ai")
        try:
            m = services.validate_member(raw)
        except Exception as exc:
            rejected.append({"raw": raw, "error": str(exc)})
            continue
        row = Member(project_id=project.id, drawing_id=did, member_type=m.member_type,
                     label=m.label, params=m.model_dump(), source="ai",
                     confidence=m.confidence, is_verified=False)
        db.add(row)
        saved.append(row)
    db.commit()
    return {"provider": provider.name, "saved": len(saved),
            "rejected": rejected, "unresolved": result.get("unresolved", [])}


# --------------------------------------------------------------------------- #
# Members
# --------------------------------------------------------------------------- #
def _member_dict(row: Member) -> dict[str, Any]:
    return {"id": row.id, "member_type": row.member_type, "label": row.label,
            "params": row.params, "source": row.source,
            "confidence": row.confidence, "is_verified": row.is_verified}


@router.get("/projects/{pid}/members")
def list_members(pid: int, db: Session = Depends(get_db)):
    _get_project(db, pid)
    rows = db.query(Member).filter_by(project_id=pid).order_by(Member.id)
    return [_member_dict(r) for r in rows]


@router.post("/projects/{pid}/members")
def add_member(pid: int, body: dict[str, Any], db: Session = Depends(get_db)):
    _get_project(db, pid)
    body.setdefault("source", "manual")
    try:
        m = services.validate_member(body)
    except Exception as exc:
        raise HTTPException(422, f"Invalid member: {exc}")
    row = Member(project_id=pid, member_type=m.member_type, label=m.label,
                 params=m.model_dump(), source=m.source, confidence=m.confidence,
                 is_verified=(m.source == "manual"))
    db.add(row)
    db.commit()
    db.refresh(row)
    return _member_dict(row)


@router.patch("/members/{mid}")
def update_member(mid: int, body: dict[str, Any], db: Session = Depends(get_db)):
    row = db.get(Member, mid)
    if not row:
        raise HTTPException(404, "Member not found")
    # When the type changes, don't merge stale type-specific fields from the old
    # member — validate the new body on its own.
    if body.get("member_type") and body["member_type"] != row.member_type:
        merged = body
    else:
        merged = {**row.params, **body}
    try:
        m = services.validate_member(merged)
    except Exception as exc:
        raise HTTPException(422, f"Invalid member: {exc}")
    row.params = m.model_dump()
    row.label = m.label
    row.member_type = m.member_type
    db.commit()
    return _member_dict(row)


@router.delete("/members/{mid}")
def delete_member(mid: int, db: Session = Depends(get_db)):
    row = db.get(Member, mid)
    if not row:
        raise HTTPException(404, "Member not found")
    db.delete(row)
    db.commit()
    return {"deleted": mid}


@router.post("/members/{mid}/verify")
def verify_member(mid: int, db: Session = Depends(get_db)):
    row = db.get(Member, mid)
    if not row:
        raise HTTPException(404, "Member not found")
    row.is_verified = True
    db.commit()
    return _member_dict(row)


# --------------------------------------------------------------------------- #
# BOQ + export
# --------------------------------------------------------------------------- #
@router.get("/projects/{pid}/boq")
def get_boq(pid: int, db: Session = Depends(get_db)):
    _get_project(db, pid)
    rows = db.query(Member).filter_by(project_id=pid).order_by(Member.id).all()
    return services.build_boq(rows, _rate_map(db, pid))


@router.get("/projects/{pid}/export/xlsx")
def export_xlsx(pid: int, db: Session = Depends(get_db)):
    p = _get_project(db, pid)
    rows = db.query(Member).filter_by(project_id=pid).order_by(Member.id).all()
    boq = services.build_boq(rows, _rate_map(db, pid))
    data = build_workbook(_project_dict(p), boq)
    fname = f"BOQ_{p.name.replace(' ', '_')}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# --------------------------------------------------------------------------- #
# Rates
# --------------------------------------------------------------------------- #
DEFAULT_UNITS = {"earthwork": "m3", "concrete": "m3", "formwork": "m2",
                 "rebar": "kg", "steel": "kg", "masonry": "m3", "plaster": "m2"}


@router.get("/projects/{pid}/rates")
def list_rates(pid: int, db: Session = Depends(get_db)):
    _get_project(db, pid)
    existing = {r.category: r for r in db.query(Rate).filter_by(project_id=pid)}
    out = []
    for cat, label in CATEGORY_ORDER:
        r = existing.get(cat)
        out.append({"category": cat, "label": label,
                    "unit": DEFAULT_UNITS.get(cat, ""),
                    "rate": r.rate if r else 0.0})
    return out


@router.post("/projects/{pid}/rates")
def set_rate(pid: int, body: RateIn, db: Session = Depends(get_db)):
    _get_project(db, pid)
    known = {c for c, _ in CATEGORY_ORDER}
    if body.category not in known:
        # Reject typos that would otherwise store a rate the BOQ never applies.
        raise HTTPException(422, f"Unknown category '{body.category}'. "
                                 f"Expected one of: {sorted(known)}")
    r = db.query(Rate).filter_by(project_id=pid, category=body.category).first()
    if r:
        r.rate = body.rate
    else:
        r = Rate(project_id=pid, category=body.category, rate=body.rate,
                 unit=body.unit or DEFAULT_UNITS.get(body.category, ""),
                 description=body.description)
        db.add(r)
    db.commit()
    return {"category": body.category, "rate": body.rate}


# --------------------------------------------------------------------------- #
# Natural-language edit (propose -> apply)
# --------------------------------------------------------------------------- #
@router.post("/projects/{pid}/nl-edit")
def nl_edit(pid: int, body: NlIn, db: Session = Depends(get_db)):
    p = _get_project(db, pid)
    provider = get_provider()
    result = provider.parse_nl_edit(
        text=body.text, context={"currency": p.currency, "default_grade": "M25"})

    preview = None
    if result.get("op") == "add" and result.get("member"):
        try:
            m = services.validate_member(result["member"])
            from ..engine.compute import compute_member
            preview = {
                "member": m.model_dump(),
                "quantities": [q.to_dict() for q in compute_member(m)],
            }
        except Exception as exc:
            result["op"] = "noop"
            result["message"] = f"Parsed but invalid: {exc}"

    db.add(ChatMessage(project_id=pid, role="user", content=body.text))
    db.add(ChatMessage(project_id=pid, role="assistant",
                       content=result.get("message", ""), proposed=result))
    db.commit()
    return {"provider": provider.name, "result": result, "preview": preview}


@router.post("/projects/{pid}/nl-edit/apply")
def nl_edit_apply(pid: int, body: dict[str, Any], db: Session = Depends(get_db)):
    _get_project(db, pid)
    member = body.get("member")
    if not member:
        raise HTTPException(422, "No member to apply")
    if not isinstance(member, dict):
        raise HTTPException(422, "member must be an object")
    member.setdefault("source", "nl")
    try:
        m = services.validate_member(member)
    except Exception as exc:
        raise HTTPException(422, f"Invalid member: {exc}")
    row = Member(project_id=pid, member_type=m.member_type, label=m.label or "NL",
                 params=m.model_dump(), source="nl", confidence=m.confidence,
                 is_verified=False)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _member_dict(row)


# --------------------------------------------------------------------------- #
# Demo seed — populate a representative multi-category BOQ in one click
# --------------------------------------------------------------------------- #
_DEMO_MEMBERS: list[dict[str, Any]] = [
    {"member_type": "earthwork_pit", "label": "E1", "length_mm": 2000,
     "breadth_mm": 2000, "depth_mm": 1500, "count": 4, "working_offset_mm": 150,
     "contains_labels": ["F1", "PCC1"]},   # backfill nets footing + PCC volume
    {"member_type": "pcc", "label": "PCC1", "length_mm": 2000, "breadth_mm": 2000,
     "thickness_mm": 100, "count": 4},
    {"member_type": "footing", "label": "F1", "length_mm": 2000, "breadth_mm": 2000,
     "depth_mm": 400, "count": 4, "mesh_bottom_x": {"dia_mm": 12, "spacing_mm": 150},
     "mesh_bottom_y": {"dia_mm": 12, "spacing_mm": 150}},
    {"member_type": "column", "label": "C1", "b_mm": 300, "D_mm": 600,
     "height_mm": 3000, "count": 4, "main_bars": [{"dia_mm": 16, "count": 8}],
     "ties": {"dia_mm": 8, "legs": 2, "spacing_mm": 150}},
    {"member_type": "beam", "label": "B1", "b_mm": 230, "depth_mm": 450,
     "clear_span_mm": 4500, "count": 6,
     "top_bars": [{"dia_mm": 16, "count": 2}],
     "bottom_bars": [{"dia_mm": 16, "count": 3}],
     "stirrups": {"dia_mm": 8, "legs": 2, "spacing_mm": 150}},
    {"member_type": "slab", "label": "S1", "length_mm": 4500, "breadth_mm": 4000,
     "thickness_mm": 125, "count": 1,
     "main_bars": {"dia_mm": 10, "spacing_mm": 150},
     "dist_bars": {"dia_mm": 8, "spacing_mm": 200}},
    {"member_type": "brick_wall", "label": "W1", "length_mm": 4500, "height_mm": 3000,
     "thickness_mm": 230, "count": 4,
     "openings": [{"width_mm": 1000, "height_mm": 2100, "count": 1}],
     "embedded_labels": ["C1"]},           # brickwork nets embedded column RCC
    {"member_type": "plaster_surface", "label": "P1", "length_mm": 4500,
     "height_mm": 3000, "faces": 2, "thickness_mm": 12, "count": 4,
     "openings": [{"width_mm": 1000, "height_mm": 2100, "count": 1}]},
    {"member_type": "steel_member", "label": "ST1", "designation": "ISMB300",
     "length_mm": 6000, "count": 8},
]

_DEMO_RATES = {"earthwork": 350, "concrete": 6500, "formwork": 450, "rebar": 75,
               "steel": 90, "masonry": 6000, "plaster": 280}


@router.post("/projects/{pid}/seed")
def seed_demo(pid: int, db: Session = Depends(get_db)):
    """Populate the project with a representative G+0 frame so reviewers can see
    a full multi-category BOQ + Excel export without uploading a drawing."""
    _get_project(db, pid)
    added = 0
    for raw in _DEMO_MEMBERS:
        m = services.validate_member({**raw, "source": "manual"})
        db.add(Member(project_id=pid, member_type=m.member_type, label=m.label,
                      params=m.model_dump(), source="manual", confidence=1.0,
                      is_verified=True))
        added += 1
    for cat, rate in _DEMO_RATES.items():
        if not db.query(Rate).filter_by(project_id=pid, category=cat).first():
            db.add(Rate(project_id=pid, category=cat, rate=rate,
                        unit=DEFAULT_UNITS.get(cat, "")))
    db.commit()
    return {"seeded_members": added}