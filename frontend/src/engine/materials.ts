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
