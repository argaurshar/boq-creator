# BOQ Creator — Project Charter (`project.md`)

> **This file is the soul of the project.** Every design decision, formula, and
> feature must trace back to a principle stated here. Read this before writing or
> reviewing any code. If code and this document disagree, one of them is wrong —
> fix the disagreement, don't ignore it.

---

## 1. Vision

Architects and structural engineers upload their **architectural and structural
drawings**. The app reads those drawings, understands the structural members in
them, and produces a complete, professional **Bill of Quantities (BOQ)** across
every structural work department — automatically, with the engineer staying in
control and verifying the result.

The user gets the BOQ back **inside the app** (editable tables) and as a
downloadable **Excel workbook**. They can add or change any element by **typing
in plain English**, and they can **cross-check every line item back to the
region of the drawing** it came from.

### Departments covered
- **RCC structure** (footings, columns, beams, slabs, walls, staircases)
- **MS / structural steel** (rolled sections, plates, connections)
- **Reinforcement / rebars** (steel weight via Bar Bending Schedule logic)
- **Concrete** (volumes, grades, formwork/shuttering)
- **Earthwork** — **excavation**, **backfilling**, **refilling**, surplus disposal
- **Brickwork / masonry**
- **Plaster / finishes**

---

## 2. The one principle that makes this legitimate

> ### 🧱 A hard wall between AI and arithmetic.

- **The AI only *extracts*.** Its sole job is to turn a drawing (pixels, vector
  geometry, embedded schedule tables, or a plain-English sentence) into a
  **strictly-typed list of structural members and their parameters**
  (dimensions, counts, bar diameters, spacings, grades). The AI **never**
  multiplies, sums, computes a volume, a weight, or an area. It never outputs a
  quantity.

- **The quantity engine does *all* the math.** Given a typed `Member`, pure
  deterministic Python returns every quantity using **IS-standard formulas**.
  Every number is reproducible, unit-tested against golden values, and carries
  an **audit trail** (the formula used, the inputs, the result, the IS clause).

**Why this matters:** a quantity surveyor can audit any line item back to
(a) the formula, (b) the extracted inputs, and (c) the drawing region. The AI is
a fast, fallible data-entry assistant — not an oracle you must trust blindly.
Nothing is ever "final" until a human has verified it.

---

## 3. Standards & conventions (India)

All measurement and computation follow Indian practice:

| Domain | Reference |
|---|---|
| Mode of measurement / deductions | **IS 1200** (parts) |
| RCC design & detailing constants | **IS 456**, **SP 34** |
| Structural steel sections | **IS 800**, **IS 808 / SP 6(1)** section tables |
| Rate conventions / measurement-sheet format | **CPWD / DSR** |
| Units | Metric — length **m**, area **m²**, volume **m³**, steel weight **kg / MT**, items **Nos** |

Key encoded constants (centralized, documented, configurable):
- Rebar unit weight: **`w = d² / 162`** kg/m (d in mm).
- Default lap length (tension): **`Ld = 50 d`** (configurable per grade/exposure).
- Stock bar length: **12 m** (laps added beyond this).
- IS 1200 deduction thresholds: masonry openings **> 0.1 m²**, plaster openings
  **> 0.5 m²**, **no deduction for reinforcement** in concrete.
- Default wastage: **3–5%** (configurable), applied at summary and recorded.

---

## 4. Core workflow (what the user experiences)

1. **Upload** a vector PDF (architectural + structural drawings).
2. App renders each page, detects the **scale**, and asks the user to
   **confirm the scale per page** (a wrong scale silently ruins every quantity —
   so this is gated).
3. **Extract**: AI reads each page (image + extracted text + schedule tables) and
   proposes a list of **members** — each with a confidence score, the evidence it
   used, and a **bounding-box region** on the drawing.
4. The deterministic **engine computes** quantities for every member and groups
   them into a BOQ.
5. **Review & verify**: the user sees an editable BOQ table. Unverified AI rows are
   flagged. Clicking a row **highlights the source region** on the drawing.
   "Show calculation" reveals the full audit trail.
6. **Edit in plain English**: e.g. *"add 5 columns 300×600, 3 m high, 8-16mm bars,
   M25"*. The AI parses this into a member; the engine computes it; the user sees a
   **proposed diff** and confirms before it is applied.
7. **Rates**: the user enters/imports unit rates per item → amounts compute
   (`Amount = Quantity × Rate`).
8. **Export** a styled **Excel** workbook (BOQ + Bar Bending Schedule + Abstract +
   Assumptions), with live rate formulas so totals update if rates change.

---

## 5. Architecture

**Web app. Python (FastAPI) backend + React (Vite + TypeScript) frontend.**

