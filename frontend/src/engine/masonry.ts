// Brickwork / masonry. Ported from masonry.py. Unit: m3 (or m2 for half-brick).
import * as mat from "./materials";
import { Member } from "./members";
import { Quantity, mmToM, pyRound, qty, step, fmt0 } from "./units";

const CLAUSE = "IS 1200 Part 3";

export function brick_wall(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), H = mmToM(m.height_mm), t = mmToM(m.thickness_mm);
  const n = m.count;

  let deduct_area = 0.0;
  for (const op of m.openings || []) {
    const area = mmToM(op.width_mm) * mmToM(op.height_mm);
    if (area > mat.MASONRY_OPENING_DEDUCT_THRESHOLD) deduct_area += area * op.count;
  }

  if (m.thickness_mm <= 115) {
    const net = Math.max(L * H - deduct_area, 0.0) * n;
    return [qty({
      category: "masonry",
      description: `Half-brick masonry ${m.label} (${fmt0(m.thickness_mm)} mm thick)`.trim(),
      unit: "m2", value: net, nos: n, length_m: L, depth_m: H,
      audit: [step("masonry.half_brick.area", "(L*H - openings(>0.1m2))*count",
        { L_m: L, H_m: H, deduct_openings_m2: deduct_area, count: n }, net, CLAUSE)],
    })];
  }

  const gross = L * H * t;
  const deductions = deduct_area * t + (m.embedded_rcc_m3 ?? 0);
  const clamped = deductions >= gross && gross > 0;
  const net = Math.max(gross - deductions, 0.0) * n;
  const bricks = net * mat.BRICKS_PER_M3;
  const extra: Record<string, any> = { bricks_est: pyRound(bricks, 0) };
  let desc = `Brickwork ${m.label} (${fmt0(m.thickness_mm)} mm thick)`.trim();
  if (clamped) {
    desc += " — review: openings/embedded RCC ≥ wall volume";
    extra.warning =
      `Net masonry clamped to 0: deductions ${pyRound(deductions, 3)} m³ ` +
      `≥ gross wall ${pyRound(gross, 3)} m³ (per unit). Check openings / embedded_labels.`;
  }
  return [qty({
    category: "masonry",
    description: desc,
    unit: "m3", value: net, nos: n, length_m: L, breadth_m: t, depth_m: H,
    audit: [step("masonry.brickwork.volume",
      "(L*H*t - openings(>0.1m2)*t - embedded_rcc)*count",
      { L_m: L, H_m: H, t_m: t, deduct_openings_m3: deduct_area * t,
        embedded_rcc_m3: m.embedded_rcc_m3 ?? 0, count: n }, net, CLAUSE)],
    extra,
  })];
}
