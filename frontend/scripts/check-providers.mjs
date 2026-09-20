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

  // Whatever model was chosen is what goes on the wire — our per-provider list
  // is a picker convenience, not a catalogue we can vouch for.
  eq("modelFor keeps an unknown id", P.modelFor(P.PROVIDERS.kie, "claude-3-7-sonnet"), "claude-3-7-sonnet");
  eq("modelFor trims", P.modelFor(P.PROVIDERS.kie, "  claude-opus-4-8 "), "claude-opus-4-8");
  eq("modelFor defaults only when empty", P.modelFor(P.PROVIDERS.kie, "   "), cases.models[0][0]);
  for (const id of Object.keys(cases.endpoints)) {
    eq(`${id}.modelsUrl`, P.PROVIDERS[id].modelsUrl, `${P.PROVIDERS[id].baseUrl}/v1/models`);
  }

  // ------------------------------------------------------------- the self-test
  // A gateway that refuses the model id, the reply length or images answers
  // every real request with the same opaque 500. The self-test must take those
  // apart and say which one it was.
  const ok200 = { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "OK" }] }), text: async () => '{"content":[]}' };
  const err = (status, msg) => ({ ok: false, status, json: async () => ({}), text: async () => JSON.stringify({ error: { message: msg } }) });

  // (a) the host serves a different model id than the one stored.
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/v1/models"))
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "claude-3-7-sonnet" }] }), text: async () => "" };
    const body = JSON.parse(init.body);
    return body.model === "claude-3-7-sonnet" ? ok200 : err(500, "Internal error, please try again later");
  };
  let r = await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6", P.PROVIDERS.kie);
  eq("self-test reads the catalogue", r.models, ["claude-3-7-sonnet"]);
  if (!/does not serve/.test(r.verdict) || !/claude-3-7-sonnet/.test(r.verdict))
    failures.push(`self-test must name the served model: ${r.verdict}`);

  // (b) the host caps the reply length.
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/v1/models")) return err(404, "no catalogue");
    const body = JSON.parse(init.body);
    return body.max_tokens > 4096 ? err(500, "Internal error") : ok200;
  };
  r = await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6", P.PROVIDERS.kie);
  eq("self-test finds the reply-length ceiling", r.cap, 4096);
  if (!r.vision) failures.push("a host that takes images must be reported as taking them");
  if (!/caps replies at 4k/.test(r.verdict)) failures.push(`cap verdict: ${r.verdict}`);

  // (c) the host takes text but not images — it cannot read drawings.
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/v1/models")) return err(404, "no catalogue");
    const body = JSON.parse(init.body);
    const hasImage = JSON.stringify(body.messages).includes('"image"');
    return hasImage ? err(400, "image blocks are not supported") : ok200;
  };
  r = await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6", P.PROVIDERS.kie);
  eq("self-test: no cap needed", r.cap, 0);
  if (r.vision) failures.push("a host that refuses images must not be reported as reading drawings");
  if (!/cannot read drawings/.test(r.verdict)) failures.push(`vision verdict: ${r.verdict}`);

  // (d) everything works.
  globalThis.fetch = async (url) => (String(url).endsWith("/v1/models") ? err(404, "x") : ok200);
  r = await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6", P.PROVIDERS.kie);
  if (!/Working/.test(r.verdict) || r.cap !== 0 || !r.vision)
    failures.push(`healthy host misreported: ${r.verdict}`);

  // (f) a host that answers a tiny request but refuses every real reply length
  // must not be reported as working.
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/v1/models")) return err(404, "x");
    return JSON.parse(init.body).max_tokens > 64 ? err(500, "Internal error") : ok200;
  };
  r = await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6", P.PROVIDERS.kie);
  eq("no usable reply length means no cap is stored", r.cap, 0);
  if (/Working/.test(r.verdict) || !/refused every reply length/.test(r.verdict))
    failures.push(`unusable host misreported: ${r.verdict}`);

  // The model the app would actually send is probed FIRST. Substituting a
  // catalogue id turns "that model is not served" into "your key is bad", and
  // a gateway's catalogue can lead with models that are not chat models at all.
  {
    const wire = [];
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith("/v1/models"))
        return { ok: true, status: 200, json: async () => ({ data: [{ id: "veo3-fast" }, { id: "claude-sonnet-4-6" }] }), text: async () => "" };
      const body = JSON.parse(init.body);
      wire.push(body.model);
      // Only the real Claude model answers; the media model 400s like one would.
      return body.model === "claude-sonnet-4-6" ? ok200 : err(400, "this model does not support messages");
    };
    r = await C.probeProvider("sk-kie-abcdefgh12", "claude-opus-4-8", P.PROVIDERS.kie);
    eq("the stored model is tried first", wire[0], "claude-opus-4-8");
    const alts = wire.filter((m) => m !== "claude-opus-4-8");
    if (alts[0] !== "claude-sonnet-4-6")
      failures.push(`a Claude id must be preferred over a media model: tried ${alts[0]}`);
    if (/rejected the key/.test(r.verdict))
      failures.push(`an unserved model must not be reported as a bad key: ${r.verdict}`);
    if (!/does not serve/.test(r.verdict) || !/claude-sonnet-4-6/.test(r.verdict))
      failures.push(`verdict should name the model that works: ${r.verdict}`);
    eq("measurements are attributed to the model they were taken on", r.model, "claude-sonnet-4-6");
    if (alts.some((m) => m !== "claude-sonnet-4-6"))
      failures.push("length and image probes must run on the model that works");
  }

  // When the stored model works, everything after it is measured on that model
  // — not on whatever the catalogue happens to list first.
  {
    const wire = [];
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith("/v1/models"))
        return { ok: true, status: 200, json: async () => ({ data: [{ id: "claude-3-7-sonnet" }] }), text: async () => "" };
      wire.push(JSON.parse(init.body).model);
      return ok200;
    };
    r = await C.probeProvider("sk-kie-abcdefgh12", "claude-opus-4-8", P.PROVIDERS.kie);
    eq("a working stored model is the one measured", r.model, "claude-opus-4-8");
    if (wire.some((m) => m !== "claude-opus-4-8"))
      failures.push(`every probe should use the stored model: ${JSON.stringify(wire)}`);
    if (!/Working/.test(r.verdict)) failures.push(`healthy stored model: ${r.verdict}`);
  }

  // A rate limit is not a statement about reply length: reading one as a length
  // refusal would pin a permanent ceiling on a passing squall.
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/v1/models")) return err(404, "x");
    return JSON.parse(init.body).max_tokens > 64 ? err(429, "rate limit exceeded") : ok200;
  };
  r = await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6", P.PROVIDERS.kie);
  eq("a rate-limited ladder settles nothing", r.lengthOk, false);
  eq("and proposes no ceiling", r.cap, 0);
  if (!/before the test could measure the reply length/.test(r.verdict))
    failures.push(`rate-limit verdict: ${r.verdict}`);
  if (/caps replies/.test(r.verdict)) failures.push("a rate limit must not be reported as a cap");

  // A settled ladder is the only thing that may be stored, so say which it was.
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/v1/models")) return err(404, "x");
    return JSON.parse(init.body).max_tokens > 4096 ? err(500, "Internal error") : ok200;
  };
  r = await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6", P.PROVIDERS.kie);
  if (!r.lengthOk || r.cap !== 4096) failures.push(`a settled ladder must report itself: ${JSON.stringify({ lengthOk: r.lengthOk, cap: r.cap })}`);

  // A key can be right and simply sent the wrong way. kie.ai documents two
  // auth routes; a host that honours only one must be found, not written off.
  {
    const seen = [];
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith("/v1/models")) return err(404, "x");
      const h = init.headers || {};
      seen.push(h["x-api-key"] ? `x-api-key:${h["x-api-key"]}` : `bearer:${h["authorization"]}`);
      // Only the documented ANTHROPIC_API_KEY route ("Bearer <key>" in
      // x-api-key) is honoured here.
      return h["x-api-key"] === "Bearer sk-kie-abcdefgh12" ? ok200 : err(530, "Internal error, please try again later");
    };
    r = await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6", P.PROVIDERS.kie);
    eq("the documented default is tried first", seen[0], "bearer:Bearer sk-kie-abcdefgh12");
    // A 530 is retried once before the route is blamed, so the second attempt
    // is the same route again; the fallback comes after that.
    const firstAlt = seen.findIndex((h) => h.startsWith("x-api-key:"));
    if (firstAlt < 1) failures.push(`the other documented route was never tried: ${JSON.stringify(seen)}`);
    eq("and it carries the documented value", seen[firstAlt], 'x-api-key:Bearer sk-kie-abcdefgh12');
    eq("and that one is reported as the way in", r.auth, "x-api-key-bearer");
    eq("the model then counts as working", r.model, "claude-sonnet-4-6");
    if (!/only accepted the key sent as/.test(r.verdict))
      failures.push(`the working auth route must be stated: ${r.verdict}`);
    if (seen.slice(firstAlt).some((h) => !h.startsWith("x-api-key:Bearer")))
      failures.push("every later probe must use the route that worked");
    // And a real call must then go out that way too.
    calls.length = 0;
    const wire2 = [];
    globalThis.fetch = async (url, init) => {
      wire2.push(init.headers);
      return { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply) };
    };
    await C.claudeParseNl("x", {}, "sk-kie-abcdefgh12", "claude-sonnet-4-6", "", P.PROVIDERS.kie, 0, r.auth);
    eq("a real call follows the discovered route", wire2[0]["x-api-key"], "Bearer sk-kie-abcdefgh12");
    if ("authorization" in wire2[0]) failures.push("the unused route must not be sent as well");
  }

  // A 530 means the gateway could not reach its model. It is never a statement
  // about the request, so it must not be read as one — and it is worth retrying.
  {
    let n = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/v1/models")) return err(404, "x");
      n += 1;
      return n <= 2 ? err(530, "Internal error, please try again later") : { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply) };
    };
    const got = await C.claudeParseNl("x", {}, "sk-kie-abcdefgh12", "claude-sonnet-4-6", "", P.PROVIDERS.kie);
    if (!got) failures.push("a call must survive a gateway blip");
    if (n < 3) failures.push(`a transient status must be retried: ${n} attempt(s)`);

    globalThis.fetch = async (url) => (String(url).endsWith("/v1/models") ? err(404, "x") : err(530, "Internal error, please try again later"));
    r = await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6", P.PROVIDERS.kie);
    eq("a host that never answers measures nothing", r.model, "");
    if (/rejected the key/.test(r.verdict))
      failures.push(`530 is not a statement about the key: ${r.verdict}`);
    if (!/theirs to fix/.test(r.verdict)) failures.push(`530 verdict: ${r.verdict}`);
  }

  // A host that simply does not publish a catalogue is not a failing check —
  // a red cross above the word "Working" teaches the user to distrust the test.
  globalThis.fetch = async (url) => (String(url).endsWith("/v1/models") ? err(404, "x") : ok200);
  r = await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6", P.PROVIDERS.kie);
  const cat = r.steps.find((st) => st.id === "models");
  if (!cat || !cat.ok || !cat.info) failures.push(`a missing catalogue must read as informational: ${JSON.stringify(cat)}`);
  if (r.steps.some((st) => st.id !== "models" && st.info))
    failures.push("only the catalogue step is informational");

  // (e) a bad key is still a bad key.
  globalThis.fetch = async (url) => (String(url).endsWith("/v1/models") ? err(401, "x") : err(401, "invalid key"));
  r = await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6", P.PROVIDERS.kie);
  if (!/rejected the key itself/.test(r.verdict)) failures.push(`401 verdict: ${r.verdict}`);

  // The self-test must never send a key to a host it does not belong to.
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), headers: init.headers || {} });
    return String(url).endsWith("/v1/models") ? err(404, "x") : ok200;
  };
  await C.probeProvider("sk-kie-abcdefgh12", "claude-sonnet-4-6");
  if (seen.some((c) => c.url.includes("api.anthropic.com")))
    failures.push("the self-test sent a kie key to Anthropic");
  if (seen.some((c) => (c.headers["x-api-key"] || "").length))
    failures.push("the self-test put a kie key in x-api-key");

  // The ceiling the self-test discovered has to reach the wire, or the whole
  // exercise is theatre.
  {
    const wire = [];
    globalThis.fetch = async (url, init) => {
      wire.push(JSON.parse(init.body).max_tokens);
      return { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply) };
    };
    const ask = (cap) => C.claudeParseNl("x", {}, "sk-kie-abcdefgh12", "claude-sonnet-4-6", "", P.PROVIDERS.kie, cap);
    await ask(0);
    eq("no ceiling: the full ask goes out", wire[0], 8000);
    await ask(4096);
    eq("a ceiling below the ask clamps it", wire[1], 4096);
    await ask(16000);
    eq("a ceiling above the ask does not raise it", wire[2], 8000);
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