```
boq-creator/
├── project.md                      ← this file
├── README.md
├── backend/
│   ├── app/
│   │   ├── main.py                 FastAPI app, routers, CORS
│   │   ├── config.py               env-driven settings (AI keys server-side)
│   │   ├── db.py                   SQLAlchemy (SQLite dev / Postgres prod)
│   │   ├── models.py               ORM: Project, Drawing, Member, BoqItem, Rate, ChatMessage
│   │   ├── schemas/                Pydantic contracts
│   │   │   ├── member_schema.py    ★ the typed Member union — shared by AI, NL, DB, engine
│   │   │   ├── extraction.py       what the AI must return
│   │   │   ├── boq.py  rate.py  nl.py
│   │   │   ├── engine/             ★ deterministic quantity engine (NO AI here)
│   │   │   │   ├── units.py  materials.py
│   │   │   │   ├── concrete.py  rebar.py  steel.py
│   │   │   │   ├── earthwork.py  masonry.py  plaster.py
│   │   │   │   ├── deductions.py  registry.py  compute.py
│   │   │   ├── ai/                 extraction & NL — AI ONLY fills typed members
│   │   │   │   ├── provider.py     AIProvider ABC (abstraction, req: swappable)
│   │   │   │   ├── claude_provider.py   default (Anthropic SDK)
│   │   │   │   ├── mock_provider.py     deterministic stub so app runs w/o a key
│   │   │   │   ├── prompts/        versioned prompt templates
│   │   │   │   ├── extraction_pipeline.py  nl_edit.py
│   │   │   ├── pdf/                loader, render, text/table extraction, scale
│   │   │   ├── export/xlsx.py      BOQ workbook (CPWD/DSR format)
│   │   │   └── api/                FastAPI routers
│   │   └── tests/engine/          ★ golden-number tests per formula (critical)
│   └── pyproject.toml
└── frontend/
    └── src/
        ├── pages/ProjectWorkspace.tsx   3-pane: viewer | BOQ table | chat
        ├── components/ DrawingViewer, BoqTable, NlChatBox, RateEntry, ExportButton, ...
        └── api/  store/  types/
```

### The AI/math wall in code
- `ai/*` returns only validated `Member` objects (Pydantic discriminated union).
- `engine/*` is pure functions: `compute(member) -> { quantities, audit }`. No I/O,
  no AI, no randomness — fully unit-testable.
- `Member` is the **single source of truth**, stored in the DB. Editing a member
  re-runs the engine; quantities are never hand-stored except when a user
  explicitly locks/overrides a line.

---

## 6. Quantity engine — formulas (IS-based)

All dimensions in metres after scale conversion. Every formula records a
`FormulaStep` `{ formula_id, expression, inputs, result, clause_ref }`.

### Concrete & RCC (m³; shuttering m²) — `concrete.py`
- **Footing (pad):** `V = L·B·D`; stepped `Σ Lᵢ·Bᵢ·Dᵢ`; sloped frustum
  `(h/6)·[L·B + l·b + (L+l)(B+b)]`. × count.
- **Column:** `V = b·D·H`; shuttering `2(b+D)·H`.
- **Beam:** `V = b·d·L`; shuttering `(2d+b)·L`. Depth measured below slab soffit
  (avoid double count with slab).
- **Slab:** `V = L·B·t` − openings; soffit shuttering = net plan area.
- **Wall / retaining:** `V = L·t·H`; shuttering `2·L·H`.
- **Staircase:** waist `incl_len·width·t` + steps `½·R·T·width·n`.
- Concrete rule: **no deduction for reinforcement**.

### Reinforcement / BBS (kg) — `rebar.py`
- Unit weight `d²/162` kg/m.
- **Cutting length** = clear span − 2·cover + hooks − bend deductions.
  - Hook (180°): `+9d` per hook. 90° bend: `−2d`. 45°: `−1d`. 135° (stirrup): hook+bend.
  - Crank (slab bent-up, 45°): `+0.42·D` per crank.
- **Stirrups:** `2(a+b) + hooks − bends`, legs `dim − 2·cover`; common lump `2(a+b)+24d`.
  Count `= floor((L−2·end_cover)/spacing) + 1`, supports variable-spacing zones (SP 34).
- **Laps:** `n = floor(L/12)`, add `n·50d`.
- Output a **Bar Bending Schedule** per member → summarized by diameter & grade,
  wastage % applied & recorded.

### Structural / MS steel (kg / MT) — `steel.py`
- Rolled section: `weight = unit_wt(designation)·length·count` (IS 808/SP 6 table).
- Plate: `area·t·7850`. Built-up: sum. Connections lump **2–5%** (recorded).

