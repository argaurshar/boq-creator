// In-browser "backend": the static (GitHub Pages) build runs the ported
// quantity engine locally and persists data in localStorage. The public API
// mirrors the old fetch client so the UI is unchanged. The Python backend
// still exists for local/Codespaces use, but this build does not need it.

import { buildBoq, StoredMember, Boq, BoqItem, BoqGroup } from "./engine/boq";
import {
  Discipline, DEFAULT_DISCIPLINE, disciplineInfo, inScope, outOfScopeReason,
} from "./engine/disciplines";

import { validateMember } from "./engine/members";
import { computeMember } from "./engine/compute";
import { roundQty } from "./engine/units";
import { CATEGORY_ORDER } from "./engine/compute";
import { DEFAULT_UNITS, DEMO_MEMBERS, DEMO_RATES } from "./engine/demo";
import { mockParseNl } from "./engine/nl";
import { claudeParseNl, claudeExtract, claudeReview, DEFAULT_MODEL } from "./engine/claude";
import {
  AuthVariant, ProviderInfo, ProviderPref, authVariantFor, modelFor,
  normalizeKey, resolveProvider,
} from "./engine/providers";
import { downloadBoqXlsx } from "./engine/export";
import {
  PACK_PROMPT_SHAPES, PACK_DEMO_MEMBERS, PACK_UNITS, PACK_DEMO_RATES,
} from "./engine/packs";

// Discipline packs contribute extraction-prompt shapes, demo elements, units
// and indicative rates; packs.ts merges them so api.ts never imports a pack.
function packPromptShapes(): string { return PACK_PROMPT_SHAPES; }
function packDemoMembers(): Record<string, any>[] { return PACK_DEMO_MEMBERS; }
const ALL_UNITS: Record<string, string> = { ...DEFAULT_UNITS, ...PACK_UNITS };
const ALL_DEMO_RATES: Record<string, number> = { ...DEMO_RATES, ...PACK_DEMO_RATES };

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
  /** Active take-off discipline — exactly one per run (the discipline gate). */
  discipline?: Discipline;
  /** Contingency added on top of the grand total — persisted so the printed
   *  report and the workbook show the same figure as the screen. */
  contingency_pct?: number;
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
// Bring-your-own AI key (kept only in this browser).
//
// The key may be an Anthropic key (sk-ant-…) or a kie.ai key (sk-kie-…), which
// serves the same Claude models on kie.ai credits. Paste either one: the
// prefix picks the endpoint, unless the user overrides it in the key dialog.
// --------------------------------------------------------------------------- //
const KEY_STORAGE = "boq.anthropicApiKey";     // historical name, any provider
const PROVIDER_STORAGE = "boq.apiProvider";    // "auto" | "anthropic" | "kie"

export function getApiKey(): string {
  try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
}
export function setApiKey(key: string): void {
  try {
    const k = normalizeKey(key);
    // Reply-length ceilings belong to the account that was measured, not to
    // the host: a different key can be a different plan. Keeping one would
    // silently truncate every reply on the new key, with nothing on screen to
    // say why, so a key change starts from "no ceiling known".
    if (k !== getApiKey()) {
      localStorage.removeItem(CAP_STORAGE);
      localStorage.removeItem(AUTH_STORAGE);
    }
    if (k) {
      localStorage.setItem(KEY_STORAGE, k);
    } else {
      // No key, no provider choice: a pin left behind would silently apply to
      // whatever key is pasted next.
      localStorage.removeItem(KEY_STORAGE);
      localStorage.removeItem(PROVIDER_STORAGE);
    }
  } catch { /* ignore */ }
}

/** The user's provider choice: "auto" (decide from the key) by default. */
export function getProviderPref(): ProviderPref {
  try {
    const v = localStorage.getItem(PROVIDER_STORAGE);
    return v === "anthropic" || v === "kie" ? v : "auto";
  } catch { return "auto"; }
}
export function setProviderPref(pref: ProviderPref): void {
  try {
    if (pref === "auto") localStorage.removeItem(PROVIDER_STORAGE);
    else localStorage.setItem(PROVIDER_STORAGE, pref);
  } catch { /* ignore */ }
}

/** The provider every AI call in this browser goes to right now. */
export function getProvider(): ProviderInfo {
  return resolveProvider(getApiKey(), getProviderPref());
}

/**
 * Key, provider and model read together, once.
 *
 * A multi-page extraction runs for minutes. Reading the key at the start and
 * the provider per page would send the old key to a new host the moment the
 * user edits the key mid-run — a credential handed to a provider it does not
 * belong to. They are only ever read as a set.
 */
