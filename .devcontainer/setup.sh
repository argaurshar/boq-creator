#!/usr/bin/env bash
# One-time setup for the Codespace: install backend + frontend dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing backend dependencies"
cd backend
python -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate

echo "==> Installing frontend dependencies"
cd ../frontend
npm install

echo "==> Setup complete."
