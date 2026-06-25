# BOQ Creator

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/argaurshar/boq-creator)

Upload architectural & structural drawings → get a complete, IS-code **Bill of
Quantities** back, in-app and as Excel. Architects/engineers stay in control:
the AI only *reads* drawings into typed structural members; a deterministic,
unit-tested engine does **all** the arithmetic, so every quantity is auditable.

> **Run it on GitHub in one click:** press the **Open in Codespaces** badge
> above (or *Code ▸ Codespaces ▸ Create codespace*). Dependencies install
> automatically and both servers start; when prompted, open the forwarded
> **port 5173** to use the app. Then click **+ Project → Load demo data**.

> **Read [`project.md`](./project.md) first — it is the soul of the project.**
> It defines the one principle everything follows from: *a hard wall between AI
> (extraction only) and arithmetic (deterministic IS-code formulas)*.

## What it does

- **Departments**: concrete & RCC, formwork, reinforcement (Bar Bending
  Schedule), structural/MS steel, earthwork (excavation / backfill / surplus),
  brickwork, plaster — following IS 1200 / IS 456 / IS 800 / SP 34 conventions.
- **AI-assisted, engineer-verified**: AI extracts members from vector PDFs
  (image + schedule tables); you review, edit and verify before anything is final.
- **Plain-English editing**: e.g. *"add 5 columns 300x600 3m high with 8-16mm
  bars M25"* → proposed quantities → Apply.
- **Auditable**: every line item shows its formula, inputs and IS clause.
- **Excel export**: CPWD/DSR-style BOQ + Bar Bending Schedule + Assumptions,
  with live `Quantity × Rate` formulas.

## Architecture

```
backend/   FastAPI + deterministic quantity engine (engine/ = pure, no AI)
frontend/  React + Vite (3-pane workspace: drawings | BOQ | chat & rates)
```

The `Member` (a typed structural element) is the single source of truth. AI / NL
/ forms all produce `Member`s; the engine recomputes quantities on demand.

## Run it

### Backend (Python 3.11+)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Runs key-free by default (`AI_PROVIDER=mock`): plain-English add, manual add,
quantities, rates and Excel export all work. For automatic drawing extraction,
set `AI_PROVIDER=claude` and `ANTHROPIC_API_KEY` (see `.env.example`).

### Frontend

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173 (proxies /api to :8000)
```

### Tests

```bash
cd backend && source .venv/bin/activate && pytest -q
```

`tests/test_engine.py` locks the IS-code formulas to golden numbers;
`tests/test_api.py` covers the API end-to-end with the mock provider.

## Status

MVP: the full vertical slice works (extract → compute → verify → rate → export)
across all categories. See `project.md` §9 for the roadmap (BBS hardening,
scanned-PDF fallback, DSR rate libraries, auth, background jobs).

> AI-assisted output is a **draft for engineer verification**, not a substitute
> for a qualified quantity surveyor.
