// Direct browser -> provider calls using the user's own key (entered in the
// UI, kept in localStorage). The key never leaves the browser except to go to
// the provider the key belongs to — Anthropic, or a gateway serving the same
// Messages API such as kie.ai (see ./providers). Mirrors
// backend/app/ai/claude_provider.py.
import { extractPrompt, nlPrompt, reviewPrompt } from "./prompts";
import { DEFAULT_DISCIPLINE } from "./disciplines";
import {
  PROVIDER_LIST, ProviderInfo, authHeaders, detectProvider, resolveProvider,
} from "./providers";

export const DEFAULT_MODEL = "claude-sonnet-4-6";
/** Hard ceiling for one provider call. */
const CALL_TIMEOUT_MS = 300_000;

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
    return `${p.short} is having trouble right now (${status}) — retry in a moment.${tail}`;
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

async function jsonCall(
  system: string,
  content: Content,
  apiKey: string,
  model: string,
  maxTokens = 16000,
  provider?: ProviderInfo
): Promise<any> {
  // No provider passed (or an older call site): let the key decide.
  const p = provider || resolveProvider(apiKey);
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const sys = attempt === 0
      ? system
      : system + "\n\nYour previous reply was not valid JSON. Return ONLY the JSON object.";
    let res: Response;
    // A gateway that accepts the connection and then never answers would
    // otherwise leave "Reading drawings…" spinning for ever. Well beyond any
    // real call (vision + 16k output), but bounded.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), CALL_TIMEOUT_MS);
    try {
      res = await fetch(p.url, {
        method: "POST",
        headers: authHeaders(p, apiKey),
        signal: abort.signal,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: sys,
          messages: [{ role: "user", content }],
        }),
      });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        throw new Error(
          `${p.short} did not answer within ${Math.round(CALL_TIMEOUT_MS / 60000)} minutes — ` +
          `the request was cancelled. Retry, or try the faster model.`
        );
      }
      throw friendlyNetworkError(p, e);
    } finally {
      clearTimeout(timer);
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
  provider?: ProviderInfo
): Promise<any> {
  const content: Content = [{
    type: "text",
    text: `Project defaults: ${JSON.stringify(context)}\n\nInstruction:\n${text}`,
  }];
  const discipline = String(context?.discipline || DEFAULT_DISCIPLINE);
  return jsonCall(nlPrompt(discipline, extraShapes), content, apiKey, model, 8000, provider);
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
  const first = await jsonCall(EXTRACT_PROMPT, base, args.apiKey, model, 16000, args.provider);

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
    second = await jsonCall(EXTRACT_PROMPT, sweep, args.apiKey, model, 16000, args.provider);
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
    const res = await jsonCall(reviewPrompt(args.extraShapes || ""), content, args.apiKey, model, 12000, args.provider);
    const reviews = Array.isArray(res?.reviews) ? res.reviews : [];
    return reviews.filter((r: any) => r && r.op && r.op !== "ok");
  } catch {
    return [];
  }
}
