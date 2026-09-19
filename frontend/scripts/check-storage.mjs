// What the browser remembers between calls, and what it must forget.
//
// frontend/src/api.ts is the whole backend of the static build: the key, which
// provider it belongs to, which model that provider was told to use, and the
// reply-length ceiling that provider was measured at all live in localStorage.
// Getting any of them wrong is silent — the app keeps working and quietly
// sends the wrong thing — so they are asserted here against the real module,
// bundled exactly as it ships.
//
//   npm run check:storage
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const failures = [];
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
};

// A localStorage that behaves like the real one, plus a mode where every
// access throws — a private window, or storage disabled — which must never
// reach the UI as an exception.
let store = new Map();
let broken = false;
const guard = () => { if (broken) throw new Error("storage disabled"); };
globalThis.localStorage = {
  getItem: (k) => { guard(); return store.has(k) ? store.get(k) : null; },
  setItem: (k, v) => { guard(); store.set(k, String(v)); },
  removeItem: (k) => { guard(); store.delete(k); },
  clear: () => { guard(); store.clear(); },
};
const reset = () => { store = new Map(); broken = false; };

// Inside the project, not /tmp: the bundle leaves "xlsx" to node, which can
// only find it from a path under node_modules.
const out = mkdtempSync(join(root, "node_modules", ".storecheck-"));
try {
  await build({
    entryPoints: [resolve(root, "src/api.ts"), resolve(root, "src/engine/providers.ts")],
    outdir: out, outbase: root, bundle: true, format: "esm", platform: "node", logLevel: "silent",
    // The workbook writer is a CommonJS package that expects node's own
    // require(); leave it to node rather than inlining it.
    external: ["xlsx"],
    // Only reached by a real drawing upload, and it pulls in the pdf.js worker
    // as a Vite ?url asset, which means nothing outside Vite.
    plugins: [{
      name: "stub-pdf",
      setup(b) {
        b.onResolve({ filter: /engine\/pdf$/ }, (a) => ({ path: a.path, external: true }));
      },
    }],
  });
  const A = await import(pathToFileURL(join(out, "src/api.js")).href);
  // Only the ids are used from these, so a separate copy of the module is fine.
  const P = await import(pathToFileURL(join(out, "src/engine/providers.js")).href);

  const KIE = "sk-kie-abcdefgh12";
  const ANT = "sk-ant-abcdefgh12";

  // ------------------------------------------------------------- the model
  reset();
  A.setApiKey(KIE);
  eq("a fresh browser uses the default model", A.getModel(), "claude-sonnet-4-6");
  A.setModel("claude-3-7-sonnet");
  eq("a chosen model is kept verbatim", A.getModel(), "claude-3-7-sonnet");
  // A model id proven on a gateway means nothing on the other host.
  A.setApiKey(ANT);
  eq("the other provider keeps its own model", A.getModel(), "claude-sonnet-4-6");
  A.setModel("claude-opus-4-8");
  A.setApiKey(KIE);
  eq("and coming back restores the first one", A.getModel(), "claude-3-7-sonnet");
  A.setApiKey(ANT);
  eq("as does going the other way", A.getModel(), "claude-opus-4-8");
  // A model can be recorded against a provider that is not the active one:
  // the self-test runs on the key being typed, not the one already saved.
  A.setApiKey(KIE);
  A.setModel("claude-3-5-haiku", P.PROVIDERS.anthropic);
  eq("recording for another provider leaves the active one alone", A.getModel(), "claude-3-7-sonnet");
  A.setApiKey(ANT);
  eq("and is there when that provider becomes active", A.getModel(), "claude-3-5-haiku");

  // An older build stored a bare id, not a map. It must survive the upgrade.
  reset();
  localStorage.setItem("boq.claudeModel", "claude-opus-4-8");
  A.setApiKey(KIE);
  eq("a pre-upgrade model is still honoured", A.getModel(), "claude-opus-4-8");
  A.setModel("claude-3-7-sonnet");
  eq("and is replaced cleanly", A.getModel(), "claude-3-7-sonnet");

  // Junk in storage must not take the app down.
  reset();
  localStorage.setItem("boq.claudeModel", "{not json");
  A.setApiKey(KIE);
  eq("garbage in the model slot falls back", typeof A.getModel(), "string");

  // ------------------------------------------------------------- the ceiling
  reset();
  A.setApiKey(KIE);
  const kie = A.getProvider();
  eq("no ceiling is assumed", A.getMaxTokensCap(kie), 0);
  A.setMaxTokensCap(kie, 4096);
  eq("a measured ceiling is kept", A.getMaxTokensCap(kie), 4096);
  eq("and travels with the key and model", A.credentials().maxTokensCap, 4096);
  // It was measured on one account. Another key may be another plan.
  A.setApiKey(ANT);
  eq("a different key starts from no ceiling", A.getMaxTokensCap(A.getProvider()), 0);
  A.setApiKey(KIE);
  eq("and the old one is not resurrected", A.getMaxTokensCap(A.getProvider()), 0);
  A.setMaxTokensCap(A.getProvider(), 8192);
  A.setMaxTokensCap(A.getProvider(), 0);
  eq("clearing a ceiling clears it", A.getMaxTokensCap(A.getProvider()), 0);
  // Re-saving the same key is not a change and must not throw the ceiling away.
  A.setMaxTokensCap(A.getProvider(), 4096);
  A.setApiKey(KIE);
  eq("re-saving the same key keeps it", A.getMaxTokensCap(A.getProvider()), 4096);

  // ------------------------------------------------------------- the key
  reset();
  A.setApiKey(`  export ANTHROPIC_API_KEY="Bearer ${KIE}"  `);
  eq("a pasted export line yields the key", A.getApiKey(), KIE);
  A.setProviderPref("anthropic");
  A.setMaxTokensCap(A.getProvider(), 4096);
  A.setApiKey("");
  eq("removing the key removes it", A.getApiKey(), "");
  eq("and the provider pin with it", A.getProviderPref(), "auto");
  eq("and the ceiling with it", A.getMaxTokensCap(A.getProvider()), 0);

  // A key and the provider it goes to are read as one set, never separately.
  reset();
  A.setApiKey(KIE);
  A.setProviderPref("anthropic");
  const cred = A.credentials();
  eq("a recognised key ignores a pin pointing elsewhere", cred.provider.id, "kie");
  eq("and the credentials name that provider's model", cred.model, "claude-sonnet-4-6");
  eq("and carry the key itself", cred.key, KIE);

  // ------------------------------------------------- storage that does not work
  reset();
  broken = true;
  for (const [name, fn] of [
    ["getApiKey", () => A.getApiKey()],
    ["getModel", () => A.getModel()],
    ["getProvider", () => A.getProvider().id],
    ["getProviderPref", () => A.getProviderPref()],
    ["credentials", () => A.credentials().provider.id],
    ["setApiKey", () => A.setApiKey(KIE)],
    ["setModel", () => A.setModel("claude-opus-4-8")],
    ["setMaxTokensCap", () => A.setMaxTokensCap(A.getProvider(), 4096)],
  ]) {
    try { fn(); } catch (e) { failures.push(`${name}() threw when storage is unavailable: ${e.message}`); }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`storage contract: ${failures.length} failure(s)\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("storage contract: all checks passed");
