// The BOQ table contract.
//
// Exactly seven columns, in exactly this order, with exactly these headings,
// on screen, in the PDF and in every spreadsheet sheet carrying BOQ lines:
//
//   Serial Number | Item | Description | Quantity | Rate | Amount | Specification
//
// There is NO separate Unit column — the unit travels inside the Quantity cell
// and stays in the row data model so exports and charts can use it
// programmatically. Everything else (member mark, sheet reference, formula,
// nos/L/B/D) is row metadata reachable by drill-down, never an eighth column.
import type { BoqItem } from "./boq";
import { packItemNoun, packSpecText } from "./packs";

export const BOQ_COLUMNS = [
  "Serial Number", "Item", "Description", "Quantity", "Rate", "Amount", "Specification",
] as const;

/** Hierarchical serial: group 1 -> "1", its items -> "1.1", "1.2", ... */
export function groupSerial(groupIndex: number): string {
  return String(groupIndex + 1);
}
export function itemSerial(groupIndex: number, itemIndex: number): string {
  return `${groupIndex + 1}.${itemIndex + 1}`;
}

// Short trade name per member type, used to build the Item cell.
const TYPE_NOUN: Record<string, string> = {
  footing: "Footings",
  column: "Columns",
  beam: "Beams",
  slab: "Slabs",
  rcc_wall: "RCC Walls",
  pcc: "PCC / Lean Concrete",
  brick_wall: "Brickwork",
  plaster_surface: "Plaster",
  earthwork_pit: "Excavation",
  steel_member: "Structural Steel",
  truss: "Steel Truss",
  anchor_bolt: "Anchor Bolts",
  roof_sheeting: "Roof Sheeting",
};

// Category fallbacks when the member type is unknown.
const CATEGORY_NOUN: Record<string, string> = {
  earthwork: "Earthwork",
  concrete: "Concrete",
  formwork: "Formwork",
  rebar: "Reinforcement Steel",
  steel: "Structural Steel",
  masonry: "Brickwork",
  plaster: "Plaster",
  roofing: "Roof Sheeting",
};

/**
 * The Item cell: the short trade name plus only those attributes that change
 * the rate (grade, thickness class). Deliberately NOT the full description.
 * e.g. "RCC M25 — Columns", "Formwork — Footings", "Excavation".
 */
export function itemNameOf(it: BoqItem): string {
  // Rows a pack type emits into a secondary category (e.g. a flooring member's
  // skirting line) take their noun from the category, not the member.
  if (it.category === "skirting") return "Skirting";
  const noun = TYPE_NOUN[it.member_type] || packItemNoun(it)
    || CATEGORY_NOUN[it.category] || it.category;
  const grade = String(it.extra?.grade || "").trim();
  switch (it.category) {
    case "concrete":
      // PCC carries its own mix in the grade slot; RCC gets the "RCC" prefix.
      return it.member_type === "pcc"
        ? (grade ? `PCC ${grade}` : "PCC / Lean Concrete")
        : `RCC ${grade || ""} — ${noun}`.replace(/\s+—/, " —").replace("RCC  —", "RCC —");
    case "formwork":
      return `Formwork — ${noun}`;
    case "rebar":
      return grade ? `Reinforcement ${grade}` : "Reinforcement Steel";
    case "steel":
      return noun;
    case "masonry":
      return noun;
    case "plaster":
      return noun;
    case "earthwork":
      return noun;
    case "roofing":
      return noun;
    default:
      return noun;
  }
}

/**
 * The Specification cell: grade, mix, cover, make, finish, class — the text a
 * tender document carries alongside the measured item. Built only from values
 * the engine actually recorded; never invented.
 */
export function specTextOf(it: BoqItem): string {
  const fromPack = packSpecText(it);
  if (fromPack) return fromPack;
  const e = it.extra || {};
  const bits: string[] = [];
  const push = (v: any, fmt: (x: any) => string) => {
    if (v !== undefined && v !== null && String(v).trim() !== "") bits.push(fmt(v));
  };

  switch (it.category) {
    case "concrete":
      push(e.grade, (g) => `Concrete grade ${g}`);
      push(e.cover_mm, (c) => `clear cover ${c} mm`);
      break;
    case "formwork":
      bits.push("Shuttering to concrete faces, including props, removal and cleaning");
      break;
    case "rebar":
      push(e.steel_grade || e.grade, (g) => `Reinforcement ${g}`);
      push(e.bar_dia_mm, (d) => `${d} mm dia`);
      if (!bits.length) bits.push("HYSD reinforcement, cut, bent and placed");
      break;
    case "steel":
      push(e.designation, (d) => `Section ${d}`);
      push(e.steel_grade, (g) => `Grade ${g}`);
      push(e.connection_pct, (p) => `${p}% gusset/connection allowance`);
      break;
    case "masonry":
      push(e.mortar, (m) => `Mortar ${m}`);
      push(e.thickness_mm, (t) => `${t} mm thick`);
      if (!bits.length) bits.push("Brick/block masonry in cement mortar");
      break;
    case "plaster":
      push(e.thickness_mm, (t) => `${t} mm thick`);
      push(e.mortar, (m) => `cement mortar ${m}`);
      push(e.faces, (f) => `${f} face(s)`);
      break;
    case "earthwork":
      push(e.soil_class, (s) => `Soil class ${s}`);
      if (!bits.length) bits.push("Excavation in ordinary soil, including lead and lift");
      break;
    case "roofing":
      push(e.sheet_type, (s) => `${s} sheeting`);
      push(e.lap_pct, (l) => `${l}% lap allowance`);
      break;
  }
  return bits.join(", ");
}

/** The Quantity cell: value and unit together, no separate Unit column. */
export function qtyCell(it: BoqItem): string {
  return `${fmtQty(it.quantity)} ${it.unit}`;
}

export function fmtQty(q: number): string {
  if (!isFinite(q)) return "—";
  const decimals = Math.abs(q) >= 1000 ? 2 : 3;
  return q.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
