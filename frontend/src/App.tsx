import { Fragment, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import {
  api,
  getApiKey,
  setApiKey,
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

const INR = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [pid, setPid] = useState<number | null>(null);
  const [boq, setBoq] = useState<Boq | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [rates, setRates] = useState<RateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean>(() => !!getApiKey());
  const [model, setModelState] = useState<string>(() => getModel());
  // In-app dialogs instead of window.prompt(): the latter is blocked in
  // sandboxed/embedded browsers (e.g. VS Code's Simple Browser).
  const [showNewProject, setShowNewProject] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const project = projects.find((p) => p.id === pid) || null;

  const saveKey = (raw: string) => {
    setShowKey(false);
    const key = raw.trim();
    setApiKey(key);
    setHasKey(!!key);
  };

  const refresh = useCallback(async (id: number) => {
    try {
      const [b, m, r] = await Promise.all([
        api.getBoq(id),
        api.listMembers(id),
        api.listRates(id),
      ]);
      setBoq(b);
      setMembers(m);
      setRates(r);
      setError(null);
    } catch (e: any) {
      setError("Failed to load project data: " + e.message);
    }
  }, []);

  useEffect(() => {
    api
      .listProjects()
      .then((ps) => {
        setProjects(ps);
        setPid((prev) => prev ?? ps[0]?.id ?? null);
      })
      .catch((e) => setError("Failed to reach the backend: " + e.message));
  }, []);

  useEffect(() => {
    if (pid !== null) refresh(pid);
  }, [pid, refresh]);

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
        <button
          className={hasKey ? "keybtn set" : "keybtn"}
          onClick={() => setShowKey(true)}
          title={
            hasKey
              ? "An Anthropic API key is set in this browser. Click to change or remove it."
              : "No AI key set — drawing extraction & chat use the key-free demo mode. Click to add your Anthropic key."
          }
        >
          {hasKey ? "🔑 AI key: on" : "🔑 Set AI key"}
        </button>
        <select
          value={model}
          title="AI model used to read drawings and chat. Opus reads the most thoroughly; Sonnet is faster/cheaper."
          onChange={(e) => { setModel(e.target.value); setModelState(e.target.value); }}
        >
          <option value="claude-sonnet-4-6">Sonnet (fast)</option>
          <option value="claude-opus-4-8">Opus (most thorough)</option>
        </select>
        <select
          value={pid ?? ""}
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
        <button onClick={() => setShowNewProject(true)}>+ Project</button>
        {pid !== null && (
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
        )}
      </div>
      {error && <div className="errbar">{error}</div>}

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
        <div className="body">
          <LeftPanel
            pid={pid}
            members={members}
            onChange={() => refresh(pid)}
          />
          <CenterPanel
            pid={pid}
            boq={boq}
            rates={rates}
            currency={project?.currency || "INR"}
            onChange={() => refresh(pid)}
          />
          <RightPanel
            pid={pid}
            project={project}
            rates={rates}
            onChange={() => refresh(pid)}
          />
        </div>
      )}

      {showNewProject && (
        <PromptModal
          title="New project"
          label="Project name"
          defaultValue="New Project"
          submitLabel="Create"
          onSubmit={createProject}
          onClose={() => setShowNewProject(false)}
        />
      )}
      {showKey && (
        <PromptModal
          title="Anthropic API key"
          label="API key"
          defaultValue={getApiKey()}
          password
          submitLabel="Save"
          message={
            "Enables live AI drawing extraction and plain-English editing. " +
            "Stored only in this browser and sent to your backend per request — " +
            "never saved server-side. Leave blank to remove it (the app then " +
            "uses the key-free demo mode)."
          }
          onSubmit={saveKey}
          onClose={() => setShowKey(false)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Modal */
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
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px" }}>{title}</h3>
        {message && (
          <p className="muted small" style={{ marginTop: 0 }}>{message}</p>
        )}
        <label className="field">{label}</label>
        <input
          className="w"
          autoFocus
          type={password ? "password" : "text"}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit(val);
            if (e.key === "Escape") onClose();
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
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Left */
function LeftPanel({
  pid,
  members,
  onChange,
}: {
  pid: number;
  members: Member[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [staged, setStaged] = useState<File[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const running = !!busy && busy.endsWith("…");

  const runExtraction = async () => {
    const list = staged;
    if (!list.length) return;
    try {
      let total = 0, rejected = 0, unresolved = 0;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        setBusy(`(${i + 1}/${list.length}) ${f.name} — rendering…`);
        const res = await api.extractDrawing(pid, f, (m) => setBusy(`(${i + 1}/${list.length}) ${m}`));
        total += res.saved;
        rejected += res.rejected.length;
        unresolved += res.unresolved.length;
        onChange();
      }
      const notes: string[] = [];
      if (rejected) notes.push(`${rejected} need fixing`);
      if (unresolved) notes.push(`${unresolved} unresolved`);
      setBusy(
        `Done. Extracted ${total} element(s) from ${list.length} file(s)` +
          (notes.length ? ` (${notes.join(", ")} — review & edit below).` : ".")
      );
      setStaged([]);
    } catch (e: any) {
      setBusy("Error: " + (e.message || e));
    }
  };

  return (
    <div className="col left">
      <h2>Drawings & Elements</h2>
      <div className="scroll">
        <div className="card">
          <label className="field">Upload drawing PDFs (you can select several)</label>
          <input
            type="file"
            accept="application/pdf"
            multiple
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
              <button
                className="primary"
                style={{ marginTop: 8 }}
                disabled={!staged.length || running}
                onClick={runExtraction}
              >
                {running ? "Reading drawings…" : "⚙ Proceed — generate BOQ"}
              </button>
            </div>
          )}
          {busy && <div className="muted" style={{ marginTop: 8 }}>{busy}</div>}
          <div style={{ marginTop: 8 }} className="muted small">
            Select your PDFs, then press <strong>Proceed</strong>. Drawings are
            read in your browser and sent page-by-page to Claude with your{" "}
            <strong>🔑 AI key</strong> (top right) to take off every quantity it
            can read — concrete, RCC/PCC, reinforcement, structural steel and
            more. Extracted elements are marked <em>review</em>; edit any of them
            below before exporting. No key? Use the chat or manual form below.
          </div>
          <div style={{ marginTop: 10 }} className="muted small">
            No drawing handy?
          </div>
          <button
            style={{ marginTop: 4 }}
            onClick={async () => {
              setBusy("Loading demo data…");
              try {
                const res = await api.seedDemo(pid);
                setBusy(`Loaded demo: ${res.seeded_members} elements.`);
                onChange();
              } catch (e: any) {
                setBusy("Error: " + e.message);
              }
            }}
          >
            Load demo data
          </button>
        </div>

        <ManualAdd pid={pid} onChange={onChange} />

        <div className="muted" style={{ margin: "4px 0 8px" }}>
          {members.length} element(s)
        </div>
        {members.map((m) => {
          const isEditing = editing === m.id;
          return (
            <div className="card" key={m.id}>
              <div className="row">
                <strong>{m.label || m.member_type}</strong>
                <span className={`badge ${m.source}`}>{m.source}</span>
                <span
                  className={`badge ${m.is_verified ? "verified" : "unverified"}`}
                >
                  {m.is_verified ? "verified" : "review"}
                </span>
                <div className="spacer" />
                <button
                  className="link"
                  onClick={() => setEditing(isEditing ? null : m.id)}
                >
                  {isEditing ? "close" : "edit"}
                </button>
                <button
                  className="link"
                  onClick={async () => {
                    if (isEditing) setEditing(null);
                    await api.deleteMember(m.id);
                    onChange();
                  }}
                >
                  delete
                </button>
              </div>
              {isEditing ? (
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
              ) : (
                <>
                  <div className="muted small">{m.member_type}</div>
                  {!m.is_verified && (
                    <button
                      className="link"
                      onClick={async () => {
                        await api.verifyMember(m.id);
                        onChange();
                      }}
                    >
                      ✓ mark verified
                    </button>
                  )}
                </>
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
  if (type === "steel_member") vals.designation = p.designation ?? "";
  if (type === "truss") vals.connection_pct = String(p.connection_pct ?? 5);
  if (type === "column") {
    if (p.main_bars?.[0]) { vals.mainCount = String(p.main_bars[0].count); vals.mainDia = String(p.main_bars[0].dia_mm); }
    if (p.ties) { vals.tieDia = String(p.ties.dia_mm); if (p.ties.spacing_mm) vals.tieSpacing = String(p.ties.spacing_mm); }
  } else if (type === "beam") {
    if (p.top_bars?.[0]) { vals.topCount = String(p.top_bars[0].count); vals.topDia = String(p.top_bars[0].dia_mm); }
    if (p.bottom_bars?.[0]) { vals.botCount = String(p.bottom_bars[0].count); vals.botDia = String(p.bottom_bars[0].dia_mm); }
    if (p.stirrups) { vals.stirDia = String(p.stirrups.dia_mm); if (p.stirrups.spacing_mm) vals.stirSpacing = String(p.stirrups.spacing_mm); }
  } else if (type === "footing") {
    if (p.mesh_bottom_x) { vals.mxDia = String(p.mesh_bottom_x.dia_mm); vals.mxSp = String(p.mesh_bottom_x.spacing_mm); }
    if (p.mesh_bottom_y) { vals.myDia = String(p.mesh_bottom_y.dia_mm); vals.mySp = String(p.mesh_bottom_y.spacing_mm); }
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
  initialType, initialVals, initialOpenings, initialSegments, submitLabel, onSubmit, onCancel,
}: {
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
    if (type === "column") {
      if (n("mainDia") && n("mainCount")) m.main_bars = [{ dia_mm: n("mainDia"), count: n("mainCount") }];
      if (n("tieDia") && n("tieSpacing")) m.ties = { dia_mm: n("tieDia"), legs: 2, spacing_mm: n("tieSpacing") };
    } else if (type === "beam") {
      if (n("topDia") && n("topCount")) m.top_bars = [{ dia_mm: n("topDia"), count: n("topCount") }];
      if (n("botDia") && n("botCount")) m.bottom_bars = [{ dia_mm: n("botDia"), count: n("botCount") }];
      if (n("stirDia") && n("stirSpacing")) m.stirrups = { dia_mm: n("stirDia"), legs: 2, spacing_mm: n("stirSpacing") };
    } else if (type === "footing") {
      if (n("mxDia") && n("mxSp")) m.mesh_bottom_x = { dia_mm: n("mxDia"), spacing_mm: n("mxSp") };
      if (n("myDia") && n("mySp")) m.mesh_bottom_y = { dia_mm: n("myDia"), spacing_mm: n("mySp") };
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
        {Object.keys(TYPE_LABELS).map((t) => (
          <option key={t} value={t}>{TYPE_LABELS[t]}</option>
        ))}
      </select>

      <div className="ffgrid" style={{ marginTop: 8 }}>
        <label className="ff">
          <span>Label / mark</span>
          <input value={v.label ?? ""} onChange={(e) => set("label", e.target.value)} />
        </label>
        {numIn("count", "Count (nos)")}
        {DIMS[type].map((d) => (
          <Fragment key={d.k}>{numIn(d.k, d.label, d.unit)}</Fragment>
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
            {numIn("tieDia", "Tie dia", "mm")}{numIn("tieSpacing", "Tie spacing", "mm")}
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
        <Section title="Bottom mesh (optional)">
          <div className="ffgrid">
            {numIn("mxDia", "X dia", "mm")}{numIn("mxSp", "X spacing", "mm")}
            {numIn("myDia", "Y dia", "mm")}{numIn("mySp", "Y spacing", "mm")}
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

function ManualAdd({ pid, onChange }: { pid: number; onChange: () => void }) {
  return (
    <div className="card">
      <label className="field">Add element manually</label>
      <MemberForm
        initialType="column"
        initialVals={defaultsFor("column")}
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

function CenterPanel({
  pid, boq, rates, currency, onChange,
}: {
  pid: number;
  boq: Boq | null;
  rates: RateRow[];
  currency: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [contingency, setContingency] = useState("0");
  const [localRates, setLocalRates] = useState<Record<string, number>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Seed/refresh the editable rate state whenever the stored rates change.
  useEffect(() => {
    const m: Record<string, number> = {};
    for (const r of rates) m[r.category] = r.rate;
    setLocalRates(m);
  }, [rates]);

  if (!boq) return <div className="col center"><div className="empty">Loading…</div></div>;

  const rateFor = (cat: string) => localRates[cat] ?? 0;
  const amountFor = (it: BoqItem) => it.quantity * rateFor(it.category);

  // Persist a rate change (debounced) but update the UI instantly for live totals.
  const setRate = (cat: string, value: number) => {
    setLocalRates((p) => ({ ...p, [cat]: value }));
    clearTimeout(timers.current[cat]);
    timers.current[cat] = setTimeout(() => {
      api.setRate(pid, cat, value || 0).then(onChange).catch(() => {});
    }, 400);
  };

  const loadIndicative = async () => {
    const next: Record<string, number> = { ...localRates };
    for (const g of boq.groups) {
      const r = (DEMO_RATES as Record<string, number>)[g.category];
      if (r != null) next[g.category] = r;
    }
    setLocalRates(next);
    await Promise.all(
      boq.groups.map((g) => {
        const r = (DEMO_RATES as Record<string, number>)[g.category];
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

  return (
    <div className="col center">
      <h2>Bill of Quantities</h2>
      <div className="scroll">
        {boq.groups.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            No quantities yet. Upload a drawing and press <strong>Proceed</strong>,
            add an element manually on the left, or describe one in the chat
            (e.g. <em>"add 5 columns 300x600 3m high with 8-16mm bars"</em>).
          </div>
        ) : (
          <>
            {/* ---- Summary / tentative estimate ---- */}
            <div className="boq-summary">
              <div className="bs-head">
                <div>
                  <div className="bs-label">Tentative estimate</div>
                  <div className="bs-total">{INR0(tentative)}</div>
                  <div className="bs-sub">
                    {boq.groups.length} categories · {allItems.length} items ·{" "}
                    {needReview > 0
                      ? <span className="bs-warn">{needReview} need review</span>
                      : "all verified"}{" "}
                    · rates set {ratesSet}/{boq.groups.length}
                  </div>
                </div>
                <div className="bs-actions">
                  <label className="bs-cont">
                    <span>Contingency %</span>
                    <input type="number" value={contingency} min="0"
                      onChange={(e) => setContingency(e.target.value)} />
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
              <div className="bs-chips">
                {boq.groups.map((g) => {
                  const st = subtotalOf(g.items);
                  const share = grand > 0 ? (st / grand) * 100 : 0;
                  return (
                    <button
                      key={g.category}
                      className={`bs-chip cat-${g.category}`}
                      title={`${g.label}: ${INR0(st)} (${share.toFixed(0)}%)`}
                      onClick={() => {
                        setCollapsed((p) => { const n = new Set(p); n.delete(g.category); return n; });
                        document.getElementById(`cat-${g.category}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <span className="chip-name">{g.label}</span>
                      <span className="chip-amt">{INR0(st)}</span>
                      <span className="chip-bar"><i style={{ width: `${share}%` }} /></span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ---- Controls ---- */}
            <div className="boq-controls">
              <input className="boq-search" placeholder="🔍 Filter line items…"
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
              <table className="boq-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="num">No.</th>
                    <th className="num">Quantity</th>
                    <th className="num">Rate</th>
                    <th className="num">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const isCol = collapsed.has(g.category);
                    const unit = g.items[0]?.unit || "";
                    const st = subtotalOf(g.shown);
                    return (
                      <Fragment key={g.category}>
                        <tr className={`cat-head cat-${g.category}`} id={`cat-${g.category}`}>
                          <td className="cat-name" colSpan={2}
                            onClick={() => setCollapsed((p) => { const n = new Set(p); n.has(g.category) ? n.delete(g.category) : n.add(g.category); return n; })}>
                            <span className="chev">{isCol ? "▸" : "▾"}</span>
                            {g.label}
                            <span className="cat-count">{g.shown.length}</span>
                          </td>
                          <td></td>
                          <td className="num">
                            <span className="rate-edit" onClick={(e) => e.stopPropagation()}>
                              ₹<input type="number" value={localRates[g.category] ?? ""}
                                placeholder="0"
                                onChange={(e) => setRate(g.category, Number(e.target.value))} />
                              <span className="per">/{unit}</span>
                            </span>
                          </td>
                          <td className="num cat-sub">{INR(st)}</td>
                          <td></td>
                        </tr>
                        {!isCol && g.shown.map((it, i) => {
                          const k = rowKey(g.category, i);
                          return (
                            <ItemRow key={k} it={it} amount={amountFor(it)} rate={rateFor(it.category)}
                              open={open === k} toggle={() => setOpen(open === k ? null : k)} />
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  <tr className="grand-row">
                    <td colSpan={4} className="grand">GRAND TOTAL{cont > 0 ? ` + ${cont}% contingency` : ""}</td>
                    <td className="num grand">{INR(tentative)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ItemRow({
  it, amount, rate, open, toggle,
}: {
  it: BoqItem; amount: number; rate: number; open: boolean; toggle: () => void;
}) {
  const review = !it.is_verified && it.source !== "manual";
  return (
    <>
      <tr className={review ? "item review" : "item"}>
        <td className="desc">
          {it.description}
          {it.source !== "manual" && <span className={`badge ${it.source}`}>{it.source}</span>}
          {review && <span className="badge unverified">review</span>}
        </td>
        <td className="num">{it.nos ?? ""}</td>
        <td className="num">{QTY(it.quantity)} <span className="unit">{it.unit}</span></td>
        <td className="num rate-cell">{rate ? QTY(rate) : <span className="muted">—</span>}</td>
        <td className="num amt">{amount ? INR(amount) : <span className="muted">—</span>}</td>
        <td className="num">
          <button className={`calc-btn ${open ? "on" : ""}`} onClick={toggle}>
            {open ? "hide" : "calc"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="calc-row">
          <td colSpan={6}>
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
  onChange,
}: {
  pid: number;
  project: Project | null;
  rates: RateRow[];
  onChange: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

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

  const apply = async (member: any) => {
    await api.nlApply(pid, member);
    setMsgs((m) => [...m, { role: "bot", text: "✓ Added to BOQ." }]);
    onChange();
  };

  return (
    <div className="col right">
      <h2>Add by chat · Rates</h2>
      <div className="scroll">
        <div className="card">
          <div className="muted" style={{ marginBottom: 8 }}>
            Describe an element in plain English. Review the proposed quantities,
            then Apply.
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
                  <button
                    className="primary"
                    onClick={() => apply(m.preview.member)}
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <textarea
              rows={2}
              className="w"
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
          <label className="field">Unit rates ({project?.currency || "INR"})</label>
          <table>
            <tbody>
              {rates.map((r) => (
                <tr key={r.category}>
                  <td>{r.label}</td>
                  <td className="muted small">{r.unit}</td>
                  <td className="num">
                    <input
                      key={`${r.category}-${r.rate}`}
                      style={{ width: 90 }}
                      type="number"
                      defaultValue={r.rate}
                      onBlur={async (e) => {
                        await api.setRate(pid, r.category, Number(e.target.value));
                        onChange();
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
