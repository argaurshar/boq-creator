// Finishes pack (Architecture; several types reused by Interior).
// Mirrors backend/app/engine/finishes.py + finishes_schema.py — kept numerically
// identical so the static build produces the same quantities as the Python API.
//
// Types: flooring, wall_tiling, false_ceiling, painting, door_window,
//        waterproofing, railing.   All linear inputs in mm.
// Units out: m2 / m / Nos (sqft is carried alongside every area in extra).
import type { Member, Opening } from "./members";
import { Quantity, mmToM, pyRound, qty, step, fmt0 } from "./units";

export const SQFT_PER_M2 = 10.7639;

// IS 1200 deduction thresholds (m2) for this pack.
const TILING_OPENING_DEDUCT_THRESHOLD = 0.1;    // IS 1200 Part 11
const PAINTING_OPENING_DEDUCT_THRESHOLD = 0.5;  // IS 1200 Part 15

const CLAUSE_TILING = "IS 1200 Part 11";
const CLAUSE_CEILING = "IS 1200 Part 12";
const CLAUSE_PAINTING = "IS 1200 Part 15";
const CLAUSE_WATERPROOFING = "IS 1200 Part 16";
const CLAUSE_DOORS = "IS 1200 Part 21";
const CLAUSE_RAILING = "IS 1200 Part 8";

export const TYPES: string[] = [
  "flooring", "wall_tiling", "false_ceiling", "painting", "door_window",
  "waterproofing", "railing",
];

export const CEILING_TYPES = ["gypsum", "POP", "grid", "wood"];
export const PAINT_SURFACES = ["internal", "external"];
export const OPENING_KINDS = ["door", "window", "ventilator"];
export const RAILING_MATERIALS = ["MS", "SS", "glass", "wood"];

// --------------------------------------------------------------------------- //
// Private validation helpers (copied from members.ts — not exported there)
// --------------------------------------------------------------------------- //
function num(raw: any, key: string, opts: { required?: boolean; gt0?: boolean; ge0?: boolean; def?: number; int?: boolean } = {}): number | null {
  let v = raw?.[key];
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new Error(`Field '${key}' is required`);
    return opts.def ?? null;
  }
  v = Number(v);
  if (!isFinite(v)) throw new Error(`Field '${key}' must be a number`);
  if (opts.gt0 && !(v > 0)) throw new Error(`Field '${key}' must be > 0`);
  if (opts.ge0 && !(v >= 0)) throw new Error(`Field '${key}' must be >= 0`);
  if (opts.int && v !== Math.trunc(v)) throw new Error(`Field '${key}' must be a whole number`);
  return v;
}

function openings(raw: any): Opening[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) throw new Error("openings must be a list");
  return raw.map((o) => ({
    width_mm: num(o, "width_mm", { required: true })!,
    height_mm: num(o, "height_mm", { required: true })!,
    count: Math.trunc(num(o, "count", { int: true, def: 1 })!),
  }));
}

// Free-text spec field: absent -> default; present (even "") -> kept as written,
// so an AI that found no finishing schedule can leave it empty on purpose.
function text(raw: any, key: string, def: string): string {
  const v = raw?.[key];
  return v === undefined || v === null ? def : String(v).trim();
}

