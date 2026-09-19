# BOQ Creator

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/argaurshar/boq-creator)

Upload architectural & structural drawings → get a complete, IS-code **Bill of
Quantities** back, in-app and as Excel. Architects/engineers stay in control:
the AI only *reads* drawings into typed structural members; a deterministic,
unit-tested engine does **all** the arithmetic, so every quantity is auditable.

> **Live (GitHub Pages):** **https://argaurshar.github.io/boq-creator/** — a
> fully static build that runs the entire quantity engine, BOQ, Excel export and
> NL editing **in your browser** (no server, nothing to install). Data is saved
> in your browser; live AI drawing extraction (upload one or more PDFs, read
> page-by-page with Claude) uses your own Anthropic key via **🔑 Set AI key**.
>
> **Or run the full app on GitHub in one click:** press the **Open in
> Codespaces** badge above (or *Code ▸ Codespaces ▸ Create codespace*).
> Dependencies install automatically and both servers start; open the forwarded
> **port 5173**. Then click **+ Project → Load demo data**.

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
quantities, rates and Excel export all work.

For **live AI drawing extraction** you need an AI key. Two ways:

- **In the app (recommended for shared/hosted instances):** click
  **🔑 Set AI key** in the top bar and paste your key. It is stored only in
  your browser and sent to the backend per request — never saved server-side —
  so the host can stay key-less and each user brings their own.
- **Server-side:** set `AI_PROVIDER=claude` and `ANTHROPIC_API_KEY` in the
  environment (see `.env.example`).

### Which key? Anthropic or kie.ai

The app speaks the Anthropic **Messages API**, and two hosts serve it. Paste
either key — the prefix picks the endpoint, so there is nothing else to
configure:

| Key | Provider | Endpoint | Sent as | Get one |
| --- | --- | --- | --- | --- |
| `sk-ant-…` | Anthropic (direct) | `https://api.anthropic.com/v1/messages` | `x-api-key` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `sk-kie-…` | [kie.ai](https://kie.ai) — same Claude models on kie.ai credits | `https://api.kie.ai/claude/v1/messages` | `Authorization: Bearer` | [kie.ai/api-key](https://kie.ai/api-key) |

Paste the key however your provider gives it to you — a bare key, a quoted
one, `Bearer sk-kie-…`, or the whole `export ANTHROPIC_API_KEY="Bearer sk-kie-…"`
line from kie.ai's setup guide. The 🔑 dialog shows which provider it detected
before you save.

A recognised key always goes to the provider that issued it: the three provider
chips only decide where a key with an **unfamiliar** prefix is sent, so the app
can never hand your Anthropic key to another host (or the reverse). Server-side
the same detection applies to `ANTHROPIC_API_KEY`; `AI_API_PROVIDER=anthropic|kie`
and `ANTHROPIC_BASE_URL` pin where the *server's own* key goes and are ignored
for a key a user brings from the browser.

#### When a gateway says "500 Internal error"

A gateway can take the key, allow the browser, and still refuse the one request
the app needs to make — because it does not serve the model id we send, caps
the reply length below what a page read asks for, or does not accept images.
All three come back as the same opaque 500.

**🔑 AI key → Test connection** takes them apart. It asks the host for its model
catalogue (`GET /v1/models`), then sends a few one-word requests: one on the
model you picked, a descending reply-length ladder (16k → 8k → 4k → 1k), and one
carrying a tiny image. It reports which step failed, and fixes what it can:

- a model the host does serve is offered as a chip — click it to use it;
- the reply-length ceiling it finds is remembered per provider, and every later
  call asks for no more than that;
- if the host will not take images, it says so — that host cannot read drawings,
  though chat and manual entry still work.

The probes cost a few tokens in total (each asks for one word, so a high
`max_tokens` is only a ceiling, never a bill).

Whatever model you choose is what gets sent. The two models in the picker are a
convenience, not a catalogue: a gateway may serve ids we have never heard of,
and silently substituting one of ours would hide "not served here" behind an
answer from a different model. The choice is remembered **per provider**, so a
gateway-only id never follows you to the other host, and a measured reply
ceiling is forgotten as soon as the key changes — another key can be another
plan.

Heavy drawings are handled before they are sent: a page that encodes larger
than the provider will accept is re-rendered smaller (down to a legibility
floor) rather than failing the run.

Browser calls go straight from your browser to that provider, so the provider
has to allow it (CORS). Anthropic does. If a gateway does not, no client-side
setting can change that — the app says so plainly instead of showing "Failed to
fetch", and everything that needs no key (chat parsing, demo data, manual entry,
rates, exports) keeps working.

### Frontend

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173 (proxies /api to :8000)
```

### Hosting on GitHub Pages (static, no backend)

The frontend ships a **self-contained build**: the quantity engine, BOQ
assembly, cross-member netting, Excel export and NL parsing are ported to
TypeScript and run entirely in the browser (`frontend/src/engine/`). The ported
engine is verified to produce **the same numbers** as the Python engine. This is
what's deployed to GitHub Pages by `.github/workflows/pages.yml` on every push
to `main`.

To enable it once: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. The site then publishes to `https://<user>.github.io/boq-creator/`.
Data is stored per-browser (localStorage); the AI key (Anthropic or kie.ai) is
entered in the UI and kept only in the browser.

The Python backend remains for local/Codespaces use and as the reference
implementation the tests pin; the Pages build does not need it.

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
