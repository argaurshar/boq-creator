// In-browser "backend": the static (GitHub Pages) build runs the ported
// quantity engine locally and persists data in localStorage. The public API
// mirrors the old fetch client so the UI is unchanged. The Python backend
// still exists for local/Codespaces use, but this build does not need it.

import { buildBoq, StoredMember, Boq, BoqItem, BoqGroup } from "./engine/boq";
import { validateMember } from "./engine/members";
import { computeMember } from "./engine/compute";
import { roundQty } from "./engine/units";
import { CATEGORY_ORDER } from "./engine/compute";
import { DEFAULT_UNITS, DEMO_MEMBERS, DEMO_RATES } from "./engine/demo";
import { mockParseNl } from "./engine/nl";
import { claudeParseNl, claudeExtract } from "./engine/claude";
import { downloadBoqXlsx } from "./engine/export";

export type { Boq, BoqItem, BoqGroup };

export interface Project {
  id: number;
  name: string;
  client: string;
  location: string;
  currency: string;
}

export interface RateRow {
  category: string;
  label: string;
  unit: string;
  rate: number;
}

export interface Member {
  id: number;
  member_type: string;
  label: string;
  params: Record<string, any>;
  source: string;
  confidence: number;
  is_verified: boolean;
}

// --------------------------------------------------------------------------- //
// Bring-your-own Anthropic key (kept only in this browser).
// --------------------------------------------------------------------------- //
const KEY_STORAGE = "boq.anthropicApiKey";

export function getApiKey(): string {
  try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
}
export function setApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch { /* ignore */ }
}

// --------------------------------------------------------------------------- //
// localStorage-backed store
// --------------------------------------------------------------------------- //
interface Store {
  seq: number;
  projects: Project[];
  members: Record<number, Member[]>;
  rates: Record<number, Record<string, number>>;
}

const STORE_KEY = "boq.store.v1";

function load(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch { /* ignore */ }
  return { seq: 1, projects: [], members: {}, rates: {} };
}

let store: Store = load();

function save(): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* ignore */ }
}

function nextId(): number {
  return store.seq++;
}

function getProject(pid: number): Project {
  const p = store.projects.find((x) => x.id === pid);
  if (!p) throw new Error("Project not found");
  return p;
}

function memberDTO(m: Member): Member {
  return { id: m.id, member_type: m.member_type, label: m.label, params: m.params,
    source: m.source, confidence: m.confidence, is_verified: m.is_verified };
}

function addMemberInternal(pid: number, raw: any, forceSource?: string): Member {
  getProject(pid);
  const body = forceSource ? { ...raw, source: forceSource } : raw;
  const m = validateMember(body); // throws on invalid
  const rec: Member = {
    id: nextId(),
    member_type: m.member_type,
    label: m.label,
    params: m,
    source: m.source,
    confidence: m.confidence,
    is_verified: m.source === "manual",
  };
  (store.members[pid] ||= []).push(rec);
  save();
  return memberDTO(rec);
}

const KNOWN_CATS = new Set(CATEGORY_ORDER.map(([c]) => c));

// Simulate async so callers using await keep working.
const ok = <T>(v: T): Promise<T> => Promise.resolve(v);

