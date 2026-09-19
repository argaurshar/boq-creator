// Direct browser -> provider calls using the user's own key (entered in the
// UI, kept in localStorage). The key never leaves the browser except to go to
// the provider the key belongs to — Anthropic, or a gateway serving the same
// Messages API such as kie.ai (see ./providers). Mirrors
// backend/app/ai/claude_provider.py.
import { extractPrompt, nlPrompt, reviewPrompt } from "./prompts";
import { DEFAULT_DISCIPLINE } from "./disciplines";
import { ProviderInfo, authHeaders, resolveProvider } from "./providers";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

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
function friendlyApiError(p: ProviderInfo, status: number, body: string): string {
  if (status === 401 || status === 403)
    return `Your ${p.label} key looks invalid or unauthorized. Open 🔑 (top right) and paste a valid key (it ${p.keyHint}). If the key is from the other provider, the 🔑 dialog detects that for you.`;
  if (status === 404)
    return `${p.label} does not recognise this endpoint or model (404). Check the model in the top bar, or switch provider in the 🔑 dialog. ${body.slice(0, 160)}`;
  if (status === 429)
    return `${p.label} rate limit reached — wait a few seconds and try again.`;
  if (status === 402)
    return `Your ${p.label} account is out of credits — top up at ${p.keyUrl}, then retry.`;
  return `${p.label} API ${status}: ${body.slice(0, 200)}`;
}

// fetch() rejects (rather than returning a status) when the request never
// completes: offline, DNS failure, or a CORS policy that blocks a browser
// origin. Only the provider can allow the origin, so say so plainly instead of
// surfacing "Failed to fetch".
function friendlyNetworkError(p: ProviderInfo, e: any): Error {
  const msg = String(e?.message || e);
  if (/failed to fetch|load failed|networkerror|fetch failed/i.test(msg)) {
    return new Error(
      `Could not reach ${p.label} from the browser (${msg}). Check your internet ` +
      `connection. If you are on a page served over the web, ${p.label} must also ` +
      `allow browser requests from this site — if it does not, run the app locally ` +
      `or use a key from the other provider.`
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
    try {
      res = await fetch(p.url, {
        method: "POST",
        headers: authHeaders(p, apiKey),
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: sys,
          messages: [{ role: "user", content }],
        }),
      });
    } catch (e: any) {
      throw friendlyNetworkError(p, e);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(friendlyApiError(p, res.status, body));
    }
    const data = await res.json();
    const text = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    try {
      return JSON.parse(stripFences(text));
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Claude did not return valid JSON: ${lastErr}`);
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
