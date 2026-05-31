#!/usr/bin/env bash
# One command to run the TrailLog demo: venv -> install -> serve.
set -euo pipefail
cd "$(dirname "$0")"

python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

echo ""
echo "TrailLog running -> open http://127.0.0.1:8000"
echo ""
exec uvicorn app.main:app --reload --port 8000
