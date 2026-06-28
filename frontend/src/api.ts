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
import { claudeParseNl, claudeExtract, claudeReview, DEFAULT_MODEL } from "./engine/claude";
import { downloadBoqXlsx } from "./engine/export";

export type { Boq, BoqItem, BoqGroup };

export interface Project {
  id: number;
  name: string;
  client: string;
  location: string;
  currency: string;
  prepared_by?: string;
  report_date?: string;
  drawing_ref?: string;
  built_up_area_m2?: number;
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

// Which Claude model to use for AI calls (extraction + chat). Default Sonnet;
// users can switch to Opus for maximum extraction completeness on hard drawings.
const MODEL_STORAGE = "boq.claudeModel";
export function getModel(): string {
  try { return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; }
}
export function setModel(model: string): void {
  try { localStorage.setItem(MODEL_STORAGE, model); } catch { /* ignore */ }
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

  updateProject: (pid: number, patch: Partial<Project>) => {
    const p = getProject(pid);
    Object.assign(p, patch, { id: p.id });
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

  // Wipe every element of a project. Used to start a fresh BOQ whenever a new
  // set of drawings is uploaded, so a new upload never mixes with old entries.
  clearMembers: (pid: number) => {
    getProject(pid);
    const removed = (store.members[pid] || []).length;
    store.members[pid] = [];
    save();
    return ok({ cleared: removed });
  },

  verifyMember: (mid: number) => {
    for (const pid of Object.keys(store.members)) {
      const m = store.members[Number(pid)].find((x) => x.id === mid);
      if (m) { m.is_verified = true; save(); return ok(memberDTO(m)); }
    }
    return ok({ error: "not found" });
  },

  // Edit an existing element in place; re-validates and recomputes the BOQ.
  updateMember: (mid: number, body: any): Promise<Member> => {
    for (const pid of Object.keys(store.members)) {
      const rec = store.members[Number(pid)].find((x) => x.id === mid);
      if (!rec) continue;
      const m = validateMember(body); // throws on invalid
      rec.params = m;
      rec.member_type = m.member_type;
      rec.label = m.label;
      rec.confidence = m.confidence;
      // source and is_verified are preserved (editing doesn't change provenance).
      save();
      return ok(memberDTO(rec));
    }
    return Promise.reject(new Error("Member not found"));
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
      result = await claudeParseNl(text, context, key, getModel());
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
    onProgress?: (msg: string) => void,
    review = true
  ): Promise<{ saved: number; rejected: any[]; unresolved: any[]; pages: number; reviews: any[] }> => {
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
    const reviews: any[] = [];
    const ctx = { concrete_grade: "M25", cover_mm: 40, currency: p.currency };
    for (const pg of pages) {
      onProgress?.(`Reading ${file.name} — page ${pg.page_no}/${pages.length} with AI…`);
      const result = await claudeExtract({
        page_no: pg.page_no, page_text: pg.text, page_image_b64: pg.image_b64,
        scale: "unknown", context: ctx, apiKey: key, model: getModel(), onProgress,
      });
      // Save members, remembering id↔label↔type so review suggestions can target them.
      const savedThisPage: { id: number; label: string; member_type: string }[] = [];
      for (const raw of result.members || []) {
        try {
          const m = addMemberInternal(pid, { ...raw, source: "ai" });
          saved++;
          savedThisPage.push({ id: m.id, label: m.label, member_type: m.member_type });
        } catch (e: any) {
          rejected.push({ error: String(e.message || e), raw });
        }
      }
      for (const u of result.unresolved || []) unresolved.push(u);

      // AI re-check: critique this page's take-off against the drawing image.
      if (review && (result.members || []).length) {
        onProgress?.(`Re-checking ${file.name} — page ${pg.page_no}/${pages.length}…`);
        const sugg = await claudeReview({
          page_no: pg.page_no, page_image_b64: pg.image_b64,
          members: result.members || [], context: ctx, apiKey: key, model: getModel(),
        });
        for (const r of sugg) {
          const lbl = String(r.target_label || "").trim().toLowerCase();
          const hit = savedThisPage.find(
            (s) => s.label.trim().toLowerCase() === lbl &&
              (!r.target_type || s.member_type === r.target_type)
          );
          reviews.push({
            op: r.op,
            member_id: hit ? hit.id : null,
            target_label: r.target_label || "",
            target_type: r.target_type || "",
            severity: ["high", "med", "low"].includes(r.severity) ? r.severity : "med",
            issue: String(r.issue || ""),
            member: r.member || null,
          });
        }
      }
    }
    return { saved, rejected, unresolved, pages: pages.length, reviews };
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

  openReport: async (pid: number) => {
    const p = getProject(pid);
    const boq = await api.getBoq(pid);
    const { openBoqReport } = await import("./engine/report");
    openBoqReport(p, boq);
  },
};
