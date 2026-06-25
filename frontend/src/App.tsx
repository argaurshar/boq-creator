import { Fragment, useEffect, useState, useCallback } from "react";
import {
  api,
  getApiKey,
  setApiKey,
  Boq,
  BoqItem,
  Project,
  RateRow,
  Member,
} from "./api";

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

  const project = projects.find((p) => p.id === pid) || null;

  const editKey = () => {
    const next = prompt(
      "Paste your Anthropic API key to enable live AI drawing extraction and " +
        "plain-English editing.\n\nThe key is stored only in this browser and " +
        "sent directly to your backend per request — never saved server-side. " +
        "Leave blank to remove it (the app then uses the key-free demo mode).",
      getApiKey()
    );
    if (next === null) return; // cancelled
    const key = next.trim();
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

  const createProject = async () => {
    const name = prompt("Project name?", "New Project");
    if (!name) return;
    const p = await api.createProject({ name });
    setProjects((ps) => [p, ...ps]);
    setPid(p.id);
  };

  return (
    <div className="app">
      <div className="topbar">
        <h1>🏗️ BOQ Creator</h1>
        <span className="tag">AI-assisted, engineer-verified · IS-code</span>
        <div className="spacer" />
        <button
          className={hasKey ? "keybtn set" : "keybtn"}
          onClick={editKey}
          title={
            hasKey
              ? "An Anthropic API key is set in this browser. Click to change or remove it."
              : "No AI key set — drawing extraction & chat use the key-free demo mode. Click to add your Anthropic key."
          }
        >
          {hasKey ? "🔑 AI key: on" : "🔑 Set AI key"}
        </button>
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
        <button onClick={createProject}>+ Project</button>
        {pid !== null && (
          <a className="btnlink accent" href={api.exportUrl(pid)} download>
            ⬇ Export Excel
          </a>
        )}
      </div>
      {error && <div className="errbar">{error}</div>}

      {pid === null ? (
        <div className="empty">
          Create a project to begin. Upload drawings, add elements in plain
          English, review the BOQ, then export to Excel.
        </div>
      ) : (
        <div className="body">
          <LeftPanel
            pid={pid}
            members={members}
            onChange={() => refresh(pid)}
          />
          <CenterPanel boq={boq} onChange={() => refresh(pid)} />
          <RightPanel
            pid={pid}
            project={project}
            rates={rates}
            onChange={() => refresh(pid)}
          />
        </div>
      )}
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

  const upload = async (file: File) => {
    setBusy("Uploading & reading PDF…");
    try {
      const d = await api.uploadDrawing(pid, file);
      let extracted = 0;
      for (let n = 1; n <= (d.page_count || 0); n++) {
        setBusy(`Extracting page ${n}/${d.page_count}…`);
        const res = await api.extractPage(d.id, n);
        extracted += res.saved || 0;
      }
      setBusy(
        d.page_count
          ? `Done. ${extracted} members extracted from ${d.page_count} page(s).`
          : "Uploaded (could not read pages — is PyMuPDF installed?)."
      );
      onChange();
    } catch (e: any) {
      setBusy("Error: " + e.message);
    }
  };

  return (
    <div className="col left">
      <h2>Drawings & Elements</h2>
      <div className="scroll">
        <div className="card">
          <label className="field">Upload vector PDF (architectural / structural)</label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          {busy && <div className="muted" style={{ marginTop: 8 }}>{busy}</div>}
          <div style={{ marginTop: 8 }} className="muted small">
            Auto-extraction from drawings needs an Anthropic API key — set it via
            <strong> 🔑 Set AI key</strong> (top right). Without a key you can
            still add elements manually or by chat.
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
        {members.map((m) => (
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
                onClick={async () => {
                  await api.deleteMember(m.id);
                  onChange();
                }}
              >
                delete
              </button>
            </div>
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
          </div>
        ))}
      </div>
    </div>
  );
}

function ManualAdd({ pid, onChange }: { pid: number; onChange: () => void }) {
  const [type, setType] = useState("column");
  const [json, setJson] = useState(
    '{"label":"C1","b_mm":300,"D_mm":600,"height_mm":3000,"count":1}'
  );
  const add = async () => {
    try {
      const body = { member_type: type, ...JSON.parse(json) };
      await api.addMember(pid, body);
      onChange();
    } catch (e: any) {
      alert("Invalid: " + e.message);
    }
  };
  return (
    <div className="card">
      <label className="field">Add element manually</label>
      <select className="w" value={type} onChange={(e) => setType(e.target.value)}>
        {["column", "beam", "footing", "slab", "rcc_wall", "pcc", "brick_wall",
          "plaster_surface", "earthwork_pit", "steel_member"].map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <label className="field">Params (JSON, mm)</label>
      <textarea rows={3} value={json} onChange={(e) => setJson(e.target.value)} />
      <button className="primary" style={{ marginTop: 8 }} onClick={add}>
        Add
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- Center */
function CenterPanel({ boq, onChange }: { boq: Boq | null; onChange: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!boq) return <div className="col center"><div className="empty">Loading…</div></div>;

  const rowKey = (g: string, i: number) => `${g}-${i}`;
  return (
    <div className="col center">
      <h2>Bill of Quantities</h2>
      <div className="scroll">
        {boq.groups.length === 0 ? (
          <div className="empty">
            No quantities yet. Upload a drawing, add an element manually, or use
            the chat on the right (e.g. <em>"add 5 columns 300x600 3m high with
            8-16mm bars"</em>).
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">No.</th>
                <th className="num">Qty</th>
                <th>Unit</th>
                <th className="num">Rate</th>
                <th className="num">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {boq.groups.map((g) => (
                <Fragment key={g.category}>
                  <tr className="section">
                    <td colSpan={7}>{g.label}</td>
                  </tr>
                  {g.items.map((it, i) => (
                    <RowWithAudit
                      key={rowKey(g.category, i)}
                      it={it}
                      open={open === rowKey(g.category, i)}
                      toggle={() =>
                        setOpen(
                          open === rowKey(g.category, i)
                            ? null
                            : rowKey(g.category, i)
                        )
                      }
                    />
                  ))}
                  <tr className="subtotal" key={g.category + "-sub"}>
                    <td colSpan={5}>Sub-total — {g.label}</td>
                    <td className="num">{INR(g.subtotal)}</td>
                    <td></td>
                  </tr>
                </Fragment>
              ))}
              <tr>
                <td colSpan={5} className="grand">GRAND TOTAL</td>
                <td className="num grand">{INR(boq.grand_total)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RowWithAudit({
  it,
  open,
  toggle,
}: {
  it: BoqItem;
  open: boolean;
  toggle: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          {it.description}
          {it.source !== "manual" && (
            <span className={`badge ${it.source}`}>{it.source}</span>
          )}
          {!it.is_verified && it.source !== "manual" && (
            <span className="badge unverified">review</span>
          )}
        </td>
        <td className="num">{it.nos ?? ""}</td>
        <td className="num">{it.quantity}</td>
        <td>{it.unit}</td>
        <td className="num">{it.rate || ""}</td>
        <td className="num">{it.amount ? INR(it.amount) : ""}</td>
        <td>
          <button className="link" onClick={toggle}>
            {open ? "hide" : "calc"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7}>
            <div className="audit">
              {it.audit.map((s, k) => (
                <div key={k}>
                  {s.formula_id}: {s.expression} = {s.result}{"  "}
                  [{s.clause_ref}]
                  {"\n   inputs: " + JSON.stringify(s.inputs)}
                </div>
              ))}
              {it.extra?.bbs && (
                <div>BBS rows: {it.extra.bbs.length} (see Excel export)</div>
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