export function credentials(): {
  key: string; provider: ProviderInfo; model: string; maxTokensCap: number;
  auth: AuthVariant;
} {
  const key = getApiKey();
  const provider = resolveProvider(key, getProviderPref());
  const model = modelFor(provider, storedModel(provider));
  return {
    key, provider, model,
    maxTokensCap: getMaxTokensCap(provider, model),
    auth: getAuthVariant(provider),
  };
}

// What a host was found to accept, per provider *and model*: a gateway can cap
// the reply length below what a page read asks for, and max_tokens limits are
// a property of the model, not of the host — a gateway reselling several
// Claude models can serve one at full length and cap another. The self-test
// measures the ladder on exactly one model, so that is what the number
// describes. Keyed by provider alone, a ceiling found for one model would
// silently throttle every other model on that host, and clamping down does
// not fail loudly: it returns a 200 carrying a truncated object, which
// surfaces much later as "did not return valid JSON". A model nobody has
// measured has no ceiling, and asks for the full length.
const CAP_STORAGE = "boq.aiMaxTokens";
const capKey = (provider: ProviderInfo, model: string) => `${provider.id}|${model}`;
function caps(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(CAP_STORAGE) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}
export function getMaxTokensCap(provider?: ProviderInfo, model?: string): number {
  const p = provider || getProvider();
  const n = Number(caps()[capKey(p, model || storedModel(p))]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
/** Record (cap > 0) or clear (cap <= 0) the ceiling found for one model. */
export function setMaxTokensCap(provider: ProviderInfo, model: string, cap: number): void {
  const all = caps();
  const k = capKey(provider, model);
  if (cap > 0) all[k] = cap;
  else delete all[k];
  try { localStorage.setItem(CAP_STORAGE, JSON.stringify(all)); } catch { /* ignore */ }
}

// How the key goes on the wire, per provider. A host that documents more than
// one auth route may honour only one of them; the 🔑 self-test finds which and
// records it here, so every later call is sent the way that host answered to.
// Forgotten with the key, since it was discovered for that account.
const AUTH_STORAGE = "boq.aiAuthMode";
function authModes(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTH_STORAGE) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}
export function getAuthVariant(provider?: ProviderInfo): AuthVariant {
  const p = provider || getProvider();
  return authVariantFor(p, authModes()[p.id]);
}
export function setAuthVariant(provider: ProviderInfo, variant: AuthVariant): void {
  const all = authModes();
  all[provider.id] = authVariantFor(provider, variant);
  try { localStorage.setItem(AUTH_STORAGE, JSON.stringify(all)); } catch { /* ignore */ }
}

// Which Claude model to use for AI calls (extraction + chat). Default Sonnet;
// users can switch to Opus for maximum extraction completeness on hard
// drawings, or to any id a gateway turns out to serve — what is chosen is what
// is sent, because our per-provider list is a convenience, not a catalogue.
// Kept per provider: an id discovered on a gateway ("claude-3-7-sonnet", say)
// is meaningless on the other host, and since a chosen model is now sent
// verbatim, carrying it across would 404 the first call after a key change.
// Each provider remembers its own choice instead.
const MODEL_STORAGE = "boq.claudeModel";
function modelMap(): Record<string, string> {
  let raw = "";
  try { raw = localStorage.getItem(MODEL_STORAGE) || ""; } catch { return {}; }
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object") return v as Record<string, string>;
    if (typeof v === "string") return { "*": v };
  } catch { /* an older build stored the bare id, not JSON */ }
  return { "*": raw };
}
function storedModel(provider?: ProviderInfo): string {
  const map = modelMap();
  const id = (provider || getProvider()).id;
  return map[id] || map["*"] || DEFAULT_MODEL;
}
export function getModel(): string {
  try { const p = getProvider(); return modelFor(p, storedModel(p)); } catch { return DEFAULT_MODEL; }
}
export function setModel(model: string, provider?: ProviderInfo): void {
  try {
    const map = modelMap();
    map[(provider || getProvider()).id] = model;
    localStorage.setItem(MODEL_STORAGE, JSON.stringify(map));
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
      discipline: body.discipline || DEFAULT_DISCIPLINE,
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
    const proj = getProject(pid);
    const rows: StoredMember[] = (store.members[pid] || []).map((m) => ({
      id: m.id, params: m.params, source: m.source, confidence: m.confidence,
      is_verified: m.is_verified, label: m.label,
    }));
    return ok(buildBoq(rows, store.rates[pid] || {}, proj.discipline || DEFAULT_DISCIPLINE));
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
      category, label, unit: ALL_UNITS[category] || "", rate: r[category] ?? 0,
    })));
  },

  setRate: (pid: number, category: string, rate: number) => {
    getProject(pid);
    if (!KNOWN_CATS.has(category)) throw new Error(`Unknown category '${category}'`);
    // A negative or non-numeric rate can never be right; clamp rather than store it.
    const r = Math.max(0, Number(rate) || 0);
    (store.rates[pid] ||= {})[category] = r;
    save();
    return ok({ category, rate: r });
  },

  nlEdit: async (pid: number, text: string) => {
    const p = getProject(pid);
    const key = getApiKey();
    const discipline = p.discipline || DEFAULT_DISCIPLINE;
    const context = {
      currency: p.currency, default_grade: "M25",
      discipline, discipline_types: disciplineInfo(discipline).types,
    };
    let result: any;
    let provider: string;
    if (key) {
      provider = "claude";
      const cred = credentials();
      result = await claudeParseNl(
        text, context, cred.key, cred.model, packPromptShapes(), cred.provider,
        cred.maxTokensCap, cred.auth);
    } else {
      provider = "mock";
      result = mockParseNl(text, discipline);
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
        // Say so before Apply if the element would land outside the active
        // discipline — it will be registered, not measured.
        if (!inScope(m.member_type, discipline)) {
          preview.out_of_scope = outOfScopeReason(m.member_type, discipline);
          result.message += ` Note: ${preview.out_of_scope}`;
        }
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
    // Read once, for the whole run: see credentials().
    const {
      key, provider: aiProvider, model: aiModel, maxTokensCap: aiCap,
      auth: aiAuth,
    } = credentials();
    if (!key) {
      throw new Error("Set your AI key (🔑 in the top bar, under ⋯ on a phone) to read PDFs — an Anthropic (sk-ant-…) or a kie.ai (sk-kie-…) key both work.");
    }
    // Lazy-load pdf.js (large) only when a PDF is actually uploaded.
    const { renderPdf } = await import("./engine/pdf");
    const pages = await renderPdf(file, onProgress);
    let saved = 0;
    const rejected: any[] = [];
    const unresolved: any[] = [];
    const reviews: any[] = [];
    const discipline = p.discipline || DEFAULT_DISCIPLINE;
    const ctx = {
      concrete_grade: "M25", cover_mm: 40, currency: p.currency,
      discipline, discipline_types: disciplineInfo(discipline).types,
    };
    for (const pg of pages) {
      onProgress?.(`Reading ${file.name} — page ${pg.page_no}/${pages.length} with AI (${disciplineInfo(discipline).label})…`);
      const result = await claudeExtract({
        page_no: pg.page_no, page_text: pg.text, page_image_b64: pg.image_b64,
        scale: "unknown", context: ctx, apiKey: key, model: aiModel, onProgress,
        provider: aiProvider, maxTokensCap: aiCap, auth: aiAuth,
        discipline, extraShapes: packPromptShapes(),
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
          members: result.members || [], context: ctx, apiKey: key, model: aiModel,
          extraShapes: packPromptShapes(), provider: aiProvider, maxTokensCap: aiCap,
          auth: aiAuth,
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

  seedDemo: (pid: number, discipline?: string) => {
    const p = getProject(pid);
    const d = discipline || p.discipline || DEFAULT_DISCIPLINE;
    // Seed only elements the active discipline measures: a demo that lands
    // mostly in the out-of-scope register teaches the wrong lesson.
    const pool = [...DEMO_MEMBERS, ...packDemoMembers()]
      .filter((raw) => disciplineInfo(d).types.includes(raw.member_type));
    if (!pool.length) {
      throw new Error(`No demo elements exist for ${disciplineInfo(d).label} yet.`);
    }
    // Idempotent: a second click must not double every element.
    const have = new Set((store.members[pid] || []).map((m) => `${m.member_type}|${m.label}`));
    let added = 0;
    for (const raw of pool) {
      if (have.has(`${raw.member_type}|${raw.label}`)) continue;
      addMemberInternal(pid, { ...raw, source: "manual" });
      added += 1;
    }
    const r = (store.rates[pid] ||= {});
    for (const [cat, rate] of Object.entries(ALL_DEMO_RATES)) {
      if (r[cat] === undefined) r[cat] = rate;
    }
    save();
    return ok({ seeded_members: added, skipped: pool.length - added });
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
