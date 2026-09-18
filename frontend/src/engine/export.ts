// BOQ workbook export via SheetJS. Ported from backend/app/export/xlsx.py.
// Sheets: BOQ (with live Amount = Quantity*Rate and SUM formulas), Bar Bending
// Schedule, Assumptions. (Cell styling is simplified vs the Python/openpyxl
// build; the data, columns and live formulas are identical.)
import * as XLSX from "xlsx";
import { Boq } from "./boq";
import { pyRound } from "./units";
import { materialTakeoff } from "./takeoff";
import { groupSerial, itemSerial, itemNameOf, specTextOf } from "./boqtable";
import { disciplineInfo } from "./disciplines";

/** Contingency % persisted on the project (0 when unset). */
const contingencyPct = (project: any) => Math.max(0, Number(project?.contingency_pct) || 0);

// The seven-column BOQ contract — identical headings, order and content to the
// on-screen table and the printed report. No Unit column: the unit rides on the
// Quantity cell as a number format, so the cell stays numeric and the Amount
// formula stays live.
const COLUMNS = ["Serial Number", "Item", "Description", "Quantity", "Rate", "Amount", "Specification"];

// Detailed measurement lives on its own sheet, not as extra BOQ columns.
const MEASURE_COLUMNS = ["Serial Number", "Item", "Description", "No.",
  "L (m)", "B (m)", "D/H (m)", "Quantity", "Unit"];

