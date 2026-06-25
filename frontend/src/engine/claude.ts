// Direct browser -> Anthropic calls using the user's own key (entered in the
// UI, kept in localStorage). The key never leaves the browser except to go to
// Anthropic. Mirrors backend/app/ai/claude_provider.py.
import { EXTRACT_PROMPT, NL_EDIT_PROMPT } from "./prompts";

// Use Claude Sonnet (current: Sonnet 4.6) for user-supplied-key calls — faster
// and cheaper than Opus, well-suited to the extraction/NL-parsing tasks here.
const MODEL = "claude-sonnet-4-6";
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

async function jsonCall(system: string, content: Content, apiKey: string): Promise<any> {
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
        model: MODEL,
        max_tokens: 8000,
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

export async function claudeParseNl(text: string, context: Record<string, any>, apiKey: string): Promise<any> {
  const content: Content = [{
    type: "text",
    text: `Project defaults: ${JSON.stringify(context)}\n\nInstruction:\n${text}`,
  }];
  return jsonCall(NL_EDIT_PROMPT, content, apiKey);
}

export async function claudeExtract(args: {
  page_no: number; page_text: string; page_image_b64: string | null;
  scale: string; context: Record<string, any>; apiKey: string;
}): Promise<any> {
  const content: Content = [];
  if (args.page_image_b64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: args.page_image_b64 },
    });
  }
  content.push({
    type: "text",
    text:
      `Page number: ${args.page_no}\nScale: ${args.scale}\n` +
      `Project defaults: ${JSON.stringify(args.context)}\n\n` +
      `Extracted page text (may include schedule tables):\n${args.page_text.slice(0, 12000)}`,
  });
  const data = await jsonCall(EXTRACT_PROMPT, content, args.apiKey);
  if (data.page_no === undefined) data.page_no = args.page_no;
  if (!data.members) data.members = [];
  if (!data.unresolved) data.unresolved = [];
  return data;
}
