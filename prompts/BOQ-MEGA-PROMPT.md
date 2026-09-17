# BUILD SPECIFICATION — AI QUANTITY TAKE-OFF / BOQ TOOL (INDIAN CONSTRUCTION)

You will build a working web application that turns uploaded construction drawings (PDF / JPEG / PNG) into an interactive, priced, exportable Bill of Quantities for Indian construction practice.

Build the tool. Everything below is a requirement on software, not a description of a document. Do not ask me clarifying questions — choose sensible defaults, implement them, and list every default in an Assumptions section at the end.

---

## 1. THE PRODUCT

The user journey you must implement, in order:

1. **Upload** — one or more PDFs and/or images, treated as one drawing set.
2. **Index & propose discipline** — build a page index, then propose exactly ONE discipline with evidence. The user confirms or overrides.
3. **Harvest** — read the WHOLE set in a fixed order, extracting dimensions, marks, schedules, levels and notes. Compute nothing yet.
4. **Ask** — ONE batch of questions covering everything unresolved.
5. **Compute** — deterministic code turns typed element records into quantities.
6. **Price** — user sets or accepts rates; amounts recompute live.
7. **Present** — interactive BOQ with the seven mandated columns, grouped with subtotals and a grand total, plus assumptions, queries and coverage panels.
8. **Export** — a real PDF file and a real Excel workbook.
9. **Learn** — user marks lines wrong and says why; the tool records it and improves its discipline packs under governance.

One command to install, one to run, one to test. No hand-edited config to reach a working first run.

---

## 2. THE NON-NEGOTIABLE ARCHITECTURAL PRINCIPLE

**A hard wall stands between language understanding and arithmetic.**

- **The reading layer only extracts.** Its only output is strictly-typed element records (geometry in millimetres, counts, grades, marks, reinforcement, provenance) plus unresolved items and an out-of-scope register. **It must never multiply, sum, average, or compute a volume, area, weight, total or rate. It must never output a quantity.**
- **A deterministic calculation layer does 100% of the arithmetic.** Pure functions: same inputs, same numbers out. No network, no randomness, no clock, no model call inside it.

Enforce this structurally, not by convention:
- The calculation layer is its own module importing only its own constants and sibling formula modules.
- Signatures take typed element records, typed rates, the active discipline and policy ids. Never free text.
- Ship a static import-graph test asserting the calculation layer's transitive imports contain no HTTP, random, date/time or model-SDK module.
- Ship a determinism test running the same element set twice under different system times and random seeds, asserting byte-identical output.

**Why:** a contractor prices off this. The engine must be reproducible and auditable to the last digit. The reading layer is model-driven and is **NOT** reproducible — do not claim it is. That is exactly why every run records its element set, answers, model identifier and pack hash.

**Test contract (mandatory).** Golden-value unit tests over every formula, using the pinned numbers in this specification verbatim. If a pinned golden disagrees with your derivation, report the disagreement with your hand derivation — do not edit the golden and do not quietly implement a different number.

---

## 3. THE DISCIPLINE GATE

Four modes: **Structure · Architecture · Civil · Interior**. **Exactly one is active per run.**

- After indexing, the tool proposes one discipline with its evidence; the user confirms or overrides.
- "Focus" operationally means: elements outside the active discipline are **not measured**, but are **recorded in a visible out-of-scope register** with sheet and mark. Never silently dropped.
- Each discipline loads its own rule-pack (item catalogue, units, source sheets, measurement conventions, specification conventions, completeness checklist). Packs are data files, versioned and hashed, not hardcoded branches.
- If the user asks for something outside the active discipline, decline and offer to switch modes — do not quietly widen scope.

---

## 4. DRAWING INTAKE AND READING ORDER

**4.1 Inventory pass first.** For every page record: sheet number, title, discipline guess, sheet type (plan / section / elevation / schedule / detail / notes), declared scale, revision, and whether it is legible. Show this index to the user.

