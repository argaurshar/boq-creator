// Reinforcement / Bar Bending Schedule. Ported from rebar.py. Unit: kg.
import * as mat from "./materials";
import { Member, BarMesh } from "./members";
import { Quantity, mmToM, pyRound, qty, step } from "./units";

interface BbsRow {
  mark: string;
  dia_mm: number;
  count: number;
  cutting_length_m: number;
  unit_weight_kg_m: number;
  total_weight_kg: number;
}

function bbsRow(mark: string, dia_mm: number, count: number, cut_len_m: number): { row: BbsRow; total: number } {
  const unit_wt = mat.rebarUnitWeight(dia_mm);
  const total_wt = cut_len_m * count * unit_wt;
  return {
    row: {
      mark, dia_mm, count,
      cutting_length_m: pyRound(cut_len_m, 3),
      unit_weight_kg_m: pyRound(unit_wt, 4),
      total_weight_kg: pyRound(total_wt, 3),
    },
    total: total_wt,
  };
}

function lapsExtra(length_m: number, dia_mm: number): number {
  const n_laps = Math.floor(length_m / mat.STOCK_BAR_LENGTH_M);
  return n_laps * mat.DEFAULT_LAP_FACTOR * mmToM(dia_mm);
}

function straightBarCutLength(clear_m: number, cover_m: number, dia_mm: number, hooks = 2): number {
  let base = clear_m - 2 * cover_m + hooks * mat.HOOK_ALLOWANCE * mmToM(dia_mm);
  base = Math.max(base, 0.0);
  return base + lapsExtra(base, dia_mm);
}

function crankExtra(d_eff_m: number, n_cranks = 2): number {
  return n_cranks * mat.CRANK_EXTRA_FACTOR * Math.max(d_eff_m, 0.0);
}

function stirrupCutLength(a_m: number, b_m: number, dia_mm: number): number {
  const d = mmToM(dia_mm);
  const perimeter = 2 * (a_m + b_m);
  const hooks = 2 * mat.HOOK_ALLOWANCE * d;
  const bends = 3 * mat.BEND_DEDUCTION_90 * d;
  return Math.max(perimeter + hooks - bends, 0.0);
}

function stirrupCount(span_m: number, cover_m: number, spacing_mm: number | null, zones: any[]): number {
  if (zones && zones.length) {
    let total = 0;
    for (const z of zones) {
      if (z.spacing_mm && z.spacing_mm > 0) {
        total += pyRound(mmToM(z.length_mm) / mmToM(z.spacing_mm), 0);
      }
    }
    return total + 1;
  }
  if (spacing_mm) {
    const usable = Math.max(span_m - 2 * cover_m, 0.0);
    return Math.floor(usable / mmToM(spacing_mm)) + 1;
  }
  return 0;
}

function summarise(rows: BbsRow[], member_label: string, n_members: number): Quantity {
  const weight = rows.reduce((s, r) => s + r.total_weight_kg, 0) * n_members;
  const wastage = (weight * mat.DEFAULT_WASTAGE_PCT) / 100.0;
  const total = weight + wastage;
  const scaled = rows.map((r) => ({
    ...r,
    count: r.count * n_members,
    total_weight_kg: pyRound(r.total_weight_kg * n_members, 3),
  }));
  return qty({
    category: "rebar",
    description: `Reinforcement steel for ${member_label}`.trim(),
    unit: "kg", value: total, nos: n_members,
    audit: [step("rebar.summary", "sum(cut_len*count*d^2/162) * (1+wastage)",
      { steel_kg: pyRound(weight, 3), wastage_pct: mat.DEFAULT_WASTAGE_PCT }, total, "SP 34 / IS 2502")],
    extra: { bbs: scaled, wastage_pct: mat.DEFAULT_WASTAGE_PCT },
  });
}

