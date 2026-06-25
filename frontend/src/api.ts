// Typed client for the BOQ Creator backend. Mirrors app/schemas + routes.

export interface Project {
  id: number;
  name: string;
  client: string;
  location: string;
  currency: string;
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

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

// --- Bring-your-own Anthropic key ------------------------------------------
// The key is kept only in this browser (localStorage) and attached to the AI
// endpoints (extract, nl-edit) as a per-request header. It is never persisted
// server-side. With no key set, those endpoints fall back to the mock provider.
const KEY_STORAGE = "boq.anthropicApiKey";

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

export function setApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* ignore storage failures (private mode, etc.) */
  }
}

function aiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const k = getApiKey();
  return k ? { ...extra, "X-Anthropic-Api-Key": k } : extra;
}

export const api = {
  listProjects: () => fetch("/api/projects").then((r) => j<Project[]>(r)),
  createProject: (body: Partial<Project>) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<Project>(r)),

  getBoq: (pid: number) => fetch(`/api/projects/${pid}/boq`).then((r) => j<Boq>(r)),
  listMembers: (pid: number) =>
    fetch(`/api/projects/${pid}/members`).then((r) => j<Member[]>(r)),
  addMember: (pid: number, body: any) =>
    fetch(`/api/projects/${pid}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => j<Member>(r)),
  deleteMember: (mid: number) =>
    fetch(`/api/members/${mid}`, { method: "DELETE" }).then((r) => j(r)),
  verifyMember: (mid: number) =>
    fetch(`/api/members/${mid}/verify`, { method: "POST" }).then((r) => j(r)),

  listRates: (pid: number) =>
    fetch(`/api/projects/${pid}/rates`).then((r) => j<RateRow[]>(r)),
  setRate: (pid: number, category: string, rate: number) =>
    fetch(`/api/projects/${pid}/rates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, rate }),
    }).then((r) => j(r)),

  nlEdit: (pid: number, text: string) =>
    fetch(`/api/projects/${pid}/nl-edit`, {
      method: "POST",
      headers: aiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text }),
    }).then((r) => j<{ provider: string; result: any; preview: any }>(r)),
  nlApply: (pid: number, member: any) =>
    fetch(`/api/projects/${pid}/nl-edit/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member }),
    }).then((r) => j<Member>(r)),

  uploadDrawing: (pid: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`/api/projects/${pid}/drawings`, { method: "POST", body: fd }).then(
      (r) => j<any>(r)
    );
  },
  extractPage: (did: number, n: number) =>
    fetch(`/api/drawings/${did}/pages/${n}/extract`, {
      method: "POST",
      headers: aiHeaders(),
    }).then((r) => j<any>(r)),

  seedDemo: (pid: number) =>
    fetch(`/api/projects/${pid}/seed`, { method: "POST" }).then((r) =>
      j<{ seeded_members: number }>(r)
    ),

  exportUrl: (pid: number) => `/api/projects/${pid}/export/xlsx`,
};