**4.2 Fixed reading order — do not deviate:**
1. General notes and legend (they carry concrete grade, cover, mortar ratio, lap conventions, steel grade — these are project-wide defaults).
2. Schedules (column, footing, beam, door/window, finishes).
3. Plans (for counts and layout).
4. Sections, elevations and details (for heights, depths, layers).

**4.3 The whole set is read before anything is computed.** Quantifying sheet 1 before reading sheet 6 is the single most common cause of a wrong BOQ.

**4.4 Source-of-truth per attribute.** State it per element type and enforce it:
- **Size and reinforcement → from the schedule.**
- **Count → from the marks drawn on the plan grid.**
- **Height, depth and layers → from the section/elevation.**

---

## 5. THE DIMENSION DISCIPLINE

**5.1 Systematic sweep.** Follow every dimension string, every grid-line spacing, every level marking, every callout/tag, every schedule row. Do not sample — enumerate.

**5.2 Mandatory cross-checks.** Sum each dimension chain and compare it against the stated overall dimension and against grid spacings. Where they disagree, **never reconcile silently** — surface the discrepancy with both numbers and ask.

**5.3 Unit and system detection.** Detect mm / cm / m / feet-inches from magnitude and notation (`12'-0"`, `2000`, `2.00`). Normalise everything to millimetres internally. Record the detected unit per sheet.

**5.4 Sanity envelopes — reject physically impossible values.** A column 300 m tall, a slab 4 mm thick, a plate smaller than its own thickness: these are unit slips, not small numbers. Detect them deterministically and flag, never silently accept.

---

## 6. THE MISSING-DIMENSION PROTOCOL

When a needed dimension is not directly readable, run these branches **strictly in order**:

1. **Printed anywhere?** Search the entire set, including schedules, sections, details and notes — not just the current sheet.
2. **Derivable?** From dimension-chain arithmetic, grid spacing, symmetry, or a repeated typical detail. Record the derivation.
3. **Scale-inferable?** Only if: the sheet declares a scale, AND a known printed dimension exists on the **same sheet** as a calibration reference, AND the element is drawn to scale (not a schematic or a "NOT TO SCALE" detail). Measure proportionally against the calibration reference, then round to a buildable modular value. Record basis and confidence as **inferred**.
4. **Otherwise ASK THE USER.** Never invent.

**6.1 The ask format.** Each question must name: the element and its mark, the sheet number, the region, exactly what is missing, which quantity it blocks, the best available assumption with its basis, and a direct question.

> Example: "Footing F2 (Sheet S-02, grid C/3): the depth is not printed on the plan or in the footing schedule, and Section A-A does not cut through it. This blocks the concrete volume, side shuttering and excavation for 4 footings. Nearest comparable F1 is 400 mm deep. **Please confirm the depth of F2, or tell me to adopt 400 mm.**"

**6.2 Batch the questions.** Ask everything in one round. Do not interrogate one dimension at a time.

**6.3 The assumption ledger.** Every assumed, derived or inferred value is recorded with: element, value, basis (derived / scaled / user-supplied / pack default), confidence, and the sheet it came from. The ledger is displayed in the app, printed in the PDF and written to an Excel sheet. **A quantity resting on an assumption is visually marked in the table.**

**6.4 If the user declines to answer**, proceed with the disclosed assumption, mark those lines clearly, and never block indefinitely.

---

## 7. ANTI-HALLUCINATION RULES

The tool must never:
1. Invent a dimension that is neither printed, derived, nor scale-inferred with a calibration reference.
2. Fabricate a schedule row, a mark, or an element that is not on a drawing.
3. Silently round or "tidy" a dimension.
4. Guess through an illegible or cropped region — flag it and ask.
5. Report a partial take-off as if it were complete.
6. Cite an IS code clause number it is not certain of. Name the code and the convention instead of inventing a clause.
7. Present an inferred value with the same visual weight as a printed one.

---

## 8. THE FOUR DISCIPLINE PACKS

