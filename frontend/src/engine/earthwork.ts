// Earthwork: excavation, backfilling, surplus. Ported from earthwork.py. Unit: m3.
import { Member } from "./members";
import { FormulaStep, Quantity, mmToM, qty, step } from "./units";

const CLAUSE = "IS 1200 Part 1";

export function earthwork_pit(m: Member): Quantity[] {
  let L = mmToM(m.length_mm), B = mmToM(m.breadth_mm);
  const D = mmToM(m.depth_mm);
  const n = m.count;
  const s = m.side_slope ?? 0;
  const off = mmToM(m.working_offset_mm);
  L = L + 2 * off;
  B = B + 2 * off;

  let exc: number;
  let st: FormulaStep;
  if (s && s > 0) {
    const a_bot = L * B;
    const a_top = (L + 2 * s * D) * (B + 2 * s * D);
    const a_mid = (L + s * D) * (B + s * D);
    exc = (D / 6.0) * (a_top + 4 * a_mid + a_bot) * n;
    st = step("earthwork.excavation.prismoidal", "D/6*(A_top+4*A_mid+A_bot)*count",
      { L_m: L, B_m: B, D_m: D, side_slope: s, count: n }, exc, CLAUSE);
  } else {
    exc = L * B * D * n;
    st = step("earthwork.excavation.vertical", "L*B*D*count",
      { L_m: L, B_m: B, D_m: D, count: n }, exc, CLAUSE);
  }

  const out: Quantity[] = [qty({
    category: "earthwork", description: `Earthwork excavation ${m.label}`.trim(),
    unit: "m3", value: exc, nos: n, length_m: L, breadth_m: B, depth_m: D, audit: [st],
  })];

  const embedded = (m.embedded_structure_m3 ?? 0) * n;
  const backfill = Math.max(exc - embedded, 0.0);
  out.push(qty({
    category: "earthwork", description: `Backfilling / refilling ${m.label}`.trim(),
    unit: "m3", value: backfill, nos: n,
    audit: [step("earthwork.backfill", "excavation - embedded_structure",
      { excavation_m3: exc, embedded_m3: embedded }, backfill, CLAUSE)],
  }));
  const surplus = Math.max(exc - backfill, 0.0);
  out.push(qty({
    category: "earthwork", description: `Surplus earth disposal ${m.label}`.trim(),
    unit: "m3", value: surplus, nos: n,
    audit: [step("earthwork.surplus", "excavation - backfill",
      { excavation_m3: exc, backfill_m3: backfill }, surplus, CLAUSE)],
  }));
  return out;
}
