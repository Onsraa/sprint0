#!/usr/bin/env bash
# sprint0 — one-command setup. Fill .env, run this, and the demo is live.
#
#   cp .env.example .env   # then fill in your secrets
#   ./scripts/bootstrap.sh
#
# Re-runnable: every run RESETS to a clean, freshly-seeded state (drops the Mongo demo DB +
# deletes dispatched GitLab projects), then launches the gateway + frontend.
#
#   -y, --yes          skip the "this will reset" confirmation
#   --setup-only       set up + seed, but don't launch the servers (prints the run commands)
set -euo pipefail

cd "$(dirname "$0")/.."

G="\033[32m"; Y="\033[33m"; R="\033[31m"; D="\033[2m"; BLD="\033[1m"; RST="\033[0m"
step() { printf "\n${BLD}» %s${RST}\n" "$1"; }
ok()   { printf "${G}✓ %s${RST}\n" "$1"; }
warn() { printf "${Y}⚠ %s${RST}\n" "$1"; }
die()  { printf "${R}✗ %s${RST}\n" "$1" >&2; exit 1; }
envval() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }

YES=0; RUN=1
for a in "$@"; do
  case "$a" in
    -y|--yes) YES=1 ;;
    --setup-only|--no-run) RUN=0 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $a (try --help)" ;;
  esac
done

# ── 1) tools ──────────────────────────────────────────────────────────────────
step "Checking tools"
need() { command -v "$1" >/dev/null 2>&1 || die "missing '$1' — $2"; }
need docker "install Docker Desktop (docker.com)"
need uv "install: curl -LsSf https://astral.sh/uv/install.sh | sh"
need node "install Node 18+ (nodejs.org)"
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm missing → enabling via corepack"
  corepack enable >/dev/null 2>&1 || npm i -g pnpm >/dev/null 2>&1 || die "could not install pnpm (npm i -g pnpm)"
fi
ok "docker · uv · node · pnpm"

# ── 2) .env ───────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  warn "created .env from .env.example — fill in your secrets, then re-run this script:"
  printf "    ${D}%s${RST}\n" "GEMINI_API_KEY · VOYAGE_API_KEY · MONGODB_URI · GITLAB_TOKEN · GITLAB_DEMO_GROUP"
  exit 1
fi
ok ".env present"

# ── 3) Atlas Local (Docker) — only when the URI is local ──────────────────────
URI="$(envval MONGODB_URI)"
if printf '%s' "$URI" | grep -qE 'localhost|127\.0\.0\.1'; then
  PORT="$(printf '%s' "$URI" | sed -nE 's#.*://[^/]*:([0-9]+).*#\1#p')"; [ -n "$PORT" ] || PORT=27018
  step "Ensuring Atlas Local container (sprint0-atlas → :$PORT)"
  if ! docker ps -a --format '{{.Names}}' | grep -qx sprint0-atlas; then
    docker run -d --name sprint0-atlas -p "${PORT}:27017" mongodb/mongodb-atlas-local:latest >/dev/null
    ok "created sprint0-atlas"
  elif ! docker ps --format '{{.Names}}' | grep -qx sprint0-atlas; then
    docker start sprint0-atlas >/dev/null; ok "started sprint0-atlas"
  else
    ok "sprint0-atlas already running"
  fi
else
  step "MONGODB_URI is remote → skipping local container"
fi

# ── 4) python deps ────────────────────────────────────────────────────────────
step "Syncing Python deps (uv sync)"
uv sync
ok "deps synced"

# ── 5) preflight: secrets · mongo ping · gitlab group ─────────────────────────
step "Preflight"
uv run python scripts/setup_check.py preflight

# ── 6) confirm the reset (destructive) ────────────────────────────────────────
GRP="$(envval GITLAB_DEMO_GROUP)"; DBN="$(envval MONGODB_DB)"; [ -n "$DBN" ] || DBN=sprint0
if [ "$YES" -ne 1 ]; then
  printf "\n${Y}This RESETS the demo:${RST} drop Mongo DB ${BLD}%s${RST} + delete dispatched projects in GitLab group ${BLD}%s${RST}.\n" "$DBN" "$GRP"
  printf "Continue? [y/N] "; read -r ans
  case "$ans" in y|Y|yes|YES) ;; *) die "aborted (no changes made)" ;; esac
fi

# ── 7) reset · 8) seed agency · 9) seed team · 10) wait for indexes ───────────
step "Resetting to a clean slate"
uv run python scripts/setup_check.py reset
step "Seeding agency memory (3 repos + embeddings + vector indexes)"
uv run python scripts/seed_agency.py
step "Seeding the demo team (5 accounts + the busy SE's project)"
uv run python scripts/seed_team.py
step "Waiting for search indexes to come READY"
uv run python scripts/setup_check.py wait

# ── 11) frontend deps ─────────────────────────────────────────────────────────
step "Installing frontend deps (pnpm install)"
( cd frontend && pnpm install --silent )
ok "frontend deps installed"

# ── 12) launch (or print the run commands) ────────────────────────────────────
GPORT="$(envval ORCHESTRATOR_PORT)"; [ -n "$GPORT" ] || GPORT=8000
printf "\n${G}${BLD}✓ sprint0 is set up and seeded.${RST}\n"
if [ "$RUN" -ne 1 ]; then
  cat <<EOF

Start it in two terminals:
  1) PYTHONPATH=orchestrator uv run uvicorn app.main:app --port ${GPORT}
  2) cd frontend && pnpm dev
Then open http://localhost:5173 and click "Try Demo".
EOF
  exit 0
fi

step "Launching gateway (:$GPORT) + frontend (:5173) — Ctrl-C stops both"
PYTHONPATH=orchestrator uv run uvicorn app.main:app --port "$GPORT" --host 127.0.0.1 &
GW=$!
( cd frontend && pnpm dev ) &
FE=$!
trap 'printf "\n${Y}stopping…${RST}\n"; kill "$GW" "$FE" 2>/dev/null || true; wait 2>/dev/null || true; exit 0' INT TERM
printf "\n${G}→ open ${BLD}http://localhost:5173${RST}${G}  (click \"Try Demo\")${RST}\n\n"
wait