For each discipline, ship: element types to extract, BOQ item catalogue in tender order with units, which sheet each quantity comes from, measurement conventions that differ from raw geometry, specification-column conventions, and a **completeness checklist** of commonly-forgotten items verified before output.

**8.1 STRUCTURE (RCC + structural steel).** Items: excavation, PCC/lean concrete, RCC by grade and element (footing, column, beam, slab, wall, staircase), formwork by element, reinforcement steel by diameter, structural steel by section, base plates, anchor bolts, trusses. Units: m³ / m² / kg / MT / nos.
Conventions: formwork is the contact area of concrete only; reinforcement is measured by weight with lap and wastage stated; concrete is measured net of openings above the stated threshold.
Checklist: PCC under **every** footing; tie/plinth beams; column starter bars and dowels; staircase waist and steps; lift/sump walls; the below-ground portion of column height.

**8.2 CIVIL (site, substructure, external works).** Items: site clearance, earthwork in excavation by depth band and soil class, shoring, dewatering, backfilling, anti-termite treatment, plinth protection, drainage, roads and pavements, boundary wall, external services trenching. Units: m³ / m² / Rmt / nos.
Conventions: excavation measured by depth stage with lead and lift stated; working space stated as a policy; **backfilling is measured net of the foundation volume occupying the pit** — never gross.
Checklist: disposal vs reuse of surplus earth; dewatering where the water table is shown; shoring for deep pits; anti-termite; plinth protection.

**8.3 ARCHITECTURE (building fabric and finishes).** Items: blockwork/brickwork by thickness, internal and external plaster, flooring and skirting, dado and wall tiling, false ceiling, painting by system and coat count, doors and windows from the schedule, waterproofing, railings, external finishes. Units: m² / m³ / Rmt / nos.
Conventions: openings below the stated threshold are not deducted in plaster and paint — state your adopted threshold as a policy, apply it consistently, and disclose it; jambs and soffits of large openings are added; skirting is measured as running length with door openings deducted; painting is measured by the surface, with a stated multiplier for grilles and railings.
Checklist: external plaster on all faces including parapets; waterproofing in wet areas and terraces; door/window frames vs shutters; lintels and sills; staircase railing.

**8.4 INTERIOR (fit-out).** Items: joinery (wardrobes, kitchen, storage, TV units, beds), loose furniture, false ceiling and cove, flooring, wall finishes and panelling, painting, glazing and mirrors, sanitary and CP, lighting and services interface, soft furnishing, handover cleaning. Units: m² / sqft / Rmt / nos / set / lump sum.

**HARD GATE — a furniture layout plan alone cannot produce a joinery quantity.** A layout gives footprint (W × D). Joinery is measured on **W × H**, and height exists on no layout plan. If only a layout is supplied, output positions and widths and return **every joinery quantity as blocked**, with the query list. Never assume 2100 mm. A 3000 × 600 wardrobe is 1.80 m² in footprint and 7.20 m² in front elevation at 2400 high — a 4× error.

**Scope split must be declared before take-off** (warm shell / bare shell / renovation). If not stated, raise a query — do not assume.
Checklist: carcass vs shutter measurement basis; hardware and channels; edge banding; services coordination cut-outs; dismantling and making good in renovation.

---

## 9. THE CALCULATION ENGINE

Implement as pure functions with golden tests. Every quantity carries an audit trail: formula id, inputs, result, and the source sheet/mark.

**9.1 Concrete and formwork**
- Footing: concrete `L·B·D·count`; **side shuttering `2(L+B)·D·count`** — or an explicit zero line with a "cast against earth" note when the section shows concrete against the excavated face. The line must always exist.
- Column: concrete `b·D·H·count`; formwork `2(b+D)·H·count`.
- Beam: concrete `b·D·L`; formwork `(2D+b)·L` (soffit plus two sides).
- Slab: concrete `L·B·t`; formwork `L·B` plus edge.
- **Golden:** a 2.0 × 2.0 × 0.4 pad → `1.600000 m³` concrete and `3.200000 m²` formwork.