// Enumerated field: matched case-insensitively to the canonical option.
function choice(raw: any, key: string, options: string[], def: string): string {
  const v = raw?.[key];
  if (v === undefined || v === null || String(v).trim() === "") return def;
  const s = String(v).trim().toLowerCase();
  const hit = options.find((o) => o.toLowerCase() === s);
  if (!hit) throw new Error(`Field '${key}' must be one of: ${options.join(", ")}`);
  return hit;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// --------------------------------------------------------------------------- //
// Validators: (raw, base) -> Member.  base = the common fields validateMember
// already built (member_type, label, count, grades, cover, source, ...).
// --------------------------------------------------------------------------- //
export const validators: Record<string, (raw: any, base: Member) => Member> = {
  flooring: (raw, base) => ({
    ...base,
    length_mm: num(raw, "length_mm", { required: true })!,
    breadth_mm: num(raw, "breadth_mm", { required: true })!,
    deduct_area_m2: num(raw, "deduct_area_m2", { ge0: true, def: 0 })!,
    skirting_height_mm: num(raw, "skirting_height_mm", { ge0: true, def: 0 })!,
    skirting_length_mm: num(raw, "skirting_length_mm", { ge0: true, def: 0 })!,
    finish: text(raw, "finish", "600x600 vitrified tiles"),
    bedding_mm: num(raw, "bedding_mm", { ge0: true, def: 20 })!,
  }),
  wall_tiling: (raw, base) => ({
    ...base,
    length_mm: num(raw, "length_mm", { required: true })!,
    height_mm: num(raw, "height_mm", { required: true })!,
    openings: openings(raw.openings),
    finish: text(raw, "finish", "300x600 ceramic tiles"),
  }),
  false_ceiling: (raw, base) => ({
    ...base,
    length_mm: num(raw, "length_mm", { required: true })!,
    breadth_mm: num(raw, "breadth_mm", { required: true })!,
    cutout_area_m2: num(raw, "cutout_area_m2", { ge0: true, def: 0 })!,
    ceiling_type: choice(raw, "ceiling_type", CEILING_TYPES, "gypsum"),
    cove_length_mm: num(raw, "cove_length_mm", { ge0: true, def: 0 })!,
  }),
  painting: (raw, base) => ({
    ...base,
    length_mm: num(raw, "length_mm", { required: true })!,
    height_mm: num(raw, "height_mm", { required: true })!,
    faces: Math.trunc(num(raw, "faces", { int: true, gt0: true, def: 1 })!),
    openings: openings(raw.openings),
    coats: Math.trunc(num(raw, "coats", { int: true, gt0: true, def: 2 })!),
    paint_system: text(raw, "paint_system", "acrylic emulsion"),
    surface: choice(raw, "surface", PAINT_SURFACES, "internal"),
  }),
  door_window: (raw, base) => ({
    ...base,
    width_mm: num(raw, "width_mm", { required: true })!,
    height_mm: num(raw, "height_mm", { required: true })!,
    kind: choice(raw, "kind", OPENING_KINDS, "door"),
    frame_material: text(raw, "frame_material", "hardwood"),
    shutter_material: text(raw, "shutter_material", "flush shutter"),
  }),
  waterproofing: (raw, base) => ({
    ...base,
    length_mm: num(raw, "length_mm", { required: true })!,
    breadth_mm: num(raw, "breadth_mm", { required: true })!,
    upturn_height_mm: num(raw, "upturn_height_mm", { ge0: true, def: 0 })!,
    treatment: text(raw, "treatment", "APP membrane 3 mm"),
  }),
  railing: (raw, base) => ({
    ...base,
    length_mm: num(raw, "length_mm", { required: true })!,
    height_mm: num(raw, "height_mm", { ge0: true, def: 900 })!,
    material: choice(raw, "material", RAILING_MATERIALS, "MS"),
  }),
};

// --------------------------------------------------------------------------- //
// Engine functions (pure, deterministic)
// --------------------------------------------------------------------------- //
export function flooring(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), B = mmToM(m.breadth_mm);
  const n = m.count;
  const deduct = m.deduct_area_m2 ?? 0;
  const area = Math.max(L * B - deduct, 0.0) * n;
  const out: Quantity[] = [qty({
    category: "flooring",
    description: `Flooring ${m.label} (${fmt0(m.length_mm)}x${fmt0(m.breadth_mm)} mm)`.trim(),
    unit: "m2", value: area, nos: n, length_m: L, breadth_m: B,
    audit: [step("flooring.area", "max(L*B - deduct_area_m2, 0) * count",
      { L_m: L, B_m: B, deduct_area_m2: deduct, count: n }, area, CLAUSE_TILING)],
    extra: {
      finish: m.finish, bedding_mm: m.bedding_mm, deduct_area_m2: deduct,
      area_sqft: pyRound(area * SQFT_PER_M2, 2),
    },
  })];

  const h = m.skirting_height_mm ?? 0;
  if (h > 0) {
    // Explicit skirting run if given, else the room perimeter 2(L+B).
    const skl = (m.skirting_length_mm ?? 0) > 0 ? mmToM(m.skirting_length_mm) : 2 * (L + B);
    const len = skl * n;
    out.push(qty({
      category: "skirting",
      description: `Skirting ${m.label} (${fmt0(h)} mm high)`.trim(),
      unit: "m", value: len, nos: n, length_m: skl, depth_m: mmToM(h),
      audit: [step("flooring.skirting", "(skirting_length_mm>0 ? skirting_length : 2*(L+B)) * count",
        { L_m: L, B_m: B, skirting_length_m: skl, skirting_height_mm: h, count: n }, len, CLAUSE_TILING)],
      extra: { finish: m.finish, skirting_height_mm: h, skirting_length_mm: skl * 1000.0 },
    }));
  }
  return out;
}

