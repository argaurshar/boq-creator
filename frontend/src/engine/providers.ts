// Where the AI key goes.
//
// The app talks to the Anthropic Messages API. That API is served by more than
// one host: Anthropic itself, and gateways that re-expose it (kie.ai resells
// the same Claude models on credits). The request body is identical; only the
// URL and the auth header differ. This module is the single place that knows
// the difference, so the rest of the app just asks for "the provider".
//
// The user should never have to say which one they are on: the key prefix
// says it. Paste sk-ant-… and you are on Anthropic; paste sk-kie-… and you are
// on kie.ai. Mirrors backend/app/ai/providers.py.

export type ProviderId = "anthropic" | "kie";
/** What the user chose in the key dialog: a provider, or let the key decide. */
export type ProviderPref = ProviderId | "auto";

export interface ProviderInfo {
  id: ProviderId;
  /** Full name, for prose. */
  label: string;
  /** Short name, for buttons and chips. */
  short: string;
  /** API root, as the provider documents it (no /v1/messages). */
  baseUrl: string;
  /** Messages endpoint (POST) — baseUrl + /v1/messages. */
  url: string;
  /** Key prefixes that identify this provider. */
  keyPrefixes: string[];
  /** Shown under the key box, e.g. "starts with sk-ant-". */
  keyHint: string;
  /** Where to get a key. */
  keyUrl: string;
  /** How the key is sent. */
  auth: "x-api-key" | "bearer";
  /** One line describing what this provider is. */
  blurb: string;
  /** Models offered, as [id, label]. */
  models: Array<[string, string]>;
}

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_BASE = "https://api.anthropic.com";
const KIE_BASE = "https://api.kie.ai/claude";

// Both providers serve the same two models, so switching provider never
// silently changes which model reads your drawings.
const MODELS: Array<[string, string]> = [
  ["claude-sonnet-4-6", "Sonnet (fast)"],
  ["claude-opus-4-8", "Opus (most thorough)"],
];

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (direct)",
    short: "Anthropic",
    baseUrl: ANTHROPIC_BASE,
    url: `${ANTHROPIC_BASE}/v1/messages`,
    keyPrefixes: ["sk-ant-"],
    keyHint: "starts with sk-ant-",
    keyUrl: "https://console.anthropic.com/settings/keys",
    auth: "x-api-key",
    blurb: "Your own Anthropic account — billed by Anthropic.",
    models: MODELS,
  },
  kie: {
    id: "kie",
    label: "Kie.ai",
    short: "Kie.ai",
    // kie.ai documents the base URL as https://api.kie.ai/claude and says the
    // client appends /v1/messages itself — which is what we do here.
    baseUrl: KIE_BASE,
    url: `${KIE_BASE}/v1/messages`,
    keyPrefixes: ["sk-kie-"],
    keyHint: "starts with sk-kie-",
    keyUrl: "https://kie.ai/api-key",
    // kie.ai accepts the key as a bearer token (their ANTHROPIC_AUTH_TOKEN
    // route); the x-api-key route wants the literal text "Bearer <key>", so
    // bearer is the unambiguous one to send.
    auth: "bearer",
    blurb: "Same Claude models through kie.ai credits — billed by kie.ai.",
    models: MODELS,
  },
};

export const DEFAULT_PROVIDER: ProviderId = "anthropic";
export const PROVIDER_LIST: ProviderInfo[] = [PROVIDERS.anthropic, PROVIDERS.kie];

/**
 * Tidy a pasted key. People paste what the docs show them, which includes
 * quotes, stray whitespace, and — from kie.ai's Claude Code instructions —
 * a literal "Bearer " prefix. All of those mean the same key.
 */
export function normalizeKey(raw: string): string {
  let k = String(raw ?? "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(k)) k = k.replace(/^bearer\s+/i, "").trim();
  return k;
}

/** Which provider issued this key? null when the prefix says nothing. */
export function detectProvider(key: string): ProviderId | null {
  const k = normalizeKey(key).toLowerCase();
  if (!k) return null;
  for (const p of PROVIDER_LIST) {
    if (p.keyPrefixes.some((prefix) => k.startsWith(prefix))) return p.id;
  }
  return null;
}

/**
 * The provider to call with this key. An explicit choice wins; otherwise the
 * key's own prefix decides; a key that looks like neither falls back to
 * Anthropic (the historical behaviour, so old stored keys keep working).
 */
export function resolveProvider(key: string, pref: ProviderPref = "auto"): ProviderInfo {
  if (pref !== "auto" && PROVIDERS[pref]) return PROVIDERS[pref];
  return PROVIDERS[detectProvider(key) || DEFAULT_PROVIDER];
}

export function providerInfo(id: string | null | undefined): ProviderInfo {
  return PROVIDERS[(id as ProviderId)] || PROVIDERS[DEFAULT_PROVIDER];
}

/** Request headers for one provider — the only thing that differs per host. */
export function authHeaders(provider: ProviderInfo, key: string): Record<string, string> {
  const k = normalizeKey(key);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (provider.auth === "bearer") {
    headers["authorization"] = `Bearer ${k}`;
  } else {
    headers["x-api-key"] = k;
    // Anthropic blocks browser calls unless the caller opts in explicitly.
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  return headers;
}

/** Models this provider offers; used to keep the model picker honest. */
export function modelsFor(provider: ProviderInfo): Array<[string, string]> {
  return provider.models;
}

/** Keep a stored model only if the active provider serves it. */
export function modelFor(provider: ProviderInfo, model: string): string {
  return provider.models.some(([id]) => id === model)
    ? model
    : provider.models[0][0];
}
