// Deterministic, key-free natural-language parser. Ported from
// backend/app/ai/mock_provider.py. Parses one plain-English instruction into a
// single typed member (the engine then computes quantities).

export interface NlResult {
  op: "add" | "modify" | "delete" | "noop";
  member?: Record<string, any> | null;
  target_label?: string;
  message: string;
}

const num = (s: string) => parseFloat(s);

function toMm(value: number, unit?: string): number {
  if (unit && ["m", "meter", "metre", "meters", "metres"].includes(unit)) return value * 1000;
  if (unit === "cm") return value * 10;
  if (unit && ["ft", "feet", "foot", "'"].includes(unit)) return value * 304.8;
  return value;
}

const DIMS = /(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)(?:\s*[xX*]\s*(\d+(?:\.\d+)?))?/;
const GRADE = /\bM\s?(\d{2})\b/i;
const COUNT = /(?:add|create|excavate)?\s*(\d+)\s+(column|beam|footing|slab|wall|brick\s*wall|pcc|pit|plaster|roof|sheet)/i;
const DEPTH = /(\d+(?:\.\d+)?)\s*(m|cm|mm|ft)?\s*(?:deep|depth)/i;
const LAP = /(\d+(?:\.\d+)?)\s*%\s*(?:lap|overlap)/i;

// Surface dimensions typed as "4x3" are metres; "4000x3000" are millimetres.
// Nothing under 100 mm makes sense for a wall or roof dimension.
const surfMm = (v: number) => (v < 100 ? v * 1000 : v);
const HEIGHT = /(\d+(?:\.\d+)?)\s*(m|cm|mm|ft|feet)?\s*(?:high|height|tall|ht)/i;
const SPAN = /(?:span|long|length)\s*(?:of)?\s*(\d+(?:\.\d+)?)\s*(m|cm|mm|ft)?/i;
const THICK = /(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*(?:thick|thk)/i;
const BARS = /(\d+)\s*[-x ]\s*(\d+)\s*(?:mm)?\s*(?:dia|ø|bars?|nos)?/i;

function ties(t: string): Record<string, any> | null {
  const m = /(?:stirrup|tie|ties)s?\s*(\d+)?\s*(?:mm)?\s*@?\s*(\d+)/i.exec(t);
  if (m) return { dia_mm: num(m[1] || "8"), legs: 2, spacing_mm: num(m[2]) };
  return null;
}

function openings(t: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  const re = /(\d{3,4})\s*[xX]\s*(\d{3,4})\s*(?:door|window|opening)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    out.push({ width_mm: num(m[1]), height_mm: num(m[2]), count: 1 });
  }
  return out;
}