export function wall_tiling(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), H = mmToM(m.height_mm);
  const n = m.count;
  const gross = L * H;
  let deduct = 0.0;
  for (const op of m.openings || []) {
    const area = mmToM(op.width_mm) * mmToM(op.height_mm);
    if (area > TILING_OPENING_DEDUCT_THRESHOLD) deduct += area * op.count;
  }
  const net = Math.max(gross - deduct, 0.0) * n;
  return [qty({
    category: "tiling",
    description: `Wall tiling ${m.label} (${fmt0(m.length_mm)}x${fmt0(m.height_mm)} mm)`.trim(),
    unit: "m2", value: net, nos: n, length_m: L, depth_m: H,
    audit: [step("tiling.area", "(L*H - openings(>0.1m2)) * count",
      { L_m: L, H_m: H, deduct_openings_m2: deduct, count: n }, net, CLAUSE_TILING)],
    extra: { finish: m.finish, deduct_openings_m2: deduct, area_sqft: pyRound(net * SQFT_PER_M2, 2) },
  })];
}

export function false_ceiling(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), B = mmToM(m.breadth_mm);
  const n = m.count;
  const cut = m.cutout_area_m2 ?? 0;
  const area = Math.max(L * B - cut, 0.0) * n;
  return [qty({
    category: "ceiling",
    description: `False ceiling ${m.label} (${fmt0(m.length_mm)}x${fmt0(m.breadth_mm)} mm)`.trim(),
    unit: "m2", value: area, nos: n, length_m: L, breadth_m: B,
    audit: [step("ceiling.area", "(L*B - cutout_area_m2) * count",
      { L_m: L, B_m: B, cutout_area_m2: cut, count: n }, area, CLAUSE_CEILING)],
    extra: {
      ceiling_type: m.ceiling_type, cove_length_mm: m.cove_length_mm ?? 0, cutout_area_m2: cut,
      area_sqft: pyRound(area * SQFT_PER_M2, 2),
    },
  })];
}

export function painting(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), H = mmToM(m.height_mm);
  const n = m.count;
  const faces = m.faces;
  const gross = L * H * faces;
  let deduct = 0.0;
  for (const op of m.openings || []) {
    const area = mmToM(op.width_mm) * mmToM(op.height_mm);
    if (area > PAINTING_OPENING_DEDUCT_THRESHOLD) deduct += area * faces * op.count;
  }
  const net = Math.max(gross - deduct, 0.0) * n;
  return [qty({
    category: "painting",
    description: `Painting ${m.label} (${fmt0(m.length_mm)}x${fmt0(m.height_mm)} mm, ${faces} face/s)`.trim(),
    unit: "m2", value: net, nos: n, length_m: L, depth_m: H,
    audit: [step("painting.area", "(L*H*faces - openings(>0.5m2)*faces) * count",
      { L_m: L, H_m: H, faces, deduct_openings_m2: deduct, count: n }, net, CLAUSE_PAINTING)],
    extra: {
      coats: m.coats, paint_system: m.paint_system, surface: m.surface, faces,
      deduct_openings_m2: deduct, area_sqft: pyRound(net * SQFT_PER_M2, 2),
    },
  })];
}

export function door_window(m: Member): Quantity[] {
  const W = mmToM(m.width_mm), H = mmToM(m.height_mm);
  const n = m.count;
  const area = W * H * n;
  const size = `${fmt0(m.width_mm)}x${fmt0(m.height_mm)}`;
  return [qty({
    category: "doors_windows",
    description: `${cap(m.kind)} ${m.label} (${size} mm)`.trim(),
    unit: "Nos", value: n, nos: n, breadth_m: W, depth_m: H,
    audit: [step("doors_windows.count", "count (area W*H*count recorded for reference)",
      { W_m: W, H_m: H, count: n, area_m2: area }, n, CLAUSE_DOORS)],
    extra: {
      kind: m.kind, size, width_mm: m.width_mm, height_mm: m.height_mm,
      frame_material: m.frame_material, shutter_material: m.shutter_material,
      area_m2: area, area_sqft: pyRound(area * SQFT_PER_M2, 2),
    },
  })];
}