**9.2 Earthwork**
- Excavation `(L+2w)(B+2w)·D` with `w` the declared working space.
- **Backfill = excavation − (foundation volume below ground)**, clamped at zero **and flagged** if negative.

**9.3 Masonry**
- `gross − openings − embedded_rcc`. Every `max(x, 0)` in the engine **emits a review flag carrying the two numbers that disagreed.** A clamped line must render as flagged, never as an ordinary zero.

**9.4 Plaster** — area by face count, openings netted per the declared threshold policy, jambs added.

**9.5 Structural steel**
- Resolve the section from a section-property table first (ISMB/ISMC/ISA/ISHB/RHS/SHS/pipe); fall back to geometry only for plates and bars.
- **Plates need a full plan size in mm (L × W × t); a thickness alone cannot be weighed.**
- Implement the physical-impossibility test for unit slips.
- **Golden:** `MS PLATE 12X12X20MM` → **14.586 kg**; `PLATE 12"x12"x20mm` → **14.586 kg**; `PLATE 200X200X10` → **3.140000 kg**. All three in one test.
- Truss: sum segments via the same resolver, apply the gusset/connection percentage, multiply by the number of identical trusses.

**9.6 Cross-element netting (anti-double-count resolver).** Run before computation. When a truss is present, drop loose steel members that restate its chords/ties/struts/web/purlins, and **raise a visible warning per removal**. Keep base plates, stiffeners, anchor bolts and column-cap connections.

---

## 10. REINFORCEMENT AND BAR BENDING SCHEDULE

- Unit weight `d²/162` kg/m. State your mass basis (nominal per IS 1786) as a policy id.
- Development / lap length from a grade × diameter table — **the table must actually be wired**, e.g. 16Ø at M25 → 48d, at M20 → 57d.
- Laps: `n_laps` counts laps needed for a member longer than stock length. **A `floor(len/12)` implementation is wrong at the boundary.**
- Hooks and bends per the declared policy (135° hook at 8d, or IS 13920 ductile detailing at 10d).
- Bar count from spacing: `floor(clear / spacing) + 1`.
- Support both bottom and top mesh mats in footings, and column ties including inner rings.

**Golden values (M25 unless stated):**
- `n_laps`: 3.0 m → **0**; 12.000 m → **0**; 12.001 m → **1**; 24.000 m → **1**; 25.000 m → **2**.
- `lapsExtra(13.0, 16, M25)` = `1 × 48 × 0.016` = **0.768000 m**; at M20 = `1 × 57 × 0.016` = **0.912000 m**. Assert the two differ.
- Column main bar, H = 3.0 m, 16Ø, no dowel: **3.768000 m**. H = 13.0 m: **14.536000 m**.
- Column tie, 300 × 600, cover 40, 8Ø: `2(0.740) + 24(0.008)` = **1.672000 m**. Under IS 13920 (135°/10d): **1.704000 m**. A `2(a+b)+12d` implementation gives 1.576000 and fails.
- Uniform stirrups 8Ø @ 150 over 4500 clear, cover 25 → **30**.
- Column C1 300 × 600 × 3000, cover 40, 8-16Ø, ties 8Ø @ 150: main **47.627520 kg**, ties **13.208800 kg**, measured Σ **60.836320 kg**, billed **61 kg**.
- A doubly-reinforced footing 2000 × 2000 × 400, bottom 12Ø @ 150 both ways, top 10Ø @ 200 both ways → **exactly 4 BBS rows** (BX, BY, TX, TY).

Output a proper Bar Bending Schedule: mark, bar type, diameter, shape code, cut length, number, total length, unit weight, total weight.

---

## 11. MATERIAL TAKE-OFF (INDICATIVE)

From the computed BOQ, derive: cement (bags), sand, coarse aggregate by concrete grade using nominal mix ratios and the dry-volume factor; mortar for masonry and plaster; brick/block counts; reinforcement tonnage by diameter; structural steel tonnage; formwork area; excavation volume.

Label the whole section **indicative**. State the mix assumptions on the output.

---