export function column(m: Member): Quantity[] {
  if (!m.main_bars || !m.main_bars.length) return [];
  const cover = mmToM(m.cover_mm);
  const H = mmToM(m.height_mm);
  const rows: BbsRow[] = [];
  m.main_bars.forEach((bg: any, i: number) => {
    const cut = H + mat.DEFAULT_LAP_FACTOR * mmToM(bg.dia_mm) + lapsExtra(H, bg.dia_mm);
    rows.push(bbsRow(`${m.label}-M${i + 1}`, bg.dia_mm, bg.count, cut).row);
  });
  if (m.ties && m.ties.spacing_mm) {
    const a = mmToM(m.b_mm) - 2 * cover;
    const b = mmToM(m.D_mm) - 2 * cover;
    const cut = stirrupCutLength(a, b, m.ties.dia_mm);
    const cnt = stirrupCount(H, cover, m.ties.spacing_mm, m.ties.zones);
    rows.push(bbsRow(`${m.label}-T`, m.ties.dia_mm, cnt, cut).row);
  }
  return rows.length ? [summarise(rows, `column ${m.label}`, m.count)] : [];
}

export function beam(m: Member): Quantity[] {
  const cover = mmToM(m.cover_mm);
  const L = mmToM(m.clear_span_mm);
  const rows: BbsRow[] = [];
  (m.top_bars || []).forEach((bg: any, i: number) => {
    const cut = straightBarCutLength(L, cover, bg.dia_mm, 2);
    rows.push(bbsRow(`${m.label}-Top${i + 1}`, bg.dia_mm, bg.count, cut).row);
  });
  (m.bottom_bars || []).forEach((bg: any, i: number) => {
    const cut = straightBarCutLength(L, cover, bg.dia_mm, 2);
    rows.push(bbsRow(`${m.label}-Bot${i + 1}`, bg.dia_mm, bg.count, cut).row);
  });
  if (m.stirrups) {
    const a = mmToM(m.b_mm) - 2 * cover;
    const b = mmToM(m.depth_mm) - 2 * cover;
    const cut = stirrupCutLength(a, b, m.stirrups.dia_mm);
    const cnt = stirrupCount(L, cover, m.stirrups.spacing_mm, m.stirrups.zones);
    rows.push(bbsRow(`${m.label}-Stp`, m.stirrups.dia_mm, cnt, cut).row);
  }
  return rows.length ? [summarise(rows, `beam ${m.label}`, m.count)] : [];
}

function meshRows(mark: string, mesh: BarMesh, span_along_m: number, bar_len_m: number, cover_m: number, crank_extra_m = 0.0): BbsRow {
  const n = Math.floor(Math.max(span_along_m - 2 * cover_m, 0.0) / mmToM(mesh.spacing_mm)) + 1;
  let cut = Math.max(bar_len_m - 2 * cover_m, 0.0) + crank_extra_m;
  cut += lapsExtra(cut, mesh.dia_mm);
  return bbsRow(mark, mesh.dia_mm, n, cut).row;
}

export function footing(m: Member): Quantity[] {
  const cover = mmToM(m.cover_mm);
  const L = mmToM(m.length_mm), B = mmToM(m.breadth_mm);
  const rows: BbsRow[] = [];
  if (m.mesh_bottom_x) rows.push(meshRows(`${m.label}-X`, m.mesh_bottom_x, B, L, cover));
  if (m.mesh_bottom_y) rows.push(meshRows(`${m.label}-Y`, m.mesh_bottom_y, L, B, cover));
  return rows.length ? [summarise(rows, `footing ${m.label}`, m.count)] : [];
}

export function slab(m: Member): Quantity[] {
  const cover = mmToM(m.cover_mm);
  const L = mmToM(m.length_mm), B = mmToM(m.breadth_mm);
  const rows: BbsRow[] = [];
  if (m.main_bars) rows.push(meshRows(`${m.label}-Main`, m.main_bars, L, B, cover));
  if (m.dist_bars) rows.push(meshRows(`${m.label}-Dist`, m.dist_bars, B, L, cover));
  if (m.bent_up_bars) {
    const d_eff = mmToM(m.thickness_mm) - 2 * cover;
    rows.push(meshRows(`${m.label}-BentUp`, m.bent_up_bars, L, B, cover, crankExtra(d_eff)));
  }
  return rows.length ? [summarise(rows, `slab ${m.label}`, m.count)] : [];
}