export function waterproofing(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), B = mmToM(m.breadth_mm);
  const n = m.count;
  const up = mmToM(m.upturn_height_mm);
  const upturn = 2 * (L + B) * up;
  const area = (L * B + upturn) * n;
  return [qty({
    category: "waterproofing",
    description: `Waterproofing ${m.label} (${fmt0(m.length_mm)}x${fmt0(m.breadth_mm)} mm)`.trim(),
    unit: "m2", value: area, nos: n, length_m: L, breadth_m: B,
    audit: [step("waterproofing.area", "(L*B + 2*(L+B)*upturn) * count",
      { L_m: L, B_m: B, upturn_m: up, upturn_area_m2: upturn, count: n }, area, CLAUSE_WATERPROOFING)],
    extra: {
      treatment: m.treatment, upturn_height_mm: m.upturn_height_mm ?? 0, upturn_area_m2: upturn,
      area_sqft: pyRound(area * SQFT_PER_M2, 2),
    },
  })];
}

export function railing(m: Member): Quantity[] {
  const L = mmToM(m.length_mm);
  const n = m.count;
  const len = L * n;
  return [qty({
    category: "railing",
    description: `Railing ${m.label} (${fmt0(m.length_mm)} mm long, ${fmt0(m.height_mm)} mm high)`.trim(),
    unit: "m", value: len, nos: n, length_m: L, depth_m: mmToM(m.height_mm),
    audit: [step("railing.length", "L * count",
      { L_m: L, height_mm: m.height_mm, count: n }, len, CLAUSE_RAILING)],
    extra: { material: m.material, height_mm: m.height_mm },
  })];
}

export const registry: Record<string, Array<(m: Member) => Quantity[]>> = {
  flooring: [flooring],
  wall_tiling: [wall_tiling],
  false_ceiling: [false_ceiling],
  painting: [painting],
  door_window: [door_window],
  waterproofing: [waterproofing],
  railing: [railing],
};

// --------------------------------------------------------------------------- //
// BOQ presentation contract
// --------------------------------------------------------------------------- //
export const CATEGORIES: Array<[string, string]> = [
  ["flooring", "Flooring"],
  ["skirting", "Skirting"],
  ["tiling", "Dado & Wall Tiling"],
  ["ceiling", "False Ceiling"],
  ["painting", "Painting"],
  ["doors_windows", "Doors & Windows"],
  ["waterproofing", "Waterproofing"],
  ["railing", "Railings"],
];

export const UNITS: Record<string, string> = {
  flooring: "m2", skirting: "m", tiling: "m2", ceiling: "m2", painting: "m2",
  doors_windows: "Nos", waterproofing: "m2", railing: "m",
};

export const DEMO_RATES: Record<string, number> = {
  flooring: 1200, skirting: 150, tiling: 1100, ceiling: 950, painting: 180,
  doors_windows: 8500, waterproofing: 450, railing: 2200,
};

export const DEMO_MEMBERS: any[] = [
  { member_type: "flooring", label: "FL1 Living", length_mm: 4500, breadth_mm: 4000, count: 1,
    deduct_area_m2: 0, skirting_height_mm: 100, finish: "600x600 vitrified tiles", bedding_mm: 20 },
  { member_type: "wall_tiling", label: "WT1 Toilet", length_mm: 7200, height_mm: 2100, count: 2,
    openings: [{ width_mm: 750, height_mm: 2100, count: 1 }], finish: "300x600 ceramic tiles" },
  { member_type: "false_ceiling", label: "FC1 Living", length_mm: 4500, breadth_mm: 4000, count: 1,
    cutout_area_m2: 0.36, ceiling_type: "gypsum", cove_length_mm: 17000 },
  { member_type: "painting", label: "PT1 Internal walls", length_mm: 17000, height_mm: 3000,
    faces: 1, count: 1, coats: 2, paint_system: "acrylic emulsion", surface: "internal",
    openings: [{ width_mm: 1000, height_mm: 2100, count: 1 }, { width_mm: 1200, height_mm: 1200, count: 2 }] },
  { member_type: "door_window", label: "D1", width_mm: 900, height_mm: 2100, count: 4,
    kind: "door", frame_material: "hardwood", shutter_material: "flush shutter" },
  { member_type: "waterproofing", label: "WP1 Toilet sunk", length_mm: 2100, breadth_mm: 1500,
    count: 2, upturn_height_mm: 300, treatment: "APP membrane 3 mm" },
  { member_type: "railing", label: "RL1 Balcony", length_mm: 3500, height_mm: 900, count: 2, material: "MS" },
];

