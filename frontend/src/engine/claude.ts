// Direct browser -> provider calls using the user's own key (entered in the
// UI, kept in localStorage). The key never leaves the browser except to go to
// the provider the key belongs to — Anthropic, or a gateway serving the same
// Messages API such as kie.ai (see ./providers). Mirrors
// backend/app/ai/claude_provider.py.
import { extractPrompt, nlPrompt, reviewPrompt } from "./prompts";
import { DEFAULT_DISCIPLINE } from "./disciplines";
import {
  AuthVariant, PROVIDER_LIST, ProviderInfo, Route, authHeaders, detectProvider,
  resolveProvider, routeFor, routesFor,
} from "./providers";

export const DEFAULT_MODEL = "claude-sonnet-5";
/** Hard ceiling for one provider call. */
const CALL_TIMEOUT_MS = 300_000;

/**
 * Statuses that say "not now", never "not this request".
 *
 * A gateway in front of the model answers 502/503/504 when its own upstream is
 * unreachable, and Cloudflare's 520-530 family means the same thing. A page
 * read is one of dozens in a run, so one blip must not end the run — and it
 * must never be read as a verdict on the request we sent.
 */
function transient(status: number): boolean {
  return status === 408 || status === 429 ||
    (status >= 502 && status <= 504) || (status >= 520 && status <= 530);
}
const RETRY_BACKOFF_MS = [1500, 4000];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Content = Array<Record<string, any>>;

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const parts = t.split("```");
    t = parts.length > 1 ? parts[1] : t;
    if (t.startsWith("json")) t = t.slice(4);
  }
  return t.trim();
}

// Map a provider HTTP error to a short, actionable message naming the provider
// the key belongs to. The raw API JSON (e.g.
// {"type":"authentication_error","message":"invalid x-api-key"}) is confusing
// to end users, so common statuses get plain-language guidance.
// A gateway can answer with HTML (an nginx 413 page, a proxy error). Pasting
// markup into the chat helps nobody: prefer the API's own message, else the
// text with tags stripped, else nothing but the status.
function errorDetail(body: string): string {
  const t = (body || "").trim();
  if (!t) return "";
  try {
    const j = JSON.parse(t);
    const m = j?.error?.message || j?.message || j?.msg;
    if (m) return String(m).slice(0, 200);
  } catch { /* not JSON */ }
  if (/^\s*</.test(t)) {
    const text = t.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return text.slice(0, 120);
  }
  return t.slice(0, 200);
}

/** The provider a key was *not* sent to — what to suggest when one rejects it. */
function otherProvider(p: ProviderInfo): ProviderInfo {
  return PROVIDER_LIST.find((q) => q.id !== p.id) || p;
}

function friendlyApiError(p: ProviderInfo, status: number, body: string, key = ""): string {
  const detail = errorDetail(body);
  const tail = detail ? ` (${detail})` : "";
  if (status === 401 || status === 403) {
    // A key whose prefix names no provider was sent here by fallback, not by
    // recognition — so "your key is invalid" may be the wrong diagnosis. The
    // key may be perfectly good and simply belong to the other host, which the
    // user can say in the 🔑 dialog.
    const other = otherProvider(p);
    if (!detectProvider(key))
      return `${p.short} rejected this key (${status}). Its prefix is not one we recognise, so it went to ${p.short}, whose keys start with ${p.keyHint}. If the key came from ${other.short}, open 🔑 AI key, choose ${other.short} and save — the key then goes to ${other.short} instead.`;
    return `Your ${p.short} key looks invalid or unauthorized. Open 🔑 AI key and paste a valid one (${p.short} keys start with ${p.keyHint}).`;
  }
  if (status === 404)
    return `${p.short} does not recognise this endpoint or model (404). Try the other model in the 🔑 AI model picker.${tail}`;
  if (status === 413)
    return `The drawing page is too large for ${p.short} (413). Try a PDF with fewer or simpler pages, or split it up.`;
  if (status === 429)
    return `${p.short} rate limit reached — wait a few seconds and try again.`;
  if (status === 402)
    return `Your ${p.short} account is out of credits — top up at ${p.billingUrl}, then retry.`;
  if (status === 400)
    return `${p.short} rejected the request (400).${tail || " The model or request shape may not be supported there."}`;
  if (status >= 500)
    return `${p.short} is having trouble with this request (${status}).${tail} If it keeps happening, open 🔑 AI key → Test connection: it finds which part ${p.short} rejects (the model id, the reply length, or the drawing image) and fixes what it can.`;
  return `${p.short} API ${status}${tail}`;
}