/** Excel number format that renders the unit inside a numeric quantity cell. */
function qtyFormat(unit: string): string {
  const u = String(unit || "").replace(/"/g, "");
  return u ? `0.000" ${u}"` : "0.000";
}

const r3 = (v: any) => (typeof v === "number" ? pyRound(v, 3) : v ?? null);

function addr(row: number, col: number): string {
  return XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
}

function boqSheet(project: any, boq: Boq): XLSX.WorkSheet {
  const aoa: any[][] = [];
  const formulas: { row: number; col: number; f: string; v: number }[] = [];

  aoa.push([`Bill of Quantities — ${project.name || "Project"}`]);
  aoa.push([`Discipline: ${disciplineInfo(boq.discipline).label} take-off`]);
  aoa.push([`Client: ${project.client || ""}    Location: ${project.location || ""}`]);
  const meta2 = [
    project.drawing_ref ? `Drawing ref: ${project.drawing_ref}` : "",
    project.report_date ? `Date: ${project.report_date}` : "",
    project.prepared_by ? `Prepared by: ${project.prepared_by}` : "",
    project.built_up_area_m2 ? `Built-up area: ${project.built_up_area_m2} m2` : "",
  ].filter(Boolean).join("    ");
  if (meta2) aoa.push([meta2]);
  aoa.push([]);
  aoa.push([...COLUMNS]);
  const headerRow = aoa.length;

  // Columns: A Serial Number | B Item | C Description | D Quantity | E Rate
  //          F Amount | G Specification
  const subtotalRows: number[] = [];
  const qtyCells: { row: number; unit: string }[] = [];
  for (let gi = 0; gi < boq.groups.length; gi++) {
    const group = boq.groups[gi];
    aoa.push([groupSerial(gi), group.label]);
    const first = aoa.length + 1;
    for (let ii = 0; ii < group.items.length; ii++) {
      const it = group.items[ii];
      aoa.push([
        itemSerial(gi, ii), itemNameOf(it), it.description,
        it.quantity, it.rate, null, specTextOf(it),
      ]);
      const r = aoa.length;
      qtyCells.push({ row: r, unit: it.unit });
      formulas.push({ row: r, col: 6, f: `D${r}*E${r}`, v: it.amount });
    }
    const last = aoa.length;
    aoa.push(["", "", `Sub-total — ${group.label}`, "", "", null, ""]);
    const subR = aoa.length;
    if (last >= first) formulas.push({ row: subR, col: 6, f: `SUM(F${first}:F${last})`, v: group.subtotal });
    subtotalRows.push(subR);
  }

  aoa.push([]);
  aoa.push(["", "", "GRAND TOTAL", "", "", null, ""]);
  const gtRow = aoa.length;
  if (subtotalRows.length) {
    formulas.push({ row: gtRow, col: 6, f: subtotalRows.map((r) => `F${r}`).join("+"), v: boq.grand_total });
  }
  // Contingency rides on top as live formulas, so the workbook total matches
  // the screen and stays editable.
  const contPct = contingencyPct(project);
  if (contPct > 0) {
    aoa.push(["", "", `Contingency ${contPct}%`, "", "", null, ""]);
    const cRow = aoa.length;
    formulas.push({ row: cRow, col: 6, f: `F${gtRow}*${contPct}/100`, v: boq.grand_total * contPct / 100 });
    aoa.push(["", "", "GRAND TOTAL incl. contingency", "", "", null, ""]);
    formulas.push({ row: aoa.length, col: 6, f: `F${gtRow}+F${cRow}`, v: boq.grand_total * (1 + contPct / 100) });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Write value + formula so the Amount column is populated even in viewers
  // that don't recalc, and SheetJS persists the formula on write.
  for (const { row, col, f, v } of formulas) ws[addr(row, col)] = { t: "n", f, v };
  // The unit rides on the numeric Quantity cell as a number format, so the cell
  // stays a number (keeping D*E live) while still reading "5.400 m3".
  for (const { row, unit } of qtyCells) {
    const cell = ws[addr(row, 4)];
    if (cell) cell.z = qtyFormat(unit);
  }
  ws["!cols"] = [{ wch: 14 }, { wch: 30 }, { wch: 52 }, { wch: 16 },
    { wch: 12 }, { wch: 16 }, { wch: 46 }];
  ws["!freeze"] = { xSplit: 0, ySplit: headerRow };
  return ws;
}

/** Detailed measurement — the nos / L / B / D basis behind every BOQ line.
 *  Lives here rather than as extra columns on the BOQ sheet. */
function measurementSheet(boq: Boq): XLSX.WorkSheet {
  const aoa: any[][] = [["Detailed Measurement"], [], [...MEASURE_COLUMNS]];
  for (let gi = 0; gi < boq.groups.length; gi++) {
    const group = boq.groups[gi];
    aoa.push([groupSerial(gi), group.label]);
    for (let ii = 0; ii < group.items.length; ii++) {
      const it = group.items[ii];
      aoa.push([
        itemSerial(gi, ii), itemNameOf(it), it.description, it.nos,
        r3(it.length_m), r3(it.breadth_m), r3(it.depth_m), it.quantity, it.unit,
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 14 }, { wch: 28 }, { wch: 46 }, { wch: 8 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 8 }];
  return ws;
}

function bbsSheet(boq: Boq): XLSX.WorkSheet {
  const cols = ["Member", "Bar Mark", "Dia (mm)", "No.", "Cutting Length (m)",
    "Unit Wt (kg/m)", "Total Wt (kg)"];
  const aoa: any[][] = [cols];
  let found = false;
  for (const group of boq.groups) {
    if (group.category !== "rebar") continue;
    for (const it of group.items) {
      for (const row of (it.extra?.bbs as any[]) || []) {
        found = true;
        aoa.push([it.description, row.mark, row.dia_mm, row.count,
          row.cutting_length_m, row.unit_weight_kg_m, row.total_weight_kg]);
      }
    }
  }
  if (!found) aoa.push(["No reinforcement members yet."]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c) => ({ wch: Math.max(12, c.length + 2) }));
  return ws;
}

// Per-segment breakdown for every truss (rafter / tie / strut / vertical …).
// Returns null when there are no trusses, so the sheet is only added when useful.
function trussSheet(boq: Boq): XLSX.WorkSheet | null {
  const cols = ["Truss", "Component", "Section", "Length (m)", "No. / truss",
    "Weight (kg)", "Basis"];
  const aoa: any[][] = [cols];
  let found = false;
  for (const group of boq.groups) {
    if (group.category !== "steel") continue;
    for (const it of group.items) {
      const segs = (it.extra?.truss_segments as any[]) || [];
      if (!segs.length) continue;
      found = true;
      for (const s of segs) {
        aoa.push([it.description, s.component, s.designation,
          r3(s.length_m), s.count, pyRound(s.weight_kg, 2), s.basis]);
      }
      if (it.extra?.per_truss_kg != null) {
        aoa.push(["", "", "", "", "Per truss:", pyRound(it.extra.per_truss_kg, 2), ""]);
      }
    }
  }
  if (!found) return null;
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c, i) => ({ wch: i === 0 ? 28 : Math.max(12, c.length + 2) }));
  return ws;
}

function costAbstractSheet(project: any, boq: Boq): XLSX.WorkSheet {
  const total = boq.grand_total || 0;
  const area = Number(project.built_up_area_m2) || 0;
  const contPct = contingencyPct(project);
  const grand = total * (1 + contPct / 100);
  const aoa: any[][] = [[`Cost Abstract — ${project.name || "Project"}`],
    [`Discipline: ${disciplineInfo(boq.discipline).label} take-off`], []];
  aoa.push(["Category", "Amount", "Share %"]);
  for (const g of boq.groups) {
    const pct = total > 0 ? pyRound((g.subtotal / total) * 100, 1) : 0;
    aoa.push([g.label, r3(g.subtotal), pct]);
  }
  aoa.push([]);
  if (contPct > 0) {
    aoa.push(["Sub-total", r3(total), ""]);
    aoa.push([`Contingency ${contPct}%`, r3(total * contPct / 100), ""]);
  }
  aoa.push([contPct > 0 ? "GRAND TOTAL incl. contingency" : "GRAND TOTAL", r3(grand), ""]);
  if (area) aoa.push([`Cost per m² (built-up ${area} m²)`, r3(grand / area), ""]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 10 }];
  return ws;
}

