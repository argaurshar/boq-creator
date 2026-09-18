"""Build the BOQ workbook with openpyxl. Mirrors frontend/src/engine/export.ts.

Sheets: Cost Abstract, BOQ (the seven-column contract with live Amount / SUM /
contingency formulas), Detailed Measurement (the nos/L/B/D basis behind every
line), Bar Bending Schedule, Steel Truss Details (when present), Material
Summary (when present), Outside Discipline (when anything was set aside) and
Assumptions.
"""
from __future__ import annotations

import io
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from ..engine.boqtable import BOQ_COLUMNS, group_serial, item_name_of, item_serial, spec_text_of
from ..engine.disciplines import discipline_info
from ..engine.material_takeoff import material_takeoff

HEADER_FILL = PatternFill("solid", fgColor="1F4E79")
SECTION_FILL = PatternFill("solid", fgColor="D9E1F2")
WHITE_BOLD = Font(bold=True, color="FFFFFF")
BOLD = Font(bold=True)
THIN = Side(style="thin", color="BBBBBB")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)

# The seven-column BOQ contract — identical headings, order and content to the
# on-screen table and the printed report. No Unit column: the unit rides on the
# Quantity cell as a number format, so the cell stays numeric and the Amount
# formula stays live.
COLUMNS = list(BOQ_COLUMNS)

# Detailed measurement lives on its own sheet, not as extra BOQ columns.
MEASURE_COLUMNS = ["Serial Number", "Item", "Description", "No.",
                   "L (m)", "B (m)", "D/H (m)", "Quantity", "Unit"]


def qty_format(unit: str) -> str:
    """Excel number format that renders the unit inside a numeric quantity cell."""
    u = str(unit or "").replace('"', "")
    return f'0.000" {u}"' if u else "0.000"


def contingency_pct(project: dict[str, Any]) -> float:
    """Contingency % carried by the caller (0 when unset)."""
    try:
        return max(0.0, float(project.get("contingency_pct") or 0))
    except (TypeError, ValueError):
        return 0.0