// fetch() rejects (rather than returning a status) when the request never
// completes: offline, DNS failure, or a CORS policy that blocks a browser
// origin. Only the provider can allow the origin, so say so plainly instead of
// surfacing "Failed to fetch".
function friendlyNetworkError(p: ProviderInfo, e: any): Error {
  const msg = String(e?.message || e);
  if (/failed to fetch|load failed|networkerror|fetch failed/i.test(msg)) {
    return new Error(
      `Could not reach ${p.short} from the browser (${msg}). Either you are offline, ` +
      `or ${p.short} does not allow browser requests from this page — only ${p.short} ` +
      `can change that (CORS), so retrying from another network will not help. ` +
      `An Anthropic key does allow it; chat, demo data and manual entry keep working ` +
      `without any key.`
    );
  }
  return e instanceof Error ? e : new Error(msg);
}

/** One POST to the Messages endpoint. Never throws on an HTTP error status. */
async function post(
  p: ProviderInfo,
  apiKey: string,
  body: Record<string, any>,
  timeoutMs = CALL_TIMEOUT_MS,
  route?: Route
): Promise<{ res: Response | null; error: any }> {
  const r = routeFor(p, route);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(r.url, {
      method: "POST",
      headers: authHeaders(p, apiKey, r.auth),
      signal: abort.signal,
      body: JSON.stringify(body),
    });
    return { res, error: null };
  } catch (e) {
    return { res: null, error: e };
  } finally {
    clearTimeout(timer);
  }
}

async function jsonCall(
  system: string,
  content: Content,
  apiKey: string,
  model: string,
  maxTokens = 16000,
  provider?: ProviderInfo,
  maxTokensCap = 0,
  route?: Route
): Promise<any> {
  // No provider passed (or an older call site): let the key decide.
  const p = provider || resolveProvider(apiKey);
  // A gateway can refuse a reply length its upstream would allow. Test
  // connection discovers the ceiling; honour it rather than fail every call.
  const tokens = maxTokensCap > 0 ? Math.min(maxTokens, maxTokensCap) : maxTokens;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const sys = attempt === 0
      ? system
      : system + "\n\nYour previous reply was not valid JSON. Return ONLY the JSON object.";
    // A gateway that accepts the connection and then never answers would
    // otherwise leave "Reading drawings…" spinning for ever. Well beyond any
    // real call (vision + 16k output), but bounded.
    const body = {
      model,
      max_tokens: tokens,
      system: sys,
      messages: [{ role: "user", content }],
      // Anthropic defaults this to false; kie.ai's Claude endpoint documents
      // `default: true`, so leaving it out asks that host for an SSE stream —
      // which this client cannot read, and which their adapter answers with a
      // generic error. Both of their own examples set it explicitly. We parse
      // one JSON reply, so say so every time.
      stream: false,
    };
    let { res, error } = await post(p, apiKey, body, CALL_TIMEOUT_MS, route);
    // A gateway that cannot reach its own upstream says so with a 5xx and asks
    // to be tried again. One page of a long run must not end the run over it.
    for (let i = 0; res && !res.ok && transient(res.status) && i < RETRY_BACKOFF_MS.length; i++) {
      await wait(RETRY_BACKOFF_MS[i]);
      ({ res, error } = await post(p, apiKey, body, CALL_TIMEOUT_MS, route));
    }
    if (!res) {
      if (error?.name === "AbortError") {
        throw new Error(
          `${p.short} did not answer within ${Math.round(CALL_TIMEOUT_MS / 60000)} minutes — ` +
          `the request was cancelled. Retry, or try the faster model.`
        );
      }
      throw friendlyNetworkError(p, error);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(friendlyApiError(p, res.status, body, apiKey));
    }
    try {
      // A 200 carrying something other than a Messages reply (a gateway
      // interstitial, a truncated body) must go through the retry, not throw a
      // raw SyntaxError at the caller.
      const data = await res.json();
      const text = (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      return JSON.parse(stripFences(text));
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`${p.short} did not return valid JSON: ${lastErr}`);
}

export async function claudeParseNl(
  text: string,
  context: Record<string, any>,
  apiKey: string,
  model: string = DEFAULT_MODEL,
  extraShapes = "",
  provider?: ProviderInfo,
  maxTokensCap = 0,
  route?: Route
): Promise<any> {
  const content: Content = [{
    type: "text",
    text: `Project defaults: ${JSON.stringify(context)}\n\nInstruction:\n${text}`,
  }];
  const discipline = String(context?.discipline || DEFAULT_DISCIPLINE);
  return jsonCall(
    nlPrompt(discipline, extraShapes), content, apiKey, model, 8000, provider,
    maxTokensCap, route);
}

function dedupeMembers(lists: any[][]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const list of lists) {
    for (const m of list || []) {
      if (!m || typeof m !== "object" || !m.member_type) continue;
      const lbl = String(m.label || "").trim().toLowerCase();
      const k = lbl ? `${m.member_type}|${lbl}` : "";
      if (k && seen.has(k)) continue;
      if (k) seen.add(k);
      out.push(m);
    }
  }
  return out;
}

