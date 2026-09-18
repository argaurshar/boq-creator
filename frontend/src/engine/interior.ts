// Interior fit-out pack: joinery, glazing, loose furniture, sanitary fixtures
// and electrical points. Mirrors backend/app/engine/interior.py and
// backend/app/schemas/interior_schema.py — same formula text, identical numbers.
//
// The one hard gate of this pack: a furniture layout plan gives width x depth;
// joinery and glazing are measured on width x HEIGHT, and height exists on no
// layout plan. So height_mm is REQUIRED for joinery and glazing and is never
// defaulted — the validator asks for the elevation instead.
//
// Everything here is pure and deterministic: no I/O, no randomness, no Date.
import { Member } from "./members";
import { Quantity, mmToM, qty, step, fmt0 } from "./units";

export const SQFT_PER_M2 = 10.7639;

export const HEIGHT_GATE =
  "height_mm is required: a layout plan only gives width and depth — read the height from the elevation or ask the user. Never assume 2100.";

export const TYPES: string[] = [
  "joinery", "glazing", "loose_furniture", "sanitary_fixture", "electrical_point",
];

export const JOINERY_TYPES = [
  "wardrobe", "kitchen_base", "kitchen_wall", "storage", "tv_unit", "vanity", "panelling", "other",
];
export const GLAZING_KINDS = ["mirror", "partition", "shower", "window_film"];
export const FIXTURES = ["WC", "wash basin", "shower", "faucet", "health faucet", "mixer", "other"];
export const POINT_TYPES = ["light", "fan", "6A socket", "16A socket", "AC", "data", "switchboard"];

const CLAUSE_JOINERY = "Trade practice — front elevation area";
const CLAUSE_TRADE = "Trade practice";
const CLAUSE_SANITARY = "IS 1200 Part 16";
const CLAUSE_ELECTRICAL = "IS 1200 Part 18";

/* ------------------------------------------------------------------ helpers */
// Private copies of the validation helpers in members.ts (not exported there).
function num(raw: any, key: string, opts: { required?: boolean; gt0?: boolean; ge0?: boolean; def?: number; int?: boolean } = {}): number | null {
  let v = raw?.[key];
  if (v === undefined || v === null) {
    if (opts.required) throw new Error(`Field '${key}' is required`);
    return opts.def ?? null;
  }
  // "" is not a number here, exactly as in the Python schemas.
  if (v === "") throw new Error(`Field '${key}' must be a number`);
  v = Number(v);
  if (!isFinite(v)) throw new Error(`Field '${key}' must be a number`);
  if (opts.gt0 && !(v > 0)) throw new Error(`Field '${key}' must be > 0`);
  if (opts.ge0 && !(v >= 0)) throw new Error(`Field '${key}' must be >= 0`);
  if (opts.int && v !== Math.trunc(v)) throw new Error(`Field '${key}' must be a whole number`);
  return v;
}

export interface Opening { width_mm: number; height_mm: number; count: number; }
function openings(raw: any): Opening[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) throw new Error("openings must be a list");
  return raw.map((o) => ({
    width_mm: num(o, "width_mm", { required: true })!,
    height_mm: num(o, "height_mm", { required: true })!,
    count: Math.trunc(num(o, "count", { int: true, def: 1 })!),
  }));
}
// Kept for contract parity with members.ts; no interior type carries openings today.
void openings;

function blank(v: any): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

// Free-text spec field: blank -> default, else the trimmed string.
function text(raw: any, key: string, def: string): string {
  // Absent -> default; a deliberately blank string stays blank (as in
  // interior_schema.py) so the spec never invents a finish the user cleared.
  const v = raw?.[key];
  return v === undefined || v === null ? def : String(v).trim();
}

// Enumerated field. Matching ignores case, spaces, underscores and hyphens so
// "Kitchen Base", "kitchen-base" and "kitchen_base" all resolve to the canonical
// option; anything else is a clear error. Same rule in interior_schema.py.
function collapse(s: string): string {
  return String(s).toLowerCase().replace(/[\s_\-]+/g, "");
}
function choice(raw: any, key: string, options: string[], def: string): string {
  const v = raw?.[key];
  if (blank(v)) return def;
  const k = collapse(v);
  for (const o of options) if (collapse(o) === k) return o;
  throw new Error(`Field '${key}' must be one of: ${options.join(", ")}`);
}

