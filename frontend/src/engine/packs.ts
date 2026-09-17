// Discipline packs — the single place the rest of the app learns about the
// element types the Architecture (finishes) and Interior packs contribute.
// Each pack is a self-contained module exporting the same contract; this
// file merges them so members.ts, compute.ts, boqtable.ts, api.ts and the
// UI never import a pack directly.
import * as finishes from "./finishes";
import * as interior from "./interior";
import type { Member } from "./members";
import type { Quantity } from "./units";

export const PACKS = [finishes, interior];

export const PACK_TYPES: string[] = PACKS.flatMap((p) => p.TYPES);
export const PACK_VALIDATORS: Record<string, (raw: any, base: Member) => Member> =
  Object.assign({}, ...PACKS.map((p) => p.validators));
export const PACK_REGISTRY: Record<string, Array<(m: Member) => Quantity[]>> =
  Object.assign({}, ...PACKS.map((p) => p.registry));
export const PACK_CATEGORIES: Array<[string, string]> = PACKS.flatMap((p) => p.CATEGORIES);
export const PACK_UNITS: Record<string, string> = Object.assign({}, ...PACKS.map((p) => p.UNITS));
export const PACK_DEMO_RATES: Record<string, number> = Object.assign({}, ...PACKS.map((p) => p.DEMO_RATES));
export const PACK_DEMO_MEMBERS: Record<string, any>[] = PACKS.flatMap((p) => p.DEMO_MEMBERS);
export const PACK_UI = Object.assign({}, ...PACKS.map((p) => p.UI)) as typeof finishes.UI & typeof interior.UI;
export const PACK_ITEM_NOUN: Record<string, string> = Object.assign({}, ...PACKS.map((p) => p.ITEM_NOUN));
export const PACK_PROMPT_SHAPES: string = PACKS.map((p) => p.PROMPT_SHAPES).join("\n\n");

/** Item noun for a pack member: a pack may compute it (e.g. "Joinery — Wardrobe"). */
export function packItemNoun(it: { member_type: string; extra?: Record<string, any> | null }): string | null {
  for (const p of PACKS) {
    const dyn = (p as any).itemNoun;
    if (typeof dyn === "function") {
      const n = dyn(it);
      if (n) return n;
    }
    if (p.ITEM_NOUN[it.member_type]) return p.ITEM_NOUN[it.member_type];
  }
  return null;
}

export function packSpecText(it: { category: string; member_type: string; extra: Record<string, any> }): string | null {
  for (const p of PACKS) {
    const t = p.specText(it);
    if (t) return t;
  }
  return null;
}
