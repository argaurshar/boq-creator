// Indicative material / resource take-off derived from the computed BOQ.
// Deterministic (dry-volume basis, IS 10262 / textbook nominal mixes). Mirrors
// backend/app/engine/material_takeoff.py.
import { Boq, BoqItem } from "./boq";
import { pyRound } from "./units";

const BAG_M3 = 0.0347;   // 1 cement bag (50 kg) ≈ 0.0347 m³
const DRY = 1.54;        // dry-volume factor for concrete

// Nominal mix ratios cement:sand:aggregate. Design mixes (M30+) and unknowns
// fall back to M25 (conservative/cement-rich) — flagged "indicative" in the UI.
const MIX: Record<string, [number, number, number]> = {
  M5: [1, 5, 10], "M7.5": [1, 4, 8], M10: [1, 3, 6],
  M15: [1, 2, 4], M20: [1, 1.5, 3], M25: [1, 1, 2],
};

function ratioFor(grade: string): [number, number, number] {
  const g = String(grade || "").toUpperCase().replace(/\s+/g, "");
  const m = g.match(/(\d+(?:\.\d+)?):(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/); // e.g. PCC1:4:8
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const key = Object.keys(MIX).find((k) => k.toUpperCase() === g);
  return key ? MIX[key] : MIX.M25;
}

export interface MatRow { material: string; qty: number; unit: string; }
export interface MatSection { title: string; rows: MatRow[]; }

export function materialTakeoff(boq: Boq): MatSection[] {
  let cementBags = 0, sand = 0, agg = 0, bricks = 0, formwork = 0, excavation = 0;
  let steelKg = 0;
  const byDia: Record<number, number> = {};

  const items: BoqItem[] = boq.groups.flatMap((g) => g.items);
  for (const it of items) {
    if (it.category === "concrete") {
      const [a, b, c] = ratioFor(String(it.extra?.grade ?? "M25"));
      const sum = a + b + c;
      const vol = it.quantity; // m³ (already includes count)
      cementBags += (DRY * a / sum * vol) / BAG_M3;
      sand += DRY * b / sum * vol;
      agg += DRY * c / sum * vol;
    } else if (it.category === "masonry" && it.unit === "m3") {
      // mortar ~0.30 m³/m³ @ 1:6, dry 1.33
      const mortarDry = it.quantity * 0.30 * 1.33;
      cementBags += (mortarDry / 7) / BAG_M3;
      sand += mortarDry * 6 / 7;
      bricks += Number(it.extra?.bricks_est ?? 0);
    } else if (it.category === "plaster") {
      // mortar from the plaster line @ 1:4, dry 1.33
      const mortarDry = Number(it.extra?.mortar_m3 ?? 0) * 1.33;
      cementBags += (mortarDry / 5) / BAG_M3;
      sand += mortarDry * 4 / 5;
    } else if (it.category === "rebar") {
      for (const r of (it.extra?.bbs as any[]) || []) {
        byDia[r.dia_mm] = (byDia[r.dia_mm] || 0) + Number(r.total_weight_kg || 0);
      }
    } else if (it.category === "steel") {
      steelKg += it.quantity; // kg
    } else if (it.category === "formwork") {
      formwork += it.quantity; // m²
    } else if (it.category === "earthwork" && /excavat/i.test(it.description)) {
      excavation += it.quantity; // m³
    }
  }

  const sections: MatSection[] = [];

  if (cementBags || sand || agg) {
    sections.push({
      title: "Cement & aggregates",
      rows: [
        { material: "Cement (OPC, 50 kg bags)", qty: pyRound(cementBags, 0), unit: "bags" },
        { material: "Sand (fine aggregate)", qty: pyRound(sand, 2), unit: "m³" },
        { material: "Coarse aggregate", qty: pyRound(agg, 2), unit: "m³" },
      ],
    });
  }

  const dias = Object.keys(byDia).map(Number).sort((a, b) => a - b);
  if (dias.length) {
    const total = dias.reduce((s, d) => s + byDia[d], 0);
    sections.push({
      title: "Reinforcement steel (TMT, by diameter)",
      rows: [
        ...dias.map((d) => ({ material: `${d} mm dia`, qty: pyRound(byDia[d], 1), unit: "kg" })),
        { material: "Total reinforcement", qty: pyRound(total, 1), unit: "kg" },
      ],
    });
  }

  if (steelKg) {
    sections.push({
      title: "Structural steel",
      rows: [
        { material: "MS sections / plates", qty: pyRound(steelKg, 1), unit: "kg" },
        { material: "  = in tonnes", qty: pyRound(steelKg / 1000, 3), unit: "MT" },
      ],
    });
  }

  const misc: MatRow[] = [];
  if (bricks) misc.push({ material: "Bricks (modular, nos)", qty: pyRound(bricks, 0), unit: "nos" });
  if (formwork) misc.push({ material: "Formwork / shuttering", qty: pyRound(formwork, 2), unit: "m²" });
  if (excavation) misc.push({ material: "Excavation (soil)", qty: pyRound(excavation, 2), unit: "m³" });
  if (misc.length) sections.push({ title: "Masonry, formwork & earthwork", rows: misc });

  return sections;
}