export async function claudeExtract(args: {
  page_no: number; page_text: string; page_image_b64: string | null;
  scale: string; context: Record<string, any>; apiKey: string;
  model?: string; onProgress?: (msg: string) => void;
  /** Active discipline — scopes what the extractor treats as primary. */
  discipline?: string;
  /** Member-shape text contributed by discipline packs. */
  extraShapes?: string;
  /** Where to send the request; defaults to whatever the key says. */
  provider?: ProviderInfo;
  /** Reply-length ceiling this host was found to accept; 0 = no ceiling. */
  maxTokensCap?: number;
  /** Where to post and how to send the key, when the default is not it. */
  route?: Route;
}): Promise<any> {
  const model = args.model || DEFAULT_MODEL;
  const EXTRACT_PROMPT = extractPrompt(args.discipline || DEFAULT_DISCIPLINE, args.extraShapes || "");
  const base: Content = [];
  if (args.page_image_b64) {
    base.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: args.page_image_b64 },
    });
  }
  base.push({
    type: "text",
    text:
      `Page number: ${args.page_no}\nScale: ${args.scale}\n` +
      `Project defaults: ${JSON.stringify(args.context)}\n\n` +
      `Extracted page text (may include schedule tables):\n${args.page_text.slice(0, 24000)}`,
  });

  // Pass 1 — extract everything.
  const first = await jsonCall(EXTRACT_PROMPT, base, args.apiKey, model, 16000, args.provider, args.maxTokensCap, args.route);

  // Pass 2 — completeness sweep: find anything missed. Re-checking each schedule
  // row and grid line against what's already captured catches under-extraction.
  const already = (first.members || [])
    .map((m: any) => `${m.member_type} ${m.label || ""}`.trim())
    .join("; ");
  args.onProgress?.(`Double-checking page ${args.page_no} for missed elements…`);
  const sweep: Content = [
    ...base,
    {
      type: "text",
      text:
        "ALREADY EXTRACTED on this page (do NOT repeat these):\n" +
        (already || "(nothing yet)") +
        "\n\nNow return ONLY the ADDITIONAL elements on this page that are NOT in " +
        "that list — re-check every schedule row, every grid line, and every " +
        "section/detail. Same JSON shape. If there are genuinely none, return " +
        '{"page_no": ' + args.page_no + ', "members": [], "unresolved": []}.',
    },
  ];
  let second: any = { members: [], unresolved: [] };
  try {
    second = await jsonCall(EXTRACT_PROMPT, sweep, args.apiKey, model, 16000, args.provider, args.maxTokensCap, args.route);
  } catch {
    /* sweep is best-effort; keep pass-1 results if it fails */
  }

  return {
    page_no: args.page_no,
    members: dedupeMembers([first.members || [], second.members || []]),
    unresolved: [...(first.unresolved || []), ...(second.unresolved || [])],
  };
}

