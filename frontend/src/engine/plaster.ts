// Plaster / finishes. Ported from plaster.py. Unit: m2.
import * as mat from "./materials";
import { Member } from "./members";
import { Quantity, mmToM, pyRound, qty, step, fmt0 } from "./units";

const CLAUSE = "IS 1200 Part 12";

export function plaster_surface(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), H = mmToM(m.height_mm);
  const n = m.count;
  const gross = L * H * m.faces;

  let deduct = 0.0;
  for (const op of m.openings || []) {
    const area = mmToM(op.width_mm) * mmToM(op.height_mm);
    if (area > mat.PLASTER_OPENING_DEDUCT_THRESHOLD) deduct += area * m.faces * op.count;
  }

  const net = Math.max(gross - deduct, 0.0) * n;
  const mortar = net * mmToM(m.thickness_mm);
  return [qty({
    category: "plaster",
    description: `Plaster ${m.label} (${fmt0(m.thickness_mm)} mm, ${m.faces} face/s)`.trim(),
    unit: "m2", value: net, nos: n, length_m: L, depth_m: H,
    audit: [step("plaster.area", "(L*H*faces - openings(>0.5m2))*count",
      { L_m: L, H_m: H, faces: m.faces, deduct_openings_m2: deduct, count: n }, net, CLAUSE)],
    extra: { mortar_m3: pyRound(mortar, 3) },
  })];
}