// --------------------------------------------------------------------------- //
// Manual-add form + card summary
// --------------------------------------------------------------------------- //
export const UI: Record<string, {
  label: string; icon: string; category: string; labelPrefix: string;
  dims: Array<{ k: string; label: string; unit?: string; def: string }>;
  choices?: Record<string, string[]>;
  texts?: Array<{ k: string; label: string; def: string }>;
  hasOpenings?: boolean;
  specLine: (p: Record<string, any>) => string[];
}> = {
  flooring: {
    label: "Flooring", icon: "🟫", category: "flooring", labelPrefix: "FL",
    dims: [
      { k: "length_mm", label: "Length", unit: "mm", def: "4000" },
      { k: "breadth_mm", label: "Breadth", unit: "mm", def: "3000" },
      { k: "skirting_height_mm", label: "Skirting height (0 = none)", unit: "mm", def: "100" },
      { k: "skirting_length_mm", label: "Skirting run (0 = perimeter)", unit: "mm", def: "0" },
      { k: "deduct_area_m2", label: "Deduct columns/ducts", unit: "m2", def: "0" },
      { k: "bedding_mm", label: "Bedding thk", unit: "mm", def: "20" },
    ],
    texts: [{ k: "finish", label: "Finish", def: "600x600 vitrified tiles" }],
    specLine: (p) => [
      `${p.length_mm}×${p.breadth_mm}`,
      Number(p.skirting_height_mm) > 0 ? `skirting ${p.skirting_height_mm}` : "",
      p.finish || "",
    ].filter(Boolean),
  },
  wall_tiling: {
    label: "Dado / Wall Tiling", icon: "🧩", category: "tiling", labelPrefix: "WT",
    dims: [
      { k: "length_mm", label: "Wall length", unit: "mm", def: "3000" },
      { k: "height_mm", label: "Dado height", unit: "mm", def: "2100" },
    ],
    texts: [{ k: "finish", label: "Finish", def: "300x600 ceramic tiles" }],
    hasOpenings: true,
    specLine: (p) => [`${p.length_mm}×${p.height_mm}`, p.finish || ""].filter(Boolean),
  },
  false_ceiling: {
    label: "False Ceiling", icon: "⬛", category: "ceiling", labelPrefix: "FC",
    dims: [
      { k: "length_mm", label: "Length", unit: "mm", def: "4000" },
      { k: "breadth_mm", label: "Breadth", unit: "mm", def: "3000" },
      { k: "cutout_area_m2", label: "Cut-outs (lights/AC)", unit: "m2", def: "0" },
      { k: "cove_length_mm", label: "Cove length", unit: "mm", def: "0" },
    ],
    choices: { ceiling_type: CEILING_TYPES },
    specLine: (p) => [
      `${p.length_mm}×${p.breadth_mm}`,
      p.ceiling_type || "",
      Number(p.cove_length_mm) > 0 ? `cove ${p.cove_length_mm}` : "",
    ].filter(Boolean),
  },
  painting: {
    label: "Painting", icon: "🖌️", category: "painting", labelPrefix: "PT",
    dims: [
      { k: "length_mm", label: "Length", unit: "mm", def: "4000" },
      { k: "height_mm", label: "Height", unit: "mm", def: "3000" },
      { k: "faces", label: "Faces (1 or 2)", def: "2" },
      { k: "coats", label: "Coats", def: "2" },
    ],
    choices: { surface: PAINT_SURFACES },
    texts: [{ k: "paint_system", label: "Paint system", def: "acrylic emulsion" }],
    hasOpenings: true,
    specLine: (p) => [
      `${p.length_mm}×${p.height_mm}`,
      `${p.faces ?? 1} face/s`,
      `${p.coats ?? 2} coats`,
      p.paint_system || "",
      p.surface || "",
    ].filter(Boolean),
  },
  door_window: {
    label: "Door / Window", icon: "🚪", category: "doors_windows", labelPrefix: "D",
    dims: [
      { k: "width_mm", label: "Width", unit: "mm", def: "900" },
      { k: "height_mm", label: "Height", unit: "mm", def: "2100" },
    ],
    choices: { kind: OPENING_KINDS },
    texts: [
      { k: "frame_material", label: "Frame", def: "hardwood" },
      { k: "shutter_material", label: "Shutter", def: "flush shutter" },
    ],
    specLine: (p) => [
      cap(String(p.kind || "door")),
      `${p.width_mm}×${p.height_mm}`,
      p.frame_material ? `${p.frame_material} frame` : "",
      p.shutter_material || "",
    ].filter(Boolean),
  },
  waterproofing: {
    label: "Waterproofing", icon: "💧", category: "waterproofing", labelPrefix: "WP",
    dims: [
      { k: "length_mm", label: "Length", unit: "mm", def: "5000" },
      { k: "breadth_mm", label: "Breadth", unit: "mm", def: "4000" },
      { k: "upturn_height_mm", label: "Upturn height", unit: "mm", def: "300" },
    ],
    texts: [{ k: "treatment", label: "Treatment", def: "APP membrane 3 mm" }],
    specLine: (p) => [
      `${p.length_mm}×${p.breadth_mm}`,
      Number(p.upturn_height_mm) > 0 ? `upturn ${p.upturn_height_mm}` : "",
      p.treatment || "",
    ].filter(Boolean),
  },
  railing: {
    label: "Railing", icon: "🛤️", category: "railing", labelPrefix: "RL",
    dims: [
      { k: "length_mm", label: "Length", unit: "mm", def: "3500" },
      { k: "height_mm", label: "Height", unit: "mm", def: "900" },
    ],
    choices: { material: RAILING_MATERIALS },
    specLine: (p) => [`${p.length_mm} long`, `${p.height_mm ?? 900} high`, p.material || ""].filter(Boolean),
  },
};

