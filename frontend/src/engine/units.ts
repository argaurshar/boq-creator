// Units, rounding (IS 1200) and core result types of the in-browser engine.
// Ported from backend/app/engine/units.py — kept numerically identical so the
// static (GitHub Pages) build produces the same quantities as the Python API.

export const MM_PER_M = 1000.0;

export function mmToM(value_mm: number | null | undefined): number {
  return (value_mm || 0.0) / MM_PER_M;
}

// Match Python's round() closely enough for our values: both operate on the
// same IEEE-754 float, so Math.round(x*10^n)/10^n reproduces CPython's result
// for the non-exact-tie products this engine generates.
export function pyRound(x: number, n = 0): number {
  if (!isFinite(x)) return x;
  const m = Math.pow(10, n);
  return Math.round(x * m) / m;
}

// Presentation rounding per IS 1200 conventions.
export const ROUNDING: Record<string, number> = {
  m: 2,
  m2: 2,
  m3: 3,
  kg: 2,
  MT: 3,
  Nos: 0,
};

export function roundQty(value: number, unit: string): number {
  return pyRound(value, unit in ROUNDING ? ROUNDING[unit] : 3);
}

export interface FormulaStep {
  formula_id: string;
  expression: string;
  inputs: Record<string, unknown>;
  result: number;
  clause_ref: string;
}

export function step(
  formula_id: string,
  expression: string,
  inputs: Record<string, unknown>,
  result: number,
  clause_ref = ""
): FormulaStep {
  return { formula_id, expression, inputs, result, clause_ref };
}

export interface Quantity {
  category: string; // concrete | rebar | steel | earthwork | masonry | plaster | formwork
  description: string;
  unit: string; // m3 | m2 | kg | MT | Nos
  value: number; // raw (unrounded)
  nos: number | null;
  length_m: number | null;
  breadth_m: number | null;
  depth_m: number | null;
  audit: FormulaStep[];
  extra: Record<string, any>;
}

export function qty(init: {
  category: string;
  description: string;
  unit: string;
  value: number;
  nos?: number | null;
  length_m?: number | null;
  breadth_m?: number | null;
  depth_m?: number | null;
  audit?: FormulaStep[];
  extra?: Record<string, any>;
}): Quantity {
  return {
    category: init.category,
    description: init.description,
    unit: init.unit,
    value: init.value,
    nos: init.nos ?? null,
    length_m: init.length_m ?? null,
    breadth_m: init.breadth_m ?? null,
    depth_m: init.depth_m ?? null,
    audit: init.audit ?? [],
    extra: init.extra ?? {},
  };
}

// Format a mm dimension like Python's f"{v:.0f}".
export function fmt0(v: number): string {
  return String(Math.round(v));
}