// AI self-review: re-examine the page image against the elements already
// extracted from it and return suggested corrections (a senior-QS critique).
// Best-effort — returns [] on any failure so it never breaks extraction.
export async function claudeReview(args: {
  page_no: number; page_image_b64: string | null; members: any[];
  context: Record<string, any>; apiKey: string; model?: string; extraShapes?: string;
  provider?: ProviderInfo;
  /** Reply-length ceiling this host was found to accept; 0 = no ceiling. */
  maxTokensCap?: number;
  /** Where to post and how to send the key, when the default is not it. */
  route?: Route;
}): Promise<any[]> {
  if (!args.page_image_b64 || !(args.members || []).length) return [];
  const model = args.model || DEFAULT_MODEL;
  const content: Content = [
    { type: "image", source: { type: "base64", media_type: "image/png", data: args.page_image_b64 } },
    {
      type: "text",
      text:
        `Page number: ${args.page_no}\n` +
        `Project defaults: ${JSON.stringify(args.context)}\n\n` +
        `ELEMENTS ALREADY EXTRACTED from this page (audit these against the image):\n` +
        JSON.stringify(args.members, null, 1),
    },
  ];
  try {
    const res = await jsonCall(reviewPrompt(args.extraShapes || ""), content, args.apiKey, model, 12000, args.provider, args.maxTokensCap, args.route);
    const reviews = Array.isArray(res?.reviews) ? res.reviews : [];
    return reviews.filter((r: any) => r && r.op && r.op !== "ok");
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- self-test
//
// A gateway can accept the key, allow the browser, and still refuse the one
// request the app needs to make — because it does not serve the model id we
// send, or caps the reply length, or does not take images. All three come back
// as the same opaque "500 Internal error", which tells the user nothing. So
// ask the host directly, one variable at a time, and keep what we learn.

/** An 8×8 PNG. Small enough to be free, real enough to prove vision works. */
const PROBE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4YWODFTEMLQkAZZlQAVIPr1MAAAAASUVORK5CYII=";
/** Reply lengths to try, largest first: the first accepted one is the ceiling. */
const TOKEN_LADDER = [16000, 8192, 4096, 1024];

export interface ProbeStep {
  id: "models" | "key" | "model" | "auth" | "length" | "image";
  label: string;
  ok: boolean;
  /** Something we learned, not something that has to work. Shown neutrally. */
  info?: boolean;
  /** HTTP status, or 0 when the request never got one (offline, CORS). */
  status: number;
  detail: string;
}

export interface ProbeResult {
  /** True when the host can do everything a drawing take-off needs. */
  ok: boolean;
  steps: ProbeStep[];
  /** Model ids the host admits to serving, when it publishes a catalogue. */
  models: string[];
  /** Largest reply length accepted, or 0 when the full 16000 is fine. */
  cap: number;
  /** Did the ladder actually settle? False means `cap` says nothing. */
  lengthOk: boolean;
  /** Can this host read drawings at all? */
  vision: boolean;
  /** The model every measurement above was taken on ("" when none worked). */
  model: string;
  /** Where the host had to be called, and how, for it to answer. */
  route: Route;
  /** One sentence for the user, and what to do about it. */
  verdict: string;
}

/**
 * Ask a host which models it serves.
 *
 * Anthropic publishes GET /v1/models and gateways that mirror the API often do
 * too. Returns [] when the host does not answer with a catalogue — that is not
 * an error, just one less thing we know.
 */
export async function listProviderModels(
  apiKey: string,
  provider: ProviderInfo
): Promise<string[]> {
  // Bounded like every other probe: a host that accepts the connection and
  // never answers must not leave the self-test spinning for ever.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);
  try {
    const res = await fetch(provider.modelsUrl, {
      method: "GET",
      headers: authHeaders(provider, apiKey),
      signal: abort.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return rows
      .map((m: any) => String(m?.id || m?.name || ""))
      .filter((id: string) => id.length > 0);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** How a key is being put on the wire, in words a user can act on. */
const AUTH_LABEL: Record<AuthVariant, string> = {
  "bearer": "Authorization: Bearer",
  "x-api-key": "x-api-key",
  "x-api-key-bearer": 'x-api-key: "Bearer …"',
};

/** A route in one short phrase, for a step label. */
function routeLabel(p: ProviderInfo, r: Route): string {
  const path = r.url.startsWith(p.baseUrl) ? r.url.slice(p.baseUrl.length) || "/" : r.url;
  return `${path} with ${AUTH_LABEL[r.auth]}`;
}

/** One probe POST, reported rather than thrown. */
async function probe(
  p: ProviderInfo,
  apiKey: string,
  body: Record<string, any>,
  id: ProbeStep["id"],
  label: string,
  route?: Route
): Promise<ProbeStep> {
  // Short enough that a wedged host cannot make the whole test outlast the
  // user's patience; far longer than a one-word reply needs.
  let { res, error } = await post(p, apiKey, body, 30_000, route);
  // One retry, so a momentary gateway hiccup is not written down as a verdict.
  if (res && !res.ok && transient(res.status)) {
    await wait(RETRY_BACKOFF_MS[0]);
    ({ res, error } = await post(p, apiKey, body, 30_000, route));
  }
  if (!res) {
    const msg = error?.name === "AbortError"
      ? "no answer within 30 seconds"
      : String(error?.message || error);
    return { id, label, ok: false, status: 0, detail: msg };
  }
  const text = await res.text();
  if (!res.ok) return { id, label, ok: false, status: res.status, detail: errorDetail(text) };
  return { id, label, ok: true, status: res.status, detail: "" };
}

const say = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * Find out what this host actually accepts, changing one thing at a time.
 *
 * Cheap: every probe asks for one word, so the reply-length ladder costs a
 * handful of tokens no matter how high it starts.
 */
export async function probeProvider(
  apiKey: string,
  model: string,
  provider?: ProviderInfo,
  /** Called as each step finishes, so the dialog can fill in as it goes. */
  onStep?: (step: ProbeStep) => void
): Promise<ProbeResult> {
  const p = provider || resolveProvider(apiKey);
  const steps: ProbeStep[] = [];
  const add = (step: ProbeStep) => { steps.push(step); onStep?.(step); };
  const hi = "Reply with the single word OK.";
  const all = routesFor(p);
  let route: Route = all[0];

  const models = await listProviderModels(apiKey, p);
  add({
    id: "models",
    label: `${p.short} model list`,
    ok: true,
    info: models.length === 0,
    status: models.length > 0 ? 200 : 0,
    detail: models.length ? `${models.length} model(s)` : "not published — that is allowed",
  });

  // The model the app would actually send goes first: it is the only one whose
  // answer describes what the user will experience. Substituting a catalogue id
  // here would report "your key is bad" when the truth is "that model is not
  // served" — the very confusion this test exists to clear up.
  const one = (id: string) => ({
    model: id, max_tokens: 64, stream: false,
    messages: [{ role: "user", content: hi }],
  });
  const first = await probe(p, apiKey, one(model), "model", `Model ${model}`, route);
  add(first);

  // The key and the model may both be fine, and the request simply addressed
  // wrongly: a host can document more than one path and more than one auth
  // header, and honour only one combination. Try the rest before concluding
  // anything about the key or the model.
  let routeStep: ProbeStep | null = null;
  if (!first.ok && first.status !== 0) {
    for (const r of all.slice(1)) {
      const alt = await probe(p, apiKey, one(model), "auth", `Try ${routeLabel(p, r)}`, r);
      add(alt);
      if (alt.ok) { route = r; routeStep = alt; break; }
    }
  }

  let working = first.ok || routeStep ? model : "";
  // A refusal that is not about the key may just be about the model. Ask the
  // catalogue for something that does work — Claude ids first, because a
  // gateway's catalogue can be mostly image/video models that would fail here
  // for reasons that have nothing to do with the key.
  if (!working && first.status !== 0 && first.status !== 401 && first.status !== 403) {
    const others = models.filter((id) => id !== model);
    const ranked = [
      ...others.filter((id) => /claude/i.test(id)),
      ...others.filter((id) => !/claude/i.test(id)),
    ].slice(0, 3);
    for (const id of ranked) {
      const st = await probe(p, apiKey, one(id), "model", `Model ${id}`, route);
      add(st);
      if (st.ok) { working = id; break; }
    }
  }
  const keyOk = !!working;
  // A route that did not answer, on the way to one that did, is a step in the
  // search — not a failure of the test. Shown as a red cross it reads as
  // "broken" even under a verdict that says "Working", so once something
  // answers, the attempts before it become what they are: things we ruled out.
  if (keyOk) {
    for (const st of steps) {
      if (!st.ok && (st.id === "model" || st.id === "auth")) {
        st.info = true;
        st.detail = st.detail ? `ruled out — ${st.detail}` : "ruled out";
      }
    }
  }

  let cap = 0;
  let lengthOk = false;
  let rateLimited = false;
  let vision = false;
  if (working) {
    // Reply length and images are measured on the model that works, so the
    // ceiling we keep is a ceiling for a request the app can actually make.
    for (const n of TOKEN_LADDER) {
      const step = await probe(
        p, apiKey,
        { ...one(working), max_tokens: n },
        "length", `Reply length ${say(n)}`, route
      );
      if (step.ok) {
        lengthOk = true;
        cap = n === TOKEN_LADDER[0] ? 0 : n;
        add({ ...step, detail: cap ? `${say(n)} accepted; longer refused` : "" });
        break;
      }
      // A rate limit says nothing about how long a reply may be. Reading one as
      // "this rung is too long" would pin a permanent ceiling on a passing
      // squall, so stop and say what actually happened.
      if (transient(step.status)) {
        rateLimited = true;
        add({
          ...step,
          detail: step.detail || (step.status === 429
            ? "rate limited — not a length limit"
            : "the host was unavailable — not a length limit"),
        });
        break;
      }
      if (n === TOKEN_LADDER[TOKEN_LADDER.length - 1]) add(step);
    }

    const img = await probe(
      p, apiKey,
      {
        model: working,
        max_tokens: 64,
        stream: false,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: PROBE_PNG } },
            { type: "text", text: hi },
          ],
        }],
      },
      "image", "Reads images (needed for drawings)", route
    );
    add(img);
    vision = img.ok;
  }

  let verdict: string;
  if (!keyOk && first.status === 0) {
    verdict = `Could not reach ${p.short} at all — ${first.detail}.`;
  } else if (!keyOk && (first.status === 401 || first.status === 403)) {
    verdict = `${p.short} rejected the key itself (${first.status})${
      all.length > 1 ? ", on every route it documents" : ""}. Check the key at ${p.keyUrl}.`;
  } else if (working && working !== model) {
    const caveat = !vision
      ? ` That one will not take images, though, so it cannot read drawings.`
      : cap
        ? ` It caps replies at ${say(cap)}, which the app will respect.`
        : "";
    verdict = `${p.short} does not serve “${model}”, but does serve “${working}”. Pick that model below.${caveat}`;
  } else if (!keyOk && models.length) {
    verdict = `${p.short} refused “${model}” (${first.status}) and every other model we tried — ${first.detail || "no detail given"}.`;
  } else if (!keyOk && transient(first.status)) {
    verdict = `${p.short} could not serve even a one-word request (${first.status}) — ${first.detail || "no detail given"}. That status means their gateway could not reach the model${
      all.length > 1 ? ", and none of the other routes they document answered either" : ""
    }, so it is theirs to fix: nothing about this app's request would change it. Check ${p.keyUrl} that this key is for their Claude endpoint and has credit, then try again later.`;
  } else if (!keyOk) {
    verdict = `${p.short} refused a one-word request on “${model}” (${first.status}) — ${first.detail || "no detail given"}. It may not serve that model; ${p.short} publishes no model list, so try another id in the picker.`;
  } else if (rateLimited) {
    verdict = `${p.short} stopped answering before the test could measure the reply length — a rate limit or a gateway having a bad minute, not a verdict on the request. Wait a minute and run it again; nothing has been changed.`;
  } else if (!lengthOk) {
    verdict = `${p.short} answered a one-word request but refused every reply length we asked for, down to ${say(TOKEN_LADDER[TOKEN_LADDER.length - 1])}. Nothing here can fix that — it is a limit on their side.`;
  } else if (!vision && cap) {
    verdict = `${p.short} works for chat (replies capped at ${say(cap)}) but will not take images, so it cannot read drawings.`;
  } else if (!vision) {
    verdict = `${p.short} works for chat but will not take images, so it cannot read drawings. Use an Anthropic key for that.`;
  } else if (cap) {
    verdict = `Working. ${p.short} caps replies at ${say(cap)}, so the app will ask for that much.`;
  } else {
    verdict = `Working — ${p.short} accepts the key, the model, a full-length reply and drawing images.`;
  }
  if (routeStep) {
    verdict += ` ${p.short} only answered ${routeLabel(p, route)}, so that is how it will be called from now on.`;
  }
  return { ok: keyOk && lengthOk && vision, steps, models, cap, lengthOk, vision, model: working, route, verdict };
}