// Short trade noun for the BOQ 'Item' column. Keyed by member_type; the
// 'skirting' entry is keyed by CATEGORY because skirting rows come from the
// flooring member (look up by category first when it differs from the type's).
export const ITEM_NOUN: Record<string, string> = {
  flooring: "Flooring",
  wall_tiling: "Dado / Wall Tiling",
  false_ceiling: "False Ceiling",
  painting: "Painting",
  door_window: "Doors & Windows",
  waterproofing: "Waterproofing",
  railing: "Railing",
  skirting: "Skirting",
};

/** Specification cell for the categories this pack owns; null otherwise. */
export function specText(it: { category: string; member_type: string; extra: Record<string, any> }): string | null {
  const e = it.extra || {};
  const has = (v: any) => v !== undefined && v !== null && String(v).trim() !== "";
  const finish = has(e.finish) ? String(e.finish) : "finish not specified";
  switch (it.category) {
    case "flooring":
      return has(e.bedding_mm) && Number(e.bedding_mm) > 0
        ? `${finish} on ${fmt0(Number(e.bedding_mm))} mm bedding`
        : finish;
    case "skirting":
      return has(e.skirting_height_mm)
        ? `${finish} skirting, ${fmt0(Number(e.skirting_height_mm))} mm high`
        : `${finish} skirting`;
    case "tiling":
      return `${finish} dado / wall tiling`;
    case "ceiling": {
      const parts = [`${has(e.ceiling_type) ? e.ceiling_type : "gypsum"} false ceiling`];
      if (has(e.cove_length_mm) && Number(e.cove_length_mm) > 0) parts.push(`${fmt0(Number(e.cove_length_mm))} mm cove`);
      return parts.join(", ");
    }
    case "painting": {
      const parts: string[] = [];
      if (has(e.coats)) parts.push(`${e.coats} coats`);
      if (has(e.paint_system)) parts.push(String(e.paint_system));
      const head = parts.join(" ");
      return [head, has(e.surface) ? String(e.surface) : ""].filter(Boolean).join(", ") || "Painting as specified";
    }
    case "doors_windows": {
      const parts = [`${cap(has(e.kind) ? String(e.kind) : "door")} ${has(e.size) ? e.size : ""}`.trim()];
      if (has(e.frame_material)) parts.push(`${e.frame_material} frame`);
      if (has(e.shutter_material)) parts.push(String(e.shutter_material));
      return parts.join(", ");
    }
    case "waterproofing": {
      const t = has(e.treatment) ? String(e.treatment) : "treatment not specified";
      return has(e.upturn_height_mm) && Number(e.upturn_height_mm) > 0
        ? `${t} incl. ${fmt0(Number(e.upturn_height_mm))} mm upturn`
        : t;
    }
    case "railing": {
      const parts = [`${has(e.material) ? e.material : "MS"} railing`];
      if (has(e.height_mm)) parts.push(`${fmt0(Number(e.height_mm))} mm high`);
      return parts.join(", ");
    }
    default:
      return null;
  }
}

