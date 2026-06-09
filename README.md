# sprint0 — agentic GitLab orchestrator

Drop a messy client brief → sprint0 plans it, **grounds it in agency memory** (past projects + reusable code, via **MongoDB Atlas Vector Search + hybrid retrieval**), runs it through a **relay** where each discipline lead ratifies their slice, then **dispatches a real GitLab project** — group, repo, board, boilerplate, and micro-contexted issues with native assignees. Reasoning by **Gemini on Vertex AI**; data + retrieval over the **MongoDB MCP**.

## Scope — what it is, what it isn't
sprint0 is an **orchestration brain, not a code-writing agent**. It plans, estimates, and staffs delivery — decomposing a brief into a discipline relay, grounding every call in agency memory, and routing work by skill, availability, and trust — while a human ratifies each gate. It reasons over *memory and decisions*, **not your source tree**: it never reads or writes your implementation. Greenfield intake (brief → grounded plan → relay → real GitLab project) is the core flow. Mid-prod feature-adds ground on the project's locked stack, its existing issues, and **its own prior ratified decisions** — so the system *compounds* (memory → ratify → verify → reuse) instead of re-deciding from scratch. The partner integration is load-bearing by design: **MongoDB, via the official MCP**, *is* that memory — hybrid vector + full-text retrieval grounds the plan, and shipped projects + ratified decisions flow back in.

## Layout
| Path | What |
|---|---|
| `orchestrator/app/` | FastAPI gateway — brief/CV intake, RAG (Mongo MCP), Gemini reasoning, relay, assignment, GitLab executor |
| `frontend/` | Vite + React + TS — login, brief drop, relay board, staffing, per-account dev/QA views |
| `scripts/` | Seeds (`seed_agency`, `seed_team`), end-to-end smoke (`demo_e2e`), probes |
| `seed/` | Agency repos + sample briefs (the demo's past-project memory) |
| `docs/` | Design spec + provisioning |

## Architecture
```
React (Vite) ─REST/WS─▶ FastAPI gateway
                          ├─ REASON: Gemini (Vertex) → validated PlanJSON, grounded on memory
                          ├─ relay (discipline-lead ratification DAG) + availability/trust assignment
                          └─ EXECUTE: batched GitLab REST
        MCP ▼                                   ▼ httpx
   MongoDB (Atlas Vector + full-text,     GitLab.com (group/repo/board/issues,
   hybrid retrieval + code-RAG)            native assignees, focus branches)
```
**Core principle:** REASON (Gemini → validated JSON, no tool-loop) is split from EXECUTE (the gateway drives batched calls) — deterministic, no timeouts. MongoDB is the brain: hybrid (vector + full-text) retrieval grounds every plan, merges grow per-discipline trust, and shipped projects flow back into memory.

## Quickstart (one command)
Fill in your secrets, run one script — it provisions everything end-to-end.
1. `cp .env.example .env`, then fill the five secrets: `GEMINI_API_KEY`, `VOYAGE_API_KEY`, `MONGODB_URI`, `GITLAB_TOKEN`, `GITLAB_DEMO_GROUP`.
2. `./scripts/bootstrap.sh`

It checks your tools, starts a local MongoDB (Atlas Local in Docker), resets to a clean slate, seeds the agency memory + the 5-account demo team, waits for the search indexes to come online, installs the frontend, then launches both servers. Open **http://localhost:5173** and click **Try Demo**.

Re-runnable — every run resets to a fresh seeded state. Flags: `-y` skips the reset confirmation; `--setup-only` provisions without launching. Prereqs: Docker, [`uv`](https://docs.astral.sh/uv/), Node 18+ (pnpm is auto-enabled via corepack). A local `MONGODB_URI` (e.g. `mongodb://localhost:27018/?directConnection=true`) makes the script manage the Atlas Local container for you; a remote Atlas URI is used as-is.

<details><summary>Manual setup</summary>

1. `cp .env.example .env` and fill it — Gemini/Vertex, Voyage (embeddings), MongoDB, GitLab token + demo group.
2. Bring up MongoDB — Atlas cloud, or **Atlas Local** (Docker) for uncapped search indexes.
3. Seed memory + team: `uv run python scripts/seed_agency.py && uv run python scripts/seed_team.py`
4. Gateway: `PYTHONPATH=orchestrator uv run uvicorn app.main:app --port 8000`
5. Frontend: `cd frontend && pnpm dev`
</details>

_Working demo — the agency brain that compounds: **memory → ratify → verify → compound**._