export const api = {
  listProjects: () => ok([...store.projects].sort((a, b) => b.id - a.id)),

  createProject: (body: Partial<Project>) => {
    const p: Project = {
      id: nextId(),
      name: body.name || "Untitled Project",
      client: body.client || "",
      location: body.location || "",
      currency: body.currency || "INR",
    };
    store.projects.push(p);
    store.members[p.id] = [];
    store.rates[p.id] = {};
    save();
    return ok(p);
  },

  getBoq: (pid: number): Promise<Boq> => {
    getProject(pid);
    const rows: StoredMember[] = (store.members[pid] || []).map((m) => ({
      id: m.id, params: m.params, source: m.source, confidence: m.confidence,
      is_verified: m.is_verified, label: m.label,
    }));
    return ok(buildBoq(rows, store.rates[pid] || {}));
  },

  listMembers: (pid: number) =>
    ok((store.members[pid] || []).map(memberDTO)),

  addMember: (pid: number, body: any) => ok(addMemberInternal(pid, body)),

  deleteMember: (mid: number) => {
    for (const pid of Object.keys(store.members)) {
      const arr = store.members[Number(pid)];
      const i = arr.findIndex((m) => m.id === mid);
      if (i >= 0) { arr.splice(i, 1); save(); break; }
    }
    return ok({ deleted: mid });
  },

  verifyMember: (mid: number) => {
    for (const pid of Object.keys(store.members)) {
      const m = store.members[Number(pid)].find((x) => x.id === mid);
      if (m) { m.is_verified = true; save(); return ok(memberDTO(m)); }
    }
    return ok({ error: "not found" });
  },

  listRates: (pid: number): Promise<RateRow[]> => {
    getProject(pid);
    const r = store.rates[pid] || {};
    return ok(CATEGORY_ORDER.map(([category, label]) => ({
      category, label, unit: DEFAULT_UNITS[category] || "", rate: r[category] ?? 0,
    })));
  },

  setRate: (pid: number, category: string, rate: number) => {
    getProject(pid);
    if (!KNOWN_CATS.has(category)) throw new Error(`Unknown category '${category}'`);
    (store.rates[pid] ||= {})[category] = rate;
    save();
    return ok({ category, rate });
  },

  nlEdit: async (pid: number, text: string) => {
    const p = getProject(pid);
    const key = getApiKey();
    const context = { currency: p.currency, default_grade: "M25" };
    let result: any;
    let provider: string;
    if (key) {
      provider = "claude";
      result = await claudeParseNl(text, context, key);
    } else {
      provider = "mock";
      result = mockParseNl(text);
    }
    let preview: any = null;
    if (result.op === "add" && result.member) {
      try {
        const m = validateMember(result.member);
        preview = {
          member: m,
          quantities: computeMember(m).map((q) => ({
            category: q.category, unit: q.unit, rounded: roundQty(q.value, q.unit),
          })),
        };
      } catch (e: any) {
        result.op = "noop";
        result.message = "Parsed but invalid: " + (e.message || e);
      }
    }
    return { provider, result, preview };
  },

  nlApply: (pid: number, member: any) => ok(addMemberInternal(pid, member, "nl")),

  // Render a PDF in the browser and extract members from each page via Claude
  // (using the user's own key). Returns a per-file summary.
  extractDrawing: async (
    pid: number,
    file: File,
    onProgress?: (msg: string) => void
  ): Promise<{ saved: number; rejected: any[]; unresolved: any[]; pages: number }> => {
    const p = getProject(pid);
    const key = getApiKey();
    if (!key) {
      throw new Error("Set your Anthropic API key (🔑 top right) to read PDFs.");
    }
    // Lazy-load pdf.js (large) only when a PDF is actually uploaded.
    const { renderPdf } = await import("./engine/pdf");
    const pages = await renderPdf(file, onProgress);
    let saved = 0;
    const rejected: any[] = [];
    const unresolved: any[] = [];
    for (const pg of pages) {
      onProgress?.(`Reading ${file.name} — page ${pg.page_no}/${pages.length} with AI…`);
      const result = await claudeExtract({
        page_no: pg.page_no,
        page_text: pg.text,
        page_image_b64: pg.image_b64,
        scale: "unknown",
        context: { concrete_grade: "M25", cover_mm: 40, currency: p.currency },
        apiKey: key,
      });
      for (const raw of result.members || []) {
        try {
          addMemberInternal(pid, { ...raw, source: "ai" });
          saved++;
        } catch (e: any) {
          rejected.push({ error: String(e.message || e), raw });
        }
      }
      for (const u of result.unresolved || []) unresolved.push(u);
    }
    return { saved, rejected, unresolved, pages: pages.length };
  },

  seedDemo: (pid: number) => {
    getProject(pid);
    let added = 0;
    for (const raw of DEMO_MEMBERS) {
      addMemberInternal(pid, { ...raw, source: "manual" });
      added += 1;
    }
    const r = (store.rates[pid] ||= {});
    for (const [cat, rate] of Object.entries(DEMO_RATES)) {
      if (r[cat] === undefined) r[cat] = rate;
    }
    save();
    return ok({ seeded_members: added });
  },

  exportXlsx: async (pid: number) => {
    const p = getProject(pid);
    const boq = await api.getBoq(pid);
    downloadBoqXlsx(p, boq);
  },
};