// --------------------------------------------------------------------------- //
// AI extraction prompt shapes
// --------------------------------------------------------------------------- //
export const PROMPT_SHAPES = `
- flooring: {member_type, label, count, length_mm, breadth_mm, deduct_area_m2,
            skirting_height_mm, skirting_length_mm, finish, bedding_mm}
            // Room-wise from the FLOOR PLAN (room name as label, e.g. "FL1 Living").
            // 'finish' ONLY from the finishing schedule; if there is no schedule, leave
            // finish empty ("") — never assume vitrified/marble/etc. skirting_height_mm
            // only when the schedule or plan states skirting; skirting_length_mm = 0
            // means the room perimeter is used. deduct_area_m2 = columns/ducts inside.
- wall_tiling: {member_type, label, count, length_mm, height_mm,
            openings:[{width_mm,height_mm,count}], finish}
            // Dado / wall tiling from the finishing schedule + toilet/kitchen details:
            // length_mm = total wall run, height_mm = dado height (e.g. 2100 in toilets,
            // 600 above a kitchen counter). Do NOT assume tiling on walls the schedule
            // does not mark. Leave finish empty if the schedule does not give the tile.
- false_ceiling: {member_type, label, count, length_mm, breadth_mm, cutout_area_m2,
            ceiling_type:"gypsum"|"POP"|"grid"|"wood", cove_length_mm}
            // From the REFLECTED CEILING PLAN / finishing schedule only. Room extent as
            // drawn; cutout_area_m2 for light/AC cut-outs if dimensioned. Never assume
            // a false ceiling in a room without one shown.
- painting: {member_type, label, count, length_mm, height_mm, faces,
            openings:[{width_mm,height_mm,count}], coats, paint_system,
            surface:"internal"|"external"}
            // Internal: wall run x floor-to-ceiling height, faces=1 per painted side.
            // External: from ELEVATIONS (each facade as one member, surface="external").
            // paint_system/coats ONLY as written in the finishing schedule or notes;
            // leave paint_system empty and coats=2 when not given. Openings from plan.
- door_window: {member_type, label, count, width_mm, height_mm,
            kind:"door"|"window"|"ventilator", frame_material, shutter_material}
            // label = the mark (D1, W2, V1); count = how many times that mark occurs
            // on the FLOOR PLAN; width_mm x height_mm from the DOOR/WINDOW SCHEDULE.
            // frame/shutter material only from the schedule; do not assume.
- waterproofing: {member_type, label, count, length_mm, breadth_mm, upturn_height_mm,
            treatment}
            // Toilets/wet areas/terrace/sunk slabs from the TOILET DETAIL or
            // waterproofing notes; upturn_height_mm as detailed (often 300). treatment
            // only as written; leave empty if the note does not name a system.
- railing: {member_type, label, count, length_mm, height_mm,
            material:"MS"|"SS"|"glass"|"wood"}
            // Balcony/staircase/terrace railings from plans + sections; length_mm = run
            // along the edge, height_mm as detailed (default 900). material only when
            // a note or detail names it.
`.trim();
