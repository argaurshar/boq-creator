// BOQ workbook export via SheetJS. Ported from backend/app/export/xlsx.py.
// Sheets: BOQ (with live Amount = Quantity*Rate and SUM formulas), Bar Bending
// Schedule, Assumptions. (Cell styling is simplified vs the Python/openpyxl
// build; the data, columns and live formulas are identical.)
import * as XLSX from "xlsx";
import { Boq } from "./boq";
import { pyRound } from "./units";
import { materialTakeoff } from "./takeoff";

const COLUMNS = ["Item", "Description", "No.", "L (m)", "B (m)", "D/H (m)",
  "Quantity", "Unit", "Rate (INR)", "Amount (INR)"];

const r3 = (v: any) => (typeof v === "number" ? pyRound(v, 3) : v ?? null);

function addr(row: number, col: number): string {
  return XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
}

function boqSheet(project: any, boq: Boq): XLSX.WorkSheet {
  const aoa: any[][] = [];
  const formulas: { row: number; col: number; f: string; v: number }[] = [];

  aoa.push([`Bill of Quantities — ${project.name || "Project"}`]);
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

  const subtotalRows: number[] = [];
  let itemNo = 0;
  for (const group of boq.groups) {
    aoa.push([group.label]);
    const first = aoa.length + 1;
    for (const it of group.items) {
      itemNo += 1;
      aoa.push([
        itemNo, it.description, it.nos,
        r3(it.length_m), r3(it.breadth_m), r3(it.depth_m),
        it.quantity, it.unit, it.rate, null,
      ]);
      const r = aoa.length;
      formulas.push({ row: r, col: 10, f: `G${r}*I${r}`, v: it.amount });
    }
    const last = aoa.length;
    aoa.push(["", `Sub-total — ${group.label}`, "", "", "", "", "", "", "", null]);
    const subR = aoa.length;
    if (last >= first) formulas.push({ row: subR, col: 10, f: `SUM(J${first}:J${last})`, v: group.subtotal });
    subtotalRows.push(subR);
  }

  aoa.push([]);
  aoa.push(["", "GRAND TOTAL", "", "", "", "", "", "", "", null]);
  const gtRow = aoa.length;
  if (subtotalRows.length) {
    formulas.push({ row: gtRow, col: 10, f: subtotalRows.map((r) => `J${r}`).join("+"), v: boq.grand_total });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Write value + formula so the Amount column is populated even in viewers
  // that don't recalc, and SheetJS persists the formula on write.
  for (const { row, col, f, v } of formulas) ws[addr(row, col)] = { t: "n", f, v };
  ws["!cols"] = COLUMNS.map((c, i) => ({ wch: i === 1 ? 46 : Math.max(10, c.length + 2) }));
  ws["!freeze"] = { xSplit: 0, ySplit: headerRow };
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
  const aoa: any[][] = [[`Cost Abstract — ${project.name || "Project"}`], []];
  aoa.push(["Category", "Amount", "Share %"]);
  for (const g of boq.groups) {
    const pct = total > 0 ? pyRound((g.subtotal / total) * 100, 1) : 0;
    aoa.push([g.label, r3(g.subtotal), pct]);
  }
  aoa.push([]);
  aoa.push(["GRAND TOTAL", r3(total), ""]);
  if (area) aoa.push([`Cost per m² (built-up ${area} m²)`, r3(total / area), ""]);
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

export function downloadBoqXlsx(project: any, boq: Boq): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, costAbstractSheet(project, boq), "Cost Abstract");
  XLSX.utils.book_append_sheet(wb, boqSheet(project, boq), "BOQ");
  XLSX.utils.book_append_sheet(wb, bbsSheet(boq), "Bar Bending Schedule");
  const trusses = trussSheet(boq);
  if (trusses) XLSX.utils.book_append_sheet(wb, trusses, "Steel Truss Details");
  const materials = materialSheet(boq);
  if (materials) XLSX.utils.book_append_sheet(wb, materials, "Material Summary");
  XLSX.utils.book_append_sheet(wb, assumptionsSheet(project, boq), "Assumptions");
  const fname = `BOQ_${String(project.name || "Project").replace(/ /g, "_")}.xlsx`;
  XLSX.writeFile(wb, fname);
}
