// BOQ workbook export via SheetJS. Ported from backend/app/export/xlsx.py.
// Sheets: BOQ (with live Amount = Quantity*Rate and SUM formulas), Bar Bending
// Schedule, Assumptions. (Cell styling is simplified vs the Python/openpyxl
// build; the data, columns and live formulas are identical.)
import * as XLSX from "xlsx";
import { Boq } from "./boq";
import { pyRound } from "./units";

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
    aoa.push(["Unresolved members"]);
    for (const e of boq.errors) aoa.push([e.label || "", e.error || ""]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 26 }, { wch: 70 }];
  return ws;
}

export function downloadBoqXlsx(project: any, boq: Boq): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, boqSheet(project, boq), "BOQ");
  XLSX.utils.book_append_sheet(wb, bbsSheet(boq), "Bar Bending Schedule");
  XLSX.utils.book_append_sheet(wb, assumptionsSheet(project, boq), "Assumptions");
  const fname = `BOQ_${String(project.name || "Project").replace(/ /g, "_")}.xlsx`;
  XLSX.writeFile(wb, fname);
}
