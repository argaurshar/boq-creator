import { Fragment, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import {
  api,
  getApiKey,
  setApiKey,
  getProvider,
  getProviderPref,
  setProviderPref,
  getModel,
  setModel,
  Boq,
  BoqItem,
  Project,
  RateRow,
  Member,
} from "./api";
import { STEEL_SECTIONS } from "./engine/materials";
import { DEMO_RATES } from "./engine/demo";
import { PACK_DEMO_RATES } from "./engine/packs";
import { materialTakeoff } from "./engine/takeoff";
import {
  BOQ_COLUMNS, groupSerial, itemSerial, itemNameOf, specTextOf,
} from "./engine/boqtable";
import {
  DISCIPLINES, DEFAULT_DISCIPLINE, disciplineInfo, disciplinesFor, inScope, Discipline,
} from "./engine/disciplines";
import type { OutOfScopeEntry } from "./engine/boq";
import { PACK_TYPES, PACK_UI } from "./engine/packs";
import {
  PROVIDER_LIST, ProviderPref, detectProvider, normalizeKey, overrideIgnored,
  providerInfo, resolveProvider,
} from "./engine/providers";

// Right-aligned columns of the seven-column BOQ contract.
const NUM_COLS = new Set<string>(["Quantity", "Rate", "Amount"]);

// Auto-created projects get a unique name ("New Project", "New Project 2", …)
// so the project dropdown never shows two indistinguishable entries.
function nextProjectName(existing: { name: string }[]): string {
  const taken = new Set(existing.map((p) => p.name.trim().toLowerCase()));
  if (!taken.has("new project")) return "New Project";
  let n = 2;
  while (taken.has(`new project ${n}`)) n += 1;
  return `New Project ${n}`;
}

const INR = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Visual identity for element cards: icon + the member's primary BOQ category
// (drives the card's colour rail via the validated .cat-* palette).
const TYPE_ICON: Record<string, string> = {
  column: "🏛️", beam: "〰️", footing: "🦶", slab: "⬜", rcc_wall: "🧊",
  pcc: "🪨", brick_wall: "🧱", plaster_surface: "🎨", earthwork_pit: "⛏️",
  steel_member: "🔩", truss: "🔺", anchor_bolt: "⚓", roof_sheeting: "🏠",
};
const TYPE_CAT: Record<string, string> = {
  column: "concrete", beam: "concrete", footing: "concrete", slab: "concrete",
  rcc_wall: "concrete", pcc: "concrete", brick_wall: "masonry",
  plaster_surface: "plaster", earthwork_pit: "earthwork",
  steel_member: "steel", truss: "steel", anchor_bolt: "steel",
  roof_sheeting: "roofing",
};
// Discipline packs contribute their own icons, categories and form fields.
for (const t of PACK_TYPES) {
  TYPE_ICON[t] = PACK_UI[t].icon;
  TYPE_CAT[t] = PACK_UI[t].category;
}

// One-line dimension summary (mm implied) so a card reads like a schedule row.
function specOf(t: string, p: Record<string, any>): string {
  const n = (v: any) => (v == null ? "?" : v);
  const parts: string[] = [];
  switch (t) {
    case "column": parts.push(`${n(p.b_mm)}×${n(p.D_mm)}`, `H ${n(p.height_mm)}`); break;
    case "beam": parts.push(`${n(p.b_mm)}×${n(p.depth_mm)}`, `L ${n(p.clear_span_mm)}`); break;
    case "footing":
    case "earthwork_pit": parts.push(`${n(p.length_mm)}×${n(p.breadth_mm)}`, `D ${n(p.depth_mm)}`); break;
    case "slab":
    case "pcc": parts.push(`${n(p.length_mm)}×${n(p.breadth_mm)}`, `t ${n(p.thickness_mm)}`); break;
    case "rcc_wall":
    case "brick_wall": parts.push(`L ${n(p.length_mm)}`, `H ${n(p.height_mm)}`, `t ${n(p.thickness_mm)}`); break;
    case "plaster_surface": parts.push(`L ${n(p.length_mm)}`, `H ${n(p.height_mm)}`, `${n(p.faces ?? 1)} face`); break;
    case "steel_member": parts.push(String(p.designation || ""), `L ${n(p.length_mm)}`); break;
    case "truss": parts.push(`span ${n(p.span_mm)}`, `${(p.segments || []).length} segments`); break;
    case "anchor_bolt": parts.push(`⌀${n(p.dia_mm)}`, `L ${n(p.length_mm)}`); break;
    case "roof_sheeting": parts.push(`${n(p.length_mm)}×${n(p.breadth_mm)}`); break;
    default:
      if (PACK_UI[t]) parts.push(...PACK_UI[t].specLine(p));
  }
  if ((p.count ?? 1) > 1) parts.push(`×${p.count}`);
  return parts.filter(Boolean).join(" · ");
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [pid, setPid] = useState<number | null>(null);
  const [boq, setBoq] = useState<Boq | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [rates, setRates] = useState<RateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean>(() => !!getApiKey());
  // Which host the key talks to (Anthropic direct, or kie.ai credits).
  const [provider, setProviderState] = useState(() => getProvider());
  const [model, setModelState] = useState<string>(() => getModel());
  // In-app dialogs instead of window.prompt(): the latter is blocked in
  // sandboxed/embedded browsers (e.g. VS Code's Simple Browser).
  const [showNewProject, setShowNewProject] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [mobileTab, setMobileTab] = useState<"left" | "center" | "right">("center");
  // Phone header: the secondary actions fold behind a "⋯" button.
  const [moreOpen, setMoreOpen] = useState(false);
  // "ink" = dark blueprint (default) · "paper" = light drafting-paper theme.
  const [theme, setTheme] = useState<string>(
    () => localStorage.getItem("boq.theme") || "ink"
  );

  useEffect(() => {
    document.body.classList.toggle("paper", theme === "paper");
    localStorage.setItem("boq.theme", theme);
  }, [theme]);

  const project = projects.find((p) => p.id === pid) || null;

  const saveKey = (raw: string, pref: ProviderPref) => {
    setShowKey(false);
    const key = normalizeKey(raw);
    setApiKey(key);                       // also clears the pin when key is ""
    if (key) setProviderPref(pref);
    setHasKey(!!key);
    setProviderState(getProvider());
    // A model the new provider does not serve would 404 on the first call, so
    // getModel() filters it — mirror that into the picker.
    const m = getModel();
    if (m !== model) setModelState(m);
  };

  // A refresh started for one project must never paint another: debounced
  // rate writes can complete after the user has already switched.
  const pidRef = useRef<number | null>(null);
  useEffect(() => { pidRef.current = pid; }, [pid]);

  const refresh = useCallback(async (id: number) => {
    try {
      const [b, m, r] = await Promise.all([
        api.getBoq(id),
        api.listMembers(id),
        api.listRates(id),
      ]);
      if (pidRef.current !== id) return;
      setBoq(b);
      setMembers(m);
      setRates(r);
      setError(null);
      // On a phone the panes are tabs: an empty project should open on the
      // Elements pane where the three steps live, not on an empty BOQ.
      if (m.length === 0) setMobileTab("left");
    } catch (e: any) {
      setError("Failed to load project data: " + e.message);
    }
  }, []);

  useEffect(() => {
    // Always open on a FRESH, empty BOQ — never reopen a previously generated
    // one. We land on an existing empty project if there is one (so repeated
    // opens don't pile up blanks), otherwise we create a new empty project.
    // Earlier projects are kept and stay selectable in the project dropdown.
    (async () => {
      try {
        let ps = await api.listProjects();
        let targetId: number | null = null;
        for (const p of ps) {
          const m = await api.listMembers(p.id);
          if (m.length === 0) { targetId = p.id; break; }
        }
        if (targetId === null) {
          const np = await api.createProject({ name: nextProjectName(ps) });
          ps = [np, ...ps];
          targetId = np.id;
        }
        setProjects(ps);
        setPid((prev) => prev ?? targetId);
      } catch (e: any) {
        setError("Failed to reach the backend: " + e.message);
      }
    })();
  }, []);

  useEffect(() => {
    if (pid !== null) refresh(pid);
  }, [pid, refresh]);

  // Switching discipline re-gates the take-off: nothing is deleted, elements
  // simply move between "measured" and the out-of-scope register.
  const setDiscipline = async (d: Discipline) => {
    if (pid === null) return;
    try {
      const p = await api.updateProject(pid, { discipline: d });
      setProjects((ps) => ps.map((x) => (x.id === p.id ? p : x)));
      refresh(pid);
    } catch (e: any) {
      setError("Could not switch discipline: " + e.message);
    }
  };

  // Contingency lives on the project so the report and workbook print the
  // same estimate the screen shows.
  const saveContingency = async (pct: number) => {
    if (pid === null) return;
    try {
      const p = await api.updateProject(pid, { contingency_pct: pct });
      setProjects((ps) => ps.map((x) => (x.id === p.id ? p : x)));
    } catch (e: any) {
      setError("Could not save contingency: " + e.message);
    }
  };

  const createProject = async (rawName: string) => {
    setShowNewProject(false);
    const name = rawName.trim();
    if (!name) return;
    try {
      const p = await api.createProject({ name });
      setProjects((ps) => [p, ...ps]);
      setPid(p.id);
    } catch (e: any) {
      setError("Could not create project: " + e.message);
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <h1>🏗️ BOQ Creator</h1>
        <span className="tag">AI-assisted, engineer-verified · IS-code</span>
        <div className="spacer" />
        {/* On a phone the project picker stays on the first row and every
            other action folds behind "⋯" so the header is two rows at most. */}
        <select
          value={pid ?? ""}
          aria-label="Project"
          className="tb-project"
          onChange={(e) =>
            setPid(e.target.value === "" ? null : Number(e.target.value))
          }
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className="tb-more"
          aria-expanded={moreOpen}
          aria-controls="tb-tools"
          aria-label={moreOpen ? "Hide menu" : "Show menu"}
          onClick={() => setMoreOpen((o) => !o)}
        >
          {moreOpen ? "✕" : "⋯"}
        </button>
        <div
          id="tb-tools"
          className={`tb-tools ${moreOpen ? "open" : ""}`}
          onClick={(e) => {
            // An action taken from the folded menu closes it; changing a
            // select does not.
            if ((e.target as HTMLElement).closest("button")) setMoreOpen(false);
          }}
        >
        <button
          className={hasKey ? "keybtn set" : "keybtn"}
          onClick={() => setShowKey(true)}
          title={
            hasKey
              ? `Your ${provider.label} key is set in this browser. Click to change it, switch provider, or remove it.`
              : "No AI key set — paste an Anthropic (sk-ant-…) or a kie.ai (sk-kie-…) key to read drawings. Chat and demo data work without one."
          }
        >
          {hasKey ? `🔑 ${provider.short}` : "🔑 Set AI key"}
        </button>
        <button
          className="themebtn"
          onClick={() => setTheme(theme === "paper" ? "ink" : "paper")}
          title={
            theme === "paper"
              ? "Switch to the dark blueprint-ink theme"
              : "Switch to the light drafting-paper theme"
          }
        >
          {theme === "paper" ? "🌙 Ink" : "☀️ Paper"}
        </button>
        <select
          value={model}
          aria-label="AI model"
          title={`AI model used to read drawings and chat, via ${provider.label}. Opus reads the most thoroughly; Sonnet is faster/cheaper.`}
          onChange={(e) => { setModel(e.target.value); setModelState(e.target.value); }}
        >
          {provider.models.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <button onClick={() => setShowNewProject(true)}>+ Project</button>
        {pid !== null && (
          <>
            <button onClick={() => setShowDetails(true)} title="Edit client, drawing ref, prepared-by, built-up area…">
              ✎ Details
            </button>
            <button
              onClick={() => {
                api.openReport(pid).catch((e: any) =>
                  setError("Report failed: " + e.message)
                );
              }}
              title="Open a printable report — use the browser's Save as PDF"
            >
              🖨 Report
            </button>
            <button
              className="accent"
              onClick={() => {
                api.exportXlsx(pid).catch((e: any) =>
                  setError("Export failed: " + e.message)
                );
              }}
            >
              ⬇ Export Excel
            </button>
          </>
        )}
        </div>
      </div>
      {error && <div className="errbar" role="alert">{error}</div>}

      {pid === null ? (
        <div className="empty">
          <div>
            Create a project to begin. Upload drawings, add elements in plain
            English, review the BOQ, then export to Excel.
          </div>
          <button
            className="primary"
            style={{ marginTop: 14 }}
            onClick={() => setShowNewProject(true)}
          >
            + Create project
          </button>
        </div>
      ) : (
        <>
          <div className="mobile-tabs">
            <button className={mobileTab === "left" ? "on" : ""} aria-pressed={mobileTab === "left"} onClick={() => setMobileTab("left")}>📐 Elements</button>
            <button className={mobileTab === "center" ? "on" : ""} aria-pressed={mobileTab === "center"} onClick={() => setMobileTab("center")}>📋 BOQ</button>
            <button className={mobileTab === "right" ? "on" : ""} aria-pressed={mobileTab === "right"} onClick={() => setMobileTab("right")}>💬 Chat &amp; Rates</button>
          </div>
          <div className={"body tab-" + mobileTab}>
            {/* key={pid}: per-project UI state (staged files, drafts, chat)
                must not leak into the next project. */}
            <LeftPanel
              key={`l${pid}`}
              pid={pid}
              members={members}
              discipline={project?.discipline || DEFAULT_DISCIPLINE}
              outOfScope={boq?.out_of_scope || []}
              hasKey={hasKey}
              onOpenKey={() => setShowKey(true)}
              onShowBoq={() => setMobileTab("center")}
              onDiscipline={setDiscipline}
              onChange={() => refresh(pid)}
            />
            <CenterPanel
              key={`c${pid}`}
              pid={pid}
              boq={boq}
              rates={rates}
              currency={project?.currency || "INR"}
              contingencyPct={project?.contingency_pct || 0}
              onContingency={saveContingency}
              onDiscipline={setDiscipline}
              onStart={() => setMobileTab("left")}
              onChange={() => refresh(pid)}
            />
            <RightPanel
              key={`r${pid}`}
              pid={pid}
              project={project}
              rates={rates}
              boqCats={(boq?.groups || []).map((g) => g.category)}
              onChange={() => refresh(pid)}
            />
          </div>
        </>
      )}

      {showNewProject && (
        <PromptModal
          title="New project"
          label="Project name"
          defaultValue={nextProjectName(projects)}
          submitLabel="Create"
          onSubmit={createProject}
          onClose={() => setShowNewProject(false)}
        />
      )}
      {showKey && (
        <ApiKeyModal onSubmit={saveKey} onClose={() => setShowKey(false)} />
      )}
      {showDetails && project && (
        <ProjectDetailsModal
          project={project}
          onClose={() => setShowDetails(false)}
          onSave={async (patch) => {
            await api.updateProject(project.id, patch);
            const ps = await api.listProjects();
            setProjects(ps);
            setShowDetails(false);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------- Project details */
function ProjectDetailsModal({
  project, onClose, onSave,
}: {
  project: Project;
  onClose: () => void;
  onSave: (patch: Partial<Project>) => Promise<void>;
}) {
  const [f, setF] = useState({
    name: project.name || "",
    client: project.client || "",
    location: project.location || "",
    currency: project.currency || "INR",
    prepared_by: project.prepared_by || "",
    drawing_ref: project.drawing_ref || "",
    report_date: project.report_date || "",
    built_up_area_m2: project.built_up_area_m2 ? String(project.built_up_area_m2) : "",
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <label className="ff"><span>{label}</span>
      <input type={type} value={f[k]} onChange={(e) => set(k, e.target.value)} /></label>
  );
  return (
    <Dialog title="Project details" width={520} onClose={onClose}>
        <p className="muted small" style={{ marginTop: 0 }}>
          Used in the printable report and Excel header.
        </p>
        <div className="ffgrid">
          {field("name", "Project name")}
          {field("client", "Client")}
          {field("location", "Location")}
          {field("currency", "Currency (e.g. INR)")}
          {field("prepared_by", "Prepared by")}
          {field("drawing_ref", "Drawing ref.")}
          {field("report_date", "Date")}
          {field("built_up_area_m2", "Built-up area (m²)", "number")}
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave({
            name: f.name.trim() || "Untitled Project",
            client: f.client.trim(),
            location: f.location.trim(),
            currency: f.currency.trim() || "INR",
            prepared_by: f.prepared_by.trim(),
            drawing_ref: f.drawing_ref.trim(),
            report_date: f.report_date.trim(),
            built_up_area_m2: f.built_up_area_m2 ? Number(f.built_up_area_m2) : undefined,
          })}>Save</button>
        </div>
    </Dialog>
  );
}

/* --------------------------------------------------------------- Modal */
let dialogSeq = 0;

/**
 * The one modal container: role=dialog, labelled by its title, focus moved in
 * on open, Tab/Shift+Tab kept inside, Escape and backdrop close it, and focus
 * goes back to whatever opened it. Both modals render through this so a
 * keyboard or screen-reader user gets the same behaviour everywhere.
 */
function Dialog({ title, width, onClose, children }: {
  title: string; width?: number; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [titleId] = useState(() => `dlg-${++dialogSeq}`);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>(
        'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'
      )).filter((el) => !el.hasAttribute("disabled"));
    // A dialog whose point is a text field says so with data-autofocus, and
    // starts with the whole value selected so a paste replaces it.
    const preferred = root.querySelector<HTMLElement>("[data-autofocus]");
    (preferred || focusables()[0] || root).focus();
    if (preferred instanceof HTMLInputElement) preferred.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) { e.preventDefault(); return; }
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Restore focus on the next frame: focusing the opener synchronously
      // puts it under the very keystroke that closed the dialog, so an Enter
      // that saved would immediately re-open it.
      const raf = requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus?.();
      });
      setTimeout(() => cancelAnimationFrame(raf), 1000);
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={width ? { width } : undefined}
      >
        <h3 id={titleId} style={{ margin: "0 0 6px" }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function PromptModal({
  title,
  label,
  message,
  defaultValue,
  password,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  message?: string;
  defaultValue?: string;
  password?: boolean;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(defaultValue ?? "");
  const [inputId] = useState(() => `dlg-in-${++dialogSeq}`);
  return (
    <Dialog title={title} onClose={onClose}>
        {message && (
          <p className="muted small" style={{ marginTop: 0 }}>{message}</p>
        )}
        <label className="field" htmlFor={inputId}>{label}</label>
        <input
          id={inputId}
          className="w"
          type={password ? "password" : "text"}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit(val);
          }}
        />
        <div
          className="row"
          style={{ justifyContent: "flex-end", gap: 8, marginTop: 14 }}
        >
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSubmit(val)}>
            {submitLabel ?? "OK"}
          </button>
        </div>
    </Dialog>
  );
}

/* --------------------------------------------------------- AI key modal */
/** Paste a key, get a working app.
 *
 *  The app speaks the Anthropic Messages API, which two hosts serve: Anthropic
 *  itself and kie.ai (same Claude models, billed as kie.ai credits). The user
 *  should not have to know which endpoint that implies — the key prefix says
 *  it, and this dialog shows what it detected before anything is saved. The
 *  override exists for keys that carry no recognisable prefix. */
function ApiKeyModal({
  onSubmit, onClose,
}: {
  onSubmit: (key: string, pref: ProviderPref) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(() => getApiKey());
  const [pref, setPref] = useState<ProviderPref>(() => getProviderPref());
  const [inputId] = useState(() => `key-in-${++dialogSeq}`);

  const key = normalizeKey(raw);
  const detected = detectProvider(key);
  const active = resolveProvider(key, pref);
  // A recognised key always goes to its own provider — a chosen one is only
  // used for keys whose prefix says nothing.
  const ignored = overrideIgnored(key, pref);
  const submit = () => onSubmit(raw, pref);

  const options: Array<{ id: ProviderPref; label: string; hint: string }> = [
    { id: "auto", label: "✨ Auto-detect", hint: "Use whichever provider the key belongs to (recommended)." },
    ...PROVIDER_LIST.map((p) => ({
      id: p.id as ProviderPref,
      label: p.short,
      hint: `${p.blurb} Keys start with ${p.keyHint}. Only used for a key whose prefix is not recognised.`,
    })),
  ];

  return (
    <Dialog title="AI key" width={470} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Paste an <b>Anthropic</b> key (sk-ant-…) or a <b>kie.ai</b> key
        (sk-kie-…) — the same Claude models, billed as kie.ai credits. The app
        works out which one it is and calls the matching endpoint. The key is
        kept only in this browser and is sent to no one but that provider.
        Leave it blank to remove it (the app then uses the key-free demo mode).
      </p>

      <div className="field">Provider</div>
      <div className="prov-grid" role="group" aria-label="AI provider">
        {options.map((o) => (
          <button
            key={o.id}
            className={`prov-opt ${pref === o.id ? "on" : ""}`}
            aria-pressed={pref === o.id}
            title={o.hint}
            onClick={() => setPref(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>

      <label className="field" htmlFor={inputId} style={{ marginTop: 12 }}>API key</label>
      <input
        id={inputId}
        className="w"
        type="password"
        autoComplete="off"
        spellCheck={false}
        data-autofocus
        placeholder="sk-ant-… or sk-kie-… (a whole export line works too)"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
      />

      <div className={`prov-status ${key && !detected ? "warn" : ""}`} role="status" aria-live="polite">
        {!key ? (
          <>Anthropic keys start with {PROVIDER_LIST[0].keyHint}; kie.ai keys start with{" "}
            {PROVIDER_LIST[1].keyHint}. You can paste a whole line from either
            provider's docs.</>
        ) : detected ? (
          <>✓ Detected {active.article} <b>{active.short}</b> key — calls go there.</>
        ) : (
          <>⚠ Unrecognised key prefix — it will be sent to <b>{active.short}</b>.
            Pick the provider above if that is wrong.</>
        )}
      </div>
      {ignored && (
        <div className="prov-status warn">
          ⚠ You chose {providerInfo(pref).short}, but this key is a {active.short}
          {" "}key, so it will go to {active.short}. A key is never sent to a
          provider it does not belong to.
        </div>
      )}

      <div className="row" style={{ marginTop: 10, alignItems: "center", gap: 8 }}>
        <a className="link" href={active.keyUrl} target="_blank" rel="noreferrer noopener">
          Get {active.article} {active.short} key ↗
        </a>
        <div className="spacer" />
        {getApiKey() && (
          <button onClick={() => onSubmit("", pref)} title="Remove the stored key from this browser">
            Remove key
          </button>
        )}
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={submit}>Save</button>
      </div>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- Left */
/** The discipline gate: four modes, exactly one active per run. Shows plainly
 *  what the active pack measures and what it does not cover yet, so a focused
 *  run is never mistaken for a complete one. */
function DisciplineGate({
  discipline, onDiscipline,
}: { discipline: Discipline; onDiscipline: (d: Discipline) => void }) {
  const info = disciplineInfo(discipline);
  return (
    <div className="card dgate step-card">
      <div className="step-h">
        <span className="step-n done">1</span>
        <span className="step-t">Choose discipline</span>
        <span className="step-s">one at a time</span>
      </div>
      <div className="dgate-grid" role="group" aria-label="Discipline">
        {DISCIPLINES.map((d) => (
          <button
            key={d.key}
            className={`dgate-opt ${d.key === discipline ? "on" : ""}`}
            aria-pressed={d.key === discipline}
            onClick={() => onDiscipline(d.key)}
            title={d.blurb}
          >
            <span className="dgate-ico">{d.icon}</span>
            <span className="dgate-label">{d.label}</span>
          </button>
        ))}
      </div>
      <div className="dgate-blurb">{info.blurb}</div>
      {info.types.length === 0 ? (
        <div className="dgate-warn">
          ⚠ No element types are supported in this mode yet — {info.label} take-off
          is not available. Nothing will be measured in this discipline.
        </div>
      ) : info.notYet.length > 0 ? (
        <details className="dgate-gaps">
          <summary>Not covered by this pack yet ({info.notYet.length})</summary>
          <ul>{info.notYet.map((n) => <li key={n}>{n}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function LeftPanel({
  pid,
  members,
  discipline,
  outOfScope,
  hasKey,
  onOpenKey,
  onShowBoq,
  onDiscipline,
  onChange,
}: {
  pid: number;
  members: Member[];
  discipline: Discipline;
  outOfScope: OutOfScopeEntry[];
  hasKey: boolean;
  onOpenKey: () => void;
  onShowBoq: () => void;
  onDiscipline: (d: Discipline) => void;
  onChange: () => void;
}) {
  const dInfo = disciplineInfo(discipline);
  // member id -> reason it sits outside the active discipline
  const oosById = new Map(outOfScope.map((o) => [o.member_id, o.reason]));
  const measuredCount = members.filter((m) => !oosById.has(m.id)).length;
  const [busy, setBusy] = useState("");
  const [staged, setStaged] = useState<File[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const running = !!busy && busy.endsWith("…");

  const runExtraction = async () => {
    const list = staged;
    if (!list.length) return;
    if (!hasKey) {
      // Never wipe the current BOQ for a run that cannot start.
      setBusy("Set your AI key (🔑 in the top bar, under ⋯ on a phone) to read drawings — Anthropic or kie.ai.");
      onOpenKey();
      return;
    }
    try {
      // A new upload always starts a fresh BOQ: wipe any earlier elements and
      // AI suggestions before reading the newly uploaded drawings.
      setBusy("Starting a fresh BOQ — clearing earlier entries…");
      await api.clearMembers(pid);
      setReviews([]);
      onChange();
      let total = 0, rejected = 0, unresolved = 0;
      const allReviews: any[] = [];
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        setBusy(`(${i + 1}/${list.length}) ${f.name} — rendering…`);
        const res = await api.extractDrawing(pid, f, (m) => setBusy(`(${i + 1}/${list.length}) ${m}`));
        total += res.saved;
        rejected += res.rejected.length;
        unresolved += res.unresolved.length;
        allReviews.push(...(res.reviews || []));
        onChange();
      }
      const sev: Record<string, number> = { high: 0, med: 1, low: 2 };
      allReviews.sort((a, b) => (sev[a.severity] ?? 1) - (sev[b.severity] ?? 1));
      setReviews(allReviews);
      // Report the gate honestly: how many of the read elements this
      // discipline actually measured, and how many were set aside.
      const after = await api.getBoq(pid);
      const outside = (after.out_of_scope || []).length;
      const notes: string[] = [];
      if (outside) notes.push(`${outside} outside ${dInfo.label} — set aside`);
      if (rejected) notes.push(`${rejected} need fixing`);
      if (unresolved) notes.push(`${unresolved} unresolved`);
      if (allReviews.length) notes.push(`${allReviews.length} AI suggestion(s)`);
      setBusy(
        `Done. Read ${total} element(s) from ${list.length} file(s); ${total - outside} measured in ${dInfo.label}` +
          (notes.length ? ` (${notes.join("; ")}).` : ".")
      );
      setStaged([]);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/failed to fetch|load failed|dynamically imported module/i.test(msg)) {
        setBusy(
          "Couldn't reach a resource. If the app was just updated, hard-refresh " +
            "(Ctrl/Cmd-Shift-R) and try again. Otherwise check your 🔑 AI key and " +
            "internet connection. (" + msg + ")"
        );
      } else {
        setBusy("Error: " + msg);
      }
    }
  };

  const applyReview = async (r: any, i: number) => {
    try {
      if (r.op === "modify" && r.member_id != null && r.member) await api.updateMember(r.member_id, r.member);
      else if (r.op === "add" && r.member) await api.addMember(pid, { ...r.member, source: "ai" });
      else if (r.op === "remove" && r.member_id != null) await api.deleteMember(r.member_id);
      setReviews((rs) => rs.filter((_, j) => j !== i));
      onChange();
    } catch (e: any) {
      setBusy("Could not apply suggestion: " + (e.message || e));
    }
  };
  const dismissReview = (i: number) => setReviews((rs) => rs.filter((_, j) => j !== i));

  return (
    <div className="col left">
      <h2>Drawings & Elements</h2>
      <div className="scroll">
        {/* The discipline gate — exactly one discipline is measured per run, so
            the take-off stays focused. Anything outside it is registered, not
            dropped (see the out-of-scope panel in the BOQ). */}
        <DisciplineGate discipline={discipline} onDiscipline={onDiscipline} />
        <div className="card step-card">
          <div className="step-h">
            <span className={`step-n ${staged.length || members.length ? "done" : "active"}`}>2</span>
            <span className="step-t">Add drawings</span>
            <span className="step-s">{staged.length ? `${staged.length} ready` : "PDF · several at once"}</span>
          </div>
          <input
            type="file"
            accept="application/pdf"
            multiple
            aria-label="Add PDF drawings"
            disabled={running}
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length) {
                setStaged((prev) => {
                  const names = new Set(prev.map((f) => f.name + f.size));
                  return [...prev, ...files.filter((f) => !names.has(f.name + f.size))];
                });
                setBusy("");
              }
              e.target.value = "";
            }}
          />
          {staged.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="muted small">{staged.length} drawing(s) ready:</div>
              {staged.map((f, i) => (
                <div className="row" key={f.name + f.size} style={{ gap: 6, alignItems: "center" }}>
                  <span className="small">📄 {f.name}</span>
                  <div className="spacer" />
                  {!running && (
                    <button
                      className="link"
                      onClick={() => setStaged((p) => p.filter((_, j) => j !== i))}
                    >
                      remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!hasKey && (
            <div className="keyhint">
              Reading drawings needs your AI key (Anthropic or kie.ai).
              <button className="link" onClick={onOpenKey}>🔑 Set AI key</button>
              <span className="muted small"> · no key? try demo data in step 3</span>
            </div>
          )}
        </div>

        <div className="card step-card">
          <div className="step-h">
            <span className={`step-n ${running ? "active" : members.length ? "done" : staged.length ? "active" : "pending"}`}>3</span>
            <span className="step-t">Generate BOQ</span>
            <span className="step-s">{dInfo.icon} {dInfo.label}</span>
          </div>
          <button
            className="primary gen-btn"
            disabled={!staged.length || running || !hasKey}
            onClick={runExtraction}
            title={
              !hasKey ? "Set your AI key (step 2) to read drawings"
              : !staged.length ? "Add at least one drawing in step 2"
              : `Read the drawings and build the ${dInfo.label} BOQ`
            }
          >
            {running ? "Reading drawings…" : `⚙ Generate ${dInfo.label} BOQ`}
          </button>
          {!running && (
            <button
              className="demo-btn"
              onClick={async () => {
                setBusy("Loading demo data…");
                try {
                  const res = await api.seedDemo(pid, discipline);
                  setBusy(res.seeded_members
                    ? `Loaded demo: ${res.seeded_members} elements.`
                    : "Demo already loaded — nothing new to add.");
                  onChange();
                } catch (e: any) {
                  setBusy("Error: " + e.message);
                }
              }}
              title="No drawing handy? Seed realistic demo elements for this discipline"
            >
              ▶ Try with demo data
            </button>
          )}
          {running && (() => {
            // Animated stage tracker parsed from the progress message.
            const stage = /re-checking/i.test(busy) ? 2
              : /with ai|double-checking/i.test(busy) ? 1 : 0;
            const steps = [
              { ico: "📄", name: "Render pages" },
              { ico: "🧠", name: "AI take-off" },
              { ico: "🔍", name: "Re-check" },
            ];
            return (
              <div className="xtrack">
                <div className="xsteps">
                  {steps.map((s, i) => (
                    <Fragment key={s.name}>
                      {i > 0 && <span className={"xconn" + (i <= stage ? " done" : "")} />}
                      <span className={"xstep" + (i < stage ? " done" : i === stage ? " active" : "")}>
                        <span className="xico">{i < stage ? "✓" : s.ico}</span>
                        <span className="xname">{s.name}</span>
                      </span>
                    </Fragment>
                  ))}
                </div>
                <div className="xbar"><i /></div>
              </div>
            );
          })()}
          {busy && <div className="muted small" role="status" aria-live="polite" style={{ marginTop: 8 }}>{busy}</div>}
          {members.length > 0 && !running && (
            <button className="link see-boq" onClick={onShowBoq}>See the BOQ →</button>
          )}
          <details className="howit">
            <summary>How it works</summary>
            <div className="muted small">
              Claude reads every sheet in your browser with your <strong>🔑 AI
              key</strong> (top bar, under ⋯ on a phone), focused on the discipline you chose in
              step 1; each run starts a fresh BOQ, and every extracted element
              is marked <em>review</em> so you stay in control. Elements that
              belong to another discipline are set aside, never dropped.
            </div>
          </details>
        </div>

        {reviews.length > 0 && (
          <div className="card review-card">
            <div className="row">
              <strong>🔍 AI re-check — {reviews.length} suggestion(s)</strong>
              <div className="spacer" />
              <button className="link" onClick={() => setReviews([])}>dismiss all</button>
            </div>
            <div className="muted small" style={{ marginBottom: 6 }}>
              The AI compared the drawing to what it extracted. Apply a fix or dismiss it.
            </div>
            {reviews.map((r, i) => (
              <div className="review-item" key={i}>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`badge sev-${r.severity}`}>{r.severity}</span>
                  <strong className="small">{r.op}{r.target_label ? ` · ${r.target_label}` : ""}</strong>
                </div>
                <div className="small" style={{ margin: "3px 0 6px" }}>{r.issue}</div>
                <div className="row" style={{ gap: 8 }}>
                  {((r.op === "modify" && r.member_id != null && r.member) ||
                    (r.op === "add" && r.member) ||
                    (r.op === "remove" && r.member_id != null)) && (
                    <button className="link" onClick={() => applyReview(r, i)}>
                      {r.op === "remove" ? "Apply (delete)" : r.op === "add" ? "Apply (add)" : "Apply fix"}
                    </button>
                  )}
                  <button className="link" onClick={() => dismissReview(i)}>dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <ManualAdd pid={pid} discipline={discipline} onChange={onChange} />

        <div className="row" style={{ margin: "4px 0 8px" }}>
          <span className="muted">
            {members.length} element(s)
            {outOfScope.length > 0 && (
              <> · <strong>{measuredCount}</strong> in {dInfo.label} · {outOfScope.length} outside</>
            )}
          </span>
          <div className="spacer" />
          {members.some((m) => !m.is_verified) && (
            <button
              className="link"
              title="Mark every AI/chat-extracted element as verified (clears the 'review' tags)"
              onClick={async () => {
                for (const m of members) if (!m.is_verified) await api.verifyMember(m.id);
                onChange();
              }}
            >
              ✓ verify all
            </button>
          )}
        </div>
        {members.map((m) => {
          const isEditing = editing === m.id;
          const oosReason = oosById.get(m.id);
          return (
            <div className={`card el-card cat-${TYPE_CAT[m.member_type] || "concrete"}${oosReason ? " oos" : ""}`} key={m.id}>
              <div className="row">
                <span className="el-ico" title={m.member_type}>
                  {TYPE_ICON[m.member_type] || "▫️"}
                </span>
                <div className="el-main">
                  <div className="el-title">
                    <strong>{m.label || m.member_type}</strong>
                    <span className="el-src" title={`added via ${m.source}`}>
                      {m.source === "manual" ? "M" : m.source.toUpperCase()}
                    </span>
                    {oosReason && (
                      <span className="el-oos" title={oosReason}>outside {dInfo.label}</span>
                    )}
                  </div>
                  <div className="el-spec">{specOf(m.member_type, m.params) || m.member_type}</div>
                </div>
                <div className="spacer" />
                <span
                  className={`el-dot ${m.is_verified ? "ok" : "warn"}`}
                  role="img"
                  aria-label={m.is_verified ? "verified" : "needs review"}
                  title={m.is_verified ? "verified" : "needs review"}
                />
                {!m.is_verified && (
                  <button
                    className="link icon" title="mark verified"
                    aria-label={`Mark ${m.label || m.member_type} verified`}
                    onClick={async () => {
                      await api.verifyMember(m.id);
                      onChange();
                    }}
                  >
                    ✓
                  </button>
                )}
                <button
                  className="link icon" title={isEditing ? "close editor" : "edit"}
                  aria-label={`${isEditing ? "Close editor for" : "Edit"} ${m.label || m.member_type}`}
                  onClick={() => setEditing(isEditing ? null : m.id)}
                >
                  {isEditing ? "✕" : "✎"}
                </button>
                <button
                  className="link icon" title="delete"
                  aria-label={`Delete ${m.label || m.member_type}`}
                  onClick={async () => {
                    if (isEditing) setEditing(null);
                    await api.deleteMember(m.id);
                    onChange();
                  }}
                >
                  🗑
                </button>
              </div>
              {isEditing && (
                <div style={{ marginTop: 8 }}>
                  {(() => {
                    const st = formStateFromMember(m.params);
                    return (
                      <MemberForm
                        initialType={st.type}
                        initialVals={st.vals}
                        initialOpenings={st.openings}
                        initialSegments={st.segments}
                        submitLabel="Save changes"
                        onSubmit={async (mm) => {
                          await api.updateMember(m.id, mm);
                          setEditing(null);
                          onChange();
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  column: "Column", beam: "Beam", footing: "Footing", slab: "Slab",
  rcc_wall: "RCC wall", pcc: "PCC / lean concrete", brick_wall: "Brick wall",
  plaster_surface: "Plaster surface", earthwork_pit: "Earthwork pit",
  steel_member: "Steel member", truss: "Steel truss",
  anchor_bolt: "Anchor bolt", roof_sheeting: "Roof sheeting",
};

type Dim = { k: string; label: string; unit?: string; def: string };
const DIMS: Record<string, Dim[]> = {
  column: [{ k: "b_mm", label: "Width (b)", unit: "mm", def: "300" }, { k: "D_mm", label: "Depth (D)", unit: "mm", def: "600" }, { k: "height_mm", label: "Height", unit: "mm", def: "3000" }],
  beam: [{ k: "b_mm", label: "Width (b)", unit: "mm", def: "230" }, { k: "depth_mm", label: "Depth", unit: "mm", def: "450" }, { k: "clear_span_mm", label: "Clear span", unit: "mm", def: "4500" }],
  footing: [{ k: "length_mm", label: "Length", unit: "mm", def: "2000" }, { k: "breadth_mm", label: "Breadth", unit: "mm", def: "2000" }, { k: "depth_mm", label: "Depth", unit: "mm", def: "400" }],
  slab: [{ k: "length_mm", label: "Length", unit: "mm", def: "4500" }, { k: "breadth_mm", label: "Breadth", unit: "mm", def: "4000" }, { k: "thickness_mm", label: "Thickness", unit: "mm", def: "125" }],
  rcc_wall: [{ k: "length_mm", label: "Length", unit: "mm", def: "3000" }, { k: "height_mm", label: "Height", unit: "mm", def: "3000" }, { k: "thickness_mm", label: "Thickness", unit: "mm", def: "200" }],
  pcc: [{ k: "length_mm", label: "Length", unit: "mm", def: "2000" }, { k: "breadth_mm", label: "Breadth", unit: "mm", def: "2000" }, { k: "thickness_mm", label: "Thickness", unit: "mm", def: "100" }],
  brick_wall: [{ k: "length_mm", label: "Length", unit: "mm", def: "4500" }, { k: "height_mm", label: "Height", unit: "mm", def: "3000" }, { k: "thickness_mm", label: "Thickness", unit: "mm", def: "230" }],
  plaster_surface: [{ k: "length_mm", label: "Length", unit: "mm", def: "4500" }, { k: "height_mm", label: "Height", unit: "mm", def: "3000" }, { k: "thickness_mm", label: "Plaster thk", unit: "mm", def: "12" }, { k: "faces", label: "Faces (1 or 2)", def: "2" }],
  earthwork_pit: [{ k: "length_mm", label: "Length", unit: "mm", def: "2000" }, { k: "breadth_mm", label: "Breadth", unit: "mm", def: "2000" }, { k: "depth_mm", label: "Depth", unit: "mm", def: "1500" }, { k: "working_offset_mm", label: "Working offset/side", unit: "mm", def: "150" }, { k: "side_slope", label: "Side slope (H:1V)", def: "0" }],
  steel_member: [{ k: "length_mm", label: "Length", unit: "mm", def: "6000" }],
  truss: [{ k: "span_mm", label: "Span (informational)", unit: "mm", def: "12000" }],
  anchor_bolt: [{ k: "dia_mm", label: "Bolt dia", unit: "mm", def: "25" }, { k: "length_mm", label: "Bolt length (incl. embedment)", unit: "mm", def: "600" }],
  roof_sheeting: [{ k: "length_mm", label: "Length", unit: "mm", def: "6000" }, { k: "breadth_mm", label: "Breadth", unit: "mm", def: "3000" }, { k: "lap_pct", label: "Lap allowance", unit: "%", def: "10" }],
};

const GRADES = ["M15", "M20", "M25", "M30", "M35", "M40"];
const RCC = new Set(["column", "beam", "footing", "slab", "rcc_wall", "pcc"]);
const REINF = new Set(["column", "beam", "footing", "slab"]);
const HAS_OPENINGS = new Set(["brick_wall", "plaster_surface"]);
const LABEL_PREFIX: Record<string, string> = {
  column: "C1", beam: "B1", footing: "F1", slab: "S1", rcc_wall: "W1",
  pcc: "PCC1", brick_wall: "BW1", plaster_surface: "P1",
  earthwork_pit: "E1", steel_member: "ST1", truss: "T1",
  anchor_bolt: "AB1", roof_sheeting: "RS1",
};
// Discipline packs register their manual-form config into the same maps.
for (const t of PACK_TYPES) {
  const u = PACK_UI[t];
  TYPE_LABELS[t] = u.label;
  DIMS[t] = u.dims;
  LABEL_PREFIX[t] = u.labelPrefix;
  if (u.hasOpenings) HAS_OPENINGS.add(t);
}
// sensible reinforcement prefills so common entry is one click
const REIN_DEFAULTS: Record<string, Record<string, string>> = {
  column: { mainCount: "8", mainDia: "16", tieDia: "8", tieSpacing: "150" },
  beam: { topCount: "2", topDia: "16", botCount: "3", botDia: "16", stirDia: "8", stirSpacing: "150" },
  footing: { mxDia: "12", mxSp: "150", myDia: "12", mySp: "150" },
  slab: { mainDia: "10", mainSp: "150", distDia: "8", distSp: "200" },
};

function defaultsFor(type: string): Record<string, string> {
  const v: Record<string, string> = { label: LABEL_PREFIX[type] || "", count: "1" };
  if (RCC.has(type)) v.concrete_grade = "M25";
  if (REINF.has(type)) v.cover_mm = type === "beam" || type === "slab" ? "25" : "40";
  for (const d of DIMS[type]) v[d.k] = d.def;
  const pu = PACK_UI[type];
  if (pu) {
    for (const [k, opts] of Object.entries(pu.choices || {})) v[k] = opts[0];
    for (const t of pu.texts || []) v[t.k] = t.def;
  }
  if (type === "steel_member") v.designation = "ISMB300";
  if (type === "truss") v.connection_pct = "5";
  Object.assign(v, REIN_DEFAULTS[type] || {});
  return v;
}

type Opening = { w: string; h: string; c: string };
type Segment = { component: string; designation: string; length_mm: string; count: string };
const STEEL_OPTS = Object.keys(STEEL_SECTIONS);
function defaultSegments(): Segment[] {
  return [
    { component: "top chord/rafter", designation: "ISA100X100X8", length_mm: "6200", count: "2" },
    { component: "bottom tie", designation: "ISA100X100X8", length_mm: "12000", count: "1" },
    { component: "strut", designation: "ISA50X50X6", length_mm: "1400", count: "6" },
    { component: "vertical", designation: "ISA50X50X6", length_mm: "900", count: "5" },
  ];
}

// Reverse-map a stored member's params into form state, for editing.
function formStateFromMember(p: any): { type: string; vals: Record<string, string>; openings: Opening[]; segments: Segment[] } {
  const type = p.member_type;
  const vals: Record<string, string> = { label: p.label ?? "", count: String(p.count ?? 1) };
  if (RCC.has(type)) vals.concrete_grade = p.concrete_grade ?? "M25";
  if (REINF.has(type)) vals.cover_mm = String(p.cover_mm ?? (type === "beam" || type === "slab" ? 25 : 40));
  for (const d of DIMS[type] || []) if (p[d.k] != null) vals[d.k] = String(p[d.k]);
  const pu = PACK_UI[type];
  if (pu) {
    for (const k of Object.keys(pu.choices || {})) if (p[k] != null) vals[k] = String(p[k]);
    for (const t of pu.texts || []) if (p[t.k] != null) vals[t.k] = String(p[t.k]);
  }
  if (type === "steel_member") vals.designation = p.designation ?? "";
  if (type === "truss") vals.connection_pct = String(p.connection_pct ?? 5);
  if (type === "column") {
    if (p.main_bars?.[0]) { vals.mainCount = String(p.main_bars[0].count); vals.mainDia = String(p.main_bars[0].dia_mm); }
    if (p.ties) { vals.tieDia = String(p.ties.dia_mm); if (p.ties.spacing_mm) vals.tieSpacing = String(p.ties.spacing_mm); }
    if (p.ties_inner) { vals.tieInDia = String(p.ties_inner.dia_mm); if (p.ties_inner.spacing_mm) vals.tieInSp = String(p.ties_inner.spacing_mm); }
  } else if (type === "beam") {
    if (p.top_bars?.[0]) { vals.topCount = String(p.top_bars[0].count); vals.topDia = String(p.top_bars[0].dia_mm); }
    if (p.bottom_bars?.[0]) { vals.botCount = String(p.bottom_bars[0].count); vals.botDia = String(p.bottom_bars[0].dia_mm); }
    if (p.stirrups) { vals.stirDia = String(p.stirrups.dia_mm); if (p.stirrups.spacing_mm) vals.stirSpacing = String(p.stirrups.spacing_mm); }
  } else if (type === "footing") {
    if (p.mesh_bottom_x) { vals.mxDia = String(p.mesh_bottom_x.dia_mm); vals.mxSp = String(p.mesh_bottom_x.spacing_mm); }
    if (p.mesh_bottom_y) { vals.myDia = String(p.mesh_bottom_y.dia_mm); vals.mySp = String(p.mesh_bottom_y.spacing_mm); }
    if (p.mesh_top_x) { vals.txDia = String(p.mesh_top_x.dia_mm); vals.txSp = String(p.mesh_top_x.spacing_mm); }
    if (p.mesh_top_y) { vals.tyDia = String(p.mesh_top_y.dia_mm); vals.tySp = String(p.mesh_top_y.spacing_mm); }
  } else if (type === "slab") {
    if (p.main_bars) { vals.mainDia = String(p.main_bars.dia_mm); vals.mainSp = String(p.main_bars.spacing_mm); }
    if (p.dist_bars) { vals.distDia = String(p.dist_bars.dia_mm); vals.distSp = String(p.dist_bars.spacing_mm); }
  }
  if (type === "brick_wall" && Array.isArray(p.embedded_labels) && p.embedded_labels.length)
    vals.embedded_labels = p.embedded_labels.join(", ");
  if (type === "earthwork_pit" && Array.isArray(p.contains_labels) && p.contains_labels.length)
    vals.contains_labels = p.contains_labels.join(", ");
  const openings: Opening[] = HAS_OPENINGS.has(type) && Array.isArray(p.openings)
    ? p.openings.map((o: any) => ({ w: String(o.width_mm), h: String(o.height_mm), c: String(o.count ?? 1) }))
    : [];
  const segments: Segment[] = type === "truss" && Array.isArray(p.segments)
    ? p.segments.map((s: any) => ({
        component: String(s.component ?? ""), designation: String(s.designation ?? ""),
        length_mm: String(s.length_mm ?? ""), count: String(s.count ?? 1),
      }))
    : [];
  return { type, vals, openings, segments };
}

function MemberForm({
  discipline, initialType, initialVals, initialOpenings, initialSegments, submitLabel, onSubmit, onCancel,
}: {
  discipline?: string;
  initialType: string;
  initialVals: Record<string, string>;
  initialOpenings: Opening[];
  initialSegments: Segment[];
  submitLabel: string;
  onSubmit: (member: any) => Promise<void>;
  onCancel?: () => void;
}) {
  const [type, setType] = useState(initialType);
  const [v, setV] = useState<Record<string, string>>(initialVals);
  const [openings, setOpenings] = useState<Opening[]>(initialOpenings);
  const [segments, setSegments] = useState<Segment[]>(initialSegments);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const changeType = (t: string) => {
    setType(t);
    setV(defaultsFor(t));
    setOpenings([]);
    setSegments(t === "truss" ? defaultSegments() : []);
    setErr("");
  };
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const numIn = (k: string, label: string, unit?: string) => (
    <label className="ff">
      <span>{label}{unit ? ` (${unit})` : ""}</span>
      <input type="number" value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  const buildMember = (): any => {
    const n = (k: string) => (v[k] !== undefined && v[k] !== "" ? Number(v[k]) : undefined);
    const m: any = { member_type: type, label: v.label || "", count: n("count") || 1 };
    if (RCC.has(type)) m.concrete_grade = v.concrete_grade || "M25";
    if (REINF.has(type)) m.cover_mm = n("cover_mm") ?? 40;
    for (const d of DIMS[type]) { const val = n(d.k); if (val !== undefined) m[d.k] = val; }
    const pu = PACK_UI[type];
    if (pu) {
      for (const k of Object.keys(pu.choices || {})) if (v[k]) m[k] = v[k];
      // As typed, including "": a deliberately blank finish must not be
      // replaced by the pack's default (the Specification cell then says so).
      for (const t of pu.texts || []) if (v[t.k] !== undefined) m[t.k] = v[t.k];
    }
    if (type === "column") {
      if (n("mainDia") && n("mainCount")) m.main_bars = [{ dia_mm: n("mainDia"), count: n("mainCount") }];
      if (n("tieDia") && n("tieSpacing")) m.ties = { dia_mm: n("tieDia"), legs: 2, spacing_mm: n("tieSpacing") };
      if (n("tieInDia") && n("tieInSp")) m.ties_inner = { dia_mm: n("tieInDia"), legs: 2, spacing_mm: n("tieInSp") };
    } else if (type === "beam") {
      if (n("topDia") && n("topCount")) m.top_bars = [{ dia_mm: n("topDia"), count: n("topCount") }];
      if (n("botDia") && n("botCount")) m.bottom_bars = [{ dia_mm: n("botDia"), count: n("botCount") }];
      if (n("stirDia") && n("stirSpacing")) m.stirrups = { dia_mm: n("stirDia"), legs: 2, spacing_mm: n("stirSpacing") };
    } else if (type === "footing") {
      if (n("mxDia") && n("mxSp")) m.mesh_bottom_x = { dia_mm: n("mxDia"), spacing_mm: n("mxSp") };
      if (n("myDia") && n("mySp")) m.mesh_bottom_y = { dia_mm: n("myDia"), spacing_mm: n("mySp") };
      if (n("txDia") && n("txSp")) m.mesh_top_x = { dia_mm: n("txDia"), spacing_mm: n("txSp") };
      if (n("tyDia") && n("tySp")) m.mesh_top_y = { dia_mm: n("tyDia"), spacing_mm: n("tySp") };
    } else if (type === "slab") {
      if (n("mainDia") && n("mainSp")) m.main_bars = { dia_mm: n("mainDia"), spacing_mm: n("mainSp") };
      if (n("distDia") && n("distSp")) m.dist_bars = { dia_mm: n("distDia"), spacing_mm: n("distSp") };
    } else if (type === "steel_member") {
      m.designation = v.designation || "";
    } else if (type === "truss") {
      m.connection_pct = n("connection_pct") ?? 5;
      m.segments = segments
        .map((s) => ({
          component: s.component.trim(),
          designation: s.designation.trim(),
          length_mm: Number(s.length_mm),
          count: Number(s.count) || 1,
        }))
        .filter((s) => s.designation && s.length_mm > 0);
    }
    if (HAS_OPENINGS.has(type)) {
      const ops = openings
        .map((o) => ({ width_mm: Number(o.w), height_mm: Number(o.h), count: Number(o.c) || 1 }))
        .filter((o) => o.width_mm && o.height_mm);
      if (ops.length) m.openings = ops;
    }
    if (type === "brick_wall" && v.embedded_labels)
      m.embedded_labels = v.embedded_labels.split(",").map((s) => s.trim()).filter(Boolean);
    if (type === "earthwork_pit" && v.contains_labels)
      m.contains_labels = v.contains_labels.split(",").map((s) => s.trim()).filter(Boolean);
    return m;
  };

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(buildMember());
      setErr("");
    } catch (e: any) {
      setErr("Could not save: " + (e.message || e));
    }
    setBusy(false);
  };

  return (
    <>
      <select className="w" value={type} onChange={(e) => changeType(e.target.value)}>
        {(() => {
          // Types the active discipline measures come first; the rest are
          // offered but flagged, because they will be set aside by the gate.
          const all = Object.keys(TYPE_LABELS);
          const inD = discipline ? disciplineInfo(discipline).types.filter((t) => TYPE_LABELS[t]) : all;
          const rest = all.filter((t) => !inD.includes(t));
          return (
            <>
              <optgroup label={discipline ? `In ${disciplineInfo(discipline).label}` : "Element types"}>
                {inD.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </optgroup>
              {discipline && rest.length > 0 && (
                <optgroup label="Other disciplines — will be set aside">
                  {rest.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </optgroup>
              )}
            </>
          );
        })()}
      </select>
      {discipline && !inScope(type, discipline) && (
        <div className="oos-note">
          {TYPE_LABELS[type]} is measured by{" "}
          {disciplinesFor(type).map((d) => d.label).join(" or ") || "no pack yet"}, not{" "}
          {disciplineInfo(discipline).label}. It will be added but listed as outside this discipline.
        </div>
      )}

      <div className="ffgrid" style={{ marginTop: 8 }}>
        <label className="ff">
          <span>Label / mark</span>
          <input value={v.label ?? ""} onChange={(e) => set("label", e.target.value)} />
        </label>
        {numIn("count", "Count (nos)")}
        {DIMS[type].map((d) => (
          <Fragment key={d.k}>{numIn(d.k, d.label, d.unit)}</Fragment>
        ))}
        {PACK_UI[type]?.choices && Object.entries(PACK_UI[type].choices!).map(([k, opts]) => (
          <label className="ff" key={k}>
            <span>{k.replace(/_/g, " ")}</span>
            <select value={v[k] ?? opts[0]} onChange={(e) => set(k, e.target.value)}>
              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        {PACK_UI[type]?.texts?.map((t) => (
          <label className="ff" key={t.k}>
            <span>{t.label}</span>
            <input type="text" value={v[t.k] ?? ""} onChange={(e) => set(t.k, e.target.value)} />
          </label>
        ))}
        {RCC.has(type) && (
          <label className="ff">
            <span>Concrete grade</span>
            <select value={v.concrete_grade ?? "M25"} onChange={(e) => set("concrete_grade", e.target.value)}>
              {GRADES.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
        )}
        {REINF.has(type) && numIn("cover_mm", "Cover", "mm")}
        {type === "steel_member" && (
          <label className="ff">
            <span>Section</span>
            <select value={v.designation ?? ""} onChange={(e) => set("designation", e.target.value)}>
              {Object.keys(STEEL_SECTIONS).map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        )}
      </div>

      {type === "column" && (
        <Section title="Reinforcement (optional)">
          <div className="ffgrid">
            {numIn("mainCount", "Main bars", "nos")}{numIn("mainDia", "Main dia", "mm")}
            {numIn("tieDia", "Tie dia (outer)", "mm")}{numIn("tieSpacing", "Tie spacing", "mm")}
            {numIn("tieInDia", "Inner tie dia", "mm")}{numIn("tieInSp", "Inner tie spacing", "mm")}
          </div>
        </Section>
      )}
      {type === "beam" && (
        <Section title="Reinforcement (optional)">
          <div className="ffgrid">
            {numIn("topCount", "Top bars", "nos")}{numIn("topDia", "Top dia", "mm")}
            {numIn("botCount", "Bottom bars", "nos")}{numIn("botDia", "Bottom dia", "mm")}
            {numIn("stirDia", "Stirrup dia", "mm")}{numIn("stirSpacing", "Stirrup spacing", "mm")}
          </div>
        </Section>
      )}
      {type === "footing" && (
        <Section title="Mesh — bottom & top (optional)">
          <div className="ffgrid">
            {numIn("mxDia", "Bot X dia", "mm")}{numIn("mxSp", "Bot X spacing", "mm")}
            {numIn("myDia", "Bot Y dia", "mm")}{numIn("mySp", "Bot Y spacing", "mm")}
            {numIn("txDia", "Top X dia", "mm")}{numIn("txSp", "Top X spacing", "mm")}
            {numIn("tyDia", "Top Y dia", "mm")}{numIn("tySp", "Top Y spacing", "mm")}
          </div>
        </Section>
      )}
      {type === "slab" && (
        <Section title="Reinforcement (optional)">
          <div className="ffgrid">
            {numIn("mainDia", "Main dia", "mm")}{numIn("mainSp", "Main spacing", "mm")}
            {numIn("distDia", "Dist dia", "mm")}{numIn("distSp", "Dist spacing", "mm")}
          </div>
        </Section>
      )}

      {type === "truss" && (
        <Section title="Truss members (one truss)">
          <div className="muted small" style={{ marginBottom: 6 }}>
            List each segment of a single truss. <em>Count</em> is the number of
            identical trusses (top), and <em>No.</em> below is how many of that
            segment occur in one truss.
          </div>
          <label className="ff" style={{ marginBottom: 6 }}>
            <span>Connection / gusset allowance (%)</span>
            <input type="number" value={v.connection_pct ?? "5"} onChange={(e) => set("connection_pct", e.target.value)} />
          </label>
          {segments.map((s, i) => (
            <div className="ffgrid" key={i} style={{ alignItems: "end" }}>
              <label className="ff"><span>Component</span>
                <input value={s.component} onChange={(e) => setSegments((p) => p.map((x, j) => j === i ? { ...x, component: e.target.value } : x))} /></label>
              <label className="ff"><span>Section</span>
                <select value={s.designation} onChange={(e) => setSegments((p) => p.map((x, j) => j === i ? { ...x, designation: e.target.value } : x))}>
                  {!STEEL_OPTS.includes(s.designation) && s.designation && <option value={s.designation}>{s.designation}</option>}
                  {STEEL_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select></label>
              <label className="ff"><span>Length (mm)</span>
                <input type="number" value={s.length_mm} onChange={(e) => setSegments((p) => p.map((x, j) => j === i ? { ...x, length_mm: e.target.value } : x))} /></label>
              <label className="ff"><span>No. / truss</span>
                <input type="number" value={s.count} onChange={(e) => setSegments((p) => p.map((x, j) => j === i ? { ...x, count: e.target.value } : x))} /></label>
              <button className="link" onClick={() => setSegments((p) => p.filter((_, j) => j !== i))}>remove</button>
            </div>
          ))}
          <button className="link" onClick={() => setSegments((p) => [...p, { component: "", designation: "ISA75X75X6", length_mm: "1000", count: "1" }])}>+ add member</button>
        </Section>
      )}

      {HAS_OPENINGS.has(type) && (
        <Section title="Openings (doors / windows)">
          {openings.map((o, i) => (
            <div className="ffgrid" key={i} style={{ alignItems: "end" }}>
              <label className="ff"><span>Width (mm)</span>
                <input type="number" value={o.w} onChange={(e) => setOpenings((p) => p.map((x, j) => j === i ? { ...x, w: e.target.value } : x))} /></label>
              <label className="ff"><span>Height (mm)</span>
                <input type="number" value={o.h} onChange={(e) => setOpenings((p) => p.map((x, j) => j === i ? { ...x, h: e.target.value } : x))} /></label>
              <label className="ff"><span>Count</span>
                <input type="number" value={o.c} onChange={(e) => setOpenings((p) => p.map((x, j) => j === i ? { ...x, c: e.target.value } : x))} /></label>
              <button className="link" onClick={() => setOpenings((p) => p.filter((_, j) => j !== i))}>remove</button>
            </div>
          ))}
          <button className="link" onClick={() => setOpenings((p) => [...p, { w: "1000", h: "2100", c: "1" }])}>+ add opening</button>
        </Section>
      )}

      {type === "brick_wall" && (
        <label className="ff" style={{ marginTop: 6 }}>
          <span>Embedded RCC labels (e.g. C1, comma-separated) — netted automatically</span>
          <input value={v.embedded_labels ?? ""} onChange={(e) => set("embedded_labels", e.target.value)} />
        </label>
      )}
      {type === "earthwork_pit" && (
        <label className="ff" style={{ marginTop: 6 }}>
          <span>Contains labels (footings/PCC inside pit, comma-separated) — backfill netted</span>
          <input value={v.contains_labels ?? ""} onChange={(e) => set("contains_labels", e.target.value)} />
        </label>
      )}

      {err && <div className="errtext small">{err}</div>}
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button className="primary" onClick={submit} disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && <button onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </>
  );
}

function ManualAdd({ pid, discipline, onChange }: { pid: number; discipline: Discipline; onChange: () => void }) {
  // Open the form on a type the active discipline actually measures.
  const firstType = disciplineInfo(discipline).types.find((t) => TYPE_LABELS[t]) || "column";
  // Collapsed by default — a dozen always-visible inputs was noise for the
  // common (upload/chat) paths.
  const [openForm, setOpenForm] = useState(false);
  if (!openForm) {
    return (
      <button className="addel-toggle" onClick={() => setOpenForm(true)}>
        ＋ Add element manually
      </button>
    );
  }
  return (
    <div className="card">
      <div className="row">
        <div className="field" style={{ margin: 0 }}>Add element manually</div>
        <div className="spacer" />
        <button className="link" onClick={() => setOpenForm(false)}>✕ close</button>
      </div>
      <MemberForm
        discipline={discipline}
        initialType={firstType}
        initialVals={defaultsFor(firstType)}
        initialOpenings={[]}
        initialSegments={[]}
        submitLabel="Add element"
        onSubmit={async (m) => { await api.addMember(pid, m); onChange(); }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="subsec">
      <div className="subsec-title">{title}</div>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- Center */
const QTY = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const INR0 = (n: number) =>
  "₹" + Math.round(n).toLocaleString("en-IN");

// Count the headline estimate up to its value — the one orchestrated "moment".
// Own component so it has its own hooks (unaffected by CenterPanel's early
// return); honours prefers-reduced-motion by jumping straight to the value.
function AnimatedAmount({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from === to) { setShown(to); fromRef.current = to; return; }
    let raf = 0; let start: number | null = null; const dur = 600;
    const tick = (t: number) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

// Cost-share donut (the "pie"). At most 5 slices + an "Other" fold so it stays
// readable; hovering a slice swaps the centre label to that slice's details;
// clicking jumps to the category in the Line items tab. Pure SVG, arcs drawn
// with stroke-dasharray; colours come from the validated .cat-* variables.
function DonutChart({ data, total, onSlice }: {
  data: { cat: string; label: string; value: number }[];
  total: number;
  onSlice: (cat: string) => void;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const R = 74, C = 2 * Math.PI * R, GAP = 3;
  let acc = 0;
  const arcs = data.map((d, i) => {
    const frac = d.value / total;
    const a = { ...d, i, frac, start: acc };
    acc += frac;
    return a;
  });
  const h = hov !== null ? arcs[hov] : null;
  return (
    <div className="card donut-card">
      <div className="viz-title">Cost split</div>
      <div className="donut-wrap">
        <svg viewBox="0 0 200 200" className="donut" role="group" aria-label="Cost share by category">
          <g transform="rotate(-90 100 100)">
            {arcs.map((a) => (
              <circle
                key={a.cat}
                className={`donut-arc cat-${a.cat}`}
                cx="100" cy="100" r={R} fill="none"
                strokeWidth={hov === a.i ? 30 : 24}
                strokeDasharray={`${Math.max(a.frac * C - GAP, 0.6)} ${C}`}
                strokeDashoffset={-(a.start * C) - GAP / 2}
                role="button"
                tabIndex={0}
                aria-label={`${a.label}: ${INR0(a.value)} (${(a.frac * 100).toFixed(1)}%) — show line items`}
                onMouseEnter={() => setHov(a.i)}
                onMouseLeave={() => setHov(null)}
                onFocus={() => setHov(a.i)}
                onBlur={() => setHov(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSlice(a.cat === "other" ? "" : a.cat); }
                }}
                onClick={() => onSlice(a.cat === "other" ? "" : a.cat)}
              >
                <title>{`${a.label}: ${INR0(a.value)} (${(a.frac * 100).toFixed(1)}%)`}</title>
              </circle>
            ))}
          </g>
          {arcs.filter((a) => a.frac >= 0.09).map((a) => {
            const mid = (a.start + a.frac / 2) * 2 * Math.PI - Math.PI / 2;
            const x = 100 + Math.cos(mid) * R;
            const y = 100 + Math.sin(mid) * R;
            return (
              <text key={a.cat} x={x} y={y} className="donut-pct">
                {Math.round(a.frac * 100)}%
              </text>
            );
          })}
        </svg>
        <div className="donut-center">
          <div className="dc-name">{h ? h.label : "Total"}</div>
          <div className="dc-val">{INR0(h ? h.value : total)}</div>
          <div className="dc-sub">{h ? `${(h.frac * 100).toFixed(1)}%` : `${data.length} categories`}</div>
        </div>
      </div>
    </div>
  );
}

// Top cost drivers — the five costliest line items as horizontal bars.
function TopItems({ rows, onJump }: {
  rows: { label: string; cat: string; amt: number }[];
  onJump: (cat: string) => void;
}) {
  if (!rows.length) return null;
  const max = rows[0].amt || 1;
  return (
    <div className="card ti-card">
      <div className="viz-title">Top cost drivers</div>
      {rows.map((r, i) => (
        <button key={i} className={`ti-row cat-${r.cat}`} onClick={() => onJump(r.cat)} title={r.label}>
          <span className="ti-top">
            <span className="ti-name">{r.label}</span>
            <span className="ti-amt">{INR0(r.amt)}</span>
          </span>
          <span className="ti-track">
            <i className="ti-bar" style={{ width: `${(r.amt / max) * 100}%`, animationDelay: `${i * 80}ms` }} />
          </span>
        </button>
      ))}
    </div>
  );
}

function CenterPanel({
  pid, boq, rates, currency, contingencyPct, onContingency, onDiscipline, onStart, onChange,
}: {
  pid: number;
  boq: Boq | null;
  rates: RateRow[];
  currency: string;
  contingencyPct: number;
  onContingency: (pct: number) => void;
  onDiscipline: (d: Discipline) => void;
  onStart: () => void;
  onChange: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [contingency, setContingency] = useState(() => String(contingencyPct || 0));
  const contTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [centerTab, setCenterTab] = useState<"overview" | "items">("overview");
  const [localRates, setLocalRates] = useState<Record<string, number>>({});
  // What the user is typing in a rate box, verbatim, while it has focus — so
  // "0", "12." or a cleared box are not re-rendered as a number underneath.
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, () => void>>({});
  const pendingCont = useRef<(() => void) | null>(null);
  // ▲/▼ flash on category chips when a rate edit moves that category's amount.
  const [chipDeltas, setChipDeltas] = useState<Record<string, number>>({});
  const prevSubs = useRef<Record<string, number> | null>(null);
  const prevSig = useRef("");
  const deltaTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Unmount (project switch, since the panel is keyed by project): flush any
  // debounced rate / contingency write for THIS project rather than lose it,
  // and stop the timers so nothing fires against the next project.
  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
    Object.values(pending.current).forEach((fn) => fn());
    clearTimeout(contTimer.current);
    pendingCont.current?.();
    clearTimeout(deltaTimer.current);
  }, []);

  // Seed/refresh the editable rate state whenever the stored rates change.
  useEffect(() => {
    const m: Record<string, number> = {};
    for (const r of rates) m[r.category] = r.rate;
    setLocalRates(m);
  }, [rates]);

  useEffect(() => {
    // Compare each category's amount to its last value; a change (from a
    // non-zero baseline, so first load / indicative-load don't flash every
    // chip) shows a ▲/▼ delta on the chip for a few seconds.
    if (!boq) return;
    // A discipline switch or a change in the element set is not a rate edit:
    // rebase the comparison instead of flashing every chip.
    const sig = boq.discipline + "|" +
      boq.groups.map((g) => g.items.map((it) => it.member_id).join(",")).join(";");
    const rebase = sig !== prevSig.current;
    prevSig.current = sig;
    const cur: Record<string, number> = {};
    for (const g of boq.groups)
      cur[g.category] = g.items.reduce(
        (s, it) => s + it.quantity * (localRates[it.category] ?? 0), 0);
    if (rebase) setChipDeltas({});
    if (prevSubs.current && !rebase) {
      const d: Record<string, number> = {};
      for (const k of Object.keys(cur)) {
        const before = prevSubs.current[k] ?? 0;
        if (before > 0 && Math.abs(cur[k] - before) >= 1) d[k] = cur[k] - before;
      }
      if (Object.keys(d).length) {
        setChipDeltas(d);
        clearTimeout(deltaTimer.current);
        deltaTimer.current = setTimeout(() => setChipDeltas({}), 4000);
      }
    }
    prevSubs.current = cur;
  }, [localRates, boq]);

  if (!boq) return <div className="col center"><div className="empty">Loading…</div></div>;

  const dInfo = disciplineInfo(boq.discipline);
  const rateFor = (cat: string) => localRates[cat] ?? 0;
  const amountFor = (it: BoqItem) => it.quantity * rateFor(it.category);

  // Persist a rate change (debounced) but update the UI instantly for live totals.
  const setRate = (cat: string, value: number) => {
    const v = Math.max(0, Number(value) || 0);
    setLocalRates((p) => ({ ...p, [cat]: v }));
    clearTimeout(timers.current[cat]);
    const run = () => {
      delete pending.current[cat];
      api.setRate(pid, cat, v).then(onChange).catch(() => {});
    };
    pending.current[cat] = run;
    timers.current[cat] = setTimeout(run, 400);
  };
  const editRate = (cat: string, raw: string) => {
    setRateDraft((p) => ({ ...p, [cat]: raw }));
    const n = Number(raw);
    if (raw.trim() === "") setRate(cat, 0);
    else if (Number.isFinite(n)) setRate(cat, n);
  };
  const endRateEdit = (cat: string) =>
    setRateDraft((p) => { const n = { ...p }; delete n[cat]; return n; });

  const editContingency = (raw: string) => {
    setContingency(raw);
    clearTimeout(contTimer.current);
    const run = () => { pendingCont.current = null; onContingency(Math.max(0, Number(raw) || 0)); };
    pendingCont.current = run;
    contTimer.current = setTimeout(run, 400);
  };

  const loadIndicative = async () => {
    // Structural categories from demo.ts, the finishing/fit-out ones from the
    // discipline packs — otherwise an Architecture BOQ stays at ₹0.
    const indicative: Record<string, number> = { ...DEMO_RATES, ...PACK_DEMO_RATES };
    const next: Record<string, number> = { ...localRates };
    for (const g of boq.groups) {
      const r = indicative[g.category];
      if (r != null) next[g.category] = r;
    }
    setLocalRates(next);
    await Promise.all(
      boq.groups.map((g) => {
        const r = indicative[g.category];
        return r != null ? api.setRate(pid, g.category, r) : Promise.resolve();
      })
    );
    onChange();
  };

  const matches = (it: BoqItem) => {
    if (reviewOnly && (it.is_verified || it.source === "manual")) return false;
    if (search && !it.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  };

  const groups = boq.groups
    .map((g) => ({ ...g, shown: g.items.filter(matches) }))
    .filter((g) => g.shown.length > 0);

  const subtotalOf = (items: BoqItem[]) => items.reduce((s, it) => s + amountFor(it), 0);
  const grand = boq.groups.reduce((s, g) => s + subtotalOf(g.items), 0);
  const cont = Number(contingency) || 0;
  const tentative = grand * (1 + cont / 100);

  const allItems = boq.groups.flatMap((g) => g.items);
  const needReview = allItems.filter((it) => !it.is_verified && it.source !== "manual").length;
  const ratesSet = boq.groups.filter((g) => rateFor(g.category) > 0).length;
  const rowKey = (g: string, i: number) => `${g}-${i}`;

  // Switch to Line items, expand + scroll to a category — used by the donut,
  // composition bar, top-drivers list and chips. Scroll waits a tick so the
  // table exists when coming from the Overview tab.
  const jumpToCat = (cat: string) => {
    setCenterTab("items");
    if (!cat) return;
    setCollapsed((p) => { const n = new Set(p); n.delete(cat); return n; });
    setTimeout(() => {
      document.getElementById(`cat-${cat}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  // Donut data: top 5 categories by cost + an "Other" fold (≤6 slices total).
  const catAmts = boq.groups
    .map((g) => ({ cat: g.category, label: g.label, value: subtotalOf(g.items) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const donutData = catAmts.length > 6
    ? [...catAmts.slice(0, 5),
       { cat: "other", label: "Other", value: catAmts.slice(5).reduce((s, r) => s + r.value, 0) }]
    : catAmts;
  const topRows = [...allItems]
    .map((it) => ({ label: it.description, cat: it.category, amt: amountFor(it) }))
    .filter((r) => r.amt > 0)
    .sort((a, b) => b.amt - a.amt)
    .slice(0, 5);

  return (
    <div className="col center">
      <h2>Bill of Quantities <span className="h2-kicker">· {dInfo.label}</span></h2>
      <div className="scroll">
        {boq.groups.length === 0 && (boq.out_of_scope || []).length > 0 ? (
          // Elements exist but none belong to the active discipline. Say so
          // plainly and offer the switch — the generic onboarding would be a lie.
          (() => {
            const active = disciplineInfo(boq.discipline);
            const byOwner = new Map<string, number>();
            for (const o of boq.out_of_scope) {
              const owner = disciplinesFor(o.member_type)[0];
              const k = owner ? owner.key : "none";
              byOwner.set(k, (byOwner.get(k) || 0) + 1);
            }
            return (
              <div className="onboard allout">
                <h3>Nothing to measure in {active.label} yet</h3>
                <div className="ob-sub">
                  All {boq.out_of_scope.length} element(s) in this project belong to other
                  disciplines, so the {active.label} BOQ is empty — not wrong, just focused.
                </div>
                <div className="allout-list">
                  {[...byOwner.entries()].map(([k, n]) => {
                    const d = disciplineInfo(k);
                    return k === "none" ? (
                      <div className="allout-row" key={k}>
                        <span>{n} element(s) of types no pack measures yet</span>
                      </div>
                    ) : (
                      <div className="allout-row" key={k}>
                        <span>{d.icon} {n} element(s) measured by <strong>{d.label}</strong></span>
                        <button className="primary" onClick={() => onDiscipline(d.key)}>
                          Switch to {d.label} →
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="ob-cta">
                  Or keep {active.label} and add its elements: upload drawings or use
                  <b> ＋ Add element manually</b> on the left.
                </div>
              </div>
            );
          })()
        ) : boq.groups.length === 0 ? (
          <div className="onboard">
            <h3>Let's build your Bill of Quantities</h3>
            <div className="ob-sub">Three steps from drawing to costed BOQ — no spreadsheets needed.</div>
            <div className="ob-steps">
              <div className="ob-step" style={{ animationDelay: "0ms" }}>
                <span className="ob-num">01</span>
                <div className="ob-ico">🎯</div>
                <div className="ob-title">Pick a discipline, add drawings</div>
                <div className="ob-desc">Structure, Civil, Architecture or Interior — one at a time — then drop in the PDFs: plans, sections, schedules, the whole set.</div>
              </div>
              <div className="ob-arrow">➜</div>
              <div className="ob-step" style={{ animationDelay: "120ms" }}>
                <span className="ob-num">02</span>
                <div className="ob-ico">🤖</div>
                <div className="ob-title">AI reads every sheet</div>
                <div className="ob-desc">Press <strong>Generate BOQ</strong> and Claude takes off every element of that discipline — then double-checks its own work.</div>
              </div>
              <div className="ob-arrow">➜</div>
              <div className="ob-step" style={{ animationDelay: "240ms" }}>
                <span className="ob-num">03</span>
                <div className="ob-ico">📊</div>
                <div className="ob-title">Review, price &amp; export</div>
                <div className="ob-desc">Tweak any element, set your rates, and export a tender-ready Excel or printable report.</div>
              </div>
            </div>
            <button className="primary ob-start" onClick={onStart}>
              Start → choose a discipline &amp; add drawings
            </button>
            <div className="ob-cta">
              No drawing handy? Use <b>▶ Try with demo data</b> in step 3 — or tell the
              chat <em>"add 5 columns 300×600, 3 m high with 8-16 mm bars"</em>.
            </div>
          </div>
        ) : (
          <>
            {/* ---- Overview / Line-items switcher ---- */}
            <div className="ctabs">
              <button className={centerTab === "overview" ? "on" : ""} aria-pressed={centerTab === "overview"} onClick={() => setCenterTab("overview")}>
                📊 Overview
              </button>
              <button className={centerTab === "items" ? "on" : ""} aria-pressed={centerTab === "items"} onClick={() => setCenterTab("items")}>
                📋 Line items <span className="ctab-count">{allItems.length}</span>
              </button>
            </div>

            {centerTab === "overview" && (
            <>
            {/* ---- Summary / tentative estimate ---- */}
            <div className="boq-summary">
              <div className="bs-head">
                <div>
                  <div className="bs-kicker">{dInfo.icon} {dInfo.label} take-off</div>
                  <div className="bs-label">Tentative estimate</div>
                  <div className="bs-total"><AnimatedAmount value={tentative} format={INR0} /></div>
                  <div className="bs-sub">
                    {allItems.length} items in {boq.groups.length} categories
                    {needReview > 0 && <> · <span className="bs-warn">{needReview} need review</span></>}
                    {ratesSet < boq.groups.length && <> · rates set {ratesSet}/{boq.groups.length}</>}
                  </div>
                </div>
                <div className="bs-actions">
                  <label className="bs-cont">
                    <span>Contingency %</span>
                    <input type="number" value={contingency} min="0" step="any"
                      onChange={(e) => editContingency(e.target.value)}
                      onBlur={() => setContingency(String(Math.max(0, Number(contingency) || 0)))} />
                  </label>
                  {cont > 0 && <div className="bs-base">base {INR0(grand)}</div>}
                  <button className="accent" onClick={loadIndicative}>
                    ⚡ Load indicative rates
                  </button>
                </div>
              </div>
              {ratesSet === 0 && (
                <div className="bs-hint">
                  Rates are ₹0 — set a rate per category below (or load indicative
                  rates) to see the cost. Currency: {currency}.
                </div>
              )}
              {(() => {
                const all: any[] = boq.errors || [];
                const coverage = all.filter((e) => e.coverage);
                const other = all.filter((e) => !e.coverage);
                return (
                  <>
                    {coverage.length > 0 && (
                      <details className="bs-coverage">
                        <summary>
                          🔍 Coverage check — {coverage.length} possible omission(s)
                        </summary>
                        <ul>
                          {coverage.map((e: any, i: number) => (
                            <li key={i}>{e.error}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {other.length > 0 && (
                      <details className="bs-warnings">
                        <summary>
                          ⚠ {other.length} note(s) — review (e.g. duplicate steel removed, unresolved items)
                        </summary>
                        <ul>
                          {other.map((e: any, i: number) => (
                            <li key={i}>{e.label ? `${e.label}: ` : ""}{e.error}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                );
              })()}
              {/* Out-of-scope register: elements read but not measured because
                  they belong to another discipline. Visible, never silent — a
                  focused run must not look like a complete one. */}
              {(boq.out_of_scope || []).length > 0 && (
                <details className="bs-oos">
                  <summary>
                    🗂 {boq.out_of_scope.length} element(s) outside {disciplineInfo(boq.discipline).label} — read, not measured
                  </summary>
                  <ul>
                    {boq.out_of_scope.map((o, i) => (
                      <li key={i}>
                        <strong>{o.label}</strong> <span className="muted">({o.member_type})</span> — {o.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {/* Where the money goes — 100% stacked composition bar. Chips
                  below are the legend, so identity is never colour-alone. */}
              {grand > 0 && (
                <div className="comp-wrap">
                  <div className="comp-cap">
                    <span>Where the money goes</span>
                    <span>100% = {INR0(grand)}</span>
                  </div>
                  <div className="comp-bar">
                    {boq.groups.map((g, i) => {
                      const st = subtotalOf(g.items);
                      const share = (st / grand) * 100;
                      if (share <= 0) return null;
                      return (
                        <button
                          key={g.category}
                          className={`comp-seg cat-${g.category}`}
                          style={{ width: `${share}%`, animationDelay: `${i * 70}ms` }}
                          aria-label={`${g.label}: ${INR0(st)} (${share.toFixed(1)}%)`}
                          onClick={() => jumpToCat(g.category)}
                        >
                          {share >= 14 && <span className="seg-label">{share.toFixed(0)}%</span>}
                          <span className="seg-tip">
                            <b>{g.label}</b>{" "}
                            <span className="tip-num">{INR0(st)} · {share.toFixed(1)}%</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="bs-chips draw">
                {boq.groups.map((g) => {
                  const st = subtotalOf(g.items);
                  const share = grand > 0 ? (st / grand) * 100 : 0;
                  return (
                    <button
                      key={g.category}
                      className={`bs-chip cat-${g.category}`}
                      title={`${g.label}: ${INR0(st)} (${share.toFixed(0)}%)`}
                      onClick={() => jumpToCat(g.category)}
                    >
                      <span className="chip-name">{g.label}</span>
                      <span className="chip-amt">
                        {INR0(st)}
                        {chipDeltas[g.category] != null && (
                          <span className={`chip-delta ${chipDeltas[g.category] > 0 ? "up" : "down"}`}>
                            {chipDeltas[g.category] > 0 ? "▲" : "▼"}{INR0(Math.abs(chipDeltas[g.category]))}
                          </span>
                        )}
                      </span>
                      <span className="chip-bar"><i style={{ width: `${share}%` }} /></span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ---- Charts: donut + top cost drivers ---- */}
            {grand > 0 && (
              <div className="viz-grid">
                <DonutChart data={donutData} total={grand} onSlice={jumpToCat} />
                <TopItems rows={topRows} onJump={jumpToCat} />
              </div>
            )}

            {/* ---- Materials at a glance (KPI tiles) ---- */}
            {(() => {
              const takeoff = materialTakeoff(boq);
              if (!takeoff.length) return null;
              const rows = takeoff.flatMap((s) => s.rows);
              const find = (pfx: string) => rows.find((r) => r.material.startsWith(pfx));
              const kpis = [
                { icon: "🧱", name: "Cement", row: find("Cement"), unit: "bags" },
                { icon: "🔩", name: "Reinforcement", row: find("Total reinforcement"),
                  unit: "MT", scale: 1 / 1000, digits: 2 },
                { icon: "🏗️", name: "Structural steel", row: find("MS sections"),
                  unit: "MT", scale: 1 / 1000, digits: 2 },
                { icon: "🧊", name: "Bricks", row: find("Bricks") },
                { icon: "🪚", name: "Formwork", row: find("Formwork") },
                { icon: "⛏️", name: "Excavation", row: find("Excavation") },
              ].filter((k) => k.row && k.row.qty > 0);
              if (!kpis.length) return null;
              return (
                <div className="card">
                  <div className="viz-title">Materials at a glance <span className="muted small">(indicative)</span></div>
                  <div className="kpi-row">
                    {kpis.map((k, i) => {
                      const v = k.row!.qty * (k.scale ?? 1);
                      const num = v.toLocaleString("en-IN", {
                        maximumFractionDigits: k.digits ?? (v >= 100 ? 0 : 1),
                      });
                      return (
                        <div className="kpi" key={k.name} style={{ animationDelay: `${i * 60}ms` }}>
                          <div className="kpi-ico">{k.icon}</div>
                          <div className="kpi-val">{num}<small>{k.unit ?? k.row!.unit}</small></div>
                          <div className="kpi-name">{k.name}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            </>
            )}

            {centerTab === "items" && (
            <>
            {/* ---- Controls ---- */}
            <div className="boq-controls">
              <input className="boq-search" placeholder="🔍 Filter line items…" aria-label="Filter line items"
                value={search} onChange={(e) => setSearch(e.target.value)} />
              <label className="boq-toggle">
                <input type="checkbox" checked={reviewOnly}
                  onChange={(e) => setReviewOnly(e.target.checked)} />
                <span>Needs review only</span>
              </label>
              <div className="spacer" />
              <button className="link" onClick={() => setCollapsed(new Set(boq.groups.map((g) => g.category)))}>collapse all</button>
              <button className="link" onClick={() => setCollapsed(new Set())}>expand all</button>
            </div>

            {/* ---- Table ---- */}
            {groups.length === 0 ? (
              <div className="empty">No line items match your filter.</div>
            ) : (
              <div className="table-wrap">
              <table className="boq-table">
                <thead>
                  <tr>
                    {BOQ_COLUMNS.map((c) => (
                      <th key={c} className={NUM_COLS.has(c) ? "num" : undefined}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    // Serials come from the UNFILTERED positions so "2.3" on
                    // screen is the same "2.3" in the workbook and the report.
                    const gi = boq.groups.findIndex((x) => x.category === g.category);
                    const isCol = collapsed.has(g.category);
                    const unit = g.items[0]?.unit || "";
                    const st = subtotalOf(g.shown);
                    return (
                      <Fragment key={g.category}>
                        <tr className={`cat-head cat-${g.category}`} id={`cat-${g.category}`}>
                          <td className="sno">{groupSerial(gi)}</td>
                          <td className="cat-name" colSpan={2}
                            onClick={() => setCollapsed((p) => { const n = new Set(p); n.has(g.category) ? n.delete(g.category) : n.add(g.category); return n; })}>
                            <span className="chev">{isCol ? "▸" : "▾"}</span>
                            {g.label}
                            <span className="cat-count">{g.shown.length}</span>
                          </td>
                          <td></td>
                          <td className="num">
                            <span className="rate-edit" onClick={(e) => e.stopPropagation()}>
                              ₹<input type="number" min="0" step="any"
                                aria-label={`${g.label} rate per ${unit}`}
                                value={rateDraft[g.category] ?? (localRates[g.category] ? String(localRates[g.category]) : "")}
                                placeholder="0"
                                onChange={(e) => editRate(g.category, e.target.value)}
                                onBlur={() => endRateEdit(g.category)}
                                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                              <span className="per">/{unit}</span>
                            </span>
                          </td>
                          <td className="num cat-sub">{INR(st)}</td>
                          <td></td>
                        </tr>
                        {!isCol && g.shown.map((it, i) => {
                          const k = rowKey(g.category, i);
                          return (
                            <ItemRow key={k} it={it} serial={itemSerial(gi, g.items.indexOf(it))}
                              amount={amountFor(it)} rate={rateFor(it.category)}
                              open={open === k} toggle={() => setOpen(open === k ? null : k)} />
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  <tr className="grand-row">
                    <td colSpan={5} className="grand">GRAND TOTAL{cont > 0 ? ` + ${cont}% contingency` : ""}</td>
                    <td className="num grand">{INR(tentative)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
              </div>
            )}

            {(() => {
              const takeoff = materialTakeoff(boq);
              if (!takeoff.length) return null;
              // Full material detail tables; the headline KPI tiles live on the
              // Overview tab.
              return (
                <details className="matsum">
                  <summary>📦 Material detail <span className="muted small">(indicative — verify mixes)</span></summary>
                  <div className="matsum-body">
                    {takeoff.map((sec) => (
                      <div className="matsec" key={sec.title}>
                        <div className="matsec-title">{sec.title}</div>
                        <table className="mattable">
                          <tbody>
                            {sec.rows.map((r, i) => (
                              <tr key={i}>
                                <td>{r.material}</td>
                                <td className="num">{QTY(r.qty)}</td>
                                <td className="unit">{r.unit}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })()}
            </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ItemRow({
  it, serial, amount, rate, open, toggle,
}: {
  it: BoqItem; serial: string; amount: number; rate: number; open: boolean; toggle: () => void;
}) {
  const review = !it.is_verified && it.source !== "manual";
  return (
    <>
      <tr className={review ? "item review" : "item"}>
        <td className="sno">{serial}</td>
        <td className="itemname">{itemNameOf(it)}</td>
        <td className="desc">
          {it.description}
          {it.source !== "manual" && <span className={`badge ${it.source}`}>{it.source}</span>}
          {review && <span className="badge unverified">review</span>}
          {/* Drill-down keeps nos / L / B / D and the formula as row metadata
              rather than adding an eighth column. */}
          <button className={`calc-btn ${open ? "on" : ""}`} onClick={toggle}>
            {open ? "hide" : "calc"}
          </button>
        </td>
        <td className="num">{QTY(it.quantity)} <span className="unit">{it.unit}</span></td>
        <td className="num rate-cell">{rate ? QTY(rate) : <span className="muted">—</span>}</td>
        <td className="num amt">{amount ? INR(amount) : <span className="muted">—</span>}</td>
        <td className="spec">{specTextOf(it) || <span className="muted">—</span>}</td>
      </tr>
      {open && (
        <tr className="calc-row">
          <td colSpan={7}>
            <div className="calc-card">
              {it.audit.map((s, k) => (
                <div className="calc-step" key={k}>
                  <div className="calc-expr">
                    <code>{s.expression}</code> = <strong>{QTY(s.result)}</strong>
                    {s.clause_ref && <span className="calc-clause">{s.clause_ref}</span>}
                  </div>
                  <div className="calc-inputs">
                    {Object.entries(s.inputs || {})
                      .filter(([, v]) => typeof v !== "object")
                      .map(([key, v]) => (
                        <span className="kv" key={key}><b>{key}</b> {String(v)}</span>
                      ))}
                  </div>
                </div>
              ))}
              {Array.isArray(it.extra?.truss_segments) && (
                <div className="calc-note">Truss: {it.extra.truss_segments.length} member(s) — see "Steel Truss Details" in the Excel export.</div>
              )}
              {Array.isArray(it.extra?.bbs) && (
                <div className="calc-note">BBS: {it.extra.bbs.length} bar row(s) — see "Bar Bending Schedule" in the Excel export.</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Right */
type Msg = { role: "user" | "bot"; text: string; preview?: any };

function RightPanel({
  pid,
  project,
  rates,
  boqCats,
  onChange,
}: {
  pid: number;
  project: Project | null;
  rates: RateRow[];
  /** Categories present in the current BOQ — always shown in the rates list. */
  boqCats: string[];
  onChange: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const dInfo = disciplineInfo(project?.discipline);
  // Rate rows the active discipline can actually use come first; the other
  // categories stay one click away instead of padding the list.
  const relevant = new Set<string>([...dInfo.categories, ...boqCats]);
  const primary = rates.filter((r) => relevant.has(r.category));
  const secondary = rates.filter((r) => !relevant.has(r.category));
  // Rates save as you type (debounced) and on blur/Enter — not only on blur.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const rateTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const ratePending = useRef<Record<string, () => void>>({});
  const commitRate = (cat: string, raw: string, immediate = false) => {
    const n = Math.max(0, Number(raw) || 0);
    clearTimeout(rateTimers.current[cat]);
    const run = () => {
      delete ratePending.current[cat];
      api.setRate(pid, cat, n).then(onChange).catch(() => {});
    };
    if (immediate) run();
    else { ratePending.current[cat] = run; rateTimers.current[cat] = setTimeout(run, 400); }
  };
  // Project switch unmounts the panel: flush, don't lose, a pending rate.
  useEffect(() => () => {
    Object.values(rateTimers.current).forEach(clearTimeout);
    Object.values(ratePending.current).forEach((fn) => fn());
  }, []);
  const rateRow = (r: RateRow) => (
    <tr key={r.category} className={`cat-${r.category}`}>
      <td><span className="rate-name">{r.label}</span></td>
      <td className="muted small">{r.unit}</td>
      <td className="num">
        <input
          style={{ width: 90 }}
          type="number" min="0" step="any" placeholder="0"
          aria-label={`${r.label} rate per ${r.unit}`}
          value={drafts[r.category] ?? (r.rate ? String(r.rate) : "")}
          onChange={(e) => {
            const v = e.target.value;
            setDrafts((d) => ({ ...d, [r.category]: v }));
            commitRate(r.category, v);
          }}
          onBlur={(e) => {
            commitRate(r.category, e.target.value, true);
            setDrafts((d) => { const n = { ...d }; delete n[r.category]; return n; });
          }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
      </td>
    </tr>
  );

  const send = async () => {
    if (!text.trim()) return;
    const t = text;
    setText("");
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setBusy(true);
    try {
      const res = await api.nlEdit(pid, t);
      setMsgs((m) => [
        ...m,
        { role: "bot", text: res.result.message, preview: res.preview },
      ]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "bot", text: "Error: " + e.message }]);
    }
    setBusy(false);
  };

  const apply = async (member: any, outOfScope?: string) => {
    await api.nlApply(pid, member);
    setMsgs((m) => [...m, {
      role: "bot",
      text: outOfScope
        ? `✓ Added — but it sits outside ${dInfo.label}, so it is registered, not measured. ${outOfScope}`
        : "✓ Added to BOQ.",
    }]);
    onChange();
  };

  return (
    <div className="col right">
      <h2>Add by chat · Rates</h2>
      <div className="scroll">
        <div className="card">
          <div className="muted" style={{ marginBottom: 8 }}>
            Describe an element in plain English — review, then Apply.
          </div>
          {msgs.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <div className="bubble">{m.text}</div>
              {m.preview && (
                <div className="preview">
                  <strong>{m.preview.member.member_type}</strong> ×{" "}
                  {m.preview.member.count}
                  <ul style={{ margin: "6px 0 6px 16px", padding: 0 }}>
                    {m.preview.quantities.map((q: any, k: number) => (
                      <li key={k}>
                        {q.category}: {q.rounded} {q.unit}
                      </li>
                    ))}
                  </ul>
                  {m.preview.out_of_scope && (
                    <div className="oos-note">⚠ {m.preview.out_of_scope}</div>
                  )}
                  <button
                    className="primary"
                    onClick={() => apply(m.preview.member, m.preview.out_of_scope)}
                  >
                    {m.preview.out_of_scope ? "Apply anyway" : "Apply"}
                  </button>
                </div>
              )}
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <textarea
              rows={2}
              className="w"
              aria-label="Describe an element to add"
              placeholder='e.g. "add 5 columns 300x600 3m high with 8-16mm bars M25"'
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </div>
          <button className="primary" onClick={send} disabled={busy}>
            {busy ? "Thinking…" : "Send"}
          </button>
        </div>

        <div className="card">
          <div className="field">Unit rates ({project?.currency || "INR"})</div>
          <div className="muted small" style={{ marginBottom: 6 }}>
            {dInfo.icon} {dInfo.label} categories · saved as you type
          </div>
          <table>
            <tbody>{primary.map(rateRow)}</tbody>
          </table>
          {secondary.length > 0 && (
            <details className="rates-more">
              <summary>Other categories ({secondary.length})</summary>
              <table><tbody>{secondary.map(rateRow)}</tbody></table>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