## 12. THE COVERAGE CHECK (ANTI-SILENT-UNDER-REPORTING)

**The principle: a partial take-off must never look identical to a genuinely small project.** There is no visual difference between "the reader got through one of six sheets" and "the job really is just footings" — same clean table, same confident total, no error. Every extraction failure degrades into this. The coverage check makes that difference visible.

- It is a **deterministic post-calculation audit** over the element types present and the declared conventions — **not** over the rows produced, because an empty category renders as nothing when the renderer skips empty groups.
- It **never changes, adds or invents a quantity.** Notes only.
- Notes must appear in **all three** outputs: an interactive Coverage panel, a PDF section, and a labelled block in the spreadsheet.
- Rules must be conservative — each fires only on an inconsistency essentially impossible in a real building, so it never cries wolf on a legitimately small job.
- Each note is worded as an instruction to check a specific sheet or supply a specific input, never as a vague warning.

**Structure rules (implement at minimum):** footings present but no columns (or vice versa); footings with no PCC; RCC concrete present with zero formwork; footings/columns present with no tie or plinth beams; slab present with no supporting beams; steel members present with no connections.
**Civil:** excavation with no backfill; foundations with no anti-termite or plinth protection where the notes call for them.
**Architecture:** masonry with no plaster; floors with no skirting; wet areas with no waterproofing; openings with no lintels.
**Interior:** joinery with no hardware; ceiling with no cove or light coordination; any joinery quantity resting on an assumed height.

**Flag-fatigue guard:** display at most 15 notes per run ranked by value impact, collapse the rest behind a count, and list all of them in the exports.

---

## 13. KNOWN TRAPS — YOUR BUILD MUST NOT REPRODUCE THESE

These are real defects found in a production version of this tool. Each is a requirement with a test.

1. **Truss double-counting** — the assembly elevation and the member schedule show the same steel twice; an "extract everything" instruction emits the truss **and** its own chords as loose members, doubling the steel category. Fix in two layers: the extraction instruction forbids it, and the engine dedups before computation with a visible warning per removal.
2. **Base plate in inches read as mm** — `12" × 12" × 20 mm` computed 0.02 kg against a true 14.586 kg. Implement the physical-impossibility test.
3. **Negative masonry clamped silently to zero** — a mis-linked embedded RCC volume netted negative, clamped to 0.00, and rendered as an ordinary zero line. Clamp **and flag**, carrying both disagreeing numbers.
4. **Footings emitted no formwork**, silently emptying the whole Formwork category — not zero, *absent*, because the renderer skips empty groups.
5. **Multi-sheet under-extraction** — the reader captured the footings and skipped the column-layout sheet, the tie-beam grid, the foundation beams, the lift/sump walls and the basement slab. Encode the set grammar explicitly and name the real mark prefixes (TB, PB, GB, FB). Generic "be exhaustive" does not survive a six-sheet set.
6. **Column count taken from the number of schedule types** — a 40-column building with 3 schedule types produced 3 columns. A schedule lists **types**; count the physical marks on the plan grid. Multi-storey schedule rows are bar curtailment, not more columns.
7. **Footings with no PCC** — the lean-concrete layer is drawn on the section, not the plan, and was skipped. Emit a PCC for every footing or flag its absence.
8. **Column height missing the below-ground portion** — read the full height from the section, from footing top to slab soffit, not the above-ground figure on the elevation.
9. **Stale data mixed with a new upload** — each new drawing set must start a genuinely fresh take-off, never merge with the previous project's elements.
10. **Confident output with no assumption disclosure** — a clean table with no visible ledger is the most dangerous output this tool can produce.

---

## 14. THE OUTPUT — THE TABLE CONTRACT

**Exactly seven columns, in exactly this order, with exactly these headings**, on screen, in the PDF, and in every Excel sheet carrying BOQ lines:

| Serial Number | Item | Description | Quantity | Rate | Amount | Specification |
|---|---|---|---|---|---|---|

