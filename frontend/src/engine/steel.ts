// Structural / MS steel. Ported from steel.py. Unit: kg.
import * as mat from "./materials";
import { Member } from "./members";
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
