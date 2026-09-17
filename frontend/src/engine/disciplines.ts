// The discipline gate.
//
// A take-off run is focused on exactly ONE discipline. Elements belonging to
// other disciplines are NOT measured — but they are never silently dropped:
// buildBoq returns them in an out-of-scope register so the user can see what
// was set aside and why. That is the whole point of the gate; a quiet drop
// would be indistinguishable from a element that was never read at all.

export type Discipline = "structure" | "architecture" | "civil" | "interior";

export interface DisciplineInfo {
  key: Discipline;
  label: string;
  icon: string;
  blurb: string;
  /** Member types this discipline measures today. */
  types: string[];
  /** Item groups the pack does NOT cover yet — surfaced in the UI verbatim. */
  notYet: string[];
}

// A member type may legitimately belong to more than one discipline: foundation
// excavation is read by a structural take-off as well as a civil one, and the
// lean-concrete layer under a footing belongs to both.
export const DISCIPLINES: DisciplineInfo[] = [
  {
    key: "structure",
    label: "Structure",
    icon: "🏗️",
    blurb: "RCC frame and structural steel — footings, columns, beams, slabs, walls, trusses.",
    types: [
      "footing", "column", "beam", "slab", "rcc_wall", "pcc",
      "steel_member", "truss", "anchor_bolt", "earthwork_pit",
    ],
    notYet: ["Staircases as a first-class type", "Retaining walls", "Precast elements"],
  },
  {
    key: "civil",
    label: "Civil",
    icon: "⛏️",
    blurb: "Site, substructure and external works — excavation, filling, lean concrete.",
    types: ["earthwork_pit", "pcc"],
    notYet: [
      "Roads and pavements", "Drainage and manholes", "Boundary wall",
      "Anti-termite treatment", "Plinth protection", "Shoring and dewatering",
    ],
  },
  {
    key: "architecture",
    label: "Architecture",
    icon: "🧱",
    blurb: "Building fabric and finishes — masonry, plaster, roof covering.",
    types: [
      "brick_wall", "plaster_surface", "roof_sheeting",
      "flooring", "wall_tiling", "false_ceiling", "painting", "door_window",
      "waterproofing", "railing",
    ],
    notYet: ["External cladding systems", "Sloped-roof waterproofing", "Staircase finishes"],
  },
  {
    key: "interior",
    label: "Interior",
    icon: "🛋️",
    blurb: "Fit-out — joinery, finishes, ceilings, loose furniture.",
    types: [
      "joinery", "glazing", "loose_furniture", "sanitary_fixture", "electrical_point",
      "flooring", "wall_tiling", "false_ceiling", "painting", "door_window",
    ],
    notYet: ["Soft furnishings and curtains", "HVAC interface", "Handover cleaning"],
  },
];

export const DEFAULT_DISCIPLINE: Discipline = "structure";

export function disciplineInfo(key: string | undefined | null): DisciplineInfo {
  return DISCIPLINES.find((d) => d.key === key) || DISCIPLINES[0];
}

/** Is this member type measured by the active discipline? */
export function inScope(memberType: string, discipline: string | undefined | null): boolean {
  return disciplineInfo(discipline).types.includes(memberType);
}

/** Which disciplines DO measure this member type (for the out-of-scope reason). */
export function disciplinesFor(memberType: string): DisciplineInfo[] {
  return DISCIPLINES.filter((d) => d.types.includes(memberType));
}

/** Human-readable reason a member was set aside, naming where it belongs. */
export function outOfScopeReason(memberType: string, discipline: string | undefined | null): string {
  const active = disciplineInfo(discipline);
  const owners = disciplinesFor(memberType);
  if (!owners.length) {
    return `No discipline pack measures "${memberType}" yet — it was read but not quantified.`;
  }
  const names = owners.map((o) => o.label).join(" or ");
  return `Measured by ${names}, not by ${active.label}. Switch discipline to include it.`;
}
