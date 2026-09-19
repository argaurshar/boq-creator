// Does the shipped TypeScript route a key the way the contract says?
//
// The static build is the product: frontend/src/engine/providers.ts and
// claude.ts are what send real users' keys. This runs them for real — bundled
// with esbuild, driven by ../../shared/provider-cases.json (the same corpus
// backend/tests/test_providers.py asserts) — and then calls the actual client
// with fetch stubbed, so the URL and headers on the wire are checked, not the
// intent behind them.
//
//   npm run check:providers
import { build } from "esbuild";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const cases = JSON.parse(readFileSync(resolve(root, "../shared/provider-cases.json"), "utf8"));

const failures = [];
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
};

const out = mkdtempSync(join(tmpdir(), "provcheck-"));
try {
  await build({
    entryPoints: [resolve(root, "src/engine/providers.ts"), resolve(root, "src/engine/claude.ts")],
    outdir: out, bundle: true, format: "esm", platform: "node", logLevel: "silent",
  });
  const P = await import(pathToFileURL(join(out, "providers.js")).href);
  const C = await import(pathToFileURL(join(out, "claude.js")).href);

  // ---------------------------------------------------------- pure contract
  for (const c of cases.normalize) eq(`normalizeKey(${JSON.stringify(c.in)})`, P.normalizeKey(c.in), c.out);
  for (const c of cases.detect) eq(`detectProvider(${JSON.stringify(c.key)})`, P.detectProvider(c.key), c.provider);
  for (const c of cases.resolve) {
    eq(`resolveProvider(${JSON.stringify(c.key)}, ${c.pref})`, P.resolveProvider(c.key, c.pref).id, c.provider);
    if (c.ignored !== undefined) {
      eq(`overrideIgnored(${JSON.stringify(c.key)}, ${c.pref})`, P.overrideIgnored(c.key, c.pref), c.ignored);
    }
  }
  for (const c of cases.headers) {
    eq(`authHeaders(${c.provider})`, P.authHeaders(P.PROVIDERS[c.provider], c.key), c.headers);
  }
  for (const [id, url] of Object.entries(cases.endpoints)) eq(`${id}.url`, P.PROVIDERS[id].url, url);
  for (const id of Object.keys(cases.endpoints)) {
    eq(`${id}.models`, P.PROVIDERS[id].models, cases.models);
  }
  // Nothing may be typed for the key that is not a key.
  eq("normalizeKey(null)", P.normalizeKey(null), "");
  eq("normalizeKey(undefined)", P.normalizeKey(undefined), "");

  // ------------------------------------------------- the wire, through claude.ts
  const reply = { content: [{ type: "text", text: JSON.stringify({ op: "noop", message: "ok" }) }] };
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
  for (const c of cases.headers) {
    calls.length = 0;
    const provider = P.PROVIDERS[c.provider];
    await C.claudeParseNl("add a column", { discipline: "structure" }, c.key, "claude-sonnet-4-6", "", provider);
    eq(`claudeParseNl -> ${c.provider} url`, calls[0]?.url, cases.endpoints[c.provider]);
    eq(`claudeParseNl -> ${c.provider} headers`, calls[0]?.headers, c.headers);
    eq(`claudeParseNl -> ${c.provider} model`, calls[0]?.body?.model, "claude-sonnet-4-6");
  }
  // With no provider argument the key alone must still pick the right host.
  calls.length = 0;
  await C.claudeParseNl("add a column", {}, "sk-kie-abcdefgh12", "claude-sonnet-4-6");
  eq("key alone routes to kie", calls[0]?.url, cases.endpoints.kie);
  calls.length = 0;
  await C.claudeParseNl("add a column", {}, "sk-ant-abcdefgh12", "claude-sonnet-4-6");
  eq("key alone routes to anthropic", calls[0]?.url, cases.endpoints.anthropic);

  // A provider must never see the other provider's key.
  for (const { key, wrong } of [
    { key: "sk-kie-abcdefgh12", wrong: "api.anthropic.com" },
    { key: "sk-ant-abcdefgh12", wrong: "api.kie.ai" },
  ]) {
    calls.length = 0;
    await C.claudeParseNl("x", {}, key, "claude-sonnet-4-6");
    const sent = JSON.stringify(calls[0]);
    if (sent.includes(wrong)) failures.push(`${key} reached ${wrong}`);
  }

  // A 401 must diagnose the right thing. A recognised key really is bad; a key
  // whose prefix names no provider was only sent here by fallback, so the
  // message must offer the other provider rather than call the key invalid.
  globalThis.fetch = async () => ({
    ok: false, status: 401,
    json: async () => ({ type: "authentication_error" }),
    text: async () => '{"type":"authentication_error","message":"invalid x-api-key"}',
  });
  const rejected = async (key, provider) => {
    try { await C.claudeParseNl("x", {}, key, "claude-sonnet-4-6", "", provider); return ""; }
    catch (e) { return String(e.message); }
  };
  let m401 = await rejected("sk-kie-abcdefgh12");
  if (!/Your Kie\.ai key looks invalid/.test(m401)) failures.push(`401 on a known key: ${m401}`);
  m401 = await rejected("mystery-key-9999", P.PROVIDERS.anthropic);
  if (!/not one we recognise/.test(m401) || !/choose Kie\.ai/.test(m401))
    failures.push(`401 on an unknown key must offer Kie.ai: ${m401}`);
  if (/looks invalid/.test(m401)) failures.push("an unrecognised key must not be called invalid");
  m401 = await rejected("mystery-key-9999", P.PROVIDERS.kie);
  if (!/choose Anthropic/.test(m401)) failures.push(`401 on kie must offer Anthropic: ${m401}`);

  // A failed fetch must be explained, not surfaced as "Failed to fetch".
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  let msg = "";
  try { await C.claudeParseNl("x", {}, "sk-kie-abcdefgh12", "claude-sonnet-4-6"); }
  catch (e) { msg = String(e.message); }
  if (!/Could not reach Kie\.ai/.test(msg)) failures.push(`network error not explained: ${msg}`);
  if (/^Failed to fetch$/.test(msg)) failures.push("raw fetch error surfaced to the user");
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`provider contract: ${failures.length} failure(s)\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("provider contract: all checks passed");
