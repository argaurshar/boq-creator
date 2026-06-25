// Structural / MS steel. Ported from steel.py. Unit: kg.
import * as mat from "./materials";
import { Member, TrussSegment } from "./members";
import { Quantity, mmToM, qty, step } from "./units";

export function steel_member(m: Member): Quantity[] {
  const L = mmToM(m.length_mm);
  const n = m.count;
  const conn = 1 + m.connection_pct / 100.0;
  const r = mat.resolveSteel(m.designation);

  if (r.unit_wt_kg_m !== null) {
    const total = r.unit_wt_kg_m * L * n * conn;
    return [qty({
      category: "steel",
      description: `Structural steel ${m.label} (${m.designation})`.trim(),
      unit: "kg", value: total, nos: n, length_m: L,
      audit: [step("steel.section.weight", "unit_wt * L * count * (1 + connection_pct)",
        { unit_wt_kg_m: r.unit_wt_kg_m, basis: r.basis, L_m: L, count: n, connection_pct: m.connection_pct },
        total, "IS 808 / SP 6(1)")],
    })];
  }

  if (r.piece_wt_kg !== null) {
    const total = r.piece_wt_kg * n * conn;
    return [qty({
      category: "steel",
      description: `Steel plate ${m.label} (${m.designation})`.trim(),
      unit: "kg", value: total, nos: n,
      audit: [step("steel.plate.weight", "L*W*t*7850 * count * (1 + connection_pct)",
        { piece_wt_kg: r.piece_wt_kg, basis: r.basis, count: n, connection_pct: m.connection_pct },
        total, "IS 808 / SP 6(1)")],
    })];
  }

  // Truly unknown: surface a zero-weight line with an assumption so the engine
  // never silently fabricates a number.
  return [qty({
    category: "steel",
    description: `Steel member ${m.label} (${m.designation}) — UNKNOWN SECTION`,
    unit: "kg", value: 0.0, nos: n, length_m: L,
    audit: [step("steel.unknown_section", "section not recognised (table or geometry)",
      { designation: m.designation }, 0.0, "IS 808")],
  })];
}

// A truss: an assembly of steel segments (rafters, ties, struts, verticals…).
// Each segment's weight comes from the same resolveSteel() used for single
// members, so any rolled or parametric section already resolves. One BOQ line
// per truss type, with a per-segment breakdown carried in `extra` for export.
export function truss(m: Member): Quantity[] {
  const segments: TrussSegment[] = m.segments || [];
  const conn = 1 + (m.connection_pct ?? 5.0) / 100.0;
  const n = m.count;
  const unknown: string[] = [];

  let perTruss = 0.0;
  const breakdown = segments.map((s) => {
    const L = mmToM(s.length_mm);
    const r = mat.resolveSteel(s.designation);
    let wt = 0.0;
    let basis = r.basis;
    if (r.unit_wt_kg_m !== null) {
      wt = r.unit_wt_kg_m * L * s.count;
    } else if (r.piece_wt_kg !== null) {
      wt = r.piece_wt_kg * s.count;
    } else {
      basis = "UNKNOWN SECTION";
      unknown.push(s.designation);
    }
    perTruss += wt;
    return {
      component: s.component, designation: s.designation, basis,
      length_m: L, count: s.count, weight_kg: wt,
    };
  });

  const total = perTruss * conn * n;
  const desc = `Steel truss ${m.label}`.trim() +
    (unknown.length ? ` — ${unknown.length} unknown section(s)` : "");
  return [qty({
    category: "steel",
    description: desc,
    unit: "kg", value: total, nos: n,
    audit: [step("steel.truss.weight",
      "sum(segment_wt) * (1 + connection_pct) * count",
      { per_truss_kg: perTruss, connection_pct: m.connection_pct ?? 5.0, count: n,
        segments: breakdown },
      total, "IS 808 / SP 6(1)")],
    extra: { truss_segments: breakdown, per_truss_kg: perTruss },
  })];
}
