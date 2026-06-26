// The typed Member + validation. Ported from
// backend/app/schemas/member_schema.py (Pydantic) to plain TS so the static
// build validates members the same way the API did. All linear dims in mm.

export interface BarGroup { dia_mm: number; count: number; }
export interface BarMesh { dia_mm: number; spacing_mm: number; }
export interface StirrupZone { spacing_mm: number; length_mm: number; }
export interface Stirrups {
  dia_mm: number; legs: number; spacing_mm: number | null; zones: StirrupZone[];
}
export interface Opening { width_mm: number; height_mm: number; count: number; }
export interface TrussSegment { component: string; designation: string; length_mm: number; count: number; }

export interface Member {
  member_type: string;
  label: string;
  count: number;
  concrete_grade: string;
  steel_grade: string;
  cover_mm: number;
  source: string;
  confidence: number;
  evidence: string;
  assumptions: string[];
  [key: string]: any;
}

const KNOWN_TYPES = [
  "column", "beam", "footing", "slab", "rcc_wall", "pcc",
  "brick_wall", "plaster_surface", "earthwork_pit", "steel_member", "truss",
  "anchor_bolt", "roof_sheeting",
];

function num(raw: any, key: string, opts: { required?: boolean; gt0?: boolean; ge0?: boolean; def?: number } = {}): number | null {
  let v = raw?.[key];
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new Error(`Field '${key}' is required`);
    return opts.def ?? null;
  }
  v = Number(v);
  if (!isFinite(v)) throw new Error(`Field '${key}' must be a number`);
  if (opts.gt0 && !(v > 0)) throw new Error(`Field '${key}' must be > 0`);
  if (opts.ge0 && !(v >= 0)) throw new Error(`Field '${key}' must be >= 0`);
  return v;
}

function barGroups(raw: any): BarGroup[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) throw new Error("bar groups must be a list");
  return raw.map((b) => ({
    dia_mm: num(b, "dia_mm", { required: true, gt0: true })!,
    count: Math.trunc(num(b, "count", { def: 1 })!),
  }));
}

function barMesh(raw: any): BarMesh | null {
  if (!raw) return null;
  return {
    dia_mm: num(raw, "dia_mm", { required: true, gt0: true })!,
    spacing_mm: num(raw, "spacing_mm", { required: true, gt0: true })!,
  };
}

function stirrups(raw: any): Stirrups | null {
  if (!raw) return null;
  const zones: StirrupZone[] = Array.isArray(raw.zones)
    ? raw.zones.map((z: any) => ({
        spacing_mm: num(z, "spacing_mm", { required: true, gt0: true })!,
        length_mm: num(z, "length_mm", { ge0: true, def: 0 })!,
      }))
    : [];
  return {
    dia_mm: num(raw, "dia_mm", { required: true, gt0: true })!,
    legs: Math.trunc(num(raw, "legs", { def: 2 })!),
    spacing_mm: raw.spacing_mm == null ? null : num(raw, "spacing_mm", { gt0: true })!,
    zones,
  };
}

function openings(raw: any): Opening[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) throw new Error("openings must be a list");
  return raw.map((o) => ({
    width_mm: num(o, "width_mm", { required: true })!,
    height_mm: num(o, "height_mm", { required: true })!,
    count: Math.trunc(num(o, "count", { def: 1 })!),
  }));
}

function trussSegments(raw: any): TrussSegment[] {
  if (!Array.isArray(raw)) throw new Error("truss 'segments' must be a list");
  const segs = raw
    .filter((s) => s && (s.designation ?? "") !== "")
    .map((s) => ({
      component: s.component != null ? String(s.component) : "",
      designation: String(s.designation),
      length_mm: num(s, "length_mm", { required: true, gt0: true })!,
      count: Math.trunc(num(s, "count", { def: 1, gt0: true })!),
    }));
  if (!segs.length) throw new Error("a truss needs at least one segment with a section designation");
  return segs;
}

function strList(raw: any): string[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) throw new Error("expected a list of labels");
  return raw.map((x) => String(x));
}