const JOINERY_HUMAN: Record<string, string> = {
  wardrobe: "Wardrobe", kitchen_base: "Kitchen base units", kitchen_wall: "Kitchen wall units",
  storage: "Storage unit", tv_unit: "TV unit", vanity: "Vanity unit", panelling: "Wall panelling",
  other: "Other",
};
export function humanJoinery(t: any): string {
  if (blank(t)) return "";
  const s = String(t);
  if (JOINERY_HUMAN[s]) return JOINERY_HUMAN[s];
  const words = s.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* --------------------------------------------------------------- validators */
export const validators: Record<string, (raw: any, base: Member) => Member> = {
  joinery: (raw, base) => {
    if (blank(raw?.height_mm)) throw new Error(HEIGHT_GATE);
    return {
      ...base,
      count: Math.trunc(num(raw, "count", { int: true, def: 1, gt0: true })!),
      width_mm: num(raw, "width_mm", { required: true, gt0: true })!,
      height_mm: num(raw, "height_mm", { required: true, gt0: true })!,
      depth_mm: num(raw, "depth_mm", { def: 0, ge0: true })!,
      joinery_type: choice(raw, "joinery_type", JOINERY_TYPES, "wardrobe"),
      carcass: text(raw, "carcass", "BWP ply 18 mm"),
      shutter_finish: text(raw, "shutter_finish", "laminate 1 mm"),
      hardware: text(raw, "hardware", "soft-close, SS"),
    };
  },
  glazing: (raw, base) => {
    if (blank(raw?.height_mm)) throw new Error(HEIGHT_GATE);
    return {
      ...base,
      count: Math.trunc(num(raw, "count", { int: true, def: 1, gt0: true })!),
      width_mm: num(raw, "width_mm", { required: true, gt0: true })!,
      height_mm: num(raw, "height_mm", { required: true, gt0: true })!,
      kind: choice(raw, "kind", GLAZING_KINDS, "mirror"),
      glass_type: text(raw, "glass_type", "6 mm mirror"),
    };
  },
  loose_furniture: (raw, base) => ({
    ...base,
    count: Math.trunc(num(raw, "count", { int: true, required: true, gt0: true })!),
    item: text(raw, "item", "3-seater sofa"),
    finish: text(raw, "finish", "fabric"),
  }),
  sanitary_fixture: (raw, base) => ({
    ...base,
    count: Math.trunc(num(raw, "count", { int: true, required: true, gt0: true })!),
    fixture: choice(raw, "fixture", FIXTURES, "WC"),
    make: text(raw, "make", ""),
  }),
  electrical_point: (raw, base) => ({
    ...base,
    count: Math.trunc(num(raw, "count", { int: true, required: true, gt0: true })!),
    point_type: choice(raw, "point_type", POINT_TYPES, "light"),
  }),
};

/* ------------------------------------------------------------------- engine */
export function joinery(m: Member): Quantity[] {
  const W = mmToM(m.width_mm), H = mmToM(m.height_mm);
  const n = m.count;
  const area = W * H * n;
  const sqft = W * H * n * SQFT_PER_M2;
  return [qty({
    category: "joinery",
    description: `Joinery ${m.label} (${fmt0(m.width_mm)}x${fmt0(m.height_mm)} mm)`.trim(),
    unit: "sqft", value: sqft, nos: n, length_m: W, depth_m: H,
    audit: [step("interior.joinery.area", "W*H*count*SQFT_PER_M2",
      { W_m: W, H_m: H, count: n, SQFT_PER_M2 }, sqft, CLAUSE_JOINERY)],
    extra: {
      area_m2: area, joinery_type: m.joinery_type, depth_mm: m.depth_mm,
      carcass: m.carcass, shutter_finish: m.shutter_finish, hardware: m.hardware,
    },
  })];
}

export function glazing(m: Member): Quantity[] {
  const W = mmToM(m.width_mm), H = mmToM(m.height_mm);
  const n = m.count;
  const area = W * H * n;
  const sqft = W * H * n * SQFT_PER_M2;
  return [qty({
    category: "glazing",
    description: `Glazing ${m.label} (${fmt0(m.width_mm)}x${fmt0(m.height_mm)} mm)`.trim(),
    unit: "sqft", value: sqft, nos: n, length_m: W, depth_m: H,
    audit: [step("interior.glazing.area", "W*H*count*SQFT_PER_M2",
      { W_m: W, H_m: H, count: n, SQFT_PER_M2 }, sqft, CLAUSE_TRADE)],
    extra: { area_m2: area, kind: m.kind, glass_type: m.glass_type },
  })];
}

export function loose_furniture(m: Member): Quantity[] {
  const n = m.count;
  return [qty({
    category: "furniture",
    description: `Loose furniture ${m.label} (${m.item})`.trim(),
    unit: "Nos", value: n, nos: n,
    audit: [step("interior.furniture.count", "count", { count: n }, n, CLAUSE_TRADE)],
    extra: { item: m.item, finish: m.finish },
  })];
}

export function sanitary_fixture(m: Member): Quantity[] {
  const n = m.count;
  return [qty({
    category: "sanitary",
    description: `Sanitary fixture ${m.label} (${m.fixture})`.trim(),
    unit: "Nos", value: n, nos: n,
    audit: [step("interior.sanitary.count", "count", { count: n }, n, CLAUSE_SANITARY)],
    extra: { fixture: m.fixture, make: m.make },
  })];
}

export function electrical_point(m: Member): Quantity[] {
  const n = m.count;
  return [qty({
    category: "services",
    description: `Electrical point ${m.label} (${m.point_type})`.trim(),
    unit: "Nos", value: n, nos: n,
    audit: [step("interior.services.count", "count", { count: n }, n, CLAUSE_ELECTRICAL)],
    extra: { point_type: m.point_type },
  })];
}

export const registry: Record<string, Array<(m: Member) => Quantity[]>> = {
  joinery: [joinery],
  glazing: [glazing],
  loose_furniture: [loose_furniture],
  sanitary_fixture: [sanitary_fixture],
  electrical_point: [electrical_point],
};

/* ------------------------------------------------------- BOQ presentation */
export const CATEGORIES: Array<[string, string]> = [
  ["joinery", "Joinery & Panelling"],
  ["furniture", "Loose Furniture"],
  ["glazing", "Glass & Mirrors"],
  ["sanitary", "Sanitary & CP Fittings"],
  ["services", "Electrical Points"],
];

export const UNITS: Record<string, string> = {
  joinery: "sqft", furniture: "Nos", glazing: "sqft", sanitary: "Nos", services: "Nos",
};

export const DEMO_RATES: Record<string, number> = {
  joinery: 1450, furniture: 25000, glazing: 650, sanitary: 12000, services: 850,
};

export const DEMO_MEMBERS: any[] = [
  { member_type: "joinery", label: "JN1", count: 2, width_mm: 2400, height_mm: 2400, depth_mm: 600,
    joinery_type: "wardrobe", carcass: "BWP ply 18 mm", shutter_finish: "laminate 1 mm",
    hardware: "soft-close, SS" },
  { member_type: "joinery", label: "JN2", count: 1, width_mm: 3000, height_mm: 850, depth_mm: 600,
    joinery_type: "kitchen_base", carcass: "BWP ply 18 mm", shutter_finish: "acrylic 1 mm",
    hardware: "soft-close, SS" },
  { member_type: "glazing", label: "GL1", count: 2, width_mm: 1200, height_mm: 1800,
    kind: "mirror", glass_type: "6 mm mirror" },
  { member_type: "loose_furniture", label: "LF1", count: 1, item: "3-seater sofa", finish: "fabric" },
  { member_type: "sanitary_fixture", label: "SN1", count: 2, fixture: "WC", make: "" },
  { member_type: "electrical_point", label: "EP1", count: 12, point_type: "6A socket" },
];

// Compact number for card summaries ("2400", "1200.5").
function n0(v: any): string {
  const x = Number(v);
  return isFinite(x) ? String(Math.round(x * 10) / 10) : String(v ?? "");
}

export const UI: Record<string, {
  label: string; icon: string; category: string; labelPrefix: string;
  dims: Array<{ k: string; label: string; unit?: string; def: string }>;
  choices?: Record<string, string[]>;
  texts?: Array<{ k: string; label: string; def: string }>;
  hasOpenings?: boolean;
  specLine: (p: Record<string, any>) => string[];
}> = {
  joinery: {
    label: "Joinery", icon: "🗄️", category: "joinery", labelPrefix: "JN1",
    dims: [
      { k: "width_mm", label: "Width", unit: "mm", def: "2400" },
      { k: "height_mm", label: "Height (from elevation)", unit: "mm", def: "2400" },
      { k: "depth_mm", label: "Depth", unit: "mm", def: "600" },
    ],
    choices: { joinery_type: JOINERY_TYPES },
    texts: [
      { k: "carcass", label: "Carcass", def: "BWP ply 18 mm" },
      { k: "shutter_finish", label: "Shutter finish", def: "laminate 1 mm" },
      { k: "hardware", label: "Hardware", def: "soft-close, SS" },
    ],
    specLine: (p) => {
      const parts = [`${n0(p.width_mm)}×${n0(p.height_mm)}`];
      const t = humanJoinery(p.joinery_type);
      if (t) parts.push(t);
      if (Number(p.depth_mm) > 0) parts.push(`${n0(p.depth_mm)} deep`);
      return parts;
    },
  },
  glazing: {
    label: "Glass & mirror", icon: "🪞", category: "glazing", labelPrefix: "GL1",
    dims: [
      { k: "width_mm", label: "Width", unit: "mm", def: "1200" },
      { k: "height_mm", label: "Height (from elevation)", unit: "mm", def: "1800" },
    ],
    choices: { kind: GLAZING_KINDS },
    texts: [{ k: "glass_type", label: "Glass type", def: "6 mm mirror" }],
    specLine: (p) => {
      const parts = [`${n0(p.width_mm)}×${n0(p.height_mm)}`];
      if (!blank(p.kind)) parts.push(String(p.kind).replace(/_/g, " "));
      if (!blank(p.glass_type)) parts.push(String(p.glass_type));
      return parts;
    },
  },
  loose_furniture: {
    label: "Loose furniture", icon: "🛋️", category: "furniture", labelPrefix: "LF1",
    dims: [{ k: "count", label: "Count", unit: "Nos", def: "1" }],
    texts: [
      { k: "item", label: "Item", def: "3-seater sofa" },
      { k: "finish", label: "Finish", def: "fabric" },
    ],
    specLine: (p) => {
      const parts = [`${n0(p.count ?? 1)} × ${blank(p.item) ? "item" : p.item}`];
      if (!blank(p.finish)) parts.push(String(p.finish));
      return parts;
    },
  },
  sanitary_fixture: {
    label: "Sanitary fixture", icon: "🚿", category: "sanitary", labelPrefix: "SN1",
    dims: [{ k: "count", label: "Count", unit: "Nos", def: "1" }],
    choices: { fixture: FIXTURES },
    texts: [{ k: "make", label: "Make", def: "" }],
    specLine: (p) => {
      const parts = [`${n0(p.count ?? 1)} × ${blank(p.fixture) ? "WC" : p.fixture}`];
      if (!blank(p.make)) parts.push(String(p.make));
      return parts;
    },
  },
  electrical_point: {
    label: "Electrical point", icon: "🔌", category: "services", labelPrefix: "EP1",
    dims: [{ k: "count", label: "Count", unit: "Nos", def: "1" }],
    choices: { point_type: POINT_TYPES },
    specLine: (p) => [`${n0(p.count ?? 1)} × ${blank(p.point_type) ? "light" : p.point_type}`],
  },
};

// Static trade noun per member type (Item column). For joinery the noun should
// carry the humanised joinery type — use itemNoun(it) below, which reads
// extra.joinery_type and falls back to this table.
export const ITEM_NOUN: Record<string, string> = {
  joinery: "Joinery",
  glazing: "Glass & Mirrors",
  loose_furniture: "Loose Furniture",
  sanitary_fixture: "Sanitary & CP",
  electrical_point: "Electrical Points",
};

/** Item cell text: "Joinery — Wardrobe" when extra.joinery_type is known. */
export function itemNoun(it: { member_type: string; extra?: Record<string, any> | null }): string {
  const base = ITEM_NOUN[it.member_type] || it.member_type;
  if (it.member_type === "joinery") {
    const t = humanJoinery(it.extra?.joinery_type);
    return t ? `Joinery — ${t}` : "Joinery";
  }
  return base;
}

const OWNED = new Set(CATEGORIES.map(([c]) => c));

/** Specification cell for the categories this pack owns; null otherwise. */
export function specText(it: { category: string; member_type: string; extra: Record<string, any> }): string | null {
  if (!OWNED.has(it.category)) return null;
  const e = it.extra || {};
  const bits: string[] = [];
  switch (it.category) {
    case "joinery": {
      const t = e.joinery_type === "other" ? "Joinery" : humanJoinery(e.joinery_type) || "Joinery";
      const depth = Number(e.depth_mm);
      bits.push(isFinite(depth) && depth > 0 ? `${t} ${fmt0(depth)} mm deep` : t);
      if (!blank(e.carcass)) bits.push(`${e.carcass} carcass`);
      if (!blank(e.shutter_finish)) bits.push(`${e.shutter_finish} shutters`);
      if (!blank(e.hardware)) bits.push(`${String(e.hardware).replace(/,\s*/g, " ")} hardware`);
      return bits.join(", ");
    }
    case "glazing": {
      const gt = blank(e.glass_type) ? "" : String(e.glass_type);
      const kind = blank(e.kind) ? "" : String(e.kind).replace(/_/g, " ");
      if (gt) bits.push(gt);
      if (kind && !gt.toLowerCase().includes(kind.toLowerCase())) bits.push(kind);
      return bits.join(" — ");
    }
    case "furniture": {
      if (!blank(e.item)) bits.push(String(e.item));
      if (!blank(e.finish)) bits.push(`${e.finish} finish`);
      return bits.join(", ");
    }
    case "sanitary": {
      const fx = blank(e.fixture) ? "Sanitary fixture" : String(e.fixture);
      return blank(e.make) ? fx : `${fx} — ${e.make}`;
    }
    case "services": {
      const pt = blank(e.point_type) ? "Electrical" : String(e.point_type);
      return pt === "switchboard"
        ? "Switchboard incl. wiring & switches"
        : `${pt} point incl. wiring & switch`;
    }
    default:
      return null;
  }
}

/* ---------------------------------------------------------- AI extraction */
export const PROMPT_SHAPES = `INTERIOR FIT-OUT — the sheets are furniture layouts, ceiling (RCP) plans, wall
elevations, joinery details, electrical/lighting layouts and toilet details.

- joinery: {member_type, label, count, width_mm, height_mm, depth_mm,
            joinery_type:"wardrobe"|"kitchen_base"|"kitchen_wall"|"storage"|"tv_unit"|"vanity"|"panelling"|"other",
            carcass, shutter_finish, hardware}
            // Read from WALL ELEVATIONS and JOINERY DETAILS. A furniture layout plan gives
            // only width x depth; joinery is measured on width x HEIGHT, and the height
            // is on no layout plan. Take height_mm from the elevation or joinery section.
            // If no elevation/detail exists, emit the unit with width_mm (and depth_mm)
            // only, OMIT height_mm, and add "height not on drawings" to assumptions so
            // the app can ask the user. NEVER assume 2100 or any other height.
            // carcass / shutter_finish / hardware only if the finish schedule or detail
            // notes state them; otherwise leave them out (defaults apply).
- glazing: {member_type, label, count, width_mm, height_mm,
            kind:"mirror"|"partition"|"shower"|"window_film", glass_type}
            // Mirrors from toilet details and elevations; partitions and shower glass from
            // plan + elevation. Same height rule as joinery: no elevation -> omit
            // height_mm and flag "height not on drawings". glass_type only if stated.
- loose_furniture: {member_type, label, count, item, finish}
            // From the FURNITURE LAYOUT. Count the pieces actually drawn; never include
            // fixed joinery here. Loose furniture is often client-supplied — if the scope
            // does not say it is in the contractor's supply, still list it and record the
            // assumption.
- sanitary_fixture: {member_type, label, count,
            fixture:"WC"|"wash basin"|"shower"|"faucet"|"health faucet"|"mixer"|"other", make}
            // From TOILET DETAILS / plumbing fixture schedules. One member per fixture
            // type with the counted number. 'make' only if a schedule names it, else "".
- electrical_point: {member_type, label, count,
            point_type:"light"|"fan"|"6A socket"|"16A socket"|"AC"|"data"|"switchboard"}
            // From the ELECTRICAL / LIGHTING LAYOUT and the RCP legend. One member per
            // point type; count the symbols on the plan. Do not infer points from the
            // furniture layout or from room names.

INTERIOR SCOPE SPLIT — record it in 'assumptions' whenever the drawings do not
state it: bare shell (civil walls, plaster and flooring are done by the fit-out
contractor), warm shell (base finishes and services already exist; only joinery,
loose furniture, fixtures and point wiring are in scope) or renovation
(dismantling of existing items precedes new work). Emit only the members the
stated scope includes; when unstated, assume warm shell and say so.`;