function parseMember(text: string): Record<string, any> | null {
  const t = text.toLowerCase();
  const gm = GRADE.exec(t);
  const grade = gm ? "M" + gm[1] : "M25";
  let count = 1;
  const cm = COUNT.exec(t);
  if (cm) count = parseInt(cm[1], 10);
  const common = { count, concrete_grade: grade, source: "nl", confidence: 0.9 };

  if (t.includes("pcc") || t.includes("lean concrete")) {
    const d = DIMS.exec(t);
    const th = THICK.exec(t);
    if (!d) return null;
    return {
      member_type: "pcc", label: "PCC-nl",
      length_mm: num(d[1]), breadth_mm: num(d[2]),
      thickness_mm: th ? toMm(num(th[1]), th[2]) : d[3] ? num(d[3]) : 100,
      ...common, concrete_grade: gm ? grade : "M10",
    };
  }

  if (t.includes("excavat") || t.includes("earthwork") || /\bpits?\b/.test(t)) {
    const d = DIMS.exec(t);
    const dp = DEPTH.exec(t);
    if (!d) return null;
    const depth = dp ? toMm(num(dp[1]), dp[2]) : d[3] ? num(d[3]) : null;
    if (depth == null) return null;
    return {
      member_type: "earthwork_pit", label: "E-nl",
      length_mm: num(d[1]), breadth_mm: num(d[2]), depth_mm: depth,
      count, source: "nl", confidence: 0.85,
    };
  }

  if (t.includes("column")) {
    const d = DIMS.exec(t);
    const h = HEIGHT.exec(t);
    if (!d) return null;
    const seg = t.replace(DIMS, " "); // strip section dims before reading bars
    const bars = t.includes("bar") ? BARS.exec(seg) : null;
    const main = bars ? [{ dia_mm: num(bars[2]), count: parseInt(bars[1], 10) }] : [];
    return {
      member_type: "column", label: "C-nl",
      b_mm: num(d[1]), D_mm: num(d[2]),
      height_mm: h ? toMm(num(h[1]), h[2]) : 3000,
      main_bars: main, ties: ties(t), ...common,
    };
  }

  if (t.includes("beam")) {
    const d = DIMS.exec(t);
    const sp = SPAN.exec(t);
    if (!d) return null;
    return {
      member_type: "beam", label: "B-nl",
      b_mm: num(d[1]), depth_mm: num(d[2]),
      clear_span_mm: sp ? toMm(num(sp[1]), sp[2]) : 4000,
      stirrups: ties(t), ...common,
    };
  }

  if (t.includes("footing")) {
    const d = DIMS.exec(t);
    if (!d) return null;
    return {
      member_type: "footing", label: "F-nl",
      length_mm: num(d[1]), breadth_mm: num(d[2]),
      depth_mm: d[3] ? num(d[3]) : 400, ...common,
    };
  }

  if (t.includes("slab")) {
    const d = DIMS.exec(t);
    const th = THICK.exec(t);
    if (!d) return null;
    return {
      member_type: "slab", label: "S-nl",
      length_mm: num(d[1]), breadth_mm: num(d[2]),
      thickness_mm: th ? toMm(num(th[1]), th[2]) : 125, ...common,
    };
  }

  if (t.includes("plaster")) {
    const d = DIMS.exec(t);
    const h = HEIGHT.exec(t);
    const sp = SPAN.exec(t);
    const th = THICK.exec(t);
    const length = sp ? toMm(num(sp[1]), sp[2]) : d ? surfMm(num(d[1])) : null;
    if (length == null) return null;
    const faces = /both\s*(?:sides?|faces?)|2\s*(?:sides?|faces?)|two\s*(?:sides?|faces?)/.test(t) ? 2 : 1;
    return {
      member_type: "plaster_surface", label: "PL-nl",
      length_mm: length,
      height_mm: h ? toMm(num(h[1]), h[2]) : d ? surfMm(num(d[2])) : 3000,
      thickness_mm: th ? toMm(num(th[1]), th[2]) : 12,
      faces, openings: openings(t), count, source: "nl", confidence: 0.85,
    };
  }

  if (t.includes("roof") || t.includes("sheet")) {
    const d = DIMS.exec(t);
    const lap = LAP.exec(t);
    if (!d) return null;
    return {
      member_type: "roof_sheeting", label: "R-nl",
      length_mm: surfMm(num(d[1])), breadth_mm: surfMm(num(d[2])),
      lap_pct: lap ? num(lap[1]) : 0,
      count, source: "nl", confidence: 0.85,
    };
  }

  if (t.includes("brick") || t.includes("wall")) {
    const d = DIMS.exec(t);
    const h = HEIGHT.exec(t);
    const sp = SPAN.exec(t);
    const th = THICK.exec(t);
    const length = sp ? toMm(num(sp[1]), sp[2]) : d ? num(d[1]) : 3000;
    return {
      member_type: "brick_wall", label: "W-nl",
      length_mm: length,
      height_mm: h ? toMm(num(h[1]), h[2]) : 3000,
      thickness_mm: th ? toMm(num(th[1]), th[2]) : 230,
      openings: openings(t), count, source: "nl", confidence: 0.85,
    };
  }

  return null;
}

// One worked example per discipline for the "couldn't parse" hint, so the
// suggestion is something the active take-off would actually measure.
const HINTS: Record<string, string> = {
  structure: "Try e.g. 'add 5 columns 300x600 3m high with 8-16mm bars M25'.",
  civil: "Try e.g. 'excavate 4 pits 2000x2000 1.5m deep' or 'add 4 pcc 2000x2000 100 thick'.",
  architecture: "Try e.g. 'add 2 brick walls 4m long 3m high 230 thick with a 1200x2100 door' or 'plaster 4x3 both sides 12 thick'.",
  interior: "The key-free parser knows RCC, masonry, plaster and roofing only — set your AI key (🔑) for interior items, or use ➕ Add element.",
};

export function mockParseNl(text: string, discipline?: string): NlResult {
  // Typed "×" (and its look-alikes) mean "x" in a dimension.
  const norm = text.replace(/[×✕✖]/g, "x");
  const t = norm.trim().toLowerCase();
  if (t.startsWith("delete") || t.startsWith("remove")) {
    return {
      op: "noop",
      message: "Deleting via chat isn't supported yet — use the delete button on the element in the left panel.",
    };
  }
  const member = parseMember(norm);
  if (member === null) {
    return {
      op: "noop",
      message: `Sorry, I couldn't parse that. ${HINTS[discipline || ""] || HINTS.structure}`,
    };
  }
  return {
    op: "add",
    member,
    message: `Parsed a ${member.member_type} (${member.label || ""}).`,
  };
}
