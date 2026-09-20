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
/** How a key is put on the wire. */
export type AuthVariant = "x-api-key" | "bearer" | "x-api-key-bearer";

export interface ProviderInfo {
  id: ProviderId;
  /** Full name, for prose. */
  label: string;
  /** Short name, for buttons and chips. */
  short: string;
  /** API root, as the provider documents it (no /v1/messages). */
  baseUrl: string;
  /** Messages endpoint (POST) — the first of `urls`. */
  url: string;
  /**
   * Every messages endpoint this host might be reached at, best first.
   *
   * A gateway can route on the path rather than serve the Anthropic one: one
   * kie.ai deployment glues whatever follows its base onto the model name, so
   * a request to …/claude/v1/messages asking for "claude-sonnet-5" is recorded
   * as "claude-sonnet-5-v1messages" and fails as an unknown model. The
   * self-test tries each of these and keeps the one that answers.
   */
  urls: string[];
  /** Model catalogue (GET) — baseUrl + /v1/models. Not every host serves it. */
  modelsUrl: string;
  /** Key prefixes that identify this provider. */
  keyPrefixes: string[];
  /** The key's prefix, bare: call sites write the sentence around it. */
  keyHint: string;
  /** "a" or "an" — so generated prose reads like English. */
  article: string;
  /** Where to get a key. */
  keyUrl: string;
  /** Where to add credits — not the same page as the key. */
  billingUrl: string;
  /** How the key is sent by default. */
  auth: AuthVariant;
  /**
   * Every way this host documents sending the key, best first.
   *
   * kie.ai documents two: ANTHROPIC_AUTH_TOKEN (a bearer token) and
   * ANTHROPIC_API_KEY set to the literal text "Bearer <key>" (an x-api-key
   * whose value carries the word Bearer). Which one a gateway actually honours
   * is not something we can know from here, so the self-test tries them.
   */
  authVariants: AuthVariant[];
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
  ["claude-sonnet-5", "Sonnet 5 (fast)"],
  ["claude-opus-5", "Opus 5 (most thorough)"],
];

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (direct)",
    short: "Anthropic",
    baseUrl: ANTHROPIC_BASE,
    url: `${ANTHROPIC_BASE}/v1/messages`,
    urls: [`${ANTHROPIC_BASE}/v1/messages`],
    modelsUrl: `${ANTHROPIC_BASE}/v1/models`,
    keyPrefixes: ["sk-ant-"],
    keyHint: "sk-ant-",
    article: "an",
    keyUrl: "https://console.anthropic.com/settings/keys",
    billingUrl: "https://console.anthropic.com/settings/billing",
    auth: "x-api-key",
    authVariants: ["x-api-key"],
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
    // The documented Anthropic-style path first; then the base on its own,
    // which is what their market router appears to want.
    urls: [`${KIE_BASE}/v1/messages`, KIE_BASE],
    modelsUrl: `${KIE_BASE}/v1/models`,
    keyPrefixes: ["sk-kie-"],
    keyHint: "sk-kie-",
    article: "a",
    keyUrl: "https://kie.ai/api-key",
    billingUrl: "https://kie.ai/billing",
    // kie.ai documents both of its routes: ANTHROPIC_AUTH_TOKEN (a bearer
    // token) and ANTHROPIC_API_KEY holding the literal text "Bearer <key>".
    // Bearer is the unambiguous one to send first; the self-test falls back to
    // the other if this host only honours that one.
    auth: "bearer",
    authVariants: ["bearer", "x-api-key-bearer"],
    blurb: "Same Claude models through kie.ai credits — billed by kie.ai.",
    models: MODELS,
  },
};

export const DEFAULT_PROVIDER: ProviderId = "anthropic";
export const PROVIDER_LIST: ProviderInfo[] = [PROVIDERS.anthropic, PROVIDERS.kie];

// A key token wherever it appears in pasted text: sk-ant-…, sk-kie-…, and any
// future sk-<vendor>- key. Long enough that it cannot match prose.
const KEY_TOKEN = /(sk-[a-z][a-z0-9]*-[A-Za-z0-9_-]{8,})/;

/**
 * Tidy a pasted key.
 *
 * People paste what the docs hand them. kie.ai's Claude Code guide hands them
 * a whole shell line — `export ANTHROPIC_API_KEY="Bearer sk-kie-…"` — and
 * Anthropic's console hands them a bare key. Both must end up as the same
 * token, because a key that is not recognised is routed to the wrong host.
 */
