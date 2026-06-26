// BOQ assembly + cross-member netting. Ported from backend/app/services.py.
import { CATEGORY_ORDER, computeMember, concreteVolume } from "./compute";
import { Member, validateMember } from "./members";
import { roundQty, pyRound } from "./units";

export interface StoredMember {
  id: number;
  params: Record<string, any>;
  source: string;
  confidence: number;
  is_verified: boolean;
  label: string;
}

export interface BoqItem {
  member_id: number | null;
  source: string;
  confidence: number;
  is_verified: boolean;
  category: string;
  description: string;
  unit: string;
  quantity: number;
  nos: number | null;
  length_m: number | null;
  breadth_m: number | null;
  depth_m: number | null;
  rate: number;
  amount: number;
  audit: any[];
  extra: Record<string, any>;
}

export interface BoqGroup {
  category: string;
  label: string;
  items: BoqItem[];
  subtotal: number;
}

export interface Boq {
  groups: BoqGroup[];
  grand_total: number;
  errors: any[];
}

function applyNetting(m: Member, volByLabel: Record<string, number>): Member {
  const fromContains = Array.isArray(m.contains_labels) && m.contains_labels.length;
  const labels: string[] | null = fromContains
    ? m.contains_labels
    : Array.isArray(m.embedded_labels) && m.embedded_labels.length
      ? m.embedded_labels
      : null;
  if (!labels) return m;
  const total = labels.reduce((s, lbl) => s + (volByLabel[lbl] || 0.0), 0);
  const per_unit = total / Math.max(m.count, 1);
  if (fromContains) return { ...m, embedded_structure_m3: per_unit };
  return { ...m, embedded_rcc_m3: per_unit };
}

export function buildBoq(members: StoredMember[], rates: Record<string, number>): Boq {
  const catGroups: Record<string, BoqItem[]> = {};
  for (const [c] of CATEGORY_ORDER) catGroups[c] = [];
  const errors: any[] = [];

  // Pass 1: validate + map label -> total concrete volume.
  const validated: { row: StoredMember; member: Member }[] = [];
  const volByLabel: Record<string, number> = {};
  for (const row of members) {
    let member: Member;
    try {
      member = validateMember(row.params);
    } catch (e: any) {
      errors.push({ member_id: row.id, error: String(e.message || e), label: row.label });
      continue;
    }
    validated.push({ row, member });
    if (member.label) {
      volByLabel[member.label] = (volByLabel[member.label] || 0.0) + concreteVolume(member);
    }
  }

  // Dedup: when a truss assembly is present, drop loose steel_member lines that
  // re-list its parts (the AI sometimes emits a truss AND its chords/webs/struts
  // as separate members). Match on truss-part wording; never touch base plates,
  // anchor bolts, stiffeners or column-connection pieces. Removed lines are
  // reported as warnings, not silently dropped.
  const hasTruss = validated.some((v) => v.member.member_type === "truss");
  const DUP_RE = /(top chord|bottom chord|\bchord\b|bottom tie|\btie\b|rafter|\bweb\b|\bstrut\b|purlin|transverse|longitudinal|bracing|diagonal|vertical)/i;
  const kept = validated.filter(({ row, member }) => {
    if (hasTruss && member.member_type === "steel_member") {
      const hay = `${member.label || ""} ${member.evidence || ""} ${member.designation || ""}`;
      if (DUP_RE.test(hay)) {
        errors.push({
          member_id: row.id, label: member.label, warning: true,
          error: `Removed probable duplicate steel (already counted in the truss): ${(member.designation || "").trim()} ${(member.label || "").trim()}`.trim(),
        });
        return false;
      }
    }
    return true;
  });

  // Pass 2: compute quantities with netting applied.
  for (const { row, member } of kept) {
    const effective = applyNetting(member, volByLabel);
    for (const q of computeMember(effective)) {
      const rate = Number(rates[q.category] ?? 0.0);
      const quantity = roundQty(q.value, q.unit);
      (catGroups[q.category] || (catGroups[q.category] = [])).push({
        member_id: row.id,
        source: row.source,
        confidence: row.confidence,
        is_verified: row.is_verified,
        category: q.category,
        description: q.description,
        unit: q.unit,
        quantity,
        nos: q.nos,
        length_m: q.length_m,
        breadth_m: q.breadth_m,
        depth_m: q.depth_m,
        rate,
        amount: pyRound(quantity * rate, 2),
        audit: q.audit,
        extra: q.extra,
      });
    }
  }

  const groups: BoqGroup[] = [];
  let grand_total = 0.0;
  for (const [cat, label] of CATEGORY_ORDER) {
    const items = catGroups[cat] || [];
    if (!items.length) continue;
    const subtotal = pyRound(items.reduce((s, i) => s + i.amount, 0), 2);
    grand_total += subtotal;
    groups.push({ category: cat, label, items, subtotal });
  }

  return { groups, grand_total: pyRound(grand_total, 2), errors };
}