function materialSheet(boq: Boq): XLSX.WorkSheet | null {
  const sections = materialTakeoff(boq);
  if (!sections.length) return null;
  const aoa: any[][] = [["Material Summary (indicative — verify mixes)"], []];
  for (const s of sections) {
    aoa.push([s.title]);
    aoa.push(["Material", "Qty", "Unit"]);
    for (const r of s.rows) aoa.push([r.material, r.qty, r.unit]);
    aoa.push([]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 8 }];
  return ws;
}

function assumptionsSheet(project: any, boq: Boq): XLSX.WorkSheet {
  const aoa: any[][] = [["Assumptions & Basis of Measurement"]];
  const rows: [string, string][] = [
    ["Standards", "IS 1200 (measurement), IS 456 (RCC), IS 800/SP6 (steel), SP 34 (detailing)"],
    ["Rebar unit weight", "d^2 / 162 kg/m"],
    ["Lap length (tension)", "50 x dia (configurable)"],
    ["Masonry opening deduction", "openings > 0.1 m2 (IS 1200)"],
    ["Plaster opening deduction", "openings > 0.5 m2 (IS 1200)"],
    ["Reinforcement in concrete", "no deduction"],
    ["Currency", project.currency || "INR"],
    ["Discipline", `${disciplineInfo(boq.discipline).label} take-off — elements of other disciplines are listed on the 'Outside Discipline' sheet, not measured`],
    ["Contingency", `${contingencyPct(project)}%`],
    ["Note", "AI-assisted draft — quantities must be engineer-verified before use."],
  ];
  for (const kv of rows) aoa.push(kv);
  if (boq.errors && boq.errors.length) {
    aoa.push([]);
    aoa.push(["Notes & coverage check"]);
    for (const e of boq.errors)
      aoa.push([e.coverage ? "Coverage" : (e.label || "Note"), e.error || ""]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 26 }, { wch: 70 }];
  return ws;
}

/** Out-of-scope register — read but not measured because another discipline
 *  owns them. A hand-over workbook must state what it does not cover. */
function outOfScopeSheet(boq: Boq): XLSX.WorkSheet | null {
  const oos = boq.out_of_scope || [];
  if (!oos.length) return null;
  const aoa: any[][] = [[`Outside This Discipline — ${disciplineInfo(boq.discipline).label} take-off`],
    [`${oos.length} element(s) read from the drawings but not measured here`], [],
    ["Label", "Element type", "Reason"]];
  for (const o of oos) aoa.push([o.label, o.member_type, o.reason]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 18 }, { wch: 20 }, { wch: 80 }];
  return ws;
}

export function downloadBoqXlsx(project: any, boq: Boq): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, costAbstractSheet(project, boq), "Cost Abstract");
  XLSX.utils.book_append_sheet(wb, boqSheet(project, boq), "BOQ");
  XLSX.utils.book_append_sheet(wb, measurementSheet(boq), "Detailed Measurement");
  XLSX.utils.book_append_sheet(wb, bbsSheet(boq), "Bar Bending Schedule");
  const trusses = trussSheet(boq);
  if (trusses) XLSX.utils.book_append_sheet(wb, trusses, "Steel Truss Details");
  const materials = materialSheet(boq);
  if (materials) XLSX.utils.book_append_sheet(wb, materials, "Material Summary");
  const oos = outOfScopeSheet(boq);
  if (oos) XLSX.utils.book_append_sheet(wb, oos, "Outside Discipline");
  XLSX.utils.book_append_sheet(wb, assumptionsSheet(project, boq), "Assumptions");
  const fname = `BOQ_${String(project.name || "Project").replace(/ /g, "_")}.xlsx`;
  XLSX.writeFile(wb, fname);
}