export function normalizeKey(raw: string): string {
  let k = String(raw ?? "").trim();
  if (k.length >= 2 &&
      ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'")))) {
    k = k.slice(1, -1).trim();
  }
  k = k.replace(/^bearer\s+/i, "").trim();
  // Anything else around the key (an export line, a JSON field, a stray
  // quote) is dropped as long as a key token is in there somewhere.
  if (!detectPrefix(k)) {
    const m = KEY_TOKEN.exec(k);
    if (m) return m[1];
  }
  return k;
}

/** Prefix lookup on an already-normalised string (no recursion). */
function detectPrefix(k: string): ProviderId | null {
  const low = k.toLowerCase();
  for (const p of PROVIDER_LIST) {
    if (p.keyPrefixes.some((prefix) => low.startsWith(prefix))) return p.id;
  }
  return null;
}

/** Which provider issued this key? null when the prefix says nothing. */
export function detectProvider(key: string): ProviderId | null {
  const k = normalizeKey(key);
  return k ? detectPrefix(k) : null;
}

/**
 * The provider to call with this key.
 *
 * A key goes to the provider that issued it — always. Sending an sk-ant- key
 * to another host would hand that host a credential it has no business
 * seeing, so a stored preference can never override a *recognised* key; it
 * only decides where a key with an unfamiliar prefix goes. A key that looks
 * like neither, with no preference, falls back to Anthropic (the historical
 * behaviour, so older stored keys keep working).
 */
export function resolveProvider(key: string, pref: ProviderPref = "auto"): ProviderInfo {
  const detected = detectProvider(key);
  if (detected) return PROVIDERS[detected];
  if (pref !== "auto" && PROVIDERS[pref]) return PROVIDERS[pref];
  return PROVIDERS[DEFAULT_PROVIDER];
}

/** True when a chosen provider is being ignored because the key names its own. */
export function overrideIgnored(key: string, pref: ProviderPref): boolean {
  const detected = detectProvider(key);
  return pref !== "auto" && detected !== null && detected !== pref;
}

export function providerInfo(id: string | null | undefined): ProviderInfo {
  return PROVIDERS[(id as ProviderId)] || PROVIDERS[DEFAULT_PROVIDER];
}

/** Request headers for one provider — the only thing that differs per host. */
export function authHeaders(
  provider: ProviderInfo,
  key: string,
  variant?: AuthVariant
): Record<string, string> {
  const k = normalizeKey(key);
  const v = authVariantFor(provider, variant);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (v === "bearer") {
    headers["authorization"] = `Bearer ${k}`;
  } else {
    // "x-api-key-bearer" is the same header carrying the word Bearer, which is
    // what kie.ai's ANTHROPIC_API_KEY route documents.
    headers["x-api-key"] = v === "x-api-key-bearer" ? `Bearer ${k}` : k;
    // Anthropic blocks browser calls unless the caller opts in explicitly.
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  return headers;
}

/** One way of reaching a host: where to post, and how to send the key. */
export interface Route {
  url: string;
  auth: AuthVariant;
}

/**
 * Every route to try, best first.
 *
 * Endpoint varies fastest: when a host answers the same way to a wrong path
 * and a wrong auth header, the path is the likelier culprit — it is the one
 * thing an Anthropic client is opinionated about.
 */
export function routesFor(provider: ProviderInfo): Route[] {
  const out: Route[] = [];
  for (const auth of provider.authVariants) {
    for (const url of provider.urls) out.push({ url, auth });
  }
  return out;
}

/** Keep a stored route only if this provider documents it. */
export function routeFor(provider: ProviderInfo, route?: Partial<Route> | null): Route {
  const url = provider.urls.includes(String(route?.url)) ? String(route?.url) : provider.url;
  return { url, auth: authVariantFor(provider, route?.auth) };
}

/** Keep a stored auth variant only if this provider documents it. */
export function authVariantFor(provider: ProviderInfo, variant?: string | null): AuthVariant {
  const v = String(variant || "");
  return (provider.authVariants as string[]).includes(v)
    ? (v as AuthVariant)
    : provider.auth;
}

/** Models this provider offers; used to keep the model picker honest. */
export function modelsFor(provider: ProviderInfo): Array<[string, string]> {
  return provider.models;
}

/**
 * The model id to send.
 *
 * Whatever the user chose wins. The per-provider list above is a convenience
 * for the picker, not a catalogue we can vouch for: a gateway may serve model
 * ids we have never heard of (ask it with listProviderModels), and silently
 * replacing a chosen model with one of ours turns "that model is not served
 * here" into a confusing wrong-answer. Only an empty choice takes the default.
 */
export function modelFor(provider: ProviderInfo, model: string): string {
  const m = String(model ?? "").trim();
  return m || provider.models[0][0];
}