def build_workbook(project: dict[str, Any], boq: dict[str, Any]) -> bytes:
    wb = Workbook()
    _cost_abstract_sheet(wb, project, boq)
    _boq_sheet(wb, project, boq)
    _measurement_sheet(wb, boq)
    _bbs_sheet(wb, boq)
    _truss_sheet(wb, boq)
    _material_sheet(wb, boq)
    _out_of_scope_sheet(wb, boq)
    _assumptions_sheet(wb, project, boq)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _style_header(ws, row, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HEADER_FILL
        cell.font = WHITE_BOLD
        cell.alignment = CENTER
        cell.border = BORDER


def _discipline_line(boq) -> str:
    return f"Discipline: {discipline_info(boq.get('discipline'))['label']} take-off"


def _cost_abstract_sheet(wb, project, boq):
    ws = wb.active
    ws.title = "Cost Abstract"
    total = float(boq.get("grand_total") or 0)
    area = float(project.get("built_up_area_m2") or 0)
    pct = contingency_pct(project)
    grand = total * (1 + pct / 100)
    ws.append([f"Cost Abstract — {project.get('name', 'Project')}"])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append([_discipline_line(boq)])
    ws.append([])
    ws.append(["Category", "Amount", "Share %"])
    _style_header(ws, ws.max_row, 3)
    for g in boq["groups"]:
        share = round(g["subtotal"] / total * 100, 1) if total > 0 else 0
        ws.append([g["label"], _r(g["subtotal"]), share])
    ws.append([])
    if pct > 0:
        ws.append(["Sub-total", _r(total), ""])
        ws.append([f"Contingency {pct:g}%", _r(total * pct / 100), ""])
    ws.append(["GRAND TOTAL incl. contingency" if pct > 0 else "GRAND TOTAL", _r(grand), ""])
    ws.cell(row=ws.max_row, column=1).font = BOLD
    ws.cell(row=ws.max_row, column=2).font = BOLD
    if area:
        ws.append([f"Cost per m² (built-up {area:g} m²)", _r(grand / area), ""])
    _autosize(ws)


def _boq_sheet(wb, project, boq):
    ws = wb.create_sheet("BOQ")

    ws.append([f"Bill of Quantities — {project.get('name', 'Project')}"])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append([_discipline_line(boq)])
    ws.append([f"Client: {project.get('client', '')}    Location: {project.get('location', '')}"])
    meta2 = "    ".join(s for s in (
        f"Drawing ref: {project['drawing_ref']}" if project.get("drawing_ref") else "",
        f"Date: {project['report_date']}" if project.get("report_date") else "",
        f"Prepared by: {project['prepared_by']}" if project.get("prepared_by") else "",
        f"Built-up area: {project['built_up_area_m2']} m2" if project.get("built_up_area_m2") else "",
    ) if s)
    if meta2:
        ws.append([meta2])
    ws.append([])

    header_row = ws.max_row + 1
    ws.append(COLUMNS)
    _style_header(ws, header_row, len(COLUMNS))

    # Columns: A Serial Number | B Item | C Description | D Quantity | E Rate
    #          F Amount | G Specification
    subtotal_rows: list[int] = []
    for gi, group in enumerate(boq["groups"]):
        ws.append([group_serial(gi), group["label"]])
        sec_row = ws.max_row
        ws.cell(row=sec_row, column=1).font = BOLD
        ws.cell(row=sec_row, column=2).font = BOLD
        for c in range(1, len(COLUMNS) + 1):
            ws.cell(row=sec_row, column=c).fill = SECTION_FILL

        first = ws.max_row + 1
        for ii, it in enumerate(group["items"]):
            r = ws.max_row + 1
            ws.append([
                item_serial(gi, ii), item_name_of(it), it["description"],
                it["quantity"], it["rate"], None, spec_text_of(it),
            ])
            # live formula: Amount = Quantity * Rate; the unit rides on the
            # numeric Quantity cell as a number format ("5.400 m3").
            ws.cell(row=r, column=6).value = f"=D{r}*E{r}"
            ws.cell(row=r, column=4).number_format = qty_format(it.get("unit", ""))
            for c in range(1, len(COLUMNS) + 1):
                ws.cell(row=r, column=c).border = BORDER
        last = ws.max_row

        sub_r = ws.max_row + 1
        ws.append(["", "", f"Sub-total — {group['label']}", "", "", None, ""])
        if last >= first:
            ws.cell(row=sub_r, column=6).value = f"=SUM(F{first}:F{last})"
        ws.cell(row=sub_r, column=3).font = BOLD
        ws.cell(row=sub_r, column=6).font = BOLD
        subtotal_rows.append(sub_r)

    ws.append([])
    ws.append(["", "", "GRAND TOTAL", "", "", None, ""])
    gt = ws.max_row
    ws.cell(row=gt, column=3).font = Font(bold=True, size=12)
    if subtotal_rows:
        gtcell = ws.cell(row=gt, column=6, value="=" + "+".join(f"F{r}" for r in subtotal_rows))
        gtcell.font = Font(bold=True, size=12)
    # Contingency rides on top as live formulas, so the workbook total matches
    # the screen and stays editable.
    pct = contingency_pct(project)
    if pct > 0:
        ws.append(["", "", f"Contingency {pct:g}%", "", "", None, ""])
        c_row = ws.max_row
        ws.cell(row=c_row, column=6, value=f"=F{gt}*{pct:g}/100")
        ws.append(["", "", "GRAND TOTAL incl. contingency", "", "", None, ""])
        ws.cell(row=ws.max_row, column=3).font = Font(bold=True, size=12)
        ws.cell(row=ws.max_row, column=6, value=f"=F{gt}+F{c_row}").font = Font(bold=True, size=12)

    for col, w in zip("ABCDEFG", (14, 30, 52, 16, 12, 16, 46)):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = f"A{header_row + 1}"


def _measurement_sheet(wb, boq):
    """Detailed measurement — the nos / L / B / D basis behind every BOQ line."""
    ws = wb.create_sheet("Detailed Measurement")
    ws.append(["Detailed Measurement — basis of every BOQ line"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([])
    ws.append(MEASURE_COLUMNS)
    _style_header(ws, ws.max_row, len(MEASURE_COLUMNS))
    for gi, group in enumerate(boq["groups"]):
        ws.append([group_serial(gi), group["label"]])
        ws.cell(row=ws.max_row, column=1).font = BOLD
        ws.cell(row=ws.max_row, column=2).font = BOLD
        for ii, it in enumerate(group["items"]):
            ws.append([
                item_serial(gi, ii), item_name_of(it), it["description"], it.get("nos"),
                _r(it.get("length_m")), _r(it.get("breadth_m")), _r(it.get("depth_m")),
                _r(it["quantity"]), it.get("unit", ""),
            ])
    _autosize(ws)


def _bbs_sheet(wb, boq):
    ws = wb.create_sheet("Bar Bending Schedule")
    cols = ["Member", "Bar Mark", "Dia (mm)", "No.", "Cutting Length (m)",
            "Unit Wt (kg/m)", "Total Wt (kg)"]
    ws.append(cols)
    _style_header(ws, 1, len(cols))
    found = False
    for group in boq["groups"]:
        if group["category"] != "rebar":
            continue
        for it in group["items"]:
            for row in (it.get("extra") or {}).get("bbs", []) or []:
                found = True
                ws.append([
                    it["description"], row.get("mark"), row.get("dia_mm"),
                    row.get("count"), row.get("cutting_length_m"),
                    row.get("unit_weight_kg_m"), row.get("total_weight_kg"),
                ])
    if not found:
        ws.append(["No reinforcement members yet."])
    _autosize(ws)


def _truss_sheet(wb, boq):
    rows = [
        [it["description"], s.get("component"), s.get("designation"),
         _r(s.get("length_m")), s.get("count"), _r(s.get("weight_kg"))]
        for group in boq["groups"] if group["category"] == "steel"
        for it in group["items"]
        for s in (it.get("extra") or {}).get("truss_segments", []) or []
    ]
    if not rows:
        return
    ws = wb.create_sheet("Steel Truss Details")
    cols = ["Truss", "Component", "Section", "Length (m)", "No.", "Weight (kg)"]
    ws.append(cols)
    _style_header(ws, 1, len(cols))
    for r in rows:
        ws.append(r)
    _autosize(ws)


def _material_sheet(wb, boq):
    sections = material_takeoff(boq)
    if not sections:
        return
    ws = wb.create_sheet("Material Summary")
    ws.append(["Material Summary (indicative — verify mixes)"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([])
    for s in sections:
        ws.append([s["title"]])
        ws.cell(row=ws.max_row, column=1).font = BOLD
        ws.append(["Material", "Qty", "Unit"])
        for r in s["rows"]:
            ws.append([r["material"], r["qty"], r["unit"]])
        ws.append([])
    _autosize(ws)


def _out_of_scope_sheet(wb, boq):
    """Out-of-scope register — read but not measured because another discipline
    owns them. A hand-over workbook must state what it does not cover."""
    oos = boq.get("out_of_scope") or []
    if not oos:
        return
    ws = wb.create_sheet("Outside Discipline")
    ws.append([f"Outside This Discipline — {discipline_info(boq.get('discipline'))['label']} take-off"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([f"{len(oos)} element(s) read from the drawings but not measured here"])
    ws.append([])
    ws.append(["Label", "Element type", "Reason"])
    _style_header(ws, ws.max_row, 3)
    for o in oos:
        ws.append([o.get("label"), o.get("member_type"), o.get("reason")])
    for col, w in zip("ABC", (18, 20, 80)):
        ws.column_dimensions[col].width = w


def _assumptions_sheet(wb, project, boq):
    ws = wb.create_sheet("Assumptions")
    ws.append(["Assumptions & Basis of Measurement"])
    ws["A1"].font = Font(bold=True, size=13)
    label = discipline_info(boq.get("discipline"))["label"]
    rows = [
        ["Standards", "IS 1200 (measurement), IS 456 (RCC), IS 800/SP6 (steel), SP 34 (detailing)"],
        ["Rebar unit weight", "d^2 / 162 kg/m"],
        ["Lap length (tension)", "50 x dia (configurable)"],
        ["Masonry opening deduction", "openings > 0.1 m2 (IS 1200)"],
        ["Plaster opening deduction", "openings > 0.5 m2 (IS 1200)"],
        ["Reinforcement in concrete", "no deduction"],
        ["Currency", project.get("currency", "INR")],
        ["Discipline", f"{label} take-off — elements of other disciplines are listed on the "
                       "'Outside Discipline' sheet, not measured"],
        ["Contingency", f"{contingency_pct(project):g}%"],
        ["Note", "AI-assisted draft — quantities must be engineer-verified before use."],
    ]
    for k, v in rows:
        ws.append([k, v])
        ws.cell(row=ws.max_row, column=1).font = BOLD
    if boq.get("errors"):
        ws.append([])
        ws.append(["Notes & coverage check"])
        ws.cell(row=ws.max_row, column=1).font = BOLD
        for e in boq["errors"]:
            ws.append(["Coverage" if e.get("coverage") else (e.get("label") or "Note"),
                       e.get("error", "")])
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 70


def _r(v):
    return round(v, 3) if isinstance(v, (int, float)) else v


def _autosize(ws):
    for col in ws.columns:
        width = 10
        letter = get_column_letter(col[0].column)
        for cell in col:
            if cell.value is not None:
                width = max(width, min(len(str(cell.value)) + 2, 55))
        ws.column_dimensions[letter].width = width