- **Do not add, remove, reorder or rename a column.** "S.No.", "Sl. No.", "Qty" and a separate "Unit" column are all violations of this contract *as headings*.
- **There is no separate Unit column.** The unit travels inside the Quantity cell and is stored separately in the row data model so exports and charts can use it programmatically.
- **Serial Number** — hierarchical (1, 1.1, 1.2, 2, 2.1).
- **Item** — short trade name plus only the attributes that change the rate, e.g. "RCC M25 — Columns".
- **Description** — full measured-item wording stating what is included, what is excluded, and the deduction rule applied.
- **Quantity** — value with its unit and sensible decimals.
- **Rate** — user-editable, INR.
- **Amount** — **the rounded, displayed quantity × rate**, so the screen, the PDF and the Excel formula agree exactly.
- **Specification** — grade, mix, cover, make, finish, class.

Everything else — member mark, sheet reference, formula, confidence, nos/L/B/D measurement basis — is **row metadata reachable by drill-down**, not an eighth column.

Group by category with subtotals and a grand total, plus a contingency control. Every row drills down to its formula, its inputs, and the sheet and mark it came from.

---

## 15. INTERACTIVITY AND PRESENTATION

- **Live recalculation** — editing any rate or element recomputes amounts, subtotals, grand total and charts immediately.
- Category grouping with collapse, search, and a "needs review" filter.
- A visual cost overview: a composition bar, a cost-split chart with a bounded number of slices (top 5 plus "Other" — never 12 slices), top cost drivers, and material KPI tiles.
- An element list the user can edit in place, with clear verified / needs-review states.
- Assumption-backed rows visually marked.
- Onboarding empty state explaining the three steps.
- Responsive down to phone width; no horizontal overflow.
- Accessible colour: never encode meaning by colour alone — use direct labels and gaps as well.

---

## 16. EXPORTS

- **PDF report** — project header, cost abstract with charts, the full BOQ with subtotals, the BBS, the assumption ledger, coverage-check findings, and a sign-off block.
- **Excel workbook** — sheets: Summary BOQ, Detailed Measurement, BBS, Steel, Material Summary, Cost Abstract, Assumptions & Queries.
- **Exports must match the on-screen numbers exactly.** Amount cells carry real formulas that reproduce the displayed value.

---

## 17. THE SELF-IMPROVING SKILL LOOP

The tool must get measurably better after each real use. Implement this with **ordinary engineering — files, a database, and prompt assembly. Do not claim to fine-tune model weights.**

**17.1 Capture per run:** drawing fingerprint (discipline, building type, sheet types, region), what was extracted, what was assumed, what the user corrected, the rating, free-text comments, and **where the error originated**.

**17.2 Fixed error taxonomy** (closed and versioned) so feedback aggregates rather than accumulating anecdotes: misread dimension · missed element · wrong formula · wrong unit · wrong rate · wrong assumption · wrong measurement convention · out-of-scope inclusion.

**17.3 Layered learning artefacts:**
- a **lessons file** of durable rules distilled from repeated errors,
- a **per-discipline checklist** that grows as omissions are confirmed,
- a **pattern library** of drawing conventions seen before (this consultant tags columns this way),
- a **rate memory** by region and date,
- **frozen regression cases** — input/expected-output pairs from corrected runs.

**17.4 Distillation.** Raw feedback becomes a durable rule only via: a promotion threshold (never promote a one-off), deduplication against existing rules, explicit conflict resolution when a new lesson contradicts an old one, and a rule format carrying trigger condition, rule text, source runs and confidence.

**17.5 Re-entry.** Lessons load by relevance for the active discipline only, with bounded growth — cap the count, age out stale rules, merge near-duplicates. The prompt must not grow without limit.

