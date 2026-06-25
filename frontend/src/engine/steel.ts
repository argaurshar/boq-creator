// Structural / MS steel. Ported from steel.py. Unit: kg.
import * as mat from "./materials";
import { Member } from "./members";
import { Quantity, mmToM, qty, step } from "./units";

export function steel_member(m: Member): Quantity[] {
  const unit_wt = mat.sectionUnitWeight(m.designation);
  const L = mmToM(m.length_mm);
  const n = m.count;
  if (unit_wt === null) {
    return [qty({
      category: "steel",
      description: `Steel member ${m.label} (${m.designation}) — UNKNOWN SECTION`,
      unit: "kg", value: 0.0, nos: n, length_m: L,
      audit: [step("steel.unknown_section", "section not in IS 808/SP 6 table",
        { designation: m.designation }, 0.0, "IS 808")],
    })];
  }
  const base = unit_wt * L * n;
  const total = base * (1 + m.connection_pct / 100.0);
  return [qty({
    category: "steel",
    description: `Structural steel ${m.label} (${m.designation})`.trim(),
    unit: "kg", value: total, nos: n, length_m: L,
    audit: [step("steel.section.weight", "unit_wt * L * count * (1 + connection_pct)",
      { unit_wt_kg_m: unit_wt, L_m: L, count: n, connection_pct: m.connection_pct }, total, "IS 808 / SP 6(1)")],
  })];
}
