// Direct browser -> Anthropic calls using the user's own key (entered in the
// UI, kept in localStorage). The key never leaves the browser except to go to
// Anthropic. Mirrors backend/app/ai/claude_provider.py.
import { EXTRACT_PROMPT, NL_EDIT_PROMPT, REVIEW_PROMPT } from "./prompts";

export const DEFAULT_MODEL = "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";

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

async function jsonCall(
  system: string,
  content: Content,
  apiKey: string,
  model: string,
  maxTokens = 16000
): Promise<any> {
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const sys = attempt === 0
      ? system
      : system + "\n\nYour previous reply was not valid JSON. Return ONLY the JSON object.";
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: sys,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
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
  model: string = DEFAULT_MODEL
): Promise<any> {
  const content: Content = [{
    type: "text",
    text: `Project defaults: ${JSON.stringify(context)}\n\nInstruction:\n${text}`,
  }];
  return jsonCall(NL_EDIT_PROMPT, content, apiKey, model, 8000);
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
}): Promise<any> {
  const model = args.model || DEFAULT_MODEL;
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
  const first = await jsonCall(EXTRACT_PROMPT, base, args.apiKey, model);

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
    second = await jsonCall(EXTRACT_PROMPT, sweep, args.apiKey, model);
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
  context: Record<string, any>; apiKey: string; model?: string;
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
    const res = await jsonCall(REVIEW_PROMPT, content, args.apiKey, model, 12000);
    const reviews = Array.isArray(res?.reviews) ? res.reviews : [];
    return reviews.filter((r: any) => r && r.op && r.op !== "ok");
  } catch {
    return [];
  }
}
