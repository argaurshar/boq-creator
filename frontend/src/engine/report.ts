// Printable / PDF BOQ report. Builds a self-contained light-theme HTML document
// and opens it in a new tab, then triggers the browser print dialog (Save as
// PDF). No dependencies — works on the static GitHub Pages build.
import { Boq } from "./boq";

interface ProjectLike {
  name?: string; client?: string; location?: string; currency?: string;
  prepared_by?: string; report_date?: string; drawing_ref?: string;
  built_up_area_m2?: number;
}

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

const money = (cur: string, n: number) =>
  (cur === "INR" ? "₹" : cur + " ") +
  Math.round(n).toLocaleString(cur === "INR" ? "en-IN" : "en-US");

const num = (n: number, d = 2) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: d });

function buildReportHtml(project: ProjectLike, boq: Boq): string {
  const cur = project.currency || "INR";
  const total = boq.grand_total || 0;
  const area = Number(project.built_up_area_m2) || 0;

  const metaRows: [string, string][] = [
    ["Client", project.client || "—"],
    ["Location", project.location || "—"],
    ["Drawing ref.", project.drawing_ref || "—"],
    ["Date", project.report_date || "—"],
    ["Prepared by", project.prepared_by || "—"],
    ["Built-up area", area ? `${num(area)} m²` : "—"],
  ];

  const abstract = boq.groups
    .map((g) => {
      const pct = total > 0 ? (g.subtotal / total) * 100 : 0;
      return `<tr><td>${esc(g.label)}</td><td class="r">${esc(money(cur, g.subtotal))}</td>
        <td class="r">${pct.toFixed(1)}%</td></tr>`;
    })
    .join("");

  const detail = boq.groups
    .map((g) => {
      const rows = g.items
        .map((it, i) => `<tr>
            <td>${i + 1}</td><td>${esc(it.description)}</td>
            <td class="r">${it.nos ?? ""}</td>
            <td class="r">${esc(num(it.quantity, 3))}</td><td>${esc(it.unit)}</td>
            <td class="r">${it.rate ? esc(num(it.rate)) : "—"}</td>
            <td class="r">${it.amount ? esc(money(cur, it.amount)) : "—"}</td>
          </tr>`)
        .join("");
      return `<tr class="grp"><td colspan="7">${esc(g.label)}</td></tr>${rows}
        <tr class="sub"><td colspan="6">Sub-total — ${esc(g.label)}</td>
        <td class="r">${esc(money(cur, g.subtotal))}</td></tr>`;
    })
    .join("");

  // Bar bending schedule (rebar items carry extra.bbs).
  const bbs = boq.groups
    .filter((g) => g.category === "rebar")
    .flatMap((g) => g.items.flatMap((it) =>
      ((it.extra?.bbs as any[]) || []).map((b) => `<tr>
        <td>${esc(it.description)}</td><td>${esc(b.mark)}</td><td class="r">${esc(b.dia_mm)}</td>
        <td class="r">${esc(b.count)}</td><td class="r">${esc(num(b.cutting_length_m, 3))}</td>
        <td class="r">${esc(num(b.total_weight_kg, 2))}</td></tr>`)))
    .join("");

  // Steel truss member breakdown (steel items carry extra.truss_segments).
  const truss = boq.groups
    .filter((g) => g.category === "steel")
    .flatMap((g) => g.items.flatMap((it) =>
      ((it.extra?.truss_segments as any[]) || []).map((s) => `<tr>
        <td>${esc(it.description)}</td><td>${esc(s.component)}</td><td>${esc(s.designation)}</td>
        <td class="r">${esc(num(s.length_m, 3))}</td><td class="r">${esc(s.count)}</td>
        <td class="r">${esc(num(s.weight_kg, 2))}</td></tr>`)))
    .join("");

  const section = (title: string, head: string, body: string) =>
    body ? `<h2>${title}</h2><table><thead>${head}</thead><tbody>${body}</tbody></table>` : "";

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>BOQ — ${esc(project.name || "Project")}</title>
<style>
  :root { --ink:#16202c; --mut:#5b6b80; --line:#cdd7e3; --accent:#2f6df0; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: var(--ink);
    margin: 0; padding: 28px 32px; background: #fff; }
  .hdr { display:flex; justify-content:space-between; align-items:flex-start;
    border-bottom: 3px solid var(--accent); padding-bottom: 12px; margin-bottom: 16px; }
  .hdr h1 { margin: 0 0 2px; font-size: 22px; }
  .hdr .sub { color: var(--mut); font-size: 12px; }
  .brand { text-align:right; font-weight:800; color:var(--accent); font-size:15px; }
  .meta { display:grid; grid-template-columns: repeat(3,1fr); gap:4px 18px;
    font-size:12px; margin: 8px 0 18px; }
  .meta b { color: var(--mut); font-weight:600; margin-right:6px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing:.5px;
    color: var(--accent); margin: 22px 0 6px; border-bottom:1px solid var(--line); padding-bottom:4px; }
  table { width:100%; border-collapse: collapse; font-size: 12px; }
  th,td { text-align:left; padding: 4px 8px; border-bottom: 1px solid var(--line); }
  th { color: var(--mut); font-size: 11px; text-transform: uppercase; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  tr.grp td { background:#eef3fb; font-weight:700; }
  tr.sub td { font-weight:700; }
  .totbox { margin-top:14px; display:flex; justify-content:flex-end; }
  .totbox table { width:auto; }
  .totbox td { border:none; padding:2px 10px; }
  .grand { font-size:18px; font-weight:800; color:var(--accent); }
  .signoff { margin-top:42px; display:flex; gap:60px; font-size:12px; color:var(--mut); }
  .signoff div { border-top:1px solid var(--ink); padding-top:6px; min-width:180px; }
  .foot { margin-top:26px; font-size:10px; color:var(--mut); border-top:1px solid var(--line); padding-top:8px; }
  @media print { body { padding: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style></head><body>
  <div class="hdr">
    <div><h1>${esc(project.name || "Project")}</h1>
      <div class="sub">Bill of Quantities &amp; Cost Estimate</div></div>
    <div class="brand">🏗️ BOQ Creator</div>
  </div>
  <div class="meta">
    ${metaRows.map(([k, v]) => `<div><b>${k}</b>${esc(v)}</div>`).join("")}
  </div>

  <h2>Cost Abstract</h2>
  <table><thead><tr><th>Category</th><th class="r">Amount</th><th class="r">Share</th></tr></thead>
    <tbody>${abstract}</tbody></table>
  <div class="totbox"><table>
    <tr><td>Grand total</td><td class="r grand">${esc(money(cur, total))}</td></tr>
    ${area ? `<tr><td>Cost / m² built-up</td><td class="r">${esc(money(cur, total / area))}</td></tr>` : ""}
  </table></div>

  <h2>Detailed Bill of Quantities</h2>
  <table><thead><tr><th>#</th><th>Description</th><th class="r">No.</th><th class="r">Qty</th>
    <th>Unit</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
    <tbody>${detail}</tbody></table>

  ${section("Bar Bending Schedule",
    "<tr><th>Member</th><th>Mark</th><th class='r'>Dia</th><th class='r'>No.</th><th class='r'>Cut len (m)</th><th class='r'>Wt (kg)</th></tr>",
    bbs)}
  ${section("Steel Truss Details",
    "<tr><th>Truss</th><th>Component</th><th>Section</th><th class='r'>Len (m)</th><th class='r'>No./truss</th><th class='r'>Wt (kg)</th></tr>",
    truss)}

  <h2>Assumptions &amp; Basis</h2>
  <div style="font-size:12px;color:var(--mut)">
    IS 1200 (measurement), IS 456 (RCC), IS 800 / SP 6(1) (steel), SP 34 (detailing).
    Rebar weight d²/162 kg/m; lap 50×dia. Rates are ${esc(cur)}, ${area ? "" : "indicative/"}engineer-verified.
    AI-assisted draft — verify against drawings before tender.
  </div>
  <div class="signoff"><div>Prepared by${project.prepared_by ? ": " + esc(project.prepared_by) : ""}</div>
    <div>Checked by</div><div>Approved by</div></div>
  <div class="foot">Generated by BOQ Creator · ${esc(project.report_date || "")}</div>
</body></html>`;

  return html;
}

// Show the report in an in-app overlay (an iframe), with Print / Download / Close.
// Avoids window.open(), which mobile browsers block as a non-gesture pop-up.
export function openBoqReport(project: ProjectLike, boq: Boq): void {
  const html = buildReportHtml(project, boq);
  const fname = `BOQ_${String(project.name || "Project").replace(/ /g, "_")}.html`;

  const overlay = document.createElement("div");
  overlay.setAttribute("style",
    "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.55);" +
    "display:flex;flex-direction:column;");

  const bar = document.createElement("div");
  bar.setAttribute("style",
    "display:flex;gap:8px;align-items:center;padding:8px 12px;background:#16203a;" +
    "border-bottom:1px solid #28324d;color:#eaf1fb;font:600 13px system-ui,sans-serif;");
  bar.innerHTML = "<span style='flex:1'>Report preview</span>";

  const mkBtn = (label: string) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.setAttribute("style",
      "cursor:pointer;border:1px solid #28324d;border-radius:8px;padding:8px 12px;" +
      "font:600 13px system-ui,sans-serif;background:#1a2440;color:#eaf1fb;min-height:38px;");
    return b;
  };
  const printBtn = mkBtn("🖨 Print / Save PDF");
  printBtn.style.background = "linear-gradient(180deg,#7c8cff,#5b6ef0)";
  printBtn.style.borderColor = "#5b6ef0";
  printBtn.style.color = "#fff";
  const dlBtn = mkBtn("⬇ Download");
  const closeBtn = mkBtn("✕ Close");

  const iframe = document.createElement("iframe");
  iframe.setAttribute("style", "flex:1;width:100%;border:0;background:#fff;");
  iframe.srcdoc = html;

  let url = "";
  const cleanup = () => {
    if (url) URL.revokeObjectURL(url);
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cleanup(); };

  printBtn.onclick = () => {
    const w = iframe.contentWindow;
    if (w) { w.focus(); w.print(); }
  };
  dlBtn.onclick = () => {
    const blob = new Blob([html], { type: "text/html" });
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fname; a.click();
  };
  closeBtn.onclick = cleanup;
  overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };
  document.addEventListener("keydown", onKey);

  bar.append(printBtn, dlBtn, closeBtn);
  overlay.append(bar, iframe);
  document.body.appendChild(overlay);
}
