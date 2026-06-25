// Roof sheeting / cladding. Ported from roofing.py. Unit: m2.
// Covered area with a lap/overlap allowance (GI/AC/PPGI sheets), openings netted.
import { Member } from "./members";
import { Quantity, mmToM, qty, step, fmt0 } from "./units";

const CLAUSE = "IS 1200 Part 22";

export function roof_sheeting(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), B = mmToM(m.breadth_mm);
  const n = m.count;
  const lap = 1 + (m.lap_pct ?? 0) / 100.0;
  const opening = m.opening_area_m2 ?? 0;
  const area = Math.max(L * B - opening, 0.0) * n * lap;
  return [qty({
    category: "roofing",
    description: `Roof sheeting ${m.label} (${fmt0(m.length_mm)}x${fmt0(m.breadth_mm)} mm)`.trim(),
    unit: "m2", value: area, nos: n, length_m: L, breadth_m: B,
    audit: [step("roofing.sheeting.area",
      "max(L*B - openings, 0) * count * (1 + lap_pct)",
      { L_m: L, B_m: B, opening_area_m2: opening, lap_pct: m.lap_pct ?? 0, count: n },
      area, CLAUSE)],
  })];
}
