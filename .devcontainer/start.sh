#!/usr/bin/env bash
# Start backend + frontend each time the Codespace is attached. Guarded so a
# re-attach doesn't spawn duplicates. Ports 8000/5173 auto-forward; open the
# forwarded 5173 ("BOQ Creator (web app)") in your browser.
set -uo pipefail
cd "$(dirname "$0")/.."

if ! pgrep -f "uvicorn app.main:app" >/dev/null; then
  echo "==> Starting backend on :8000"
  ( cd backend && source .venv/bin/activate && \
    uvicorn app.main:app --host 0.0.0.0 --port 8000 ) >/tmp/boq-backend.log 2>&1 &
fi

if ! pgrep -f "vite" >/dev/null; then
  echo "==> Starting frontend on :5173"
  ( cd frontend && npm run dev ) >/tmp/boq-frontend.log 2>&1 &
fi

echo "==> BOQ Creator is starting. Open the forwarded port 5173 in your browser."
echo "    Logs: /tmp/boq-backend.log  /tmp/boq-frontend.log"
