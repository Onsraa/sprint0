#!/usr/bin/env bash
# sprint0 — one command to clean your LIVE test session and restart the gateway, so you don't wipe by hand.
#
#   ./scripts/reset.sh          session clean: wipe your relays/briefs/tasks/contracts, KEEP the corpus  [fast]
#   ./scripts/reset.sh --full   ALSO reseed the agency corpus + team (only when the seed itself changed)  [slow]
#
# Always: stops the gateway, clears GitLab's dispatched projects (keeps the topic-tagged agency repos),
# restarts the gateway LIVE, prints health. After it finishes — refresh the browser.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── stopping gateway ──"
pkill -9 -f "uvicorn app.main" 2>/dev/null || true
sleep 2

if [[ "${1:-}" == "--full" ]]; then
  echo "── full reseed: agency corpus + team (clears + reseeds Mongo + GitLab) ──"
  uv run python scripts/seed_agency.py
  uv run python scripts/seed_team.py
else
  echo "── wiping session (corpus kept) ──"
  uv run python scripts/reset_session.py
  echo "── clearing GitLab dispatched projects (agency seed repos stay) ──"
  PYTHONPATH=orchestrator uv run python -c "from app import gitlab as gl; print('  reset_demo ->', gl.reset_demo())"
fi

echo "── restarting gateway (live) ──"
PYTHONPATH=orchestrator nohup uv run uvicorn app.main:app --port 8000 > /tmp/sprint0-gateway.log 2>&1 &
sleep 9
echo -n "── health: "; curl -s http://localhost:8000/health || echo "(gateway not up yet — check /tmp/sprint0-gateway.log)"
echo
echo "✓ done — refresh the browser"
