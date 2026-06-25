// Material constants and reference tables. Ported from
// backend/app/engine/materials.py (project.md section 3).

export const REBAR_WEIGHT_DIVISOR = 162.0;

export const DEFAULT_LAP_FACTOR = 50; // Ld = 50 * d
export const STOCK_BAR_LENGTH_M = 12.0;

export const HOOK_ALLOWANCE = 9; // +9d per 180-deg hook
export const BEND_DEDUCTION_90 = 2; // -2d per 90-deg bend
export const BEND_DEDUCTION_45 = 1; // -1d per 45-deg bend
export const CRANK_EXTRA_FACTOR = 0.42; // +0.42*D per 45-deg crank

export const STEEL_DENSITY = 7850.0;
export const RCC_DENSITY = 2500.0;

export const DEFAULT_WASTAGE_PCT = 3.0;

export const MASONRY_OPENING_DEDUCT_THRESHOLD = 0.1;
export const PLASTER_OPENING_DEDUCT_THRESHOLD = 0.5;

export const BRICKS_PER_M3 = 500;

// Structural steel section unit weights (kg/m), IS 808 / SP 6(1).
export const STEEL_SECTIONS: Record<string, number> = {
  ISMB100: 11.5, ISMB125: 13.3, ISMB150: 14.9, ISMB175: 19.3,
  ISMB200: 25.4, ISMB225: 31.2, ISMB250: 37.3, ISMB300: 44.2,
  ISMB350: 52.4, ISMB400: 61.6, ISMB450: 72.4, ISMB500: 86.9,
  ISMB600: 122.6,
  ISMC75: 6.8, ISMC100: 9.2, ISMC125: 12.7, ISMC150: 16.4,
  ISMC175: 19.1, ISMC200: 22.1, ISMC250: 30.4, ISMC300: 36.3,
  ISMC400: 49.4,
  ISA50X50X6: 4.5, ISA65X65X6: 5.8, ISA75X75X6: 6.8,
  ISA75X75X8: 8.9, ISA90X90X8: 10.8, ISA100X100X8: 12.1,
  ISA100X100X10: 14.9, ISA130X130X10: 19.7, ISA150X150X12: 27.3,
  ISHB150: 27.1, ISHB200: 37.3, ISHB250: 51.0, ISHB300: 58.8,
  ISLB75: 6.1, ISLB100: 8.0, ISLB125: 11.9, ISLB150: 14.2,
  ISLB175: 16.7, ISLB200: 19.8, ISLB225: 23.5, ISLB250: 27.9,
  ISLB300: 37.7, ISLB350: 49.5, ISLB400: 56.9, ISLB450: 65.3,
  ISLB500: 75.0, ISLB600: 99.5,
  ISWB150: 17.0, ISWB175: 22.1, ISWB200: 28.8, ISWB225: 33.9,
  ISWB250: 40.9, ISWB300: 48.1, ISWB350: 56.9, ISWB400: 66.7,
  ISWB450: 79.7, ISWB500: 95.2, ISWB550: 112.5, ISWB600: 133.7,
  ISMC350: 42.1, ISMC375: 50.6,
};

export function rebarUnitWeight(dia_mm: number): number {
  return (dia_mm * dia_mm) / REBAR_WEIGHT_DIVISOR;
}

export function sectionUnitWeight(designation: string): number | null {
  if (!designation) return null;
  const key = designation.toUpperCase().replace(/ /g, "").replace(/-/g, "");
  return key in STEEL_SECTIONS ? STEEL_SECTIONS[key] : null;
}

export interface SteelResolve {
  unit_wt_kg_m: number | null; // weight per metre (linear members)
  piece_wt_kg: number | null; // weight per piece (plates)
  basis: string; // human-readable derivation, for the audit trail
}

// kg/m for a section of cross-sectional area in mm^2.
const wPerM = (area_mm2: number) => (area_mm2 / 1e6) * STEEL_DENSITY;

// Resolve a steel weight from a free-text designation. Falls back from the
// rolled-section table to geometry-derived weights for parametric sections
// (SHS/RHS, angles, pipes, flats, rounds) and plates — so a section that isn't
// in the table still gets a real weight instead of zero. All deterministic
// (density x geometry, IS 808 / SP 6 conventions); no AI.
export function resolveSteel(designation: string): SteelResolve {
  const none: SteelResolve = { unit_wt_kg_m: null, piece_wt_kg: null, basis: "" };
  if (!designation) return none;
  const D = designation.toUpperCase();
  const key = D.replace(/ /g, "").replace(/-/g, "");

  // 1. Rolled section in the IS 808 / SP 6 table.
  if (key in STEEL_SECTIONS) {
    return { unit_wt_kg_m: STEEL_SECTIONS[key], piece_wt_kg: null, basis: "IS 808 / SP 6 table" };
  }

  const n = (D.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  const has = (re: RegExp) => re.test(D);

  // 2. Plate / gusset / base plate: finite piece L x W x t (mm).
  if (has(/PLATE|PLT|GUSSET/) && n.length >= 3) {
    const [L, W, t] = n;
    return { unit_wt_kg_m: null, piece_wt_kg: (L * W * t / 1e9) * STEEL_DENSITY,
             basis: `plate ${L}x${W}x${t} mm` };
  }
  // 3. Square / rectangular hollow section.
  if (has(/\bSHS\b|\bRHS\b|\bHSS\b|TUBE|HOLLOW/)) {
    let h, b, t;
    if (n.length >= 3) [h, b, t] = n;
    else if (n.length === 2) { [h, t] = n; b = h; } // e.g. SHS 100x4 (square)
    if (h && b && t && h > 2 * t && b > 2 * t) {
      return { unit_wt_kg_m: wPerM(h * b - (h - 2 * t) * (b - 2 * t)), piece_wt_kg: null,
               basis: `hollow section ${h}x${b}x${t} mm` };
    }
  }
  // 4. Angle (equal or unequal): legs + thickness.
  if (has(/\bISA\b|ANGLE/) && n.length >= 2) {
    let a, b, t;
    if (n.length >= 3) [a, b, t] = n;
    else { [a, t] = n; b = a; } // equal angle leg x thk
    if (a && b && t) {
      return { unit_wt_kg_m: wPerM((a + b - t) * t), piece_wt_kg: null,
               basis: `angle ${a}x${b}x${t} mm` };
    }
  }
  // 5. Pipe / circular hollow section: outer dia x thickness.
  if (has(/PIPE|\bCHS\b|CIRCULAR/) && n.length >= 2) {
    const [od, t] = n;
    if (od && t && od > 2 * t) {
      return { unit_wt_kg_m: wPerM(Math.PI * (od - t) * t), piece_wt_kg: null,
               basis: `pipe ${od}x${t} mm` };
    }
  }
  // 6. Flat bar: width x thickness.
  if (has(/FLAT|\bFLT\b|\bISF\b/) && n.length >= 2) {
    const [w, t] = n;
    if (w && t) return { unit_wt_kg_m: wPerM(w * t), piece_wt_kg: null, basis: `flat ${w}x${t} mm` };
  }
  // 7. Round bar: diameter.
  if (has(/ROUND|\bRND\b|Ø/) && n.length >= 1) {
    const d = n[0];
    if (d) return { unit_wt_kg_m: wPerM((Math.PI / 4) * d * d), piece_wt_kg: null, basis: `round ${d} mm dia` };
  }
  return none;
}