export function validateMember(raw: any): Member {
  if (!raw || typeof raw !== "object") throw new Error("member must be an object");
  const t = raw.member_type;
  if (!KNOWN_TYPES.includes(t)) {
    throw new Error(`Unknown member_type '${t}'. Expected one of: ${KNOWN_TYPES.join(", ")}`);
  }

  const base: Member = {
    member_type: t,
    label: raw.label != null ? String(raw.label) : "",
    count: Math.trunc(num(raw, "count", { def: 1 })!),
    concrete_grade: raw.concrete_grade != null ? String(raw.concrete_grade) : "M25",
    steel_grade: raw.steel_grade != null ? String(raw.steel_grade) : "Fe500",
    cover_mm: num(raw, "cover_mm", { def: 40 })!,
    source: ["ai", "nl", "manual"].includes(raw.source) ? raw.source : "manual",
    confidence: raw.confidence != null ? Number(raw.confidence) : 1.0,
    evidence: raw.evidence != null ? String(raw.evidence) : "",
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [],
  };

  switch (t) {
    case "column":
      return {
        ...base,
        b_mm: num(raw, "b_mm", { required: true })!,
        D_mm: num(raw, "D_mm", { required: true })!,
        height_mm: num(raw, "height_mm", { required: true })!,
        main_bars: barGroups(raw.main_bars),
        ties: stirrups(raw.ties),
        ties_inner: stirrups(raw.ties_inner),
      };
    case "beam":
      return {
        ...base,
        b_mm: num(raw, "b_mm", { required: true })!,
        depth_mm: num(raw, "depth_mm", { required: true })!,
        clear_span_mm: num(raw, "clear_span_mm", { required: true })!,
        top_bars: barGroups(raw.top_bars),
        bottom_bars: barGroups(raw.bottom_bars),
        stirrups: stirrups(raw.stirrups),
      };
    case "footing":
      return {
        ...base,
        length_mm: num(raw, "length_mm", { required: true })!,
        breadth_mm: num(raw, "breadth_mm", { required: true })!,
        depth_mm: num(raw, "depth_mm", { required: true })!,
        mesh_bottom_x: barMesh(raw.mesh_bottom_x),
        mesh_bottom_y: barMesh(raw.mesh_bottom_y),
        mesh_top_x: barMesh(raw.mesh_top_x),
        mesh_top_y: barMesh(raw.mesh_top_y),
      };
    case "slab":
      return {
        ...base,
        length_mm: num(raw, "length_mm", { required: true })!,
        breadth_mm: num(raw, "breadth_mm", { required: true })!,
        thickness_mm: num(raw, "thickness_mm", { required: true })!,
        main_bars: barMesh(raw.main_bars),
        dist_bars: barMesh(raw.dist_bars),
        bent_up_bars: barMesh(raw.bent_up_bars),
        opening_area_m2: num(raw, "opening_area_m2", { def: 0 })!,
      };
    case "rcc_wall":
      return {
        ...base,
        length_mm: num(raw, "length_mm", { required: true })!,
        height_mm: num(raw, "height_mm", { required: true })!,
        thickness_mm: num(raw, "thickness_mm", { required: true })!,
      };
    case "pcc":
      return {
        ...base,
        length_mm: num(raw, "length_mm", { required: true })!,
        breadth_mm: num(raw, "breadth_mm", { required: true })!,
        thickness_mm: num(raw, "thickness_mm", { required: true })!,
      };
    case "brick_wall":
      return {
        ...base,
        length_mm: num(raw, "length_mm", { required: true })!,
        height_mm: num(raw, "height_mm", { required: true })!,
        thickness_mm: num(raw, "thickness_mm", { required: true })!,
        openings: openings(raw.openings),
        embedded_rcc_m3: num(raw, "embedded_rcc_m3", { def: 0 })!,
        embedded_labels: strList(raw.embedded_labels),
      };
    case "plaster_surface":
      return {
        ...base,
        length_mm: num(raw, "length_mm", { required: true })!,
        height_mm: num(raw, "height_mm", { required: true })!,
        faces: Math.trunc(num(raw, "faces", { def: 1 })!),
        thickness_mm: num(raw, "thickness_mm", { def: 12 })!,
        openings: openings(raw.openings),
      };
    case "earthwork_pit":
      return {
        ...base,
        length_mm: num(raw, "length_mm", { required: true })!,
        breadth_mm: num(raw, "breadth_mm", { required: true })!,
        depth_mm: num(raw, "depth_mm", { required: true })!,
        side_slope: num(raw, "side_slope", { def: 0 })!,
        working_offset_mm: num(raw, "working_offset_mm", { def: 0 })!,
        embedded_structure_m3: num(raw, "embedded_structure_m3", { def: 0 })!,
        contains_labels: strList(raw.contains_labels),
      };
    case "steel_member":
      return {
        ...base,
        designation: raw.designation != null ? String(raw.designation) : "",
        length_mm: num(raw, "length_mm", { required: true })!,
        connection_pct: num(raw, "connection_pct", { def: 3.0 })!,
      };
    case "truss":
      return {
        ...base,
        span_mm: num(raw, "span_mm", { def: 0 })!,
        connection_pct: num(raw, "connection_pct", { def: 5.0 })!,
        segments: trussSegments(raw.segments),
      };
    case "anchor_bolt":
      return {
        ...base,
        dia_mm: num(raw, "dia_mm", { required: true, gt0: true })!,
        length_mm: num(raw, "length_mm", { required: true, gt0: true })!,
      };
    case "roof_sheeting":
      return {
        ...base,
        length_mm: num(raw, "length_mm", { required: true })!,
        breadth_mm: num(raw, "breadth_mm", { required: true })!,
        lap_pct: num(raw, "lap_pct", { def: 0 })!,
        opening_area_m2: num(raw, "opening_area_m2", { def: 0 })!,
      };
    default:
      throw new Error(`Unhandled member_type '${t}'`);
  }
}
