// Concrete & RCC volumes and formwork. Ported from concrete.py. Units: m3 / m2.
import { Member } from "./members";
import { Quantity, mmToM, qty, step, fmt0 } from "./units";

const CLAUSE = "IS 1200 Part 2 / IS 456";

const grade = (m: Member) => m.concrete_grade ?? "M25";

export function column(m: Member): Quantity[] {
  const b = mmToM(m.b_mm), D = mmToM(m.D_mm), H = mmToM(m.height_mm);
  const n = m.count;
  const vol = b * D * H * n;
  const shutter = 2 * (b + D) * H * n;
  const label = `${grade(m)} RCC column ${m.label}`.trim();
  return [
    qty({
      category: "concrete", description: `${label} (${fmt0(m.b_mm)}x${fmt0(m.D_mm)} mm)`,
      unit: "m3", value: vol, nos: n, length_m: b, breadth_m: D, depth_m: H,
      audit: [step("concrete.column.volume", "b*D*H*count",
        { b_m: b, D_m: D, H_m: H, count: n }, vol, CLAUSE)],
      extra: { grade: grade(m) },
    }),
    qty({
      category: "formwork", description: `Formwork to column ${m.label}`.trim(),
      unit: "m2", value: shutter, nos: n,
      audit: [step("concrete.column.formwork", "2*(b+D)*H*count",
        { b_m: b, D_m: D, H_m: H, count: n }, shutter, CLAUSE)],
    }),
  ];
}

export function beam(m: Member): Quantity[] {
  const b = mmToM(m.b_mm), d = mmToM(m.depth_mm), L = mmToM(m.clear_span_mm);
  const n = m.count;
  const vol = b * d * L * n;
  const shutter = (2 * d + b) * L * n;
  const label = `${grade(m)} RCC beam ${m.label}`.trim();
  return [
    qty({
      category: "concrete", description: `${label} (${fmt0(m.b_mm)}x${fmt0(m.depth_mm)} mm)`,
      unit: "m3", value: vol, nos: n, length_m: L, breadth_m: b, depth_m: d,
      audit: [step("concrete.beam.volume", "b*d*L*count",
        { b_m: b, d_m: d, L_m: L, count: n }, vol, CLAUSE)],
      extra: { grade: grade(m) },
    }),
    qty({
      category: "formwork", description: `Formwork to beam ${m.label}`.trim(),
      unit: "m2", value: shutter, nos: n,
      audit: [step("concrete.beam.formwork", "(2*d+b)*L*count",
        { b_m: b, d_m: d, L_m: L, count: n }, shutter, CLAUSE)],
    }),
  ];
}

export function footing(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), B = mmToM(m.breadth_mm), D = mmToM(m.depth_mm);
  const n = m.count;
  const vol = L * B * D * n;
  const shutter = 2 * (L + B) * D * n;   // vertical side shuttering of the pad
  const label = `${grade(m)} RCC footing ${m.label}`.trim();
  return [
    qty({
      category: "concrete", description: `${label} (${fmt0(m.length_mm)}x${fmt0(m.breadth_mm)} mm)`,
      unit: "m3", value: vol, nos: n, length_m: L, breadth_m: B, depth_m: D,
      audit: [step("concrete.footing.volume", "L*B*D*count",
        { L_m: L, B_m: B, D_m: D, count: n }, vol, CLAUSE)],
      extra: { grade: grade(m) },
    }),
    qty({
      category: "formwork", description: `Formwork to footing ${m.label}`.trim(),
      unit: "m2", value: shutter, nos: n,
      audit: [step("concrete.footing.formwork", "2*(L+B)*D*count",
        { L_m: L, B_m: B, D_m: D, count: n }, shutter, CLAUSE)],
    }),
  ];
}

export function slab(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), B = mmToM(m.breadth_mm), t = mmToM(m.thickness_mm);
  const n = m.count;
  const gross_area = L * B;
  const net_area = Math.max(gross_area - (m.opening_area_m2 ?? 0), 0.0);
  const vol = net_area * t * n;
  const shutter = net_area * n;
  const label = `${grade(m)} RCC slab ${m.label}`.trim();
  return [
    qty({
      category: "concrete", description: `${label} (${fmt0(m.thickness_mm)} mm thick)`,
      unit: "m3", value: vol, nos: n, length_m: L, breadth_m: B, depth_m: t,
      audit: [step("concrete.slab.volume", "(L*B - openings)*t*count",
        { L_m: L, B_m: B, openings_m2: m.opening_area_m2 ?? 0, t_m: t, count: n }, vol, CLAUSE)],
      extra: { grade: grade(m) },
    }),
    qty({
      category: "formwork", description: `Formwork (soffit) to slab ${m.label}`.trim(),
      unit: "m2", value: shutter, nos: n,
      audit: [step("concrete.slab.formwork", "(L*B - openings)*count",
        { net_area_m2: net_area, count: n }, shutter, CLAUSE)],
    }),
  ];
}

export function rcc_wall(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), H = mmToM(m.height_mm), t = mmToM(m.thickness_mm);
  const n = m.count;
  const vol = L * t * H * n;
  const shutter = 2 * L * H * n;
  const label = `${grade(m)} RCC wall ${m.label}`.trim();
  return [
    qty({
      category: "concrete", description: `${label} (${fmt0(m.thickness_mm)} mm thick)`,
      unit: "m3", value: vol, nos: n, length_m: L, breadth_m: t, depth_m: H,
      audit: [step("concrete.wall.volume", "L*t*H*count",
        { L_m: L, t_m: t, H_m: H, count: n }, vol, CLAUSE)],
      extra: { grade: grade(m) },
    }),
    qty({
      category: "formwork", description: `Formwork to wall ${m.label}`.trim(),
      unit: "m2", value: shutter, nos: n,
      audit: [step("concrete.wall.formwork", "2*L*H*count",
        { L_m: L, H_m: H, count: n }, shutter, CLAUSE)],
    }),
  ];
}

export function pcc(m: Member): Quantity[] {
  const L = mmToM(m.length_mm), B = mmToM(m.breadth_mm), t = mmToM(m.thickness_mm);
  const n = m.count;
  const vol = L * B * t * n;
  return [
    qty({
      category: "concrete", description: `PCC / lean concrete ${m.label} (${fmt0(m.thickness_mm)} mm)`.trim(),
      unit: "m3", value: vol, nos: n, length_m: L, breadth_m: B, depth_m: t,
      audit: [step("concrete.pcc.volume", "L*B*t*count",
        { L_m: L, B_m: B, t_m: t, count: n }, vol, CLAUSE)],
      extra: { grade: grade(m) },
    }),
  ];
}
