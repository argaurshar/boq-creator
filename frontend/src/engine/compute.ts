// Engine orchestrator: Member -> Quantity[]. Ported from compute.py.
import * as concrete from "./concrete";
import * as earthwork from "./earthwork";
import * as masonry from "./masonry";
import * as plaster from "./plaster";
import * as rebar from "./rebar";
import * as steel from "./steel";
import * as roofing from "./roofing";
import { Member } from "./members";
import { Quantity } from "./units";

type Fn = (m: Member) => Quantity[];

const REGISTRY: Record<string, Fn[]> = {
  column: [concrete.column, rebar.column],
  beam: [concrete.beam, rebar.beam],
  footing: [concrete.footing, rebar.footing],
  slab: [concrete.slab, rebar.slab],
  rcc_wall: [concrete.rcc_wall],
  pcc: [concrete.pcc],
  brick_wall: [masonry.brick_wall],
  plaster_surface: [plaster.plaster_surface],
  earthwork_pit: [earthwork.earthwork_pit],
  steel_member: [steel.steel_member],
  truss: [steel.truss],
  anchor_bolt: [steel.anchor_bolt],
  roof_sheeting: [roofing.roof_sheeting],
};

export function computeMember(member: Member): Quantity[] {
  const fns = REGISTRY[member.member_type];
  if (!fns) throw new Error(`No engine function for member_type=${member.member_type}`);
  const out: Quantity[] = [];
  for (const fn of fns) out.push(...fn(member));
  return out;
}

export function computeAll(members: Member[]): Quantity[] {
  const out: Quantity[] = [];
  for (const m of members) out.push(...computeMember(m));
  return out;
}

export function concreteVolume(member: Member): number {
  return computeMember(member)
    .filter((q) => q.category === "concrete")
    .reduce((s, q) => s + q.value, 0);
}

export const CATEGORY_ORDER: [string, string][] = [
  ["earthwork", "Earthwork"],
  ["concrete", "Concrete & RCC"],
  ["formwork", "Formwork / Shuttering"],
  ["rebar", "Reinforcement Steel"],
  ["steel", "Structural Steel"],
  ["masonry", "Brickwork / Masonry"],
  ["plaster", "Plaster & Finishes"],
  ["roofing", "Roofing & Sheeting"],
];