### Earthwork (m³) — `earthwork.py`
- Excavation vertical: `V = L·B·D`. With side slopes (prismoidal):
  `V = D/6·[A_top + 4·A_mid + A_bottom]`. Trench: `((B_top+B_bottom)/2)·D·L`.
- **Backfilling = Excavation − (embedded structure volume)** (footing + PCC + stub),
  computed by netting against related members (not a heuristic).
- **Surplus disposal = Excavation − Backfill.**

### Brickwork / masonry (m³; half-brick m²) — `masonry.py`
- `V = L·H·t` − openings (> 0.1 m²) − embedded RCC (columns/beams/lintels/bands).
  No deduction for rebar. Brick/mortar breakup optional.

### Plaster / finishes (m²) — `plaster.py`
- Face area `L·H` (both faces if internal both-sides). Deduct openings > 0.5 m²
  per IS 1200 (reveal policy configurable & recorded). Ceiling = slab soffit net.

---

## 7. AI contract (what the model returns)

The AI returns **only** validated JSON: a list of members with `member_type`,
`label`, `count`, `confidence`, `region` (page bbox for drawing-reference),
`params` (typed dims in **mm**), and `evidence`/`assumptions`. Missing dimensions
are `null` + listed under `unresolved` — **never silently guessed**. Same schema
is reused for plain-English edits. Server-side Pydantic validation rejects &
retries on invalid output. Schedule tables (column/beam/bar-bending) are the
preferred, highest-confidence input.

---

## 8. Excel export

One workbook: **Cover/Abstract**, **BOQ** (Item · Description · No. · L · B · D ·
Quantity · Unit · Rate · Amount, grouped by department, in CPWD/DSR measurement-
sheet style), **Bar Bending Schedule**, **Assumptions** (scale, deduction policy,
wastage, laps, AI assumptions/unresolved). `Amount` and subtotals are **live Excel
formulas** so the client can change rates and see totals update.

---

## 9. Roadmap (build order)

The category order is deliberate: prove the architecture on the lowest-formula-risk
category first, defer the riskiest (rebar) until the verify-loop is proven, and add
categories that reuse already-extracted dimensions last.

- **Phase 0 — Skeleton:** scaffold backend+frontend, DB, PDF upload/render, viewer,
  AIProvider ABC + mock provider. No quantities yet.
- **Phase 1 — MVP, Concrete end-to-end:** member schema → `concrete.py` + audit +
  golden tests → AI extraction (from schedule tables first) → editable BOQ table →
  rates → **xlsx export** → NL add → drawing-region reference. *Proves the whole loop.*
- **Phase 2 — Reinforcement / BBS:** `rebar.py` + BBS sheet, extensive golden tests.
- **Phase 3 — Earthwork + Masonry + Plaster:** shared deductions, cross-member netting.
- **Phase 4 — Structural steel:** section table + `steel.py`.
- **Phase 5 — Hardening:** scale auto-detect robustness, scanned-PDF/vision fallback,
  multi-page assembly, confidence review queue, auth/multi-user, DSR rate libraries,
  background jobs (Celery) for large drawing sets.

---

## 10. Top risks & how we de-risk them

| Risk | Mitigation |
|---|---|
| AI mis-reads / hallucinates members | AI never computes; mandatory human-verify; confidence + evidence shown; prefer schedule tables; `unresolved` instead of guessing. |
| Wrong scale → every quantity off | Detect 3 ways (text, scale bar, reference dim); **require per-page scale confirmation**; "measure a known dimension" check. |
| Formula / IS-compliance errors | Pure deterministic engine, golden-number unit tests from published examples/DSR; audit trail with clause refs; centralized constants. |
| Deduction ambiguity (IS 1200) | Encode thresholds as named, configurable policies; record chosen policy in the export. |
| Double-counting (beam/slab, embedded RCC in masonry) | Single source of truth (Members) + cross-member netting in the engine, tested. |
| AI lock-in / cost / latency | `AIProvider` ABC; provider/model/prompt-version recorded per run; mock provider so app runs without a key; cache by page hash. |
| "Is this trustworthy for professional use?" | Positioned as *AI-assisted draft, engineer-verified*; nothing final until verified; full auditability; familiar CPWD/DSR measurement-sheet output. |

---

## 11. Non-goals (for now)
- Fully automatic, no-human-check takeoff (explicitly rejected — not legitimate yet).
- Scanned/photo drawings as a primary path (vision fallback only, with warnings).
- Cost estimation beyond rate × quantity (no live market rates, GST workflows v1).
- Structural *design* (we measure what's drawn; we don't design members).

---

## 12. Definition of done (per category)
A category is "done" when: the engine module exists with an audit trail, golden
unit tests pass against published worked examples, the AI can extract its members,
the BOQ table shows & lets the user verify/edit them, drawing-reference works, and
the category appears correctly in the Excel export.