**17.6 The guards — implement all of them.** A naive feedback loop gets worse, not better:
- **Provenance** on every rule (which runs produced it).
- **Quarantine** for unconfirmed lessons until the threshold is met.
- **Confidence decay** over time.
- **The regression suite gates every change** — a lesson that breaks a frozen case is rejected.
- **Feedback must never alter the deterministic calculation engine without a passing test.** The engine changes only through code review, never through accumulated user comments.
- **Precision monitoring** — a checklist rule whose confirmed-miss precision falls below 0.5 over 20 firings is muted and **reported as muted**, never silently dropped.
- Guard against one loud user overfitting the rules, and against a *wrong* user correction poisoning them.

**17.7 Feedback UX.** A line-item-level "this is wrong" control that captures **which** item and **why** (by taxonomy class), plus an optional comment. Minimum friction, usable signal.

**17.8 Metrics that prove learning:** element recall against a verified take-off, assumption rate per run, correction rate per run, regression pass rate, time-to-BOQ.

---

## 18. GUARDRAILS AND HONESTY

- No fabricated IS clause numbers.
- No invented dimensions.
- Rates labelled **indicative** unless the user supplies a rate basis.
- A visible statement, in the app and on every exported document carrying priced lines: **this is a tentative estimate requiring engineer verification.**
- No API key, token or credential in source, build output or logs. Provide a placeholder env file.
- State plainly where uploads and element records live, for how long, and whether they leave the device.
- If no reading layer is configured, say so on the upload screen and offer manual entry as an explicitly labelled degraded mode — never as a completed read.

---

## 19. DELIVERABLES AND ACCEPTANCE

**Hand back:** runnable code with a stated stack and run instructions; the deterministic engine with its passing test suite; a one-click worked demo that reproduces the headline numbers in your README; and a written, specific "what I did not implement" list.

**Acceptance checklist — each item binary:**
1. One command installs, one runs, one tests.
2. The calculation layer is a separate module; the import-graph test and the determinism test pass.
3. Golden tests pass using this spec's pinned numbers verbatim (2×2×0.4 pad → 1.600000 m³ and 3.200000 m²; the three plate cases → 14.586 / 14.586 / 3.140000 kg; column tie → 1.672000 m; n_laps boundary at 12.000 and 12.001; column C1 → 60.836320 kg measured).
4. Exactly one discipline is active per run; out-of-scope elements are registered and visible.
5. The whole set is read before any computation.
6. A missing dimension produces a **question naming element, sheet and blocked quantity** — not an invented number.
7. The assumption ledger exists in app, PDF and Excel; assumption-backed rows are visually marked.
8. The BOQ table has exactly the seven mandated columns, correctly named and ordered, with no Unit column.
9. Amount = displayed quantity × rate, identical across screen, PDF and Excel.
10. Both exports are real files and match the screen exactly.
11. The coverage check fires on a bare-footing set and stays quiet on a complete one.
12. All ten known traps have a test proving absence.
13. The learning loop runs with provenance, quarantine, a regression gate, and the engine-immutability guard.
14. The honesty statement appears in the app and on every priced export.

---

## 20. HOW TO RESPOND

1. **Start with a build plan, briefly** — at most 15 lines: the stack, the module layout, which disciplines get complete formula sets (all four packs ship populated either way), and the build order.
2. **Build the engine and its golden tests BEFORE the interface.** A build that implements a pretty interface over a stubbed engine does not outscore one that does the reverse — do not optimise as though it would.
3. **Then build, writing real files.** List the directory tree; paste only the engine, its tests, one discipline pack, and anything a reviewer cannot understand the architecture without. Never ship a placeholder function body silently.
4. **Do not ask me clarifying questions.** Choose sensible defaults, implement them, list them.
5. **End with three things:** Assumptions made (each with the default chosen), Not implemented (each with a one-line reason), and your self-assessment against the §19 checklist — each item marked met/not-met, with the file or test that proves it.
6. **Do not describe features you did not write.** Do not present a mockup as a running app, a stub as an engine, a comment as a test, or an empty JSON file as a learning loop. A build that names its gaps accurately is worth more than one claiming completeness it cannot demonstrate.

**If you cannot finish, cut from the bottom of the build order — never from the engine, its golden tests, the table contract, the provenance chain, or the honesty surfaces.**
