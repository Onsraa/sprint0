"""sprint0 gateway (Phase 4) — FastAPI.

Wires the REASON pipeline (`app.reason.run_brief`) and the EXECUTE step
(`app.execute.execute_plan`) behind the REST/WS API the frontend calls.
In-memory stores (demo-grade). Reason needs Atlas reachable on :27017;
execute hits GitLab over 443. Developers are canned for now (Atlas read = TODO).
"""
from __future__ import annotations

import asyncio
import difflib
import io
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from google.genai.errors import ClientError

from pydantic import BaseModel

from app import agreements, auth, canned, const, corpus, dedup, demo, eventlog, gitlab, gitlab_hooks, grading, graph, handoff, lineage, policy, relay, routing, runtime, scheduler, solutions as soln, staffing, strategist, tasks as tasklib, team
from app.canned import CANNED_DEVELOPERS
from app.contracts import (
    AccessGrant, Agreement, InterfaceDraft, ApproveRequest, ArchitectureOptions, ChangeEvent, ClarifiedSpec, ClarifyResolution, Constraints,
    Decision, DeveloperProfile, DispatchRequest, FeatureRequest, IntegrationSignal, Notification, NotificationType, PlanJSON,
    PlanRequest, ProjectRecord, QAReport, QAQueue, QAQueueEntry, RatifyRequest, RelayState, Task, UserSubscription,
    ContextScope, DecisionCard, Discipline, DriftReport, GovernanceRule, GraphEdge, GraphNode, ImpactedTask, RescheduleProposal,
    SolutionCard, SolutionSet,
)
from app.agent import AIOutputError, AITimeoutError, DECISION_DOMAIN_CONSTRAINTS, generate_conflict, generate_decision_card, generate_shape
from app.execute import execute_plan, extend_project, focus_command_for, reserve_project, scaffold_project
from app.graphstore import store
from app.rag import (
    access_grants_for_subject, access_grants_for_requester, all_project_records, decisions_by_owner,
    all_decisions, decisions_for_project, delete_decision, get_decision, update_decision,
    save_graph, graph_nodes, graph_edges, save_governance_rule, all_governance_rules,
    all_profiles, update_profile,
    save_subscription, delete_subscription, subscriptions_of, watchers_of,
    get_access_grant, get_project_record, past_projects, record_merge, set_developer_discipline,
    save_access_grant, save_decision, save_notification, notifications_for_user, mark_all_read,
    notification_exists, dedup_notifications, delete_notification,
    save_project_record, update_access_grant, update_project_record,
    all_events, all_tasks, delete_tasks_for_project, get_task, mongo_close, save_event, save_tasks,
    tasks_for_project, update_task,
    save_reschedule_proposal, open_reschedule_proposals,
    get_reschedule_proposal, update_reschedule_proposal,
    save_agreement, agreements_for_plan, agreements_for_ratifier, get_agreement, update_agreement, all_agreements, reuse_pack,
    reset_demo_agreements, reset_demo_tasks, reset_demo_projects, reset_demo_graph, reset_demo_notifications,
    reset_demo_events, embed_queries, embed_document, code_chunks_for_project, upsert_code_chunk,
    save_state, delete_state, load_states, reset_demo_session,
)
from app.reason import (
    clarify_brief, close_project, delta_brief, judge_memory, link_gitlab, onboard_developer, propose_acceptance,
    propose_architectures, propose_contract_options, propose_solutions, qa_review, reconcile_links,
    regenerate_slice, run_brief,
)

app = FastAPI(title="sprint0", version="0.4.0")


@app.exception_handler(AIOutputError)
async def _ai_output_error(_request, exc: AIOutputError) -> JSONResponse:
    """A model returned schema-invalid output → 502 (a clean upstream-failure signal), not a 500."""
    return JSONResponse(status_code=502, content={"detail": str(exc)})


class _LiveGateMiddleware:
    """Per-request demo/live flag from the `X-Sprint0-Live` header. Pure ASGI (not BaseHTTPMiddleware)
    so the contextvar it sets is visible to the endpoint + the agent calls in the same task. Covers
    every route, including the unauthenticated ones, with no endpoint signature changes."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            supplied = None
            for k, v in scope.get("headers", []):
                if k == b"x-sprint0-live":
                    supplied = v.decode("latin-1")
                    break
            demo.set_live(demo.token_ok(supplied))
        await self.app(scope, receive, send)


app.add_middleware(_LiveGateMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
        # FRONTEND_ORIGIN may be a comma-list — a Cloud Run service answers on BOTH its URL formats
        # (PROJECTNUM.REGION.run.app and SERVICE-HASH.REGION.a.run.app), so allow each.
        *[o.strip() for o in os.getenv("FRONTEND_ORIGIN", "").split(",") if o.strip()],
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ClientError)
async def _genai_error(_request, exc: ClientError) -> JSONResponse:
    """Degrade gracefully when the AI provider rate-limits / exhausts quota — a 429 mid-demo
    should return a clean message, not a 500 stack trace."""
    code = getattr(exc, "code", 502) or 502
    if code == 429:
        return JSONResponse(status_code=503, content={"detail": "AI quota / rate-limit hit — retry shortly."})
    return JSONResponse(status_code=502, content={"detail": f"AI provider error ({code})."})


@app.exception_handler(AITimeoutError)
async def _genai_timeout(_request, exc: AITimeoutError) -> JSONResponse:
    """A hung model stream hit the per-attempt deadline — clean 504 the wizard can toast + retry."""
    return JSONResponse(status_code=504, content={"detail": "AI call timed out — retry."})


# ── Rate-limit for the PUBLIC (unauthenticated) AI intake endpoints ──
# clarify + architectures stay open by design (demo "drop a brief"), so cap anonymous Gemini
# cost/quota abuse with a sliding window. Two layers: a per-(ip,user) bucket so NAT'd teammates don't
# starve each other, under a per-IP HARD ceiling so a spoofed username (auth is header-only) can't mint
# fresh buckets to bypass the cap. Per-worker (in-process); swap to Redis if multi-worker.
_AI_RATE_MAX = 5                          # calls allowed per (ip, user) bucket
_AI_RATE_IP_MAX = _AI_RATE_MAX * 3        # hard ceiling per IP across ALL usernames (anti username-rotation)
_AI_RATE_WINDOW_S = 60                    # sliding window seconds
_ai_calls: dict[str, list[float]] = {}    # f"{ip}|{user}" → call times
_ai_calls_ip: dict[str, list[float]] = {} # ip → call times (the ceiling)


def _ai_throttle(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    user = (request.headers.get("X-Sprint0-User") or "").strip() or "-"
    now = time.monotonic()
    ip_recent = [t for t in _ai_calls_ip.get(ip, []) if now - t < _AI_RATE_WINDOW_S]
    bucket = f"{ip}|{user}"
    recent = [t for t in _ai_calls.get(bucket, []) if now - t < _AI_RATE_WINDOW_S]
    if len(recent) >= _AI_RATE_MAX or len(ip_recent) >= _AI_RATE_IP_MAX:
        raise HTTPException(429, "rate limited — too many AI requests, retry shortly")
    recent.append(now)
    ip_recent.append(now)
    _ai_calls[bucket] = recent
    _ai_calls_ip[ip] = ip_recent


# Demo-grade in-memory stores.
BRIEFS: dict[str, str] = {}
SPECS: dict[str, ClarifiedSpec] = {}
ARCHS: dict[str, ArchitectureOptions] = {}  # brief_id → cached architecture options (wizard resume, no Gemini re-run)
PLANS: dict[str, PlanJSON] = {}
RELAYS: dict[str, RelayState] = {}
RESULTS: dict[str, dict] = {}
DELTA_TARGET: dict[str, int] = {}  # plan_id → existing project_id (mid-prod delta plans extend, not create)
RESERVED: dict[str, dict] = {}  # plan_id → reserve result (project_id/web_url/clone_url/default_branch) — two-phase create
DELTA_PRIORITY: dict[str, str] = {}  # plan_id → feature priority (urgent → its tasks preempt planned work)
PROJECTS: dict[int, PlanJSON] = {}  # project_id → live plan (for QA review + mid-prod, this session)
REQA: dict[int, set] = {}  # project_id → reopened issue iids awaiting re-QA (the reject→fix→re-QA loop)
SOLUTIONS: dict[tuple[str, str], SolutionSet] = {}  # (plan_id, discipline) → cached reuse-or-innovate set (lazy)
CHOSEN: dict[tuple[str, str], SolutionCard] = {}    # (plan_id, discipline) → the ratified solution pick
FOCUS_CONTEXTS: dict[str, dict] = {}                 # issue_id → {docs, reused pointers} served by /api/focus (never committed)

# Per-plan lock serializing reserve + scaffold: their idempotency guards (RESERVED / RELAYS-absent) check
# then await GitLab, so two concurrent callers (double-clicked Create; last-gate ratify racing a manual
# dispatch) could BOTH pass the guard and create twice. The loser now re-checks after the winner finishes.
_DISPATCH_LOCKS: dict[str, asyncio.Lock] = {}


def _dispatch_lock(plan_id: str) -> asyncio.Lock:
    return _DISPATCH_LOCKS.setdefault(plan_id, asyncio.Lock())


# Fire-and-forget background work (pre-generation, contract drafting). asyncio only keeps a WEAK reference
# to a created task — an unreferenced one can be garbage-collected mid-flight (the docs say to keep a ref).
_BG_TASKS: set[asyncio.Task] = set()


def _spawn(coro) -> asyncio.Task:
    """create_task + a strong reference until done — the ONLY way background work is launched here."""
    t = asyncio.create_task(coro)
    _BG_TASKS.add(t)
    t.add_done_callback(_BG_TASKS.discard)
    return t


_BRIEF_MAX_CHARS = 20_000


# ── Durability: the workflow dicts above stay the fast read cache (hot paths never hit Mongo), but every
# WRITE also persists THROUGH to the SessionState collection so a restart loses nothing. Rehydrated on
# startup. Best-effort — a snapshot write never fails the request, but a failure is LOGGED: silent
# no-persistence means "Saved ✓" in the UI while the data lives in RAM only (Atlas M0 idle-pause hits this).
_persist_log = logging.getLogger("sprint0.persist")


async def _persist(store: str, key, value: dict) -> None:
    try:
        await save_state(store, str(key), value)
    except Exception as exc:
        _persist_log.warning("session-state write FAILED (%s/%s): %s — in-memory only until Mongo recovers", store, key, exc)


async def _unpersist(store: str, key) -> None:
    try:
        await delete_state(store, str(key))
    except Exception as exc:
        _persist_log.warning("session-state delete failed (%s/%s): %s", store, key, exc)


async def _persist_relay(plan_id: str) -> None:
    """Snapshot the in-flight plan + relay after an in-place mutation (ratify/handoff/integration-flag)."""
    if plan_id in PLANS:
        await _persist("plans", plan_id, PLANS[plan_id].model_dump())
    if plan_id in RELAYS:
        await _persist("relays", plan_id, RELAYS[plan_id].model_dump())


async def _store_focus_contexts(plan: PlanJSON, pointers: dict[str, list[dict]]) -> None:
    """Persist each code/infra issue's focus context (rendered DOCS + reuse POINTERS) keyed by issue id so the
    /api/focus bootstrap can serve it on checkout. Reused CODE is NOT stored — the endpoint fetches it live
    from the pointers. Nothing is committed to the repo, so a merge into main carries no sprint0.
    KNOWN FLAW: this store is never garbage-collected (entries are tiny — docs + URLs — but unbounded)."""
    for epic in plan.epics:
        for issue in epic.issues:
            if (issue.kind or "code") not in ("code", "infra"):
                continue
            ptrs = pointers.get(issue.id) or []
            ctx = {"docs": handoff.render_focus_docs(issue, ptrs), "reused": ptrs}
            FOCUS_CONTEXTS[issue.id] = ctx
            await _persist("focus", issue.id, ctx)


async def _rehydrate_session() -> None:
    """LIVE startup: rebuild the in-memory workflow dicts from their durable SessionState snapshots, so an
    in-flight wizard / open relay / reserved project / re-QA queue / attribution queue survives a restart."""
    async def _load(store: str) -> dict:
        try:
            return await load_states(store)
        except Exception:
            return {}

    for bid, v in (await _load("briefs")).items():
        BRIEFS[bid] = v.get("v", "")
    for bid, v in (await _load("specs")).items():
        try: SPECS[bid] = ClarifiedSpec(**v)
        except Exception: pass
    for bid, v in (await _load("archs")).items():
        try: ARCHS[bid] = ArchitectureOptions(**v)
        except Exception: pass
    for pid, v in (await _load("plans")).items():
        try: PLANS[pid] = PlanJSON(**v)
        except Exception: pass
    for iid, v in (await _load("focus")).items():
        if isinstance(v.get("docs"), dict):
            FOCUS_CONTEXTS[iid] = {"docs": v["docs"], "reused": v.get("reused") or []}
    for pid, v in (await _load("relays")).items():
        try: RELAYS[pid] = RelayState(**v)
        except Exception: pass
    for pid, v in (await _load("results")).items():
        RESULTS[pid] = v
    for pid, v in (await _load("reserved")).items():
        RESERVED[pid] = v
    for pid, v in (await _load("delta_target")).items():
        try: DELTA_TARGET[pid] = int(v["v"])
        except Exception: pass
    for pid, v in (await _load("delta_priority")).items():
        DELTA_PRIORITY[pid] = v.get("v", "normal")
    for k, v in (await _load("chosen")).items():
        try:
            _pid, _disc = const.split_persist_key(k)
            CHOSEN[(_pid, _disc)] = SolutionCard(**v)
        except Exception: pass
    for k, v in (await _load("solutions")).items():
        try:
            _pid, _disc = const.split_persist_key(k)
            SOLUTIONS[(_pid, _disc)] = SolutionSet(**v)
        except Exception: pass
    for pid, v in (await _load("reqa")).items():
        try: REQA[int(pid)] = set(v.get("v", []))
        except Exception: pass
    _att = (await _load("attributions")).get("_all")
    if _att and isinstance(_att.get("v"), list):
        ATTRIBUTIONS[:] = _att["v"]


def _dev_trust() -> dict[str, dict]:
    """username / gitlab_username → {trust: per-discipline dict, trust_level} for relay auto-pass."""
    out: dict[str, dict] = {}
    for mbr in team.all_members() or CANNED_DEVELOPERS:
        entry = {"trust": getattr(mbr, "trust", {}) or {}, "trust_level": mbr.trust_level}
        out[mbr.username if hasattr(mbr, "username") and mbr.username else mbr.gitlab_username] = entry
        out[mbr.gitlab_username] = entry
    return out


_DEFAULT_DIAL = 70  # the product-default Trust Dial; used to render a gate's tier when none is set


async def _routing_edges() -> list | None:
    """Best-effort graph edges (the local backend Graph A) for blast-radius routing. None when no
    graph is built → the router reduces to today's dial check; otherwise blast-aware routing kicks in."""
    try:
        edges = [GraphEdge(**e) for e in await graph_edges("local")]
        return edges or None
    except Exception:
        return None


_HEALTH_MONGO = None


def _mongo_ok() -> bool:
    """Cheap liveness ping of the MCP's backing store (Atlas Local). Lazy, pooled client, 800ms cap —
    if Mongo is unreachable the MCP path is dead too, so this is the honest signal behind the UI dot."""
    global _HEALTH_MONGO
    uri = os.getenv("MONGODB_URI", "")
    if not uri:
        return False
    try:
        if _HEALTH_MONGO is None:
            from pymongo import MongoClient
            _HEALTH_MONGO = MongoClient(uri, serverSelectionTimeoutMS=800)
        _HEALTH_MONGO.admin.command("ping")
        return True
    except Exception:
        return False


@app.get("/health")
def health() -> dict:
    ok = _mongo_ok()
    return {"status": "ok" if ok else "degraded", "service": "sprint0", "mongo": ok, "ok": ok, "demo_mode": demo.DEMO_MODE}


async def _seed_demo() -> None:
    """DEMO_MODE: populate the in-mem stores from CANNED_PLAN so the public URL shows a full
    workspace with zero Atlas/GitLab — the login roster, an active project + its relay, and
    materialized tasks (a spread of statuses, including Done so the Record-merge beat is live)."""
    await team.refresh()  # demo: loads CANNED_ROSTER into the cache (login + assignee/lead resolution)
    now = datetime.now(timezone.utc).isoformat()
    plan = canned.DEMO_PLAN.model_copy(deep=True)  # already seated on the demo roster (canned._seat_plan)
    pid, plan_id = canned.DEMO_PROJECT_ID, canned.DEMO_PLAN_ID
    PLANS[plan_id] = plan
    PROJECTS[pid] = plan
    RELAYS[plan_id] = relay.build_relay(plan)  # gates start pending (stage-0) / locked (downstream) — NO auto-pass; the human ratifies each
    reset_demo_agreements()
    # Contract-first: the canned plan's interface contracts are drafted from the feature NOW (demo uses canned
    # options) — so the Gate × Contract "× Contract" half is populated from the start, independent of any choice.
    await _draft_contracts(plan_id, plan)
    objs = tasklib.materialize_tasks(plan, pid, now)
    for t, st in zip(objs, ["done", "done", "in_review", "in_progress", "in_progress"]):
        t.status = st  # a lively board; the rest stay planned
    scheduler.schedule_tasks(objs, team.all_members(), now)
    await save_tasks([o.model_dump() for o in objs])
    reset_demo_graph()  # Living Project Graph: rebuild the reuse-lineage graph from canned (1 feature, 3 derived_from)
    await save_graph(canned.LINEAGE_NODES, canned.LINEAGE_EDGES, canned.LINEAGE_PID)


@app.post("/api/demo/reset")
async def demo_reset(_: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """DEMO-only: a FULL wipe back to the clean canned board — drops EVERYTHING this session created
    (briefs, plans, dispatched projects + their tasks + contracts, attributions, gate picks), then re-seeds.
    Anything you made from a brief is gone; only the seeded board remains."""
    if not demo.is_demo():
        raise HTTPException(403, "reset is demo-mode only")
    for store in (BRIEFS, SPECS, ARCHS, PLANS, RELAYS, RESULTS, DELTA_TARGET, DELTA_PRIORITY,
                  PROJECTS, REQA, SOLUTIONS, CHOSEN):
        store.clear()
    ATTRIBUTIONS.clear()
    reset_demo_tasks()        # drop session-created tasks (dispatched + drafts)
    reset_demo_agreements()   # drop session-created interface contracts
    reset_demo_projects()     # drop session-dispatched project records
    reset_demo_notifications()  # drop session-generated bell pings (canned feed re-adds itself)
    reset_demo_events()       # drop the session event log (the LPG spine)
    reset_demo_session()      # drop the persisted session snapshot (briefs/plans/relays/… write-through)
    reset_demo_graph()        # drop any session-built graph (the lineage graph is re-seeded below)
    await _seed_demo()        # rebuild the clean seeded board (fresh gates, tasks, lineage graph) — the only thing left
    return {"ok": True}


@app.on_event("startup")
async def _startup() -> None:
    """Load the team roster + persisted projects so per-account views are instant + complete.
    Also backfill Tasks for projects dispatched before the Task store existed (idempotent).
    In DEMO_MODE there's no Atlas/GitLab to read → seed the in-mem stores from canned fixtures."""
    if demo.is_demo():
        try:
            await _seed_demo()
        except Exception:
            pass
        return
    try:
        await team.refresh()
        now = datetime.now(timezone.utc).isoformat()
        for rec in await all_project_records():
            if not rec.get("plan"):
                continue
            pid = rec["project_id"]
            PROJECTS[pid] = PlanJSON(**rec["plan"])
            # No relay parity: a dispatched project is FINISHED, so its relay has LEFT the board — the
            # Relays pool shows in-flight plans only (empty on a clean env until a brief is planned, which
            # is correct). We still backfill Tasks below so per-account work views populate.
            try:
                if not await tasks_for_project(pid):  # never materialized (pre-Phase-A / seeded) → backfill
                    objs = tasklib.materialize_tasks(PROJECTS[pid], pid, now)
                    for o in objs:
                        o.status = "in_progress"  # these projects are already live
                    scheduler.schedule_tasks(objs, team.all_members(), now)
                    await save_tasks([o.model_dump() for o in objs])
            except Exception:
                pass  # backfill is best-effort
        # sweep orphan draft tasks (negative placeholder pid from un-dispatched wizard sessions, now stale)
        try:
            orphan = {t["project_id"] for t in await all_tasks() if int(t.get("project_id", 0)) < 0}
            for opid in orphan:
                await delete_tasks_for_project(opid)
        except Exception:
            pass
        try:
            await dedup_notifications()  # collapse any historical duplicate notifications (one-shot cleanup)
        except Exception:
            pass
        try:  # durability: rehydrate ALL workflow dicts from their SessionState snapshots (authoritative)
            await _rehydrate_session()
        except Exception:
            pass
        try:  # durable runtime (P8): event-spine rebuild fills any gap NOT covered by a snapshot (setdefault)
            _plans, _relays = runtime.rebuild_runtime(await all_events(limit=100_000))
            for _pid, _pl in _plans.items():
                PLANS.setdefault(_pid, _pl)
            for _pid, _st in _relays.items():
                RELAYS.setdefault(_pid, _st)
        except Exception:
            pass
        # No draft-task re-materialization on restart: tasks exist only after a plan is dispatched
        # (_finalize_scaffold), so an in-flight (un-dispatched) plan's Work hub is correctly empty.
    except Exception:
        pass  # Atlas may be momentarily unreachable; lazy-load on first authed request


@app.on_event("shutdown")
async def _shutdown() -> None:
    """Close the shared MongoDB MCP session cleanly."""
    await mongo_close()


class LoginRequest(BaseModel):
    username: str


@app.post("/api/auth/login")
async def auth_login(req: LoginRequest) -> dict:
    """Pick-your-account login (demo, no password). Token = username; sent as X-Sprint0-User."""
    return await auth.login(req.username)


async def _attach_availability(members: list[DeveloperProfile]) -> list[DeveloperProfile]:
    """Overlay each member's availability (when they can start new work) from the live task store.
    Best-effort — a transient task-store failure must never break the roster/identity endpoints."""
    try:
        objs = [Task(**d) for d in await all_tasks()]
        avail = scheduler.availability(members, objs, datetime.now(timezone.utc).isoformat())
        return [m.model_copy(update={"availability": avail.get(m.username)}) for m in members]
    except Exception:
        return members


@app.get("/api/me", response_model=DeveloperProfile)
async def me(member: DeveloperProfile = Depends(auth.current_member)) -> DeveloperProfile:
    return (await _attach_availability([member]))[0]


@app.get("/api/me/issues")
async def my_issues(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Every issue across known projects assigned to the caller — real, empty until assigned."""
    out = []
    for pid, plan in PROJECTS.items():
        for epic in plan.epics:
            for i in epic.issues:
                if i.assignee in (member.username, member.gitlab_username):
                    out.append({"project_id": pid, "project": plan.project_name, "epic": epic.title, "issue": i.model_dump()})
    return {"username": member.username, "count": len(out), "issues": out}


@app.get("/api/me/decisions")
async def my_decisions(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The caller's Decision Portfolio — every gate they've ratified, across all projects."""
    if demo.is_demo():
        rows = [dict(d) for d in canned.CANNED_DECISIONS]
        return {"username": member.username, "count": len(rows), "decisions": rows}
    try:
        rows = await decisions_by_owner(member.username)
    except Exception:
        rows = []
    return {"username": member.username, "count": len(rows), "decisions": rows}


def _my_gates(member: DeveloperProfile, members: list[DeveloperProfile]) -> list[dict]:
    """Return relay gate items awaiting this member across all active relays."""
    items = []
    for plan_id, state in RELAYS.items():
        plan = PLANS.get(plan_id)
        if plan is None:
            continue
        for g in state.gates:
            if g.discipline not in state.baton:  # only active (baton-holding) gates
                continue
            if g.status not in ("pending", "changes_requested"):
                continue
            if not _gate_ready(plan_id, g):      # strict pipeline: never queue a gate whose choices aren't ready yet
                continue
            # the gate queues for the ONE user who owns it (ratifier ?? a coverer ?? the manager for a true
            # orphan) — never a blanket manager grant. Mirrors the ratify permission + the frontend.
            if not relay.owns_gate(member, g, members):
                continue
            issue_count = sum(
                1 for e in plan.epics for i in e.issues
                if relay.is_acceptance_gate(g) or i.lane == g.discipline
            )
            items.append({
                "plan_id": plan_id, "project": plan.project_name, "discipline": g.discipline,
                "status": g.status, "issue_count": issue_count,
                "is_delta": plan_id in DELTA_TARGET, "target_project_id": DELTA_TARGET.get(plan_id),
            })
    return items


@app.get("/api/me/queue")
async def my_queue(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Relay gates awaiting the caller across ALL active relays: a gate that is on the baton,
    still open, and theirs (their discipline's lead — or the manager, for an orphan gate)."""
    await team.ensure_loaded()
    items = _my_gates(member, team.all_members())
    return {"username": member.username, "count": len(items), "items": items}


# ── Live notification push (System 5): query-identified WS channel (browsers can't set WS headers) ──
_WS_CLIENTS: dict[str, set[WebSocket]] = {}


async def _push_ws(user_id: str, payload: dict) -> None:
    """Best-effort: push a JSON payload to every live socket the user has open."""
    for ws in list(_WS_CLIENTS.get(user_id, ())):
        try:
            await ws.send_json(payload)
        except Exception:
            _WS_CLIENTS.get(user_id, set()).discard(ws)


async def notify(user_id: str, type: NotificationType, title: str, *, body: str = "", ref: dict | None = None, actionable: bool = False) -> None:
    """Best-effort: append a Notification to a member's Inbox feed + push it live over WS (System 5)."""
    try:
        if await notification_exists(user_id, type, ref or {}):
            return  # dedup — don't pile up identical unread notifications (e.g. repeated API-failing flags)
        n = Notification(id=f"ntf_{uuid.uuid4().hex[:8]}", user_id=user_id, type=type, title=title,
                         body=body, ref=ref or {}, actionable=actionable,
                         created_at=datetime.now(timezone.utc).isoformat())
        await save_notification(n.model_dump())
        await _push_ws(user_id, {"kind": "notification", "notification": n.model_dump()})
    except Exception:
        pass


def _relay_recipients(plan: PlanJSON, state: RelayState) -> set[str]:
    """EVERY relay participant — issue assignees ∪ gate ratifiers ∪ managers. The one recipient rule for
    relay-lifecycle pings (created / shipped / failed), so no event invents its own audience."""
    recips = {i.assignee for e in plan.epics for i in e.issues if i.assignee}
    recips |= {relay.ratifier_of(g) for g in state.gates if relay.ratifier_of(g)}
    recips |= {m.username for m in team.all_members() if m.is_manager}
    return {r for r in recips if r}


_EVENT_TO_TYPE = {"assigned": "task_assigned", "completed": "task_completed",
                  "qa_failed": "qa_failed", "drift_flagged": "drift_flagged"}


async def notify_watchers(subject_id: str, event: str, title: str, *, body: str = "", ref: dict | None = None) -> None:
    """Fan-out (System 5): notify everyone subscribed to `subject_id` for `event`. Best-effort."""
    try:
        for sub in await watchers_of(subject_id):
            w = sub.get("watcher_id")
            if w and w != subject_id and event in (sub.get("events") or []):
                await notify(w, _EVENT_TO_TYPE.get(event, "task_assigned"), title, body=body, ref=ref)  # type: ignore[arg-type]
    except Exception:
        pass


@app.get("/api/inbox")
async def inbox(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Aggregate Inbox: ratify gates awaiting me + pending access requests (needs_action),
    plus the notification feed. `unread` drives the bell badge."""
    await team.ensure_loaded()
    needs_action = [
        {"kind": "ratify", "title": f"{it['project']} · {it['discipline']}", "ref": {"plan_id": it["plan_id"]}, "item": it}
        for it in _my_gates(member, team.all_members())
    ]
    try:
        for g in await access_grants_for_subject(member.username):
            if g.get("status") == "pending":
                needs_action.append({"kind": "access_request",
                                     "title": f"@{g['requester_id']} requests access to your tasks",
                                     "ref": {"grant_id": g["id"]}})
    except Exception:
        pass
    try:
        for prop in await open_reschedule_proposals():
            is_mgr = member.is_manager
            if is_mgr or member.username in prop.get("affected_users", []):
                st = prop.get("strategy", {})
                needs_action.append({
                    "kind": "reschedule",
                    "title": f"AI proposes: {st.get('action', '?')} — {st.get('impact_summary') or st.get('rationale', '')}"[:90],
                    "ref": {"proposal_id": prop["id"]},
                    "item": prop,
                })
    except Exception:
        pass
    try:
        notes = await notifications_for_user(member.username)
    except Exception:
        notes = []
    if demo.is_demo():  # canned feed + this session's runtime pings (notifications_for_user already filtered to me)
        notes = [dict(n) for n in canned.CANNED_INBOX] + notes
    notes.sort(key=lambda n: n.get("created_at", ""), reverse=True)
    unread = len(needs_action) + sum(1 for n in notes if not n.get("read"))
    return {"needs_action": needs_action, "notifications": notes, "unread": unread}


@app.post("/api/inbox/read-all")
async def inbox_read_all(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    await mark_all_read(member.username)
    return {"ok": True}


@app.delete("/api/notifications/{notif_id}")
async def inbox_delete(notif_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Dismiss a notification from the caller's own inbox."""
    await delete_notification(member.username, notif_id)
    return {"ok": True}


class AccessRequestBody(BaseModel):
    subject_id: str


@app.post("/api/access/requests")
async def request_access(body: AccessRequestBody, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    if body.subject_id == member.username:
        raise HTTPException(400, "can't request access to your own tasks")
    existing = await access_grants_for_requester(member.username)
    if any(g.get("subject_id") == body.subject_id and g.get("status") in ("pending", "granted") for g in existing):
        raise HTTPException(409, "you already have a pending or granted request for this person")
    now = datetime.now(timezone.utc).isoformat()
    grant = AccessGrant(id=f"agr_{uuid.uuid4().hex[:8]}", requester_id=member.username,
                        subject_id=body.subject_id, status="pending", created_at=now, updated_at=now)
    await save_access_grant(grant.model_dump())
    await notify(body.subject_id, "access_requested", f"@{member.username} requests access to your tasks",
                 actionable=True, ref={"grant_id": grant.id})
    return grant.model_dump()


@app.post("/api/access/requests/{grant_id}/accept")
async def accept_access(grant_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    g = await get_access_grant(grant_id)
    if not g:
        raise HTTPException(404, "no such request")
    if g["subject_id"] != member.username:
        raise HTTPException(403, "only the subject can accept")
    await update_access_grant(grant_id, {"status": "granted", "updated_at": datetime.now(timezone.utc).isoformat()})
    await notify(g["requester_id"], "access_granted", f"@{member.username} granted you access to their tasks",
                 ref={"grant_id": grant_id})
    return {**g, "status": "granted"}


@app.post("/api/access/requests/{grant_id}/reject")
async def reject_access(grant_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    g = await get_access_grant(grant_id)
    if not g:
        raise HTTPException(404, "no such request")
    if g["subject_id"] != member.username:
        raise HTTPException(403, "only the subject can reject")
    await update_access_grant(grant_id, {"status": "revoked", "updated_at": datetime.now(timezone.utc).isoformat()})
    return {**g, "status": "revoked"}


@app.get("/api/access")
async def list_access(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    mine = await access_grants_for_requester(member.username)
    watching = await access_grants_for_subject(member.username)
    return {
        "i_can_see": [g for g in mine if g.get("status") == "granted"],
        "can_see_me": [g for g in watching if g.get("status") == "granted"],
        "pending_in": [g for g in watching if g.get("status") == "pending"],
        "pending_out": [g for g in mine if g.get("status") == "pending"],  # my outgoing requests awaiting accept (drives the "Requested" state)
    }


@app.delete("/api/access/{grant_id}")
async def revoke_access(grant_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    g = await get_access_grant(grant_id)
    if not g:
        raise HTTPException(404, "no such grant")
    if member.username not in (g["subject_id"], g["requester_id"]):
        raise HTTPException(403, "not your grant")
    await team.ensure_loaded()
    mgr = team.manager()
    if mgr and g["requester_id"] == mgr.username and member.username != mgr.username:
        raise HTTPException(403, "the manager always watches — that Watch can't be revoked")
    await update_access_grant(grant_id, {"status": "revoked", "updated_at": datetime.now(timezone.utc).isoformat()})
    return {**g, "status": "revoked"}


@app.post("/api/access/{grant_id}/mute")
async def mute_access(grant_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    g = await get_access_grant(grant_id)
    if not g:
        raise HTTPException(404, "no such grant")
    if g["subject_id"] != member.username:
        raise HTTPException(403, "only the subject can mute")
    new_muted = not g.get("notifications_muted", False)
    await update_access_grant(grant_id, {"notifications_muted": new_muted, "updated_at": datetime.now(timezone.utc).isoformat()})
    return {**g, "notifications_muted": new_muted}


@app.get("/api/relays")
async def list_relays(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Manager overview of every active relay — the cross-project ratification board."""
    out = []
    for plan_id, state in RELAYS.items():
        plan = PLANS.get(plan_id)
        if plan is None:
            continue
        out.append({
            "plan_id": plan_id, "project": plan.project_name, "baton": list(state.baton),
            "gates": [_gate_summary(plan_id, g) for g in state.gates],
            "is_delta": plan_id in DELTA_TARGET, "target_project_id": DELTA_TARGET.get(plan_id),
            "all_ratified": relay.all_ratified(state), "dispatch": state.dispatch,
        })
    return {"count": len(out), "relays": out}


def _gate_summary(plan_id: str, g) -> dict:
    """THE gate projection for list payloads — one place to extend, so a new Gate field (ready,
    is_acceptance, owner…) can never be added to the detail endpoint and silently missed here."""
    return {"discipline": g.discipline, "status": g.status, "note": g.note, "owner": g.owner,
            "delegate": g.delegate, "ready": _gate_ready(plan_id, g),
            "is_acceptance": relay.is_acceptance_gate(g)}


@app.get("/api/qa/queue", response_model=QAQueue)
async def qa_queue(_: DeveloperProfile = Depends(auth.current_member)) -> QAQueue:
    """Cross-project Tester queue — one row per ACTIVE RELAY with an acceptance gate (plan→project resolved
    by ID via RESERVED / DELTA_TARGET, never by name: two relays on one project are two rows), plus one row
    per dispatched project with no active relay (its post-dispatch acceptance + any reopened re-QA items).
    So a tester sees all their acceptance work across projects in one place, not one locked project."""
    entries: list[QAQueueEntry] = []
    covered: set[int] = set()  # project_ids already represented by an active relay's row
    for plan_id, state in RELAYS.items():
        plan = PLANS.get(plan_id)
        qa_gate = next((g for g in state.gates if relay.is_acceptance_gate(g)), None)
        if plan is None or qa_gate is None:
            continue
        pid = (RESERVED.get(plan_id) or {}).get("project_id") or DELTA_TARGET.get(plan_id)
        if not pid:
            continue  # not Created yet — the tester queue starts once the project exists
        reqa = sorted(REQA.get(pid, set()))
        covered.add(pid)  # an active relay OWNS its project's row — even done-skipped, don't double-list below
        if qa_gate.status in const.DONE and not reqa:
            continue  # accepted and nothing reopened → no outstanding QA on this relay
        entries.append(QAQueueEntry(
            project_id=pid, project_name=plan.project_name, plan_id=plan_id,
            qa_status=qa_gate.status, baton="qa" in state.baton,
            issue_count=sum(len(e.issues) for e in plan.epics), awaiting_reqa=reqa,
        ))
    for pid, plan in PROJECTS.items():  # dispatched (relay popped): live acceptance + reopened items
        if pid in covered:
            continue
        entries.append(QAQueueEntry(
            project_id=pid, project_name=plan.project_name, plan_id="",
            qa_status="pending", baton=False,
            issue_count=sum(len(e.issues) for e in plan.epics), awaiting_reqa=sorted(REQA.get(pid, set())),
        ))
    entries.sort(key=lambda e: (e.baton, e.issue_count), reverse=True)
    return QAQueue(count=len(entries), queue=entries)


@app.get("/api/projects")
async def list_projects(_: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """All repos in the demo group (real source of truth). A repo with a ProjectRecord is
    sprint0-managed → kind=active (full plan/status/counts); the rest (agency seed repos) are
    kind=reference, enriched from PastProjects memory. Falls back to ProjectRecords if GitLab is down."""
    if demo.is_demo():  # no GitLab/Atlas on the public tier → canned workspace + THIS session's dispatched projects
        out = [dict(p) for p in canned.CANNED_PROJECTS]
        seen = {p["project_id"] for p in out}
        try:
            for rec in await all_project_records():  # _DEMO_PROJECTS — wizard-created, newest on top
                if rec.get("project_id") not in seen:
                    out.insert(0, {**rec, "kind": "active"})
        except Exception:
            pass
        return {"count": len(out), "projects": out}
    try:
        repos = await run_in_threadpool(gitlab.list_group_projects)
    except Exception:
        repos = None
    try:
        records = {r["project_id"]: r for r in await all_project_records()}
    except Exception:
        records = {}

    if repos is None:  # GitLab unreachable → persisted records only
        out = [{**r, "kind": "active"} for r in records.values()]
        return {"count": len(out), "projects": out}

    try:
        past = {p.get("name"): p for p in await past_projects()}
    except Exception:
        past = {}

    out = []
    for repo in repos:
        pid, name = repo["project_id"], repo["name"]
        rec = records.get(pid)
        if rec:  # sprint0-managed / in-progress
            out.append({**rec, "kind": "active", "web_url": rec.get("web_url") or repo["web_url"],
                        "last_activity_at": repo["last_activity_at"]})
        elif repo["seed"] or name in past:  # agency reference repo
            pp = past.get(name) or {}
            out.append({
                "project_id": pid, "name": name, "web_url": repo["web_url"], "kind": "reference",
                "status": "shipped", "tech_stack": pp.get("tech_stack") or {}, "tags": pp.get("tags") or [],
                "summary": pp.get("outcome_notes") or repo["description"] or "",
                "last_activity_at": repo["last_activity_at"],
            })
        else:  # any other live repo
            out.append({"project_id": pid, "name": name, "web_url": repo["web_url"], "kind": "active",
                        "status": None, "last_activity_at": repo["last_activity_at"]})
    # Union: a sprint0-managed project (ProjectRecord + materialized tasks) must resolve even if GitLab no
    # longer lists its repo (demo reset / free-tier cap) — else its tasks orphan with a blank project.
    seen = {p["project_id"] for p in out}
    for pid, rec in records.items():
        if pid not in seen:
            out.append({**rec, "kind": "active"})
    return {"count": len(out), "projects": out}


@app.get("/api/workspace")
async def workspace(_: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The workspace label = the GitLab demo group's display name, for the sidebar + breadcrumbs.
    Best-effort: falls back to the configured group path if GitLab is unreachable."""
    try:
        return await run_in_threadpool(gitlab.group_info)
    except Exception:
        return {"name": gitlab.DEMO_GROUP, "path": gitlab.DEMO_GROUP, "web_url": ""}


@app.post("/api/briefs")
async def create_brief(text: Optional[str] = Form(None), file: Optional[UploadFile] = File(None), _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    content = (text or "").strip()
    if file is not None:
        raw = await file.read()
        if (file.filename or "").lower().endswith(".pdf"):
            from pypdf import PdfReader

            content = "\n".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(raw)).pages).strip()
        else:
            content = raw.decode("utf-8", "ignore").strip()
    if not content:
        raise HTTPException(400, "empty brief")
    # cap the brief — a pasted 50kB doc would blow the clarify prompt budget (the UI caps at 8k;
    # PDFs can extract more, so truncate rather than reject)
    content = content[:_BRIEF_MAX_CHARS]
    bid = f"brief_{uuid.uuid4().hex[:8]}"
    BRIEFS[bid] = content
    await _persist("briefs", bid, {"v": content})
    return {"brief_id": bid}


@app.get("/api/briefs/{brief_id}")
async def get_brief(brief_id: str) -> dict:
    """Rehydrate a brief's text (wizard resume — no Gemini re-run)."""
    if brief_id not in BRIEFS:
        raise HTTPException(404, "brief not found")
    return {"brief_id": brief_id, "text": BRIEFS[brief_id]}


@app.get("/api/briefs/{brief_id}/spec", response_model=ClarifiedSpec)
async def get_spec(brief_id: str) -> ClarifiedSpec:
    """Cached clarified spec (wizard resume). 404 until /clarify has run."""
    spec = SPECS.get(brief_id)
    if spec is None:
        raise HTTPException(404, "not clarified yet")
    return spec


@app.get("/api/briefs/{brief_id}/architectures", response_model=ArchitectureOptions)
async def get_architectures(brief_id: str) -> ArchitectureOptions:
    """Cached architecture options (wizard resume). 404 until /architectures has run."""
    opts = ARCHS.get(brief_id)
    if opts is None:
        raise HTTPException(404, "no architectures yet")
    return opts


@app.post("/api/briefs/{brief_id}/clarify", response_model=ClarifiedSpec)
async def clarify(brief_id: str, constraints: Optional[Constraints] = None,
                  _: DeveloperProfile = Depends(auth.current_manager),
                  _t: None = Depends(_ai_throttle)) -> ClarifiedSpec:
    """Intake: extract the spec, flag unclear features as ambiguity cards, propose reuse."""
    if brief_id not in BRIEFS:
        raise HTTPException(404, "brief not found")
    from app import trace
    trace.clear(f"{brief_id}:clarify"); trace.begin(f"{brief_id}:clarify")   # phase-scoped run (no cross-phase bleed)
    spec = await clarify_brief(BRIEFS[brief_id], constraints or Constraints())
    SPECS[brief_id] = spec
    await _persist("specs", brief_id, spec.model_dump())
    return spec


@app.post("/api/briefs/{brief_id}/clarify/resolve", response_model=ClarifiedSpec)
async def resolve_clarify(brief_id: str, res: ClarifyResolution,
                          _: DeveloperProfile = Depends(auth.current_manager),
                          _t: None = Depends(_ai_throttle)) -> ClarifiedSpec:
    """Manager answers the ambiguity cards (id → resolution); folds into the living spec, THEN judges agency
    memory on the RESOLVED spec (CRAG) — so the answers can shift which past work grounds the architecture."""
    spec = SPECS.get(brief_id)
    if spec is None:
        raise HTTPException(404, "clarify the brief first")
    for amb in spec.ambiguities:
        if amb.id in res.answers:
            amb.resolution = res.answers[amb.id]
    from app import trace
    trace.clear(f"{brief_id}:memory"); trace.begin(f"{brief_id}:memory")   # phase-scoped run
    spec.memory_candidates = await judge_memory(spec)   # reuse judged on the RESOLVED spec, not the raw brief
    SPECS[brief_id] = spec
    await _persist("specs", brief_id, spec.model_dump())
    return spec


@app.post("/api/briefs/{brief_id}/architectures", response_model=ArchitectureOptions)
async def architectures(brief_id: str, constraints: Optional[Constraints] = None,
                        grounded: Optional[list[str]] = Query(None), decided: bool = Query(False),
                        _: DeveloperProfile = Depends(auth.current_manager),
                        _t: None = Depends(_ai_throttle)) -> ArchitectureOptions:
    """Idea 1: 2-3 grounded Architecture Cards. `grounded` = the human's ratified memory-candidate refs
    (Use/Skip from the Memory panel). `decided` distinguishes a human verdict of "keep none → fresh build"
    (decided + empty grounded → []) from "no panel shown → the AI judges all retrieved candidates" (None)."""
    if brief_id not in BRIEFS:
        raise HTTPException(404, "brief not found")
    eff_grounded = grounded if grounded is not None else ([] if decided else None)
    from app import trace
    trace.clear(f"{brief_id}:arch"); trace.begin(f"{brief_id}:arch")   # phase-scoped run
    opts = await propose_architectures(BRIEFS[brief_id], constraints or Constraints(), grounded=eff_grounded)
    ARCHS[brief_id] = opts  # cache for wizard resume
    await _persist("archs", brief_id, opts.model_dump())
    return opts


@app.get("/api/briefs/{brief_id}/trace")
async def brief_trace(brief_id: str, phase: Optional[str] = Query(None),
                      _: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The ReAct trace for a brief's run — the agent's REAL Reason→Action steps (Gemini · MongoDB · GitLab).
    Trace runs are PHASE-scoped (`{brief_id}:{phase}`) so each wizard phase polls only its own steps (no
    cross-phase bleed / clear-flicker). `phase` omitted = the legacy brief-keyed run. MEMBER-readable —
    leads watch their gate's contract drafting and the Tester watches the dispatch (manager-only here
    silently 403'd those LiveTraces); the steps are non-sensitive ReAct labels."""
    from app import trace
    key = f"{brief_id}:{phase}" if phase else brief_id
    return {"brief_id": brief_id, "phase": phase, "steps": trace.get(key)}


def _manifest_of(plan: PlanJSON) -> list[str]:
    """The key files a plan touches — deduped, sorted union of every issue's context_scope.files.
    Recomputed on each delta dispatch so mid-prod grounding never reads the dispatch-day snapshot."""
    return sorted({f for e in plan.epics for i in e.issues for f in (i.context_scope.files or [])})


def _plan_pid(plan_id: str) -> int:
    """Negative placeholder project_id for a plan's Tasks before dispatch assigns the real GitLab
    project_id; re-keyed on dispatch. Process-stable (fine for the draft→dispatch flow). (Phase A)"""
    return -(abs(hash(plan_id)) % 2_000_000_000)


def _reflow_change_events(rows: list[dict]) -> list[ChangeEvent]:
    """The event spine now also carries Living-Project-Graph events (plan_created, gitlab_*, reuse_recorded,
    corpus_reembedded, node_retired …) whose `kind` isn't a ChangeEvent kind. The reflow engine only consumes
    calendar/work/assignment ChangeEvents, so skip anything that doesn't parse — never let a spine event break
    scheduling."""
    out: list[ChangeEvent] = []
    for e in rows:
        try:
            out.append(ChangeEvent(**e))
        except Exception:
            pass
    return out


@app.post("/api/briefs/{brief_id}/plan")
async def make_plan(brief_id: str, req: Optional[PlanRequest] = None, _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    if brief_id not in BRIEFS:
        raise HTTPException(404, "brief not found")
    req = req or PlanRequest()
    from app import trace
    trace.clear(f"{brief_id}:plan"); trace.begin(f"{brief_id}:plan")   # phase-scoped run
    # REASON: RAG (MongoDB MCP) → Gemini → assign. chosen_stack locks the stack (Idea 1).
    plan = await run_brief(BRIEFS[brief_id], chosen_stack=req.chosen_stack, constraints=req.constraints)
    plan_id = f"plan_{brief_id}"
    PLANS[plan_id] = plan
    RELAYS[plan_id] = relay.build_relay(plan, setup_owner=req.setup_owner)  # +setup gate if the stack was redirected to a lead
    await _persist_relay(plan_id)  # durable: snapshot the plan + open relay so they survive a restart
    try:  # durable runtime (P8): the spine records the plan so an in-flight relay survives a restart
        await eventlog.emit(const.EventKind.PLAN_CREATED, created_at=datetime.now(timezone.utc).isoformat(),
                            payload={"plan_id": plan_id, "plan": plan.model_dump()})
    except Exception:
        pass
    # Tasks are NOT materialized here — only at _finalize_scaffold (after the relay's gates ratify), so the
    # Work hub stays empty until the plan is dispatched (no pre-ratification tasks, no negative-pid placeholders).
    # (Subteam pacts CUT 2026-06-09 — _seed_subteam_agreements no longer called; interface contracts stay JIT.)
    return {"plan_id": plan_id, "plan": plan.model_dump(), "relay": RELAYS[plan_id].model_dump()}


# ── Agreement engine: interface contracts (CDD) — draft → route → ratify → auto-mock ──
def _apply_api_contract(plan_id: str, issue_id: str, contract: str) -> None:
    """Seed the producer issue's `api_contract` (the mock that flows to the FE context)."""
    plan = PLANS.get(plan_id)
    if not plan:
        return
    for e in plan.epics:
        for i in e.issues:
            if i.id == issue_id:
                i.api_contract = contract
                return


async def _seed_subteam_agreements(plan_id: str, plan: PlanJSON) -> None:
    """At plan time, route any sub-team proposals (a 2nd dev warranted for a heavy slice). Interface
    contracts are NOT drafted here — they are drafted from the feature at reserve (`_draft_contracts`,
    contract-first), independent of any gate choice."""
    try:
        members = team.all_members()
        drafts = agreements.propose_subteams(plan, members)
        if not drafts:
            return
        now = datetime.now(timezone.utc).isoformat()
        for a in drafts:
            a.id = f"agr_{uuid.uuid4().hex[:8]}"
            a.plan_id = plan_id
            a.ratifiers = agreements.ratifiers_for(a, members)
            a.created_at = a.updated_at = now
            a.state = "proposed"
            await save_agreement(a.model_dump())
    except Exception:
        pass


async def _draft_contracts(plan_id: str, plan: PlanJSON) -> None:
    """Contract-FIRST: at reserve, draft EVERY producer→consumer interface contract from the FEATURE (the two
    slices' descriptions) — independent of any gate choice. The contract is the external interface both sides
    implement against; a gate's reuse-or-innovate choice SATISFIES it, never authors it. The producer (its
    gate owner) signs a shape; the consumer agrees or counters. Idempotent — an edge that already has a live
    contract is skipped — and best-effort (the integration gate is the net). Emits a ReAct trace
    ({plan_id}:contracts) so the drafting is visible, INCLUDING a 'no contract needed' result for a bare edge.
    In DEMO this runs too (propose_contract_options returns canned options)."""
    from app import trace
    run = f"{plan_id}:contracts"
    try:
        by_id = {i.id: i for e in plan.epics for i in e.issues}
        edges: dict[tuple[str, str], object] = {}             # (producer_issue, consumer_lane) → consumer issue
        for cons in by_id.values():
            for dep in cons.depends_on:
                prod = by_id.get(dep)
                if not prod or prod.discipline == cons.discipline:
                    continue                                  # only cross-discipline dependency edges produce a contract
                if prod.discipline not in const.API_PRODUCER_DISCIPLINES:
                    continue                                  # frontend/uiux/devops serve no consumed API → no contract
                edges.setdefault((prod.id, cons.discipline), cons)
        if not edges:
            return
        trace.begin(run)
        trace.step("server", "thought", "Drafting interface contracts", f"{len(edges)} producer→consumer edge(s), from the feature")
        members = team.all_members()
        existing = await agreements_for_plan(plan_id)         # idempotent re-draft: skip an edge already under contract
        pool = await all_agreements()                         # the cross-plan precedent pool (compound from past ratified shapes)
        now = datetime.now(timezone.utc).isoformat()
        # each side's signer = its gate OWNER (delegate ?? owner — known at reserve); the lane lead is the fallback
        _state = RELAYS.get(plan_id)
        gate_owners = {g.discipline: relay.ratifier_of(g) for g in (_state.gates if _state else []) if relay.ratifier_of(g)}
        async def _edge(prod_id: str, cons_disc: str, cons) -> None:
            """Draft ONE producer→consumer edge — runs concurrently with its siblings (N edges in parallel,
            not N sequential Gemini calls). Distinct edges by construction (the edges dict dedups), so the
            concurrent saves can't duplicate; trace steps interleave but each row is labeled by edge."""
            prod = by_id[prod_id]
            prod_disc = prod.discipline
            trace.step("gemini", "action", f"{prod_disc} → {cons_disc}", f"What does {cons_disc} need from {prod.title}?")
            try:
                opts = await propose_contract_options(plan, prod, cons)   # feature-grounded (no gate choice)
            except Exception:
                logging.getLogger("sprint0.contracts").warning(
                    "contract draft failed for %s→%s (%s) — the integration gate is the net", prod_disc, cons_disc, plan_id)
                return                                        # best-effort; the integration gate still catches drift
            if not opts.needed or not opts.proposals:
                trace.step("server", "result", f"No contract needed · {prod_disc}→{cons_disc}", "no API boundary between these slices")
                return
            top = opts.proposals[0].interface
            a = Agreement(
                id=f"agr_{uuid.uuid4().hex[:8]}", type="interface", plan_id=plan_id,
                subject=f"{prod_disc}→{cons_disc} · {top.path or prod.title}",
                interface=top, proposals=opts.proposals,
                producer_issue_id=prod_id, consumer_issue_id=cons.id,
                producer_discipline=prod_disc, consumer_discipline=cons_disc,
                producer_actor=gate_owners.get(prod_disc) or "",
                consumer_actor=gate_owners.get(cons_disc) or agreements.lead_of(cons_disc, members) or "",
                state="proposed", created_at=now, updated_at=now)
            a.ratifiers = agreements.ratifiers_for(a, members, gate_ratifiers={prod_disc: a.producer_actor, cons_disc: a.consumer_actor})
            precedent = agreements.find_precedent(a.model_dump(), pool)
            if precedent:                                     # COMPOUND → a RECOMMENDATION (not auto-pass): badge it; the producer still signs
                a.precedent_id = precedent                    # state stays "proposed"; no mock seeded until the human signs
            await save_agreement(a.model_dump())
            trace.step("mongodb", "result", f"Contract drafted · {a.subject}", (f"{top.method or ''} {top.path or ''}").strip() or "interface")
            if a.producer_actor:                              # route to the producer to pick a shape + sign (sign-async)
                await notify(a.producer_actor, "agreement_proposed", f"Sign your contract · {a.subject}",
                             body=f"Pick the API shape {cons_disc} builds against, then sign.",
                             ref={"agreement_id": a.id, "plan_id": plan_id}, actionable=True)

        def _edge_live(prod_id: str, cons_disc: str) -> bool:  # idempotent re-draft: skip an edge already under contract
            return any(a.get("type") == "interface" and a.get("producer_issue_id") == prod_id
                       and a.get("consumer_discipline") == cons_disc
                       and a.get("state") in const.AGREEMENT_LIVE for a in existing)

        await asyncio.gather(*(_edge(pid_, disc_, cons) for (pid_, disc_), cons in edges.items()
                               if not _edge_live(pid_, disc_)))
    except Exception:
        logging.getLogger("sprint0.contracts").exception("contract drafting failed wholesale (%s)", plan_id)


@app.get("/api/plans/{plan_id}/agreements")
async def list_agreements(plan_id: str, _: DeveloperProfile = Depends(auth.current_member)) -> dict:
    rows = await agreements_for_plan(plan_id)
    return {"agreements": [a for a in rows if a.get("type") != "subteam"]}  # subteam pacts cut — hide legacy rows


@app.get("/api/me/agreements")
async def my_agreements(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The agreements awaiting MY signature — the Inbox queue (minimal-ratifier routing, no broadcast)."""
    rows = await agreements_for_ratifier(member.username)
    return {"agreements": [a for a in rows if a.get("type") != "subteam"]}


class RatifyAgreementBody(BaseModel):
    decision: Literal["ratified", "rejected"] = "ratified"
    note: str = ""
    chosen_proposal_id: Optional[str] = None   # producer: which reuse/fresh shape they sign…
    interface: Optional[InterfaceDraft] = None # …or a written-from-scratch shape (write-your-own)


class CounterAgreementBody(BaseModel):
    why: str = ""                              # one-line reason for the alternative shape
    proposal_id: Optional[str] = None          # counter with one of the offered proposals…
    interface: Optional[InterfaceDraft] = None # …or a written-from-scratch shape


@app.post("/api/agreements/{agreement_id}/ratify")
async def ratify_agreement(agreement_id: str, body: RatifyAgreementBody,
                           member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """SIGN-ASYNC. The PRODUCER picks a shape (chosen_proposal_id) + signs → state `active`, the mock flows,
    the consumer is pinged — the producer is NOT blocked. The CONSUMER then agrees (→ `ratified`/compounded)
    or counters (see /counter). A reject is the rare terminal no."""
    raw = await get_agreement(agreement_id)
    if not raw:
        raise HTTPException(404, "agreement not found")
    a = Agreement(**raw)
    if member.username not in a.ratifiers and not member.is_manager:
        raise HTTPException(403, "not a ratifier of this agreement")
    now = datetime.now(timezone.utc).isoformat()
    # the producer ACTOR (the producing gate's ratifier, possibly out-of-discipline) — discipline fallback for legacy rows
    is_producer = (member.username == a.producer_actor) if a.producer_actor \
        else member.covers(a.producer_discipline)
    # the producer picks WHICH shape they're signing (reuse / fresh / write-your-own) → becomes the agreed interface
    if is_producer and body.decision == "ratified":
        if body.interface is not None:                       # write-your-own → the producer authored the shape
            a.interface, a.chosen_proposal_id = body.interface, "user"
        elif body.chosen_proposal_id:
            chosen = next((p for p in a.proposals if p.id == body.chosen_proposal_id), None)
            if chosen:
                a.interface, a.chosen_proposal_id = chosen.interface, chosen.id
    agreements.apply_ratification(a, member.username, body.decision, body.note, now, is_producer=is_producer)
    if a.type == "interface" and a.interface and a.producer_issue_id:
        mock = json.dumps(agreements.mock_from_schema(a.interface.response_fields))
        if a.state in ("active", "ratified"):
            _apply_api_contract(a.plan_id, a.producer_issue_id, mock)  # flows on the producer's sign (active) + finalizes on ratified
        if a.state == "active":  # producer just signed → ping the consumer JIT to agree or counter
            signed = {r["by"] for r in a.ratifications if r.get("decision") == "ratified"}
            for u in a.ratifiers:
                if u not in signed:
                    await notify(u, "agreement_proposed", f"Contract to sign · {a.subject}",
                                 body="The producer signed. Agree, or counter with your own shape.",
                                 ref={"agreement_id": a.id, "plan_id": a.plan_id}, actionable=True)
    await update_agreement(agreement_id, a.model_dump())
    return a.model_dump()


@app.post("/api/agreements/{agreement_id}/counter")
async def counter_agreement(agreement_id: str, body: CounterAgreementBody,
                            member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Disagree by PROPOSING a different shape (+ a one-line why), not just rejecting. Bounces the contract
    back to the other side, which agrees or counters again — the cycle. The shape = a picked proposal or a
    written InterfaceDraft."""
    raw = await get_agreement(agreement_id)
    if not raw:
        raise HTTPException(404, "agreement not found")
    a = Agreement(**raw)
    if member.username not in a.ratifiers and not member.is_manager:
        raise HTTPException(403, "not a ratifier of this agreement")
    now = datetime.now(timezone.utc).isoformat()
    iface = None
    if body.proposal_id:
        iface = next((p.interface for p in a.proposals if p.id == body.proposal_id), None)
    iface = body.interface or iface or a.interface
    if iface is None:
        raise HTTPException(400, "a counter needs a shape (a proposal id or an interface)")
    agreements.apply_counter(a, member.username, iface, body.why, now)
    await update_agreement(agreement_id, a.model_dump())
    for u in a.ratifiers:  # route back to the OTHER side
        if u != member.username:
            await notify(u, "agreement_proposed", f"Counter-proposal · {a.subject}",
                         body=f"@{member.username} proposed a different shape — {body.why or 'review it'}.",
                         ref={"agreement_id": a.id, "plan_id": a.plan_id}, actionable=True)
    return a.model_dump()


class DraftShapeBody(BaseModel):
    description: str = ""


@app.post("/api/agreements/{agreement_id}/draft-shape")
async def draft_agreement_shape(agreement_id: str, body: DraftShapeBody,
                                member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Author-assist: draft an interface shape from a one-line description, to SEED the write-your-own / counter
    editor. The human always edits + signs — this is a starting point, not an auto-decision (demo returns a stub)."""
    raw = await get_agreement(agreement_id)
    if not raw:
        raise HTTPException(404, "agreement not found")
    a = Agreement(**raw)
    prompt = (f"SUBJECT: {a.subject}\n"
              f"PRODUCER: {a.producer_discipline}  CONSUMER: {a.consumer_discipline}\n"
              f"DESCRIPTION: {(body.description or '').strip()[:200]}\n"
              f"Draft the interface the consumer needs from the producer.")
    draft = await generate_shape(prompt)
    return draft.model_dump()


@app.post("/api/plans/{plan_id}/agreements/verify")
async def verify_agreements(plan_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The VERIFY beat (memory→ratify→verify→compound): shape-check each ratified interface contract's
    producer output against the ratified shape. A violation = the merged reality diverging from a
    ratified agreement → an IntegrationSignal that holds the gate + pings the producer. Clean = honored."""
    plan = PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    issues = {i.id: i for e in plan.epics for i in e.issues}
    state = RELAYS.get(plan_id)
    results, now = [], datetime.now(timezone.utc).isoformat()
    for raw in await agreements_for_plan(plan_id):
        if raw.get("type") != "interface" or raw.get("state") not in const.DONE:
            continue
        prod = issues.get(raw.get("producer_issue_id"))
        if not prod or not prod.api_contract:
            continue
        try:
            payload = json.loads(prod.api_contract)
        except Exception:
            continue
        viol = agreements.verify_against(InterfaceDraft(**(raw.get("interface") or {})), payload)
        results.append({"agreement_id": raw["id"], "subject": raw.get("subject"), "ok": not viol, "violations": viol})
        if viol and state is not None:  # drift → the existing integration gate enforces it
            relay.record_integration_signal(state, IntegrationSignal(
                target_issue_id=prod.id, state="failing", by="sprint0", source="ai",
                note=f"Contract violation: {'; '.join(viol)}", created_at=now))
            if prod.assignee:
                await notify(prod.assignee, "qa_failed", f"Contract violation · {raw.get('subject')}",
                             body="; ".join(viol), ref={"plan_id": plan_id, "issue_id": prod.id}, actionable=True)
    await _persist_relay(plan_id)  # durable: a contract-violation integration signal survives a restart
    return {"checked": len(results), "violations": len([r for r in results if not r["ok"]]), "results": results}


@app.get("/api/reuse-pack")
async def get_reuse_pack(projects: str = "", discipline: str = "", _: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The REUSE agreement made executable: the cited source files for a chosen memory solution, scoped to
    the gate's `discipline` (the devops card cites devops files, not the whole tree) — the dev pulls them
    (link → file list → seed the focus branch). 'it was built before' → 'it's in your branch'."""
    names = [p.strip() for p in projects.split(",") if p.strip()]
    files = await reuse_pack(names, discipline=discipline or None)
    return {"count": len(files), "files": files}


@app.get("/api/plans/{plan_id}", response_model=PlanJSON)
async def get_plan(plan_id: str) -> PlanJSON:
    if plan_id not in PLANS:
        raise HTTPException(404, "plan not found")
    return PLANS[plan_id]


def _gate_ready(plan_id: str, g) -> bool:
    """Strict pipeline (P2): a pending gate is 'ready' (open) once its choices are cached; a gate with no
    slice (the qa acceptance gate, setup) has nothing to generate → always ready."""
    if g.status not in ("pending", "changes_requested"):
        return True
    if (plan_id, g.discipline) in SOLUTIONS:
        return True
    plan = PLANS.get(plan_id)
    return not plan or not any(i.discipline == g.discipline for e in plan.epics for i in e.issues)


@app.get("/api/plans/{plan_id}/relay", response_model=RelayState)
async def get_relay(plan_id: str) -> RelayState:
    if plan_id not in RELAYS:
        raise HTTPException(404, "relay not found")
    state = RELAYS[plan_id]
    for g in state.gates:  # stamp the strict-pipeline readiness + the acceptance flag at serialization time
        g.ready = _gate_ready(plan_id, g)
        g.is_acceptance = relay.is_acceptance_gate(g)
    return state


def _can_author_acceptance(member: DeveloperProfile, state) -> bool:
    """Only the acceptance gate's OWNER (the Tester — its ratifier ?? the qa coverer ?? the manager when qa
    is an orphan) authors the definition of done. No blanket manager grant — owns_gate decides."""
    g = next((g for g in state.gates if relay.is_acceptance_gate(g)), None)
    return bool(g) and relay.owns_gate(member, g, team.all_members())


ACCEPTANCE_MAX = 240  # an authored pass-condition stays one concise line


class AcceptanceItem(BaseModel):
    issue_id: str
    text: str = ""


class AcceptanceSave(BaseModel):
    criteria: list[AcceptanceItem]


@app.get("/api/plans/{plan_id}/acceptance")
async def get_acceptance(plan_id: str, _: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The acceptance criteria (definition of done) the Tester authors at the terminal gate — one per plan
    issue. Each seeds from the issue's generic line until the Tester sharpens it; the checklist + this share
    `handoff.acceptance_line`, so the editor shows exactly what dispatch will post to the role:qa issue."""
    plan = PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    # Lazy AI pass (cached): seed each issue with a SPECIFIC testable criterion the first time the Tester opens
    # the gate, so they refine real conditions, not "works end-to-end". Best-effort; the generic line stands on
    # failure / demo. Cached on the plan's issues + persisted so it's a one-shot.
    if not demo.is_demo() and not any(i.acceptance for e in plan.epics for i in e.issues):
        try:
            crit = await propose_acceptance(plan)
            if crit:
                for e in plan.epics:
                    for i in e.issues:
                        if crit.get(i.id):
                            i.acceptance = crit[i.id]
                await _persist("plans", plan_id, plan.model_dump())
        except Exception:
            logging.getLogger("sprint0.acceptance").warning("acceptance criteria generation failed (%s)", plan_id)
    items = [{"issue_id": i.id, "title": i.title, "discipline": i.discipline, "type": i.type,
              "text": handoff.acceptance_line(i)} for e in plan.epics for i in e.issues]
    return {"plan_id": plan_id, "criteria": items}


@app.post("/api/plans/{plan_id}/acceptance")
async def save_acceptance(plan_id: str, req: AcceptanceSave,
                          member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The Tester saves the authored criteria onto the plan's issues — they flow into the role:qa GitLab
    checklist at dispatch. Authored by the acceptance gate's owner (delegate ?? owner) or the manager."""
    plan, state = PLANS.get(plan_id), RELAYS.get(plan_id)
    if plan is None or state is None:
        raise HTTPException(404, "plan not found")
    await team.ensure_loaded()
    if not _can_author_acceptance(member, state):
        raise HTTPException(403, "only the acceptance gate's owner or the manager can author the definition of done")
    by_id = {i.id: i for e in plan.epics for i in e.issues}
    for c in req.criteria:
        iss = by_id.get(c.issue_id)
        if iss is not None:
            iss.acceptance = c.text.strip()[:ACCEPTANCE_MAX]
    await _persist("plans", plan_id, plan.model_dump())
    return {"plan_id": plan_id, "saved": sum(1 for c in req.criteria if c.issue_id in by_id)}


# (Removed: the Autonomy dial / auto-pass endpoint. NO auto-approval — the human ratifies every gate, the AI only
#  recommends. A manager can't sensibly pre-approve a plan they haven't read.)


@app.post("/api/plans/{plan_id}/ratify/{discipline}", response_model=RelayState)
async def ratify_gate(
    plan_id: str, discipline: str, req: RatifyRequest,
    member: DeveloperProfile = Depends(auth.current_member),
) -> RelayState:
    """Only the gate's OWNER ratifies it — its assigned lead (ratifier), or, for an orphan gate that nobody
    covers, the manager. A gate is one user's; no role grants ratify on someone else's slice."""
    state, plan = RELAYS.get(plan_id), PLANS.get(plan_id)
    if state is None or plan is None:
        raise HTTPException(404, "plan not found")
    _gate = next((g for g in state.gates if g.discipline == discipline), None)
    if _gate is None:
        raise HTTPException(404, f"no {discipline} gate")
    await team.ensure_loaded()
    if not relay.owns_gate(member, _gate, team.all_members()):
        _ratifier = relay.ratifier_of(_gate)
        raise HTTPException(403, f"only this gate's owner ({_ratifier or discipline + ' lead'}) can ratify it")
    if next(g.status for g in state.gates if g.discipline == discipline) == "blocked":
        raise HTTPException(409, "gate is blocked by an open integration failure — mark it api-ok first")
    if discipline == "setup" and req.tech_stack is not None:  # the redirected lead confirms or OVERRIDES the stack
        plan.tech_stack = req.tech_stack                      # propagates to the scaffold (README/focus) at relay-close
    relay.ratify(state, plan, discipline, req.edits, req.approve, req.note)  # type: ignore[arg-type]
    _pregenerate_open_gates(plan_id)  # strict pipeline: the gates this ratify just unlocked start preparing (P2)
    try:  # durable runtime (P8): record the ratification so the relay's progress survives a restart
        await eventlog.emit(const.EventKind.GATE_RATIFIED, created_at=datetime.now(timezone.utc).isoformat(),
                            payload={"plan_id": plan_id, "discipline": discipline,
                                     "approve": req.approve, "note": req.note})
    except Exception:
        pass
    chosen = req.chosen_solution
    if req.approve and discipline != "setup":  # the setup gate has no discipline slice/Decision — it just sets the stack
        sl = [i for e in plan.epics for i in e.issues if i.discipline == discipline]
        if chosen is not None:  # reuse-or-innovate: record the pick
            CHOSEN[(plan_id, discipline)] = chosen
            await _persist("chosen", const.persist_key(plan_id, discipline), chosen.model_dump())  # durable
            pre_files = soln.gate_slice_files(plan, discipline)  # footprint before the choice
            if chosen.source == "user":  # write-your-own → the AI rewrites THIS gate's issues to match
                try:
                    regen = await regenerate_slice(sl, discipline, chosen)  # type: ignore[arg-type]
                    patch = {r.id: r for r in regen.issues}
                    for i in sl:
                        r = patch.get(i.id)
                        if r and r.title:
                            i.title = r.title
                        if r and r.description:
                            i.description = r.description
                        if r and r.files:
                            i.context_scope.files = r.files
                except Exception:
                    pass  # best-effort; the choice is still recorded
                SOLUTIONS.pop((plan_id, discipline), None)  # cached set is stale after a rewrite
                await _unpersist("solutions", const.persist_key(plan_id, discipline))
            # Cross-gate impact: ONLY when the choice ADDED files (a user rewrite) that touch another gate.
            # A memory/ai pick changes no files → never bounces another discipline's already-ratified gate.
            added = sorted(soln.gate_slice_files(plan, discipline) - pre_files)
            if added:
                await team.ensure_loaded()
                for d in soln.cross_gate_overlap(plan, discipline, added):
                    for g in state.gates:
                        if g.discipline == d and g.status in const.DONE:
                            g.status = "changes_requested"
                            g.note = f"re-ratify — {discipline}'s chosen solution now touches your slice"
                    owner = next((m.username for m in team.all_members() if m.covers(d)), None)
                    if owner:
                        await notify(owner, "ratify_needed",
                                     f"Re-ratify {d}: {discipline}'s choice now touches your slice",
                                     ref={"plan_id": plan_id, "discipline": d}, actionable=True)
                relay._recompute_baton(state)  # bounced gates re-enter the baton
            # Contract-first: the interface contracts were drafted from the feature at reserve (_draft_contracts),
            # independent of this choice — ratifying a gate no longer generates them.
        now = datetime.now(timezone.utc).isoformat()
        deviated = req.deviated or (chosen is not None and chosen.source == "user")
        if chosen is not None and chosen.title:
            rec = chosen.title.strip()                       # the ratified Contract pick — clean, human-readable
        elif req.ai_recommendation:
            rec = req.ai_recommendation.strip()
        else:
            _n = len(sl)
            rec = f"{(discipline or 'gate').capitalize()} slice · {_n} issue{'s' if _n != 1 else ''}"
        dec = Decision(
            id=f"dec_{uuid.uuid4().hex[:8]}", owner_id=member.username, domain=discipline,  # type: ignore[arg-type]
            context_tags=sorted({i.required_skill for i in sl if i.required_skill}),
            recommendation=rec,
            reasoning=req.reasoning, project_id=plan_id, project_name=plan.project_name,
            issue_ids=[i.id for i in sl],
            ai_proposal_at_time=(req.ai_recommendation or (chosen.title if chosen else None) or None),
            confidence_at_time=(req.ai_confidence if req.ai_confidence is not None else (chosen.confidence if chosen else None)),
            deviation_from_ai=deviated,
            deviation_reason=(req.deviation_reason or (chosen.summary if (chosen and chosen.source == "user") else "")) or None,
            created_at=now, updated_at=now,
        )
        try:
            await save_decision(dec.model_dump())
        except Exception:
            pass  # best-effort persistence, mirrors save_project_record at dispatch
    if relay.all_ratified(state) and (plan_id in RESERVED or plan_id in DELTA_TARGET):
        # the LAST gate just ratified → DISPATCH (a slow, validated phase). Mark "dispatching" FIRST so a
        # concurrent manager poll sees the truth (not an "open" relay it can act on). NO premature "ratified"
        # ping — the only success signal is the VALIDATED ship below.
        state.dispatch = "dispatching"
        await _persist_relay(plan_id)
        await team.ensure_loaded()
        result: dict = {}
        try:
            pid = (RESERVED.get(plan_id) or {}).get("project_id") or DELTA_TARGET.get(plan_id)
            result = await _finalize_scaffold(plan_id, plan, project_id=pid)  # validated; pops the relay on a clean ship
        except Exception:
            logging.getLogger("sprint0.dispatch").exception("scaffold threw after the last ratify (%s)", plan_id)
        if result.get("ok"):
            # SHIPPED → tell EVERY relay participant (assignees ∪ gate ratifiers ∪ managers), concise + direct.
            n = result.get("tasks_created", 0)
            for _u in sorted(_relay_recipients(plan, state)):
                await notify(_u, "project_shipped", f"{plan.project_name}: relay shipped · {n} tasks created",
                             ref={"plan_id": plan_id, "project_id": result.get("project_id")})
        else:
            st = RELAYS.get(plan_id)
            if st is not None:            # soft-fail set this inside _finalize_scaffold; a THROW didn't → ensure it
                st.dispatch = "failed"
            _msg = f"{plan.project_name}: the relay cleared but the dispatch FAILED"
            for _u in sorted({member.username, *(m.username for m in team.all_members() if m.is_manager)}):
                await notify(_u, "dispatch_failed", _msg,
                             body="GitLab issues or tasks did not land — nothing shipped. Retry from the relay (Dispatch).",
                             ref={"plan_id": plan_id}, actionable=True)
    await _persist_relay(plan_id)  # durable: snapshot the plan + relay after this ratify (no-op if a scaffold just popped it)
    return state


# ── Integration gate (B+C+D): declared api-failing signal → reject to producer, block qa ──
def _find_issue(plan: PlanJSON, issue_id: str | None):
    if not issue_id:
        return None
    return next((i for e in plan.epics for i in e.issues if i.id == issue_id), None)


def _owns_issue(member: DeveloperProfile, issue) -> bool:
    return issue is not None and issue.assignee in (member.username, member.gitlab_username)


def _is_qa_owner(member: DeveloperProfile, members: list[DeveloperProfile]) -> bool:
    """The acceptance-gate owner: a member in an acceptance lane (qa today), or — when no developer
    holds one — the manager (orphan-inheritance). Decoupled from the literal name 'qa'."""
    member_owns = any(relay.lane_stage(d) == "accept" for d in member.disciplines)
    has_owner = any(relay.lane_stage(d) == "accept" for m in members for d in m.disciplines)
    return member_owns or (member.is_manager and not has_owner)


async def _reopen_producer(plan_id: str, issue) -> None:
    """Best-effort GitLab side-effect: reopen the producer's issue if the plan is dispatched and we
    can resolve its iid (title-matched from the dispatch result). No-ops otherwise — the relay state
    is the source of truth either way."""
    try:
        res = RESULTS.get(plan_id) or {}
        pid = res.get("project_id")
        if not pid:
            return
        iid = next((it.get("iid") for it in res.get("issues", []) if it.get("title") == issue.title), None)
        if iid is None:
            return
        await run_in_threadpool(gitlab.reopen_issue, pid, iid, "Integration failure reported via sprint0 — reopening for fix.")
    except Exception:
        pass  # best-effort, mirrors save_project_record — never fail the flag over a GitLab call


class IntegrationFlagRequest(BaseModel):
    state: Literal["failing", "ok"] = "failing"
    reporter_issue_id: Optional[str] = None   # the consumer issue whose assignee is reporting
    target_issue_id: Optional[str] = None     # the producer issue (explicit pick; else derived from depends_on)
    source: Literal["manual", "webhook", "ci", "ai"] = "manual"
    note: str = ""


@app.post("/api/plans/{plan_id}/integration/flag")
async def flag_integration(
    plan_id: str, req: IntegrationFlagRequest,
    member: DeveloperProfile = Depends(auth.current_member),
) -> dict:
    """Declare an issue's API integration failing (or back ok). Fired by the CONSUMER (a downstream
    issue's assignee) or the qa-gate owner; routes to the PRODUCER (via `depends_on`). An open
    `failing` signal holds the qa gate `blocked` and pings the producer's Inbox. No DAG cascade —
    only the qa gate's status moves. On ambiguity (>1 producer) returns the candidates to pick from."""
    state, plan = RELAYS.get(plan_id), PLANS.get(plan_id)
    if state is None or plan is None:
        raise HTTPException(404, "plan not found")
    await team.ensure_loaded()
    members = team.all_members()
    qa_owner = _is_qa_owner(member, members)

    reporter_issue = _find_issue(plan, req.reporter_issue_id)
    if req.reporter_issue_id and reporter_issue is None:
        raise HTTPException(404, "reporter issue not found")

    if req.target_issue_id:                                   # explicit producer pick
        target_issue = _find_issue(plan, req.target_issue_id)
        if target_issue is None:
            raise HTTPException(404, "target issue not found")
    elif reporter_issue is not None:                          # derive producer from the consumer's depends_on
        if not (qa_owner or _owns_issue(member, reporter_issue)):
            raise HTTPException(403, "only the issue's assignee or the qa lead/manager can flag integration")
        producers = relay.resolve_producers(plan, req.reporter_issue_id)  # type: ignore[arg-type]
        if not producers:
            raise HTTPException(400, "reporter issue has no upstream producer (depends_on) to route to")
        if len(producers) > 1:                                # ambiguous → let the UI disambiguate
            return {"need_target": True, "candidates": [
                {"id": p.id, "title": p.title, "assignee": p.assignee, "api_contract": p.api_contract}
                for p in producers
            ]}
        target_issue = producers[0]
    else:
        raise HTTPException(400, "need reporter_issue_id or target_issue_id")

    # Authority: the consumer (reporter assignee), the producer (target assignee — e.g. re-marking ok),
    # or the qa-gate owner. The one new per-issue permission vs. today's gate-only authority.
    if not (qa_owner or _owns_issue(member, reporter_issue) or _owns_issue(member, target_issue)):
        raise HTTPException(403, "only the issue's assignee or the qa lead/manager can flag integration")

    sig = IntegrationSignal(
        target_issue_id=target_issue.id, state=req.state, by=member.username,
        reporter_issue_id=req.reporter_issue_id, source=req.source, note=req.note,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    relay.record_integration_signal(state, sig)

    if req.state == "failing" and target_issue.assignee:      # ping the producer's Inbox + reopen their issue
        await notify(
            target_issue.assignee, "qa_failed",
            f"API reported failing: {target_issue.title}",
            body=(req.note or f"@{member.username} reports your API integration is failing.")[:300],
            ref={"plan_id": plan_id, "issue_id": target_issue.id, "reporter_issue_id": req.reporter_issue_id},
            actionable=True,
        )
        await _reopen_producer(plan_id, target_issue)
        await notify_watchers(target_issue.assignee, "qa_failed",
                              f"@{target_issue.assignee}'s API flagged failing: {target_issue.title}",
                              ref={"plan_id": plan_id, "issue_id": target_issue.id})
    await _persist_relay(plan_id)  # durable: the integration signal (qa blocked) survives a restart
    return state.model_dump()


@app.get("/api/plans/{plan_id}/staffing")
async def plan_staffing(plan_id: str) -> dict:
    """Team-coverage + gap recommendations (who to stretch / onboard) for the manager."""
    plan = PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    await team.ensure_loaded()
    members = await _attach_availability(team.all_members())  # gap advisor reads real availability, not static load
    return {"coverage": staffing.coverage(plan, members)}


async def _can_read_contract(member: DeveloperProfile, discipline: str, plan_id: str | None = None) -> bool:
    """Contract visibility: a gate's Contract (solutions + decision card) is private to the gate's OWNER
    (owns_gate: ratifier ?? a discipline coverer ?? the manager for a true orphan) or anyone holding a
    GRANTED Watch on that owner. NO blanket manager read. Tickets stay open — this gates only the Contract."""
    await team.ensure_loaded()
    members = team.all_members()
    gate = None
    if plan_id and (st := RELAYS.get(plan_id)):
        gate = next((g for g in st.gates if g.discipline == discipline), None)
    if gate and relay.owns_gate(member, gate, members):
        return True
    ratifier = relay.ratifier_of(gate) if gate else None
    subject = ratifier or next((m.username for m in members if m.covers(discipline)), None)
    if subject:
        for g in await access_grants_for_requester(member.username):
            if g.get("subject_id") == subject and g.get("status") == "granted":
                return True
    return False


@app.get("/api/plans/{plan_id}/gates/{discipline}/candidates")
async def gate_candidates(plan_id: str, discipline: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Passport-ranked teammates to hand this gate (+ its slice) to — powers the handoff picker."""
    await team.ensure_loaded()
    members = await _attach_availability(team.all_members())
    return {"plan_id": plan_id, "discipline": discipline, "candidates": _rank_candidates(discipline, members, exclude=member.username)}


@app.get("/api/architects")
async def architects(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Roster ranked as potential STACK deciders — for the architecture step, when the manager wants to
    redirect the stack choice to a lead instead of picking it themselves. Ranked by tech-lead fit (backend-lane
    trust + seniority + availability), so the manager sees a %-match dropdown. Available pre-plan."""
    await team.ensure_loaded()
    members = await _attach_availability(team.all_members())
    return {"candidates": _rank_candidates("backend", members)}


@app.post("/api/plans/{plan_id}/gates/{discipline}/handoff", response_model=RelayState)
async def handoff_gate(plan_id: str, discipline: str, assignee: str = "", member: DeveloperProfile = Depends(auth.current_member)) -> RelayState:
    """Human-in-control: a discipline lead / the current delegate / the manager hands a gate AND its slice
    to another member. Sets the gate's `delegate` (they may now ratify + it shows OPEN in their Relays) and
    reassigns the slice's issues to them — plan issues always; dispatched Tasks too (with a schedule re-pack).
    `assignee=""` clears the delegation."""
    state, plan = RELAYS.get(plan_id), PLANS.get(plan_id)
    if state is None or plan is None:
        raise HTTPException(404, "plan not found")
    gate = next((g for g in state.gates if g.discipline == discipline), None)
    if gate is None:
        raise HTTPException(404, f"no {discipline} gate")
    await team.ensure_loaded()
    if not relay.owns_gate(member, gate, team.all_members()):
        _ratifier = relay.ratifier_of(gate)
        raise HTTPException(403, f"only this gate's owner ({_ratifier or discipline + ' lead'}) can hand it off")
    new = assignee or None
    gate.delegate = new
    # reassign the slice — plan issues always; if any are dispatched Tasks, reassign + reschedule those projects.
    now = datetime.now(timezone.utc).isoformat()
    touched: set[int] = set()
    for e in plan.epics:
        for i in e.issues:
            if i.discipline != discipline:
                continue
            i.assignee = new
            doc = await get_task(i.id)
            if doc:
                t = Task(**doc)
                t.assignee = new
                t.assigned_by = member.username if new else "ai"
                await update_task(t.id, t.model_dump())
                touched.add(t.project_id)
    for pid in touched:
        await _reschedule_project(pid)
    if new and new != member.username:
        await notify(new, "ratify_needed", f"Gate handed to you · {plan.project_name} · {discipline}",
                     body=f"@{member.username} handed you the {discipline} gate and its slice — yours to ratify.",
                     ref={"plan_id": plan_id, "discipline": discipline}, actionable=True)
        await notify_watchers(new, "assigned", f"@{new} took the {discipline} gate on {plan.project_name}",
                              ref={"plan_id": plan_id, "discipline": discipline})
    await _persist_relay(plan_id)  # durable: the delegate + slice reassignment survive a restart
    return state


async def _gate_generation_context(plan_id: str, discipline: str) -> tuple[dict, list[dict]]:
    """The feature context a gate's solutions are grounded on (P7): the CHOSEN solutions of this plan's
    already-ratified gates + the signed interface shapes flowing INTO this gate — so the proposals stay
    consistent with the decisions already made, never blind to the feature."""
    upstream = {d: sol for (pid, d), sol in CHOSEN.items() if pid == plan_id and d != discipline}
    try:
        rows = await agreements_for_plan(plan_id)
        # contract-first: include DRAFT (proposed) inbound contracts too — the choice is interface-AWARE, never
        # interface-BLOCKED (a contract still in negotiation is context, "may change", not a dependency).
        inbound = [a for a in rows if a.get("type") == "interface" and a.get("consumer_discipline") == discipline
                   and a.get("state") in const.AGREEMENT_LIVE]
    except Exception:
        inbound = []
    return upstream, inbound


async def _generate_gate_solutions(plan_id: str, plan: PlanJSON, discipline: str) -> SolutionSet:
    """Generate + cache + persist ONE gate's reuse-or-innovate set (full feature context, P7). Shared by the
    lazy GET (the never-strand fallback) and the strict-pipeline pre-generation (P2)."""
    key = (plan_id, discipline)
    upstream, inbound = await _gate_generation_context(plan_id, discipline)
    try:
        sset = await propose_solutions(plan, discipline, upstream_choices=upstream, inbound_contracts=inbound)  # MongoDB MCP grounding + one Gemini call
    except Exception:  # a transient model/DB error must NOT 500 the Contract — degrade to a stub + user slot
        sset = SolutionSet(solutions=[SolutionCard(
            source="ai", title="Define this slice",
            summary="AI proposal unavailable — describe the approach, or write your own.")])
    slice_files = soln.gate_slice_files(plan, discipline)
    dependents: dict[str, list[str]] = {}
    existing: set[str] = set()  # the feature repo's CURRENT tree → classify each file modify vs add
    pid = DELTA_TARGET.get(plan_id)  # a code graph + a live tree exist only for a dispatched repo (delta flow)
    if pid is not None:
        try:
            edges = [GraphEdge(**e) for e in await graph_edges(str(pid))]
            dependents = {f: graph.dependents_of(f, edges) for f in slice_files}
        except Exception:
            dependents = {}
        if not demo.is_demo():  # SECURITY: a demo delta plan must NEVER fire a real GitLab call
            try:
                existing = await run_in_threadpool(gitlab.list_repo_tree, pid)
            except Exception:
                existing = set()
    # a brand-new project (pid None) has no slice files in its repo yet → existing stays empty → all `add`
    sset = soln.finalize_solution_set(sset, discipline, soln.impacted_files(slice_files, dependents), existing)
    # #33 — server-derive each option's grade (memory-grounded only) + the green/orange/grey triage signal
    # from the graded-decisions memory. conflict is already on the card (LLM-flagged live / canned in demo).
    try:
        decisions = await all_decisions()
    except Exception:
        decisions = []
    for c in sset.solutions:
        if c.source == "memory" and not c.grade:   # preserve a pre-set grade (canned demo); derive otherwise
            c.grade = grading.grade_for(c.grounded_on, decisions, discipline)
        c.signal = grading.signal_for(c)
    sset.chosen = CHOSEN.get(key)   # the ratified pick → the done-gate review shows it (None when auto-passed)
    SOLUTIONS[key] = sset
    await _persist("solutions", const.persist_key(key[0], key[1]), sset.model_dump())  # durable cache
    return sset


def _pregenerate_open_gates(plan_id: str) -> None:
    """Strict pipeline (P2): fire-and-forget generation for every PENDING gate that has no cached solution
    set yet, so a gate is 'preparing' the moment it unlocks and opens with its choices ready. Called at
    reserve (the parallel first wave) and after each ratify (the newly unlocked gates). The lazy GET stays
    as the fallback, so a failed background task can never strand a gate."""
    plan, state = PLANS.get(plan_id), RELAYS.get(plan_id)
    if plan is None or state is None:
        return

    async def _one(disc: str) -> None:
        try:
            await _generate_gate_solutions(plan_id, plan, disc)
        except Exception:
            logging.getLogger("sprint0.pregen").warning(
                "pre-generation failed for %s/%s — the lazy GET will retry on open", plan_id, disc)

    for g in state.gates:
        if g.status in ("pending", "changes_requested") and (plan_id, g.discipline) not in SOLUTIONS \
                and any(i.discipline == g.discipline for e in plan.epics for i in e.issues):
            _spawn(_one(g.discipline))


@app.get("/api/plans/{plan_id}/gates/{discipline}/solutions", response_model=SolutionSet)
async def gate_solutions(
    plan_id: str, discipline: str, member: DeveloperProfile = Depends(auth.current_member),
) -> SolutionSet:
    """Reuse-or-innovate (the Contract spine): the strict pipeline pre-generates (P2); this GET serves the
    cache — and remains the lazy fallback that generates on the spot if pre-generation hasn't landed."""
    plan = PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    # visibility = the gate's RATIFIER (delegate ?? owner ?? discipline lead), the manager, or a granted Watch
    if not await _can_read_contract(member, discipline, plan_id):
        return SolutionSet(discipline=discipline, solutions=[])  # private — ratifier / manager / granted Watch only
    key = (plan_id, discipline)
    if key in SOLUTIONS:
        SOLUTIONS[key].chosen = CHOSEN.get(key)   # may have changed since cache (ratify writes CHOSEN)
        return SOLUTIONS[key]
    slice_issues = [i for e in plan.epics for i in e.issues if i.discipline == discipline]
    if not slice_issues:
        raise HTTPException(404, "no slice for this discipline in the plan")
    return await _generate_gate_solutions(plan_id, plan, discipline)


async def _build_reuse_pointers(plan_id: str, plan: PlanJSON) -> dict[str, list[dict]]:
    """Reuse layer-2: for each gate whose ratified pick is memory-grounded, build POINTERS (GitLab blob
    coordinates) to the cited source files — NO fetch, NO Gemini adapt here. The /api/focus endpoint fetches
    each pointer's RAW file live when the dev curls, and materializes it under .sprint0/reused/<source-project>/.
    Storing pointers (not content) keeps the focus store tiny. Live only — demo execute is a stub."""
    if demo.is_demo():
        return {}
    pointers: dict[str, list[dict]] = {}
    for (pid_key, disc), chosen in list(CHOSEN.items()):
        if pid_key != plan_id or not chosen.grounded_on:  # only memory-grounded (reuse) picks
            continue
        targets = [i.id for e in plan.epics for i in e.issues
                   if i.discipline == disc and (i.kind or "code") in ("code", "infra")]
        if not targets:
            continue  # no code/infra branch in this gate → don't spend a reuse_pack call
        try:
            rows = await reuse_pack(chosen.grounded_on, discipline=disc, limit=6)
        except Exception:
            continue
        gate_pointers: list[dict] = []
        for f in rows:
            info = gitlab.file_ref_from_blob_url(str(f.get("web_url", "")))
            if not info:
                continue
            proj, ref, src_path = info
            # Namespace by source project so two repos' `app/main.py` don't collide; group under .sprint0/reused.
            proj_slug = "".join(c if (c.isalnum() or c in "-_.") else "-" for c in str(f.get("project", ""))) or "memory"
            gate_pointers.append({
                "path": f".sprint0/reused/{proj_slug}/{src_path}",
                "project": proj, "ref": ref, "src_path": src_path,
                "source_url": str(f.get("web_url", "")), "source_project": str(f.get("project", "")),
            })
        if not gate_pointers:
            continue
        for iid in targets:
            pointers[iid] = gate_pointers  # every branch in the reusing gate points at the reference code
    return pointers


@app.post("/api/plans/{plan_id}/approve")
async def approve_plan(plan_id: str, req: ApproveRequest, _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    plan = req.edits or PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    state = RELAYS.get(plan_id)  # create-late (decision 5): never scaffold before the relay clears
    if state is not None and not relay.all_ratified(state):
        pending = [g.discipline for g in state.gates if g.status not in const.DONE]
        raise HTTPException(409, f"Sign the Contract for {len(pending)} open gate(s) first: {', '.join(pending)}.")
    # EXECUTE: scaffold real GitLab infra (sync httpx → threadpool); seed reuse drafts into focus branches.
    seeds = await _build_reuse_pointers(plan_id, plan)
    await _store_focus_contexts(plan, seeds)  # /api/focus serves these on checkout (nothing committed)
    result = await run_in_threadpool(lambda: execute_plan(plan, reuse_seeds=seeds))
    RESULTS[plan_id] = result
    await _persist("results", plan_id, result)
    return {"plan_id": plan_id, "mode": req.mode, **result}


@app.get("/api/focus/{issue_id}", response_class=PlainTextResponse)
async def focus_bootstrap(issue_id: str, t: str = Query(default="")) -> str:
    """The dev's `curl ... | bash` target: a one-shot script that writes the task's agent docs + reused code
    locally (UNTRACKED), so nothing sprint0 is committed and merging the focus branch leaves main pristine.
    Reused code is fetched RAW from GitLab here (pointers were stored, not content). Token-gated — the per-issue
    token is the access control, since the served files include reused code."""
    ctx = FOCUS_CONTEXTS.get(issue_id)
    if ctx is None:
        raise HTTPException(404, "no focus context for this task (re-dispatch, or wrong id)")
    if t != handoff.focus_token(issue_id):
        raise HTTPException(403, "bad or missing focus token")
    gen = dict(ctx["docs"])
    reused = ctx.get("reused") or []
    for p in reused:  # fetch each reused file's RAW content live; a moved/deleted source is just skipped
        try:
            gen[p["path"]] = await run_in_threadpool(gitlab.get_file_raw, p["project"], p["src_path"], p["ref"])
        except Exception:
            continue
    if reused:
        gen[".sprint0/reused/REUSE_MANIFEST.md"] = handoff.reuse_manifest(reused)
    return handoff.focus_script(gen)


@app.get("/api/plans/{plan_id}/dispatch/preview")
async def dispatch_preview(plan_id: str) -> dict:
    """Dry-run the irreversible GitLab creation (decision 5): what it will create, who it will invite,
    and whether the invite count exceeds the free-tier 5-member group cap. The manager reviews this
    BEFORE committing via /dispatch — the router can auto-clear the relay with no human, so this is the
    real go/no-go on spending real GitLab budget."""
    plan = PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    from app import trace
    bid = plan_id.removeprefix("plan_")  # the wizard polls /trace by brief_id
    trace.clear(f"{bid}:review"); trace.begin(f"{bid}:review")   # phase-scoped run
    await team.ensure_loaded()
    trace.step("server", "action", "Resolve the project name", plan.project_name)
    issues = [i for e in plan.epics for i in e.issues]
    trace.step("server", "action", "Count the tasks to scaffold", f"{len(issues)} task(s) across the relay")
    repo_members = sorted({
        i.assignee for i in issues
        if i.assignee and (mb := team.get(i.assignee)) and mb.gitlab_user_id and policy.needs_repo(mb.discipline)
    })
    cap = 5  # GitLab free-tier members-per-group cap
    state = RELAYS.get(plan_id)
    trace.step("server", "result", f"{len(repo_members)} member invite(s) · cap {cap}",
               "over the free-tier cap" if len(repo_members) > cap else "ready to reserve on GitLab")
    return {
        "plan_id": plan_id, "project_name": plan.project_name, "is_delta": plan_id in DELTA_TARGET,
        "creates": {"project": 0 if plan_id in DELTA_TARGET else 1, "issues": len(issues)},
        "member_invites": repo_members, "invite_count": len(repo_members),
        "free_tier_cap": cap, "exceeds_cap": len(repo_members) > cap,
        "relay_cleared": bool(state and relay.all_ratified(state)),
    }


async def _finalize_scaffold(plan_id: str, plan: PlanJSON, *, project_id: int | None = None) -> dict:
    """Phase 2 (the relay has CLOSED): scaffold the real GitLab infra — issues, branches, focus files, QA —
    onto a project, re-key the draft tasks → real (in_progress), persist the record, then drop the relay from
    the in-flight board. Called by the dispatch endpoint AND the ratify-close hook. `project_id`: a delta
    target / a reserved pid; None = create fresh (reserve+scaffold in one). Idempotent (RELAYS-absent guard,
    serialized per plan by _dispatch_lock so concurrent callers can't both pass the guard)."""
    async with _dispatch_lock(plan_id):
        result = await _finalize_scaffold_locked(plan_id, plan, project_id=project_id)
    _DISPATCH_LOCKS.pop(plan_id, None)  # finished (or no-op) — don't leak a lock per dispatched plan
    return result


async def _finalize_scaffold_locked(plan_id: str, plan: PlanJSON, *, project_id: int | None = None) -> dict:
    if plan_id not in RELAYS:  # already finalized (a re-ratify after the relay was popped) → no double-scaffold
        return RESULTS.get(plan_id, {})
    from app import trace
    run = f"{plan_id}:dispatch"
    trace.clear(run); trace.begin(run)  # the dispatch is a real, slow process — make it VISIBLE (was trace-silent)
    trace.step("server", "thought", "Dispatching the relay to GitLab",
               f"{sum(len(e.issues) for e in plan.epics)} issue(s) · focus branches · acceptance checklist")
    seeds = await _build_reuse_pointers(plan_id, plan)  # reuse layer-2: pointers → fetched live by /api/focus
    await _store_focus_contexts(plan, seeds)  # /api/focus serves these on checkout (nothing committed)
    if plan_id in DELTA_TARGET:  # mid-prod: append to the existing project
        pid = DELTA_TARGET[plan_id]
        result = await run_in_threadpool(lambda: extend_project(plan, pid, reuse_seeds=seeds))
        result["project_id"] = pid
        if pid in PROJECTS:  # grow the live plan so QA + later deltas see the new issues
            PROJECTS[pid].epics.extend(plan.epics)
        try:  # refresh the durable record so the NEXT feature-add grounds on current titles + files
            rec = await get_project_record(pid)
            if rec and rec.get("plan"):
                merged = PlanJSON(**rec["plan"])
                merged.epics.extend(plan.epics)
                await update_project_record(pid, {"plan": merged.model_dump(), "module_manifest": _manifest_of(merged)})
        except Exception as e:
            result["persist_warning"] = str(e)[:200]
    elif project_id is not None:  # RESERVED project (two-phase): scaffold the heavy infra onto the empty repo
        reserved = RESERVED.get(plan_id) or {}
        result = await run_in_threadpool(lambda: scaffold_project(
            plan, project_id, web_url=reserved.get("web_url", ""), clone_url=reserved.get("clone_url", ""),
            default_branch=reserved.get("default_branch", "main"), reuse_seeds=seeds))
        result["project_id"] = project_id
        result.setdefault("web_url", reserved.get("web_url", ""))
        PROJECTS[project_id] = plan
        try:  # flip reserved → in_progress + refresh plan/stack/manifest (the stack may have changed at the setup gate)
            await update_project_record(project_id, {"status": "in_progress", "plan": plan.model_dump(),
                                                     "tech_stack": plan.tech_stack.model_dump(),
                                                     "module_manifest": _manifest_of(plan)})
        except Exception as e:
            result["persist_warning"] = str(e)[:200]
        try:
            await record_reuse_lineage(plan_id, plan, project_id)
        except Exception:
            pass
    else:  # legacy single-shot: reserve + scaffold now (no prior reservation)
        result = await run_in_threadpool(lambda: execute_plan(plan, reuse_seeds=seeds))
        PROJECTS[result["project_id"]] = plan
        record = ProjectRecord(
            project_id=result["project_id"], name=plan.project_name, web_url=result.get("web_url", ""),
            tech_stack=plan.tech_stack, grounded_on=plan.grounded_on, plan=plan, module_manifest=_manifest_of(plan),
        )
        rec = record.model_dump()
        rec["created_at"] = datetime.now(timezone.utc).isoformat()
        try:
            await save_project_record(rec)
        except Exception as e:
            result["persist_warning"] = str(e)[:200]
        try:  # Living Project Graph: record content-addressed reuse lineage (derived_from)
            await record_reuse_lineage(plan_id, plan, result["project_id"])
        except Exception:
            pass
    trace.step("gitlab", "result", "Project scaffolded on GitLab",
               f"{result.get('issues_created', 0)} issue(s) · {result.get('context_branches', 0)} focus branch(es) · QA checklist")
    # Re-key the plan's Tasks from the placeholder to the real project_id + flip to in_progress.
    objs: list = []  # the materialized tasks — the dispatch-validation count (always defined, even if the block throws)
    try:
        real_pid = result["project_id"]
        now = datetime.now(timezone.utc).isoformat()
        await delete_tasks_for_project(_plan_pid(plan_id))  # drop this plan's placeholder draft tasks
        iid_by_title = {i.get("title"): i.get("iid") for i in result.get("issues", [])}
        objs = tasklib.materialize_tasks(plan, real_pid, now)
        feat_pri = DELTA_PRIORITY.get(plan_id)
        for o in objs:
            o.status = "in_progress"
            o.gitlab_issue_iid = iid_by_title.get(o.title)
            if feat_pri:
                o.priority = feat_pri
        await team.ensure_loaded()
        avail = scheduler.blocked_days(_reflow_change_events(await all_events()))
        scheduler.schedule_tasks(objs, team.all_members(), now, availability=avail)  # availability-aware
        await save_tasks([o.model_dump() for o in objs])
        prior = {d["id"]: (d.get("scheduled_start"), d.get("scheduled_end")) for d in await tasks_for_project(real_pid)}
        await _reschedule_project(real_pid)
        if plan_id in DELTA_TARGET:  # a feature shifted the existing roadmap → propose the impact to the manager
            after = await tasks_for_project(real_pid)
            moved = [d for d in after if (d.get("scheduled_start"), d.get("scheduled_end")) != prior.get(d["id"])]
            ev = ChangeEvent(id=f"evt_{uuid.uuid4().hex[:8]}", kind="scope_change", project_id=real_pid,
                             payload={"feature": plan.project_name}, created_at=now)
            try:
                await save_event(ev.model_dump())
            except Exception:
                pass
            await _maybe_strategize(ev, moved, prior)
    except Exception:
        pass  # never block the scaffold on task persistence
    # Callback VALIDATION — confirm the dispatch REALLY landed (GitLab issues + Mongo tasks) before declaring it
    # shipped. A soft failure (0 issues / 0 tasks) keeps the relay on the board (dispatch="failed") for retry.
    result["tasks_created"] = len(objs)
    result["ok"] = result.get("issues_created", 0) > 0 and result["tasks_created"] > 0
    RESULTS[plan_id] = result
    await _persist("results", plan_id, result)
    if not result["ok"]:
        st = RELAYS.get(plan_id)
        if st is not None:
            st.dispatch = "failed"
            await _persist_relay(plan_id)
        trace.step("server", "result", "Dispatch failed", "GitLab issues or tasks did not land — kept for retry")
        return result
    try:  # durable runtime: scaffolded → leaves the in-flight pool on replay (PROJECTS owns it now)
        await eventlog.emit(const.EventKind.PLAN_SCAFFOLDED, created_at=datetime.now(timezone.utc).isoformat(),
                            payload={"plan_id": plan_id, "project_id": result.get("project_id")})
    except Exception:
        pass
    trace.step("server", "result", "Relay shipped", f"{plan.project_name} is live — {result['tasks_created']} tasks in Projects + Tester")
    _st = RELAYS.get(plan_id)
    if _st is not None:  # stamp the FINAL phase on the state object — the ratify response carries it after the pop
        _st.dispatch = "shipped"
    # The relay is FINISHED → drop it from the in-flight board (the project now lives in Projects + Tester).
    RELAYS.pop(plan_id, None)
    PLANS.pop(plan_id, None)
    RESERVED.pop(plan_id, None)
    DELTA_TARGET.pop(plan_id, None)      # a finished delta → drop its target link + priority (no longer in-flight)
    DELTA_PRIORITY.pop(plan_id, None)
    for _s in ("plans", "relays", "reserved", "delta_target", "delta_priority"):  # durable: the finished relay leaves the in-flight snapshot too
        await _unpersist(_s, plan_id)
    return result


@app.post("/api/plans/{plan_id}/reserve")
async def reserve_plan(plan_id: str, req: DispatchRequest, _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    """Phase 1 of two-phase create (the wizard 'Create'): RESERVE the GitLab project — an empty repo, name
    only — and KEEP the relay OPEN so the leads ratify their gates live. The real scaffold (issues, branches,
    focus files, QA + the work tasks) fires AUTOMATICALLY when the relay closes (the last gate's ratify).
    No GitLab work here beyond the empty repo; nothing is auto-approved."""
    async with _dispatch_lock(plan_id):  # a double-clicked Create must hit the RESERVED guard, not create twice
        return await _reserve_locked(plan_id, req)


async def _reserve_locked(plan_id: str, req: DispatchRequest) -> dict:
    plan, state = PLANS.get(plan_id), RELAYS.get(plan_id)
    if plan is None or state is None:
        raise HTTPException(404, "plan not found")
    if plan_id in RESERVED:  # idempotent — already reserved
        r = RESERVED[plan_id]
        return {"project_id": r["project_id"], "web_url": r.get("web_url", ""), "relay_open": True}
    if req.project_name and req.project_name.strip():  # the manager validated/edited the AI-filled name
        plan.project_name = req.project_name.strip()[:80]
    from app import trace
    bid = plan_id.removeprefix("plan_"); trace.clear(f"{bid}:create"); trace.begin(f"{bid}:create")  # phase-scoped run
    trace.step("gitlab", "action", "Create the GitLab project", plan.project_name)
    try:
        res = await run_in_threadpool(lambda: reserve_project(plan, plan.project_name))  # contextvar can't cross the threadpool — bracket the real op here
    except Exception as e:  # a GitLab failure must return a clean 502 (CORS headers attach), never an unhandled 500
        trace.step("gitlab", "result", "GitLab rejected the create", str(e)[:140])
        raise HTTPException(502, f"GitLab could not reserve the project: {str(e)[:200]}")
    trace.step("gitlab", "result", f"project #{res['project_id']} reserved", res.get("web_url", ""))
    RESERVED[plan_id] = res
    await _persist("reserved", plan_id, res)          # durable: survive a restart between reserve and close
    await _persist_relay(plan_id)                     # the (possibly edited) name lives on the plan snapshot
    PROJECTS[res["project_id"]] = plan
    record = ProjectRecord(
        project_id=res["project_id"], name=plan.project_name, web_url=res.get("web_url", ""),
        tech_stack=plan.tech_stack, grounded_on=plan.grounded_on, plan=plan,
        module_manifest=_manifest_of(plan), status="reserved",
    )
    rec = record.model_dump()
    rec["created_at"] = datetime.now(timezone.utc).isoformat()
    try:
        await save_project_record(rec)
    except Exception:
        pass
    try:  # durable runtime: re-fold RESERVED on a restart from this event
        await eventlog.emit(const.EventKind.PROJECT_RESERVED, created_at=datetime.now(timezone.utc).isoformat(),
                            payload={"plan_id": plan_id, "reserved": res})
    except Exception:
        pass
    _spawn(_draft_contracts(plan_id, plan))  # contract-first: draft the interfaces from the feature, in parallel
    # Creation is announced the moment it's REAL: the project ping first, then the relay ping (a relay can
    # also be born alone via add-feature, which fires only relay_created).
    await team.ensure_loaded()
    _gate_count = len(state.gates)
    for _u in sorted(_relay_recipients(plan, state)):
        await notify(_u, "project_created", f"Project {plan.project_name} created",
                     ref={"plan_id": plan_id, "project_id": res["project_id"]})
        await notify(_u, "relay_created", f"{plan.project_name}: relay created · {_gate_count} gates",
                     ref={"plan_id": plan_id, "project_id": res["project_id"]})
    # The wizard's Create finishes only when the FIRST WAVE is OPEN — await its option drafting (visible in
    # the create trace; Gemini/MCP steps from inside the drafting land here too). Downstream waves keep
    # pre-generating in the background on each ratify (the board shows them as "preparing"). A per-gate
    # failure degrades to the lazy GET — it can slow the Create but never fail it.
    first_wave = [g.discipline for g in state.gates
                  if g.status in ("pending", "changes_requested") and (plan_id, g.discipline) not in SOLUTIONS
                  and any(i.discipline == g.discipline for e in plan.epics for i in e.issues)]

    async def _draft_one(disc: str) -> None:
        trace.step("gemini", "action", f"Drafting {disc} options", "reuse-or-innovate, grounded on agency memory")
        try:
            sset = await _generate_gate_solutions(plan_id, plan, disc)
            trace.step("gemini", "result", f"{disc} options ready", f"{len(sset.solutions)} choice(s) for the lead")
        except Exception:
            trace.step("server", "result", f"{disc} options delayed", "the gate drafts them on open instead")

    if first_wave:
        await asyncio.gather(*(_draft_one(d) for d in first_wave))
    trace.step("server", "result", "Relay open", "each gate is its lead's to ratify; tasks scaffold to GitLab on close")
    return {"project_id": res["project_id"], "web_url": res.get("web_url", ""), "relay_open": True}


@app.post("/api/plans/{plan_id}/dispatch")
async def dispatch_plan(plan_id: str, req: DispatchRequest, _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    """Manual scaffold (delta/add-feature, or a legacy single-shot). Requires the relay CLEARED — the normal
    two-phase path auto-scaffolds when the last gate ratifies, so this is the delta + fallback door."""
    plan, state = PLANS.get(plan_id), RELAYS.get(plan_id)
    if plan is None or state is None:
        raise HTTPException(404, "plan not found")
    if not relay.all_ratified(state):  # never scaffold an un-ratified relay
        pending = [g.discipline for g in state.gates if g.status not in const.DONE]
        raise HTTPException(409, f"relay not cleared — {len(pending)} open gate(s): {', '.join(pending)}")
    if req.project_name and req.project_name.strip():  # manager validated/edited the AI-filled name
        plan.project_name = req.project_name.strip()[:80]
    pid = DELTA_TARGET.get(plan_id) or (RESERVED.get(plan_id) or {}).get("project_id")
    result = await _finalize_scaffold(plan_id, plan, project_id=pid)
    return {"plan_id": plan_id, "mode": req.mode, **result}


class RejectRequest(BaseModel):
    comment: str
    to_runner: Optional[str] = None


class MergeRequest(BaseModel):
    gitlab_username: str
    task_type: str
    score: float = 0.85
    project_id: Optional[int] = None  # if set with issue_iid, clears the issue from the re-QA queue
    issue_iid: Optional[int] = None
    plan_id: Optional[str] = None         # with issue_id + output_sample: verify the merged slice vs its contract
    issue_id: Optional[str] = None        # the plan's producer issue id (e.g. "E1-1")
    output_sample: Optional[dict] = None  # the producer's real response shape (what the dev's CI already verified)


@app.post("/api/projects/{project_id}/issues/{iid}/reject")
async def reject_issue(
    project_id: int, iid: int, req: RejectRequest, member: DeveloperProfile = Depends(auth.current_member)
) -> dict:
    """Tester reject → reopen + route back to the responsible-layer runner. Flags the issue for re-QA
    so it re-enters the checklist once the fix is merged. Two-plane: a failed check is a TICKET routed
    to the runner's profile (never a new relay) — so ping their Inbox to make that routing visible.
    Authorized to the acceptance/qa-gate owner or the manager — it triggers a real GitLab reopen."""
    await team.ensure_loaded()
    if not (_is_qa_owner(member, team.all_members()) or member.is_manager):
        raise HTTPException(403, "only the acceptance/qa owner or the manager can reject an item")
    res = await run_in_threadpool(handoff.reroute, project_id, iid, req.comment, req.to_runner)
    REQA.setdefault(project_id, set()).add(iid)
    await _persist("reqa", project_id, {"v": sorted(REQA[project_id])})  # durable re-QA queue
    if req.to_runner:  # surface the bounce as an actionable ticket on the runner's Inbox + watchers
        await notify(req.to_runner, "qa_failed", f"Tester bounced an item back to you (#{iid})",
                     body=(req.comment or "An acceptance check failed — reopened for a fix.")[:300],
                     ref={"project_id": project_id, "iid": iid}, actionable=True)
        await notify_watchers(req.to_runner, "qa_failed", f"@{req.to_runner} got a Tester reject: #{iid}",
                              ref={"project_id": project_id, "iid": iid})
    return {**res, "awaiting_reqa": sorted(REQA[project_id])}


@app.post("/api/projects/{project_id}/features")
async def add_feature(project_id: int, req: FeatureRequest, _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    """Mid-prod: a feature brief → delta plan grounded on the live project → its own relay.
    Ratify + dispatch as usual; dispatch then EXTENDS this project instead of scaffolding."""
    record = await get_project_record(project_id)
    if not record:
        raise HTTPException(404, "no project record — dispatch a plan first")
    plan = await delta_brief(req.text, record, req.constraints)
    plan_id = f"plan_delta_{project_id}_{uuid.uuid4().hex[:6]}"
    PLANS[plan_id] = plan
    RELAYS[plan_id] = relay.build_relay(plan)
    DELTA_TARGET[plan_id] = project_id
    DELTA_PRIORITY[plan_id] = req.priority
    _spawn(_draft_contracts(plan_id, plan))  # contract-first: draft the delta's interfaces from the feature
    _pregenerate_open_gates(plan_id)  # the delta's first wave starts preparing now (board pulses, no lazy-GET stall)
    await _persist_relay(plan_id)  # durable: the delta plan + relay survive a restart
    await _persist("delta_target", plan_id, {"v": project_id})
    await _persist("delta_priority", plan_id, {"v": req.priority})
    await team.ensure_loaded()  # a relay born WITHOUT a project create → only the relay ping
    for _u in sorted(_relay_recipients(plan, RELAYS[plan_id])):
        await notify(_u, "relay_created", f"{plan.project_name}: relay created · {len(RELAYS[plan_id].gates)} gates",
                     ref={"plan_id": plan_id, "project_id": project_id})
    # No pre-ratification draft tasks (see make_plan): the delta's tasks materialize at _finalize_scaffold.
    # (Subteam pacts CUT 2026-06-09 — interface contracts stay JIT.)
    return {"plan_id": plan_id, "project_id": project_id, "plan": plan.model_dump(), "relay": RELAYS[plan_id].model_dump()}


@app.post("/api/plans/{plan_id}/reschedule-preview")
async def reschedule_preview(plan_id: str, _: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Tier C dry-run: schedule a delta plan's draft tasks against the LIVE project WITHOUT persisting,
    returning the impact (existing tasks pushed + who picks up load) so the wizard shows consequences
    BEFORE dispatch. Deterministic — zero AI tokens."""
    pid = DELTA_TARGET.get(plan_id)
    if pid is None:
        raise HTTPException(404, "not a delta plan — nothing live to preview against")
    existing = [Task(**d) for d in await tasks_for_project(pid)]
    drafts = [Task(**d) for d in await tasks_for_project(_plan_pid(plan_id))]
    for d in drafts:
        d.project_id = pid  # share the project's assignee calendar (in-memory only; never saved)
    prior = {t.id: t.scheduled_end for t in existing}
    await team.ensure_loaded()
    members = team.all_members()
    avail = scheduler.blocked_days(_reflow_change_events(await all_events()))
    scheduler.schedule_tasks(existing + drafts, members, datetime.now(timezone.utc).isoformat(), availability=avail)
    moved = [{"task_id": t.id, "title": t.title, "assignee": t.assignee, "old_end": prior.get(t.id), "new_end": t.scheduled_end}
             for t in existing if t.scheduled_end != prior.get(t.id)]
    by_user = {m.username: m for m in members}
    load: dict[str, float] = {}
    for d in drafts:
        if d.assignee:
            load[d.assignee] = load.get(d.assignee, 0.0) + d.estimate_days
    capacity = []  # per-person load before -> after (~10% per added task-day over a 2-week sprint)
    for u, days in sorted(load.items(), key=lambda x: -x[1]):
        m = by_user.get(u)
        before = int(m.load) if m else 0
        capacity.append({"username": u, "name": (m.name if m else u), "before": before,
                         "after": before + round(days * 10), "added_days": round(days, 1)})
    at_risk = sum(1 for c in capacity if c["after"] > 100)
    untouched = [{"id": t.id, "title": t.title, "status": t.status} for t in existing if t.status == "in_progress"][:8]
    return {"pushed": len(moved), "moved": moved[:12], "capacity": capacity,
            "untouched": untouched, "feature_tasks": len(drafts), "at_risk": at_risk}


class QuickTaskRequest(BaseModel):
    title: str
    discipline: Discipline
    estimate_days: float = 1.0
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    assignee: Optional[str] = None
    depends_on: list[str] = []


@app.post("/api/projects/{project_id}/tasks")
async def create_task(project_id: int, req: QuickTaskRequest, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Tier D ad-hoc quick-add: a manager or the discipline lead adds a task. It still flows through the
    engine — auto-routed by load, scheduled + reflowed (an urgent one cascades) — tagged with human
    provenance (assigned_by = the creator), never a side-door ticket."""
    if not (member.is_manager or member.covers(req.discipline)):
        raise HTTPException(403, "only the manager or a lane coverer can add a task here")
    await team.ensure_loaded()
    devs = team.all_members()
    assignee = req.assignee
    if not assignee:  # auto-route: lowest-load coverer of the discipline
        cand = min((m for m in devs if m.covers(req.discipline) and m.load < 100), key=lambda m: m.load, default=None)
        assignee = cand.username if cand else None
    now = datetime.now(timezone.utc).isoformat()
    t = Task(id=f"adhoc_{uuid.uuid4().hex[:8]}", project_id=project_id, title=req.title, description="",
             discipline=req.discipline, assignee=assignee, assigned_by=member.username,
             estimate_days=req.estimate_days, priority=req.priority, depends_on=req.depends_on,
             status="planned", context_scope=ContextScope(files=[]), created_at=now, updated_at=now)
    await save_tasks([t.model_dump()])
    await _reschedule_project(project_id)  # the ad-hoc task reflows + cascades like any other work
    if assignee and assignee != member.username:
        await notify(assignee, "task_assigned", f"Task added to you: {t.title}",
                     body=f"@{member.username} added '{t.title}' ({req.discipline}).",
                     ref={"task_id": t.id, "project_id": project_id})
    return (await get_task(t.id)) or t.model_dump()


class SuggestRequest(BaseModel):
    title: str


@app.post("/api/tasks/suggest")
async def suggest_task(req: SuggestRequest, _: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Opt-in quick-add helper: infer discipline / estimate / priority from a task title. Deterministic
    keyword heuristic — zero AI cost (swap in a Gemini agent later if smarter inference is wanted)."""
    s = req.title.lower()
    disc = ("uiux" if any(k in s for k in ("design", "figma", "ui/ux", "wireframe", "mockup")) else
            "qa" if any(k in s for k in ("test", "qa", "acceptance", "e2e", "regression")) else
            "devops" if any(k in s for k in ("deploy", " ci", "cd ", "infra", "pipeline", "docker", "k8s", "terraform")) else
            "frontend" if any(k in s for k in ("page", "component", "css", "screen", "button", "form", "modal")) else
            "backend")
    pri = ("urgent" if any(k in s for k in ("urgent", "asap", "critical", "hotfix", "p0", "outage")) else
           "high" if any(k in s for k in ("important", "high priority", "p1")) else "normal")
    est = 3.0 if any(k in s for k in ("refactor", "migration", "rewrite", "redesign")) else 1.0
    return {"discipline": disc, "estimate_days": est, "priority": pri}


# ── Work hub (Phase A): Tasks aggregate + per-task edit/claim/status ──
class TaskPatch(BaseModel):
    patch: dict


@app.get("/api/work")
async def work(scope: str = "me", member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Aggregate of Tasks for the Work hub. scope = me | team | user:<username>. Team visibility is OPEN —
    every logged-in member sees everyone's tasks in full (no consent gating)."""
    who = member.username if scope == "me" else (scope.split(":", 1)[1] if scope.startswith("user:") else None)
    try:
        rows = await all_tasks(assignee=who)   # me | user:<name> filtered server-side; team (who=None) → all
    except Exception:
        rows = []
    for r in rows:  # conventional branch + gateway bootstrap command (token-gated), built server-side
        if (r.get("kind") or "code") in ("code", "infra"):
            r["branch"] = handoff.branch_for(r.get("title", ""), r["id"])
            r["focus_command"] = focus_command_for(r["id"], r.get("title", ""))
    return {"scope": scope, "count": len(rows), "tasks": rows}


async def _load_task_or_404(task_id: str) -> Task:
    doc = await get_task(task_id)
    if not doc:
        raise HTTPException(404, "no such task")
    return Task(**doc)


@app.get("/api/tasks/{task_id}")
async def task_detail(task_id: str, _: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Open team visibility — any logged-in member sees a task in full."""
    doc = await get_task(task_id)
    if not doc:
        raise HTTPException(404, "no such task")
    return doc


@app.patch("/api/tasks/{task_id}")
async def edit_task(task_id: str, body: TaskPatch, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    t = await _load_task_or_404(task_id)
    now = datetime.now(timezone.utc).isoformat()
    try:
        updated = tasklib.apply_edit(t, body.patch, editor_role=member.role, editor_user=member.username,
                                     editor_discipline=member.discipline, now=now)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    await update_task(task_id, updated.model_dump())
    return updated.model_dump()


@app.post("/api/tasks/{task_id}/claim")
async def claim_task(task_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """A developer self-assigns an UNASSIGNED task in their own discipline."""
    t = await _load_task_or_404(task_id)
    if t.assignee:
        raise HTTPException(409, "task already assigned — ask a lead or the manager to reassign")
    if not member.covers(t.discipline):
        raise HTTPException(403, "you can only claim tasks in a lane you cover")
    updated = tasklib.claim(t, user=member.username, now=datetime.now(timezone.utc).isoformat())
    await update_task(task_id, updated.model_dump())
    await _reschedule_project(updated.project_id)  # owner changed → re-pack the calendar
    return updated.model_dump()


@app.post("/api/tasks/{task_id}/release")
async def release_task(task_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The owner — or a lead / the manager — drops the assignment back to the pool."""
    t = await _load_task_or_404(task_id)
    if t.assignee != member.username and "assignee" not in tasklib.can_edit(
        t, editor_role=member.role, editor_user=member.username, editor_discipline=member.discipline
    ):
        raise HTTPException(403, "only the owner, a lead, or the manager can release this task")
    updated = tasklib.release(t, now=datetime.now(timezone.utc).isoformat())
    await update_task(task_id, updated.model_dump())
    await _reschedule_project(updated.project_id)
    return await get_task(task_id) or updated.model_dump()  # return the freshly re-scheduled task


@app.post("/api/tasks/{task_id}/reassign")
async def reassign_task(task_id: str, assignee: str = "", member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Manager / discipline lead reassigns a task to another member (assignee="" → unassign)."""
    t = await _load_task_or_404(task_id)
    # human-in-control: the manager / discipline lead can reassign, AND the current owner can hand off
    # their own task to anyone (the AI's pick is never the final word).
    is_owner = bool(t.assignee) and t.assignee == member.username
    if not is_owner and "assignee" not in tasklib.can_edit(
        t, editor_role=member.role, editor_user=member.username, editor_discipline=member.discipline
    ):
        raise HTTPException(403, "only the owner, the discipline lead, or the manager can reassign this task")
    new = assignee or None
    try:
        updated = tasklib.apply_edit(t, {"assignee": new}, editor_role=member.role, editor_user=member.username,
                                     editor_discipline=member.discipline, now=datetime.now(timezone.utc).isoformat())
    except PermissionError as e:
        raise HTTPException(403, str(e))
    updated.assigned_by = member.username if new else "ai"  # provenance: placed by the reassigner
    await update_task(task_id, updated.model_dump())
    await _reschedule_project(updated.project_id)
    if new and new != member.username:  # ping the new owner's Inbox (skip unassign + self-reassign)
        await notify(new, "task_assigned", f"Task assigned to you: {updated.title}",
                     body=f"@{member.username} assigned you “{updated.title}”.",
                     ref={"task_id": task_id, "project_id": updated.project_id})
        await notify_watchers(new, "assigned", f"@{new} was assigned “{updated.title}”",
                              ref={"task_id": task_id, "project_id": updated.project_id})
    return await get_task(task_id) or updated.model_dump()  # return the freshly re-scheduled task


_TRUST_W = {"low": 0.0, "medium": 0.5, "high": 1.0}
_SEN_W = {"junior": 0.34, "mid": 0.67, "senior": 1.0}


def _rank_candidates(discipline: str, members: list[DeveloperProfile], *, exclude: str | None = None) -> list[dict]:
    """Passport-fit ranking for handing off work in `discipline` — roster-only (no vector search), so it
    works in demo. Blends per-lane trust, availability (sooner-free), lane-match, and seniority. The
    manager is never recommended as a worker. Best first."""
    out = []
    for m in members:
        if m.is_manager or m.username == exclude:
            continue
        trust_tier = m.trust_in(discipline)
        trust = _TRUST_W.get(trust_tier, 0.0)
        fid = m.availability.free_in_days if m.availability else None
        avail = max(0.0, 1 - min(int(fid), 15) / 15) if fid is not None else 1 - min(100, m.load) / 100
        in_lane = m.covers(discipline)
        sen = _SEN_W.get(m.seniority, 0.67)
        s = 0.40 * trust + 0.30 * avail + 0.20 * (1.0 if in_lane else 0.0) + 0.10 * sen
        why = " · ".join([
            f"{discipline} lead" if in_lane else f"stretch from {m.discipline or 'no lane'}",
            m.seniority, f"trust {trust_tier}",
            "free now" if fid == 0 else f"free in {fid}d" if fid is not None else f"{m.load}% load",
        ])
        out.append({"username": m.username, "name": m.name, "discipline": m.discipline,
                    "score": round(s * 100), "in_lane": in_lane, "why": why})
    out.sort(key=lambda c: c["score"], reverse=True)
    return out


@app.get("/api/tasks/{task_id}/candidates")
async def task_candidates(task_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Passport-ranked teammates to hand this task to (best fit first), powering the reassign picker."""
    t = await _load_task_or_404(task_id)
    members = await _attach_availability(team.all_members())
    return {"task_id": task_id, "discipline": t.discipline, "candidates": _rank_candidates(t.discipline, members, exclude=t.assignee)}


@app.post("/api/tasks/{task_id}/status")
async def task_status(task_id: str, status: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    t = await _load_task_or_404(task_id)
    if not tasklib.can_edit(t, editor_role=member.role, editor_user=member.username, editor_discipline=member.discipline):
        raise HTTPException(403, "not allowed")
    try:
        updated = tasklib.set_status(t, status, now=datetime.now(timezone.utc).isoformat())
    except ValueError as e:
        raise HTTPException(400, str(e))
    await update_task(task_id, updated.model_dump())
    if updated.status != t.status:
        await _on_task_status_change(updated, t.status, member)
    return updated.model_dump()


async def _on_task_status_change(t: Task, prev: str, actor: DeveloperProfile) -> None:
    """Side effects of a status change: reflow the project on Done (completed work frees capacity →
    downstream re-packs) and notify reviewers / manager / dependents. Best-effort — never raises."""
    try:
        if t.status == "done":
            ev = ChangeEvent(id=f"evt_{uuid.uuid4().hex[:8]}", kind="task_done", task_id=t.id,
                             project_id=t.project_id, user_id=t.assignee,
                             created_at=datetime.now(timezone.utc).isoformat())
            try:
                await save_event(ev.model_dump())
            except Exception:
                pass
            await _reschedule_project(t.project_id)
        await team.ensure_loaded()
        members = team.all_members()
        if t.status == "in_review":
            reviewers = [m for m in members if any(relay.lane_stage(d) == "accept" for d in m.disciplines)] or [m for m in members if m.is_manager]
            for r in reviewers:
                if r.username != actor.username:
                    await notify(r.username, "ratify_needed", f"Ready for review: {t.title}",
                                 body=f"@{actor.username} moved '{t.title}' to In Review.",
                                 ref={"task_id": t.id, "project_id": t.project_id}, actionable=True)
        elif t.status == "done":
            mgr = next((m for m in members if m.is_manager), None)
            if mgr and mgr.username != actor.username:
                await notify(mgr.username, "task_completed", f"Task done: {t.title}",
                             body=f"@{actor.username} marked '{t.title}' done.",
                             ref={"task_id": t.id, "project_id": t.project_id})
            for d in await tasks_for_project(t.project_id):
                dt = Task(**d)
                if t.id in (dt.depends_on or []) and dt.assignee and dt.assignee != actor.username:
                    await notify(dt.assignee, "task_assigned", f"Unblocked: {dt.title}",
                                 body=f"'{t.title}' is done — {dt.title} can start.",
                                 ref={"task_id": dt.id, "project_id": t.project_id})
    except Exception:
        pass


@app.post("/api/tasks/{task_id}/pin")
async def pin_task(task_id: str, pinned: bool = True, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Lock (or unlock) a task's dates so the reflow engine never moves it (Reclaim-style lock).
    The scheduler already honors Task.pinned — this is the only path that sets it."""
    t = await _load_task_or_404(task_id)
    if not member.is_manager and t.assignee != member.username:
        raise HTTPException(403, "only the manager or the task's owner can pin/unpin it")
    now = datetime.now(timezone.utc).isoformat()
    await update_task(task_id, {"pinned": pinned, "updated_at": now})
    t.pinned, t.updated_at = pinned, now
    return t.model_dump()


async def _reschedule_project(project_id: int) -> int:
    """Re-run the deterministic scheduler for a project's Tasks + persist the dates (best-effort).
    Called after any assignment change so the old + new owner's calendars re-pack. Returns the count."""
    try:
        docs = await tasks_for_project(project_id)
        if not docs:
            return 0
        objs = [Task(**d) for d in docs]
        await team.ensure_loaded()
        avail = scheduler.blocked_days(_reflow_change_events(await all_events()))
        # Full re-solve is intentional here (a reassignment must reclaim the old owner's freed capacity —
        # reflow's minimal-perturbation floor would not), but only persist the tasks whose dates moved.
        prior = {o.id: (o.scheduled_start, o.scheduled_end) for o in objs}
        scheduler.schedule_tasks(objs, team.all_members(), datetime.now(timezone.utc).isoformat(), availability=avail)
        for o in objs:
            if (o.scheduled_start, o.scheduled_end) != prior[o.id]:
                await update_task(o.id, {"scheduled_start": o.scheduled_start, "scheduled_end": o.scheduled_end})
        return len(objs)
    except Exception:
        return 0  # never fail an assignment over the recompute


@app.post("/api/schedule/recompute")
async def recompute_schedule(project_id: int, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Re-run the deterministic scheduler for a project's Tasks and persist the dates."""
    return {"project_id": project_id, "scheduled": await _reschedule_project(project_id)}


# ── Reflow engine: one event-driven, cross-roadmap, minimal-perturbation re-flow path ──
async def _reflow_for_event(ev: ChangeEvent) -> tuple[list[dict], dict]:
    """Incremental, availability-aware, cross-project reflow for a single change event. Recomputes
    only the affected subgraph (minimal perturbation), persists ONLY tasks whose dates moved, returns
    them. A work event marks its task changed (and applies an estimate change); a calendar event marks
    the affected person's whole task stream. Best-effort: never raises into the request."""
    try:
        objs = [Task(**d) for d in await all_tasks()]
        if not objs:
            return [], {}
        if ev.task_id:                                            # work/assignment event on one task
            changed = [ev.task_id]
            if ev.kind == "estimate_change" and "new" in ev.payload:
                new_est = float(ev.payload["new"])
                for o in objs:
                    if o.id == ev.task_id:
                        o.estimate_days = new_est
                await update_task(ev.task_id, {"estimate_days": new_est})
        elif ev.user_id:                                          # calendar event → that person's tasks
            changed = [o.id for o in objs if o.assignee == ev.user_id]
        else:
            changed = []
        if not changed:
            return [], {}
        await team.ensure_loaded()
        avail = scheduler.blocked_days(_reflow_change_events(await all_events()))
        prior = {o.id: (o.scheduled_start, o.scheduled_end) for o in objs}
        scheduler.reflow(objs, team.all_members(), datetime.now(timezone.utc).isoformat(),
                         changed, availability=avail)
        moved = [o for o in objs if (o.scheduled_start, o.scheduled_end) != prior[o.id]]
        for o in moved:                                           # only-changed write (not N updates)
            await update_task(o.id, {"scheduled_start": o.scheduled_start, "scheduled_end": o.scheduled_end})
        return [o.model_dump() for o in moved], prior
    except Exception:
        return [], {}


SEMANTIC_KINDS = {"spec_change", "scope_change", "blocked"}  # content changes the date-graph can't judge
STRATEGIST_IMPACT_THRESHOLD = 3                              # tasks moved → high-impact enough to ask the AI


async def _maybe_strategize(ev: ChangeEvent, moved: list[dict], prior: dict | None = None) -> dict | None:
    """Fire the AI Strategist only when the change is semantic or high-impact (keeps tokens near-zero).
    It sees only the delta; low-impact strategies auto-apply (the reflow already shifted), high-impact
    ones are proposed to the manager + each affected person is notified. Best-effort — never raises."""
    if ev.kind not in SEMANTIC_KINDS and len(moved) < STRATEGIST_IMPACT_THRESHOLD:
        return None
    try:
        impacted = [Task(**d) for d in moved]
        if ev.task_id and not any(t.id == ev.task_id for t in impacted):
            ct = await get_task(ev.task_id)
            if ct:
                impacted.append(Task(**ct))
        if not impacted:
            return None
        await team.ensure_loaded()
        strategy = await strategist.judge(ev, impacted, team.all_members())
        affected = sorted({t.assignee for t in impacted if t.assignee})
        if not strategist.should_auto_apply(strategy):
            prop = RescheduleProposal(
                id=f"rsp_{uuid.uuid4().hex[:8]}", project_id=ev.project_id, event=ev, strategy=strategy,
                impacted=[ImpactedTask(task_id=t.id, title=t.title, assignee=t.assignee,
                                       old_start=(prior or {}).get(t.id, (None, None))[0],
                                       old_end=(prior or {}).get(t.id, (None, None))[1],
                                       scheduled_start=t.scheduled_start, scheduled_end=t.scheduled_end)
                          for t in impacted],
                affected_users=affected, created_at=datetime.now(timezone.utc).isoformat(),
            )
            try:
                await save_reschedule_proposal(prop.model_dump())
            except Exception:
                pass
            mgr = next((m for m in team.all_members() if m.is_manager), None)
            if mgr:
                await notify(mgr.username, "reschedule_proposed", "AI reschedule strategy proposed",
                             body=strategy.impact_summary or strategy.rationale,
                             ref={"proposal_id": prop.id}, actionable=True)
        for n in strategist.impact_notifications(impacted, ev):
            await notify(n["user_id"], "reschedule_proposed", n["title"], body=n["body"])
        return strategy.model_dump()
    except Exception:
        return None


class EventRequest(BaseModel):
    kind: str
    user_id: str | None = None
    task_id: str | None = None
    project_id: int | None = None
    start: str | None = None     # ISO date — for date-range calendar events (sick/holiday/time_off)
    end: str | None = None
    payload: dict = {}           # kind-specific, e.g. {"new": 6.0} for an estimate_change


@app.post("/api/events")
async def post_event(req: EventRequest, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Record a change (calendar or work) and re-flow the affected calendars across the roadmap.
    Returns only the tasks whose dates moved — minimal perturbation, so the UI patches just those —
    plus an optional AI Strategist proposal when the change is semantic or high-impact."""
    ev = ChangeEvent(id=f"evt_{uuid.uuid4().hex[:8]}", kind=req.kind, user_id=req.user_id,
                     task_id=req.task_id, project_id=req.project_id, start=req.start, end=req.end,
                     payload=req.payload, created_at=datetime.now(timezone.utc).isoformat())
    try:
        await save_event(ev.model_dump())
    except Exception:
        pass  # event logging is best-effort; still attempt the reflow
    moved, prior = await _reflow_for_event(ev)
    return {"event": ev.model_dump(), "reflowed": moved, "strategy": await _maybe_strategize(ev, moved, prior)}


async def _apply_strategy(prop: dict) -> list[dict]:
    """Execute the ratified strategy deterministically, then re-reflow. Returns moved tasks.
    right_shift is already live (the reflow did it) → just acknowledge. reassign/re_estimate change
    the task then reflow. descope marks the task blocked. compress/re_plan/escalate flag for manual."""
    strat = prop["strategy"]
    action, targets = strat["action"], strat.get("target_task_ids", [])
    now = datetime.now(timezone.utc).isoformat()
    if action == "reassign" and strat.get("reassign_to"):
        for tid in targets:
            if await get_task(tid):
                await update_task(tid, {"assignee": strat["reassign_to"], "assigned_by": "ai", "updated_at": now})
    elif action == "re_estimate":
        new = (prop.get("event", {}).get("payload", {}) or {}).get("new")
        for tid in targets:
            if await get_task(tid) and new is not None:
                await update_task(tid, {"estimate_days": float(new), "updated_at": now})
    elif action == "descope":
        for tid in targets:
            if await get_task(tid):
                await update_task(tid, {"status": "blocked", "updated_at": now})
    # right_shift / compress / re_plan / escalate → no further task mutation (right_shift already live)
    changed = list(targets)
    if not changed:
        return []
    objs = [Task(**d) for d in await all_tasks()]
    await team.ensure_loaded()
    avail = scheduler.blocked_days(_reflow_change_events(await all_events()))
    prior = {o.id: (o.scheduled_start, o.scheduled_end) for o in objs}
    scheduler.reflow(objs, team.all_members(), now, changed, availability=avail)
    moved = [o for o in objs if (o.scheduled_start, o.scheduled_end) != prior[o.id]]
    for o in moved:
        await update_task(o.id, {"scheduled_start": o.scheduled_start, "scheduled_end": o.scheduled_end})
    return [o.model_dump() for o in moved]


@app.get("/api/reschedule/proposals/{proposal_id}")
async def get_reschedule(proposal_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    prop = await get_reschedule_proposal(proposal_id)
    if not prop:
        raise HTTPException(404, "no such proposal")
    return prop


@app.post("/api/reschedule/proposals/{proposal_id}/apply")
async def apply_reschedule(proposal_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The manager (or an affected discipline lead) ratifies the AI strategy → apply it."""
    prop = await get_reschedule_proposal(proposal_id)
    if not prop:
        raise HTTPException(404, "no such proposal")
    if not member.is_manager and member.username not in prop.get("affected_users", []):
        raise HTTPException(403, "only the manager or an affected member can apply this")
    if prop.get("status") != "proposed":
        raise HTTPException(409, "proposal already resolved")
    moved = await _apply_strategy(prop)
    now = datetime.now(timezone.utc).isoformat()
    await update_reschedule_proposal(proposal_id, {"status": "applied", "resolved_at": now, "resolved_by": member.username})
    action = prop["strategy"]["action"]
    flagged = action in ("escalate", "re_plan", "compress")
    for u in prop.get("affected_users", []):
        await notify(u, "reschedule_resolved",
                     f"Reschedule applied: {action}" if not flagged else f"Flagged for manual handling: {action}",
                     body=prop["strategy"].get("impact_summary", ""), ref={"proposal_id": proposal_id})
    return {"proposal_id": proposal_id, "status": "applied", "action": action, "flagged_manual": flagged, "moved": moved}


@app.post("/api/reschedule/proposals/{proposal_id}/reject")
async def reject_reschedule(proposal_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Discard the AI strategy (the safe right-shift the reflow already applied stands)."""
    prop = await get_reschedule_proposal(proposal_id)
    if not prop:
        raise HTTPException(404, "no such proposal")
    if not member.is_manager and member.username not in prop.get("affected_users", []):
        raise HTTPException(403, "only the manager or an affected member can reject this")
    if prop.get("status") != "proposed":
        raise HTTPException(409, "proposal already resolved")
    await update_reschedule_proposal(proposal_id, {"status": "rejected",
                                                   "resolved_at": datetime.now(timezone.utc).isoformat(),
                                                   "resolved_by": member.username})
    return {"proposal_id": proposal_id, "status": "rejected"}


@app.post("/api/projects/{project_id}/qa/run", response_model=QAReport)
async def qa_run(project_id: int, _: DeveloperProfile = Depends(auth.current_member)) -> QAReport:
    """Layered QA: the QA-agent prefills the acceptance checklist; reopened items are flagged."""
    plan = PROJECTS.get(project_id)
    if plan is None:
        raise HTTPException(404, "no live plan for this project — dispatch it first")
    report = await qa_review(plan)
    report.reopened = sorted(REQA.get(project_id, set()))
    await team.ensure_loaded()
    report.tester = relay.best_tester(team.all_members())  # who runs the gate, by passport (+why)
    return report


class CloseRequest(BaseModel):
    outcome_notes: str = ""


async def _validate_project_decisions(project_name: str) -> int:
    """Outcome Validation: a shipped project is the success signal → every Decision captured for it
    (matched by project_name) becomes outcome_validated, and each owner is notified. Best-effort.
    Returns how many decisions flipped to validated."""
    if not project_name:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    owners: set[str] = set()
    count = 0
    try:
        for d in await decisions_for_project(project_name):
            if not d.get("outcome_validated"):
                # ship is the strongest validation signal: the slice merged + cleared QA → grade up
                patch = {"outcome_validated": True, "updated_at": now, "merged": True,
                         "qa_passed": True, "promoted_at": now}
                patch["grade"] = grading.next_grade({**d, **patch})
                await update_decision(d["id"], patch)
                count += 1
                if d.get("owner_id"):
                    owners.add(d["owner_id"])
        for owner in owners:
            await notify(owner, "project_shipped",
                         f"Shipped: {project_name} — your decisions are now validated",
                         ref={"project_name": project_name})
    except Exception:
        pass
    return count


@app.post("/api/projects/{project_id}/close")
async def close(project_id: int, req: CloseRequest, _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    """Post-mortem: write the shipped project into agency memory; mark the record closed. Outcome
    Validation fires here — this project's decisions become outcome_validated + owners notified."""
    record = await get_project_record(project_id)
    if not record:
        raise HTTPException(404, "no project record")
    out = await close_project(record, req.outcome_notes)
    try:
        await update_project_record(project_id, {"status": "closed"})
    except Exception:
        pass
    validated = await _validate_project_decisions(record.get("name", ""))
    return {**out, "decisions_validated": validated}


# ── Outcome Validation: per-decision memory control + cross-user surfacing (roadmap System 3) ──
class DeprecateRequest(BaseModel):
    reason: str = ""


class ReasoningEdit(BaseModel):
    reasoning: str


class VisibilityRequest(BaseModel):
    visibility: Literal["personal", "team"]


async def _owned_decision_or_403(decision_id: str, member: DeveloperProfile) -> dict:
    d = await get_decision(decision_id)
    if not d:
        raise HTTPException(404, "no such decision")
    if not member.is_manager and d.get("owner_id") != member.username:
        raise HTTPException(403, "only the decision owner or a manager can change it")
    return d


@app.post("/api/decisions/{decision_id}/deprecate")
async def deprecate_decision(decision_id: str, req: DeprecateRequest,
                             member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Cautionary record: won't surface as a proposal; the AI treats the reason as a negative signal."""
    await _owned_decision_or_403(decision_id, member)
    await update_decision(decision_id, {"deprecated": True, "deprecation_reason": req.reason,
                                        "updated_at": datetime.now(timezone.utc).isoformat()})
    return await get_decision(decision_id)


@app.patch("/api/decisions/{decision_id}")
async def edit_decision(decision_id: str, req: ReasoningEdit,
                        member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Improve a decision's reasoning (signal quality); still surfaceable."""
    await _owned_decision_or_403(decision_id, member)
    await update_decision(decision_id, {"reasoning": req.reasoning,
                                        "updated_at": datetime.now(timezone.utc).isoformat()})
    return await get_decision(decision_id)


@app.post("/api/decisions/{decision_id}/visibility")
async def set_decision_visibility(decision_id: str, req: VisibilityRequest,
                                  member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Toggle surfacing scope: personal (only you) ↔ team (eligible for cross-user surfacing)."""
    await _owned_decision_or_403(decision_id, member)
    await update_decision(decision_id, {"visibility": req.visibility,
                                        "updated_at": datetime.now(timezone.utc).isoformat()})
    return await get_decision(decision_id)


@app.delete("/api/decisions/{decision_id}")
async def remove_decision(decision_id: str,
                          member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Remove a decision from the pool entirely (cannot be undone)."""
    await _owned_decision_or_403(decision_id, member)
    await delete_decision(decision_id)
    return {"deleted": decision_id}


@app.get("/api/decisions/surface")
async def surface_decisions(domain: str = "", tags: str = "",
                            member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Cross-user surfacing + the quality gate: your own decisions (always, even unvalidated) plus
    OTHER members' decisions that passed the gate — outcome_validated AND reasoning AND visibility=team.
    Deprecated decisions never surface. Optional filter by `domain` + comma-separated `tags`."""
    if demo.is_demo():
        own = [dict(d) for d in canned.CANNED_DECISIONS if d.get("owner_id") == member.username]
        others = [dict(d) for d in canned.CANNED_DECISIONS if d.get("owner_id") != member.username]
        return {"own": own, "team": others}
    want_tags = {t.strip() for t in tags.split(",") if t.strip()}

    def matches(d: dict) -> bool:
        if domain and d.get("domain") != domain:
            return False
        if want_tags and not (want_tags & set(d.get("context_tags", []))):
            return False
        return True

    own: list[dict] = []
    team: list[dict] = []
    try:
        for d in await all_decisions():
            if d.get("deprecated") or not matches(d):
                continue
            if d.get("owner_id") == member.username:
                own.append(d)                                                    # rule 1: own always surfaced
            elif d.get("outcome_validated") and d.get("reasoning") and d.get("visibility") == "team":
                team.append(d)                                                   # rule 2 + quality gate (attribution via owner_id)
    except Exception:
        pass
    return {"own": own, "team": team}


@app.get("/api/relays/{plan_id}/gates/{discipline}/card")
async def decision_card_for_gate(plan_id: str, discipline: str,
                                 member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Decision Card (System 2): two-pass adversarial AI for a relay gate. Pass 1 (domain persona, no
    past in context → no anchoring) proposes; we surface the team's past validated decisions (System 3);
    Pass 2 fires only if a past exists → conflict. Signal: orange=conflict, green=past+agree, grey=new.
    AI emits structured fields only; best-effort (card=null on AI failure — never blocks ratify)."""
    plan = PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    if not await _can_read_contract(member, discipline, plan_id):  # Contract is private — redacted for non-ratifier/manager/watcher
        return {"card": None, "signal": "grey", "low_confidence": True, "past": {"own": [], "team": []}, "error": "private"}
    sl = [i for e in plan.epics for i in e.issues if i.discipline == discipline]
    tags = sorted({i.required_skill for i in sl if i.required_skill})
    ctx = (sl[0].title if sl else discipline)[:50]
    surfaced = await surface_decisions(domain=discipline, tags=",".join(tags), member=member)
    best_past = next((d for d in surfaced["own"] + surfaced["team"] if d.get("reasoning")), None)
    try:
        p1 = await generate_decision_card(
            f"DOMAIN: {discipline}\n"
            f"YOUR CONSTRAINTS: {DECISION_DOMAIN_CONSTRAINTS.get(discipline, discipline)}\n"
            f"DECISION CONTEXT: {ctx}\n"
            f"RELEVANT SKILLS/TAGS: {', '.join(tags) or '—'}\n"
            f"THE SLICE BEING RATIFIED: {('; '.join(i.title for i in sl))[:300] or '(empty)'}")
        conflict, reason = False, ""
        if best_past and grading.carries_routing_weight(best_past):  # only a proven past can route (decision 4)
            v = await generate_conflict(
                f"DECISION CONTEXT: {ctx}\n"
                f"Position A — AI recommendation: {p1.recommendation}\n"
                f"Position B — past decision by @{best_past.get('owner_id')} "
                f"({best_past.get('project_name')}): {best_past.get('recommendation', '')} — "
                f"{best_past.get('reasoning', '')}")
            conflict, reason = v.conflict, v.conflict_reason
        card = DecisionCard(domain=discipline, context=ctx, recommendation=p1.recommendation,
                            confidence=p1.confidence, pros=p1.pros, cons=p1.cons,
                            conflict=conflict, conflict_reason=reason or None)
        signal = "orange" if conflict else ("green" if best_past else "grey")
        # Spine: fold the real AI confidence + grounding signal into this gate's routing tier (zero
        # extra LLM cost — both are already computed here). Returned for the panel; not persisted.
        tier, cost, blast, note = routing.route_gate(
            sl, await _routing_edges(), _dev_trust(), _DEFAULT_DIAL,
            confidence=p1.confidence, signal=signal)
        return {"card": card.model_dump(), "signal": signal,
                "routing": {"tier": tier, "expected_cost": cost, "blast_radius": blast, "note": note},
                "low_confidence": p1.confidence < 60, "past": surfaced}
    except Exception as e:
        return {"card": None, "signal": "grey", "routing": None,
                "low_confidence": False, "past": surfaced, "error": str(e)[:200]}


# ── Capability profiles (spine refactor P2): the growing, manager-confirmed lane vocabulary ──
@app.get("/api/profiles")
async def list_profiles(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The capability-profile dictionary (the growing taxonomy). `proposed` profiles await a manager
    confirm; only `confirmed`/`seed` ones are eligible to shape the bounded lane topology."""
    return {"profiles": await all_profiles()}


@app.post("/api/profiles/{profile_id}/confirm")
async def confirm_profile(profile_id: str,
                          member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The confirm gate (decision A): the manager promotes a discovered profile proposed → confirmed,
    keeping the lane taxonomy bounded. Only the manager can grow the vocabulary."""
    if not member.is_manager:
        raise HTTPException(403, "only the manager can confirm a capability profile")
    await update_profile(profile_id, {"status": "confirmed"})
    return {"profile_id": profile_id, "status": "confirmed"}


# ── Code Graph (roadmap System 4): dependency graph (A) + governance (B) + drift → refactor ──
_GRAPH_ROOT = os.path.dirname(os.path.abspath(__file__))  # the live backend package (orchestrator/app)


class GraphBuildRequest(BaseModel):
    root: str = ""            # default = the live backend package
    project_id: str = "local"


@app.post("/api/graph/build")
async def graph_build(req: GraphBuildRequest, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Build Graph A — parse Python imports under `root` (default: this backend) → nodes + edges → persist."""
    root = req.root or _GRAPH_ROOT
    nodes, edges = graph.build_python_graph(root, project_id=req.project_id)
    try:
        await save_graph([n.model_dump() for n in nodes], [e.model_dump() for e in edges], req.project_id)
    except Exception:
        pass
    return {"project_id": req.project_id, "root": root, "nodes": len(nodes), "edges": len(edges)}


@app.get("/api/graph")
async def graph_get(project_id: str = "local", as_of: Optional[str] = None,
                    member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Bitemporal read: as_of=<ISO> returns the graph as it was at that time (vf<=T<vt); omit for the current
    view (open versions). Routes through the GraphStore seam — legacy file graphs (no bitemporal fields) read
    as current, unchanged."""
    return {"project_id": project_id, "as_of": as_of,
            "nodes": await store.nodes(project_id, as_of=as_of), "edges": await store.edges(project_id, as_of=as_of)}


@app.get("/api/graph/dependents")
async def graph_dependents(path: str, project_id: str = "local",
                           member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Transitive dependents (who breaks if `path` changes) + dependencies (the focus-branch set)."""
    edges = [GraphEdge(**e) for e in await graph_edges(project_id)]
    return {"path": path, "dependents": graph.dependents_of(path, edges),
            "dependencies": graph.dependencies_of(path, edges)}


class GovernanceRuleRequest(BaseModel):
    governs_pattern: str
    constraint: str = ""
    domain: str = "backend"
    decision_id: str = ""


@app.post("/api/graph/governance")
async def graph_add_governance(req: GovernanceRuleRequest,
                               member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Graph B: register a decision-governance rule (a path pattern + constraint)."""
    if not member.is_manager and not member.covers(req.domain):
        raise HTTPException(403, "only the manager or a domain coverer can set governance for this domain")
    rule = GovernanceRule(id=f"gov_{uuid.uuid4().hex[:8]}", governs_pattern=req.governs_pattern,
                          constraint=req.constraint, domain=req.domain, decision_id=req.decision_id,
                          created_at=datetime.now(timezone.utc).isoformat())
    try:
        await save_governance_rule(rule.model_dump())
    except Exception:
        pass
    return rule.model_dump()


@app.get("/api/graph/governance")
async def graph_list_governance(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    return {"rules": await all_governance_rules()}


@app.post("/api/graph/drift")
async def graph_drift(project_id: str = "local", member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Drift: import cycles (blocking) + governance violations (drift) over the stored Graph A × Graph B."""
    nodes = [GraphNode(**n) for n in await graph_nodes(project_id)]
    edges = [GraphEdge(**e) for e in await graph_edges(project_id)]
    rules = [GovernanceRule(**r) for r in await all_governance_rules()]
    reports = graph.drift_reports(nodes, edges, rules)
    return {"project_id": project_id, "count": len(reports), "reports": [r.model_dump() for r in reports]}


class RefactorRequest(BaseModel):
    project_id: int                 # the project the maintenance task lands in
    report: DriftReport


def _lead_for_discipline(disc: str) -> str | None:
    """Who leads a discipline (ratifies its gate): the first developer with that discipline; falls back
    to the manager for an orphan discipline (e.g. uiux has no dev)."""
    lead = next((m.username for m in team.all_members() if m.covers(disc)), None)
    return lead or next((m.username for m in team.all_members() if m.is_manager), None)


@app.post("/api/graph/refactor")
async def graph_refactor(req: RefactorRequest, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Drift report → a maintenance Task in the work hub / relay, ASSIGNED to the domain lead + a live
    `drift_flagged` ping (Code Graph #4 → notifications #5). Same relay system as feature work."""
    if not member.is_manager:
        raise HTTPException(403, "only the manager can schedule a refactor task")
    r = req.report
    now = datetime.now(timezone.utc).isoformat()
    disc = r.domain if r.domain in ("uiux", "backend", "frontend", "qa", "devops") else "backend"
    pri = "urgent" if r.severity == "blocking" else ("high" if r.severity == "drift" else "low")
    await team.ensure_loaded()
    lead = _lead_for_discipline(disc)
    task = Task(
        id=f"refactor_{uuid.uuid4().hex[:8]}", project_id=req.project_id,
        title=f"Refactor: {r.drift_from_description or r.violation}"[:120],
        description=f"{r.violation}\n\nFix: {r.suggested_fix}\n\nFiles: {', '.join(r.affected_files)}",
        discipline=disc, assignee=lead, assigned_by="ai", risk="medium", priority=pri, status="planned",
        context_scope=ContextScope(files=r.affected_files, note="maintenance/refactor (Code Graph drift)"),
        created_at=now, updated_at=now)
    try:
        await save_tasks([task.model_dump()])
        await _reschedule_project(req.project_id)   # date the refactor into the lead's calendar
    except Exception:
        pass
    if lead:                                         # ring the responsible expert's bell live (System 5)
        await notify(lead, "drift_flagged", f"Drift in {disc}: {r.violation}"[:120],
                     body=r.suggested_fix, ref={"task_id": task.id}, actionable=True)
        await notify_watchers(lead, "drift_flagged", f"Drift flagged in {disc} (@{lead})", ref={"task_id": task.id})
    return await get_task(task.id) or task.model_dump()


# ── Living Project Graph (reuse lineage): a reused source feature changes → PROPOSE a sync task in every
# project that derived from it. The event the simulate endpoint posts is exactly what a GitLab merge webhook
# would send — this is the demo seam for the missing GitLab→sprint0 inbound edge. NO-AUTO-APPROVAL throughout.
class SourceChangeRequest(BaseModel):
    feature_node: str               # the content-addressed source feature node (e.g. "feat:qpauth0001")
    new_hash: str = ""              # the post-fix content hash (a fix = a new identity)
    summary: str = ""               # what changed upstream


async def _project_source_change(ev: ChangeEvent) -> list[dict]:
    """Projection of a `source_changed` event: traverse inbound `derived_from` → one PROPOSED sync Task +
    `drift_flagged` ping per dependent project. Tasks are `planned` (the dependent's owner ratifies)."""
    try:
        await eventlog.emit(const.EventKind.SOURCE_CHANGED, created_at=ev.created_at, payload=ev.payload)  # the spine — append first
    except Exception:
        pass
    nodes = [GraphNode(**n) for n in await graph_nodes("lineage")]
    edges = [GraphEdge(**e) for e in await graph_edges("lineage")]
    proposals = lineage.propagate_source_change(ev, nodes, edges)
    await team.ensure_loaded()
    now = datetime.now(timezone.utc).isoformat()
    feat_title = next((n.title for n in nodes if n.path == ev.payload.get("feature_node")),
                      ev.payload.get("feature_node", "a reused feature"))
    created: list[dict] = []
    by_lead: dict[str, list[dict]] = {}    # owner → their dependents (one summary ping each; notify dedups same user+type)
    for p in proposals:
        disc = p["domain"] if p["domain"] in ("uiux", "backend", "frontend", "qa", "devops") else "backend"
        lead = _lead_for_discipline(disc)
        pid = p["project_id"] or 0
        task = Task(
            id=f"sync_{uuid.uuid4().hex[:8]}", project_id=pid,
            title=f"Sync: {feat_title} changed upstream"[:120],
            description=(f"The reused source **{feat_title}** changed upstream.\n\nWhat changed: "
                         f"{p['summary']}\n\nReview {p['title']} and decide whether to adopt the change."),
            discipline=disc, assignee=lead, assigned_by="ai", risk="medium", priority="high", status="planned",
            context_scope=ContextScope(files=[], note=f"reuse sync (Living Project Graph · derived_from {ev.payload.get('feature_node')})"),
            created_at=now, updated_at=now)
        try:
            await save_tasks([task.model_dump()])
            if pid:
                await _reschedule_project(pid)               # date the sync task into the lead's calendar
        except Exception:
            pass
        created.append(await get_task(task.id) or task.model_dump())
        if lead:
            by_lead.setdefault(lead, []).append({"title": p["title"], "task_id": task.id})
    for lead, items in by_lead.items():                       # one honest summary ping per affected owner (System 5)
        n, first = len(items), items[0]["task_id"]
        await notify(lead, "drift_flagged",
                     f"{feat_title} changed upstream — {n} sync task{'s' if n != 1 else ''}"[:120],
                     body="Review & adopt: " + ", ".join(i["title"] for i in items),
                     ref={"task_id": first}, actionable=True)
        await notify_watchers(lead, "drift_flagged", f"Reuse sync flagged for @{lead} ({n})", ref={"task_id": first})
    return created


async def record_reuse_lineage(plan_id: str, plan: PlanJSON, project_id: int) -> int:
    """LIVE reuse ingest (Living Project Graph P3): for each gate whose ratified pick is memory-grounded,
    content-hash the cited source and record a `derived_from` edge from THIS project to the (shared, deduped)
    source feature node. Identical reused code across projects collapses to ONE feature node. Best-effort;
    self-skips in demo (reuse_pack is empty there)."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        existing = await store.nodes("lineage")
    except Exception:
        existing = []
    recorded = 0
    for (pid_key, disc), chosen in list(CHOSEN.items()):
        if pid_key != plan_id or not chosen.grounded_on:   # only memory-grounded (reuse) picks record lineage
            continue
        try:
            rows = await reuse_pack(chosen.grounded_on, discipline=disc, limit=6)
        except Exception:
            continue
        source_text = "\n".join(str(r.get("excerpt", "")) for r in rows).strip()
        if not source_text:
            continue
        src = chosen.grounded_on[0]
        new_nodes, new_edges = lineage.build_reuse_lineage(
            project_id=project_id, project_name=plan.project_name, discipline=disc,
            source_project=src, source_text=source_text, now=now, existing_features=existing)
        try:
            await store.add_nodes(new_nodes)
            await store.add_edges(new_edges)
            existing.extend(new_nodes)   # a later gate in this loop dedups against what we just added
            await eventlog.emit(const.EventKind.REUSE_RECORDED, created_at=now,
                                payload={"project_id": project_id, "discipline": disc, "source": src})
            recorded += 1
        except Exception:
            pass
    return recorded


@app.post("/api/lineage/simulate-change")
async def lineage_simulate_change(req: SourceChangeRequest,
                                  member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Simulate what a GitLab merge webhook WOULD post when a reused source feature changes: append a
    `source_changed` event → propose a sync Task in every dependent project (human ratifies)."""
    if not member.is_manager:
        raise HTTPException(403, "only the manager can simulate a source change")
    now = datetime.now(timezone.utc).isoformat()
    ev = ChangeEvent(id=f"src_{uuid.uuid4().hex[:8]}", kind="source_changed", created_at=now,
                     payload={"feature_node": req.feature_node, "new_hash": req.new_hash,
                              "summary": req.summary or "upstream change"})
    proposed = await _project_source_change(ev)
    return {"event": ev.model_dump(), "dependents": len(proposed), "proposed": proposed}


class RetireNodeRequest(BaseModel):
    path: str
    project_id: str = "lineage"


@app.post("/api/lineage/retire")
async def lineage_retire(req: RetireNodeRequest,
                         member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Tombstone a feature/node: CLOSE the current version (valid_to=now, deleted=True) instead of deleting —
    it drops from the current view but stays queryable via `?as_of=`. Code deletion that never loses history."""
    if not member.is_manager:
        raise HTTPException(403, "only the manager can retire a node")
    now = datetime.now(timezone.utc).isoformat()
    await store.close_node(req.path, req.project_id, {"valid_to": now, "deleted": True})
    await eventlog.emit(const.EventKind.NODE_RETIRED, created_at=now, payload={"path": req.path, "project_id": req.project_id})
    return {"retired": req.path, "at": now}


@app.get("/api/lineage/duplicates")
async def lineage_duplicates(threshold: float = 0.82,
                             member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Semantic near-dup detection (P5): exact-hash dups are already collapsed by content-addressing; this
    embeds each DISTINCT canonical feature's title (Voyage, live) and flags same-intent / different-code pairs
    above `threshold` for a human to merge. Never auto-merges. Best-effort — empty if embeddings are down."""
    if demo.is_demo():  # the hosted demo stubs the Voyage query vector (free-tier protection) → no real similarity
        return {"threshold": threshold, "pairs": [], "engine": "voyage-live-only",
                "note": "Semantic dedup runs live with Voyage embeddings — unlock the live demo to compute it. "
                        "(The hosted demo stubs the query vector to protect the free-tier rate limit.)"}
    feats = [n for n in await store.nodes("lineage")
             if n.get("node_type") == "feature" and n.get("ref_project_id") in (None, 0)]
    seen: set = set()
    units: list[dict] = []
    for f in feats:                                     # one canonical unit per distinct content_hash
        h = f.get("content_hash")
        if h in seen:
            continue
        seen.add(h)
        units.append(f)
    if len(units) < 2:
        return {"threshold": threshold, "pairs": [], "units": len(units)}
    try:
        vecs = await run_in_threadpool(lambda: embed_queries([u.get("title") or u["path"] for u in units]))
    except Exception as e:  # no Voyage key / rate-limited → honest empty
        return {"threshold": threshold, "pairs": [], "note": f"semantic dedup runs live (Voyage): {str(e)[:80]}"}
    items = [{**u, "vector": v} for u, v in zip(units, vecs)]
    return {"threshold": threshold, "pairs": dedup.near_duplicate_pairs(items, threshold)}


async def reembed_corpus(project_id: int, ref: str, files: list[str]) -> int:
    """Living corpus (P7): a push changed `files` → re-embed ONLY the chunks whose content actually changed
    (content-hash gated) so recall grounds on current code, not the seed snapshot. Live-only (GitLab+Voyage)."""
    if not files:
        return 0
    try:
        rec = await get_project_record(project_id)
    except Exception:
        rec = {}
    project_name = (rec or {}).get("name") or ""
    if not project_name:
        return 0
    content_by_path: dict[str, str] = {}
    for f in files:
        try:
            content_by_path[f] = await run_in_threadpool(gitlab.get_file_raw, project_id, f, ref or "main")
        except Exception:
            pass
    chunks_by_path = {c.get("file_path"): c for c in await code_chunks_for_project(project_name)}
    to_embed, _unchanged = corpus.plan_reembed(files, content_by_path, chunks_by_path)
    now = datetime.now(timezone.utc).isoformat()
    from app.agent import generate_file_summary
    for f in to_embed:
        content = content_by_path[f]
        try:
            lang, disc = corpus.language_of(f), corpus.discipline_of_path(f)
            summary = await generate_file_summary(f, content)  # best-effort '' on any failure
            vec = await run_in_threadpool(
                embed_document, corpus.chunk_embed_text(project_name, f, disc, lang, summary, content))
            await upsert_code_chunk({"project": project_name, "file_path": f, "excerpt": content[:1500],
                                     "summary": summary, "language": lang, "discipline": disc,
                                     "embedding": vec, "content_hash": graph.normalize_and_hash(content), "updated_at": now})
        except Exception:
            pass
    if to_embed:
        await eventlog.emit(const.EventKind.CORPUS_REEMBEDDED, created_at=now, payload={"project_id": project_id, "files": to_embed})
    return len(to_embed)


@app.post("/api/webhooks/gitlab")
async def gitlab_webhook(request: Request) -> dict:
    """The INBOUND edge (P6): GitLab calls this on push/merge/issue. Verify the shared secret, emit each event
    on the spine, and route a MERGE on a canonical reused feature (matched by source_project_id) into the
    existing source_changed propagation → dependents get proposed sync tasks. sprint0 finally PERCEIVES GitLab.
    The 'Simulate source change' button posts to /api/lineage/simulate-change (manager-auth'd), NOT this."""
    if demo.is_demo():  # live-only integration: the public demo never gets real GitLab webhooks, so an
        raise HTTPException(403, "the GitLab webhook is a live-mode integration")  # anon POST must not act here
    secret = os.getenv("GITLAB_WEBHOOK_SECRET", "")
    if not secret or request.headers.get("X-Gitlab-Token") != secret:  # fail CLOSED — unconfigured/bad token = reject
        raise HTTPException(401, "bad or missing webhook token")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "invalid JSON body")
    kind = str(payload.get("object_kind", ""))
    events = gitlab_hooks.parse_gitlab_event(kind, payload)
    now = datetime.now(timezone.utc).isoformat()
    propagated = reembedded = credited = 0
    for ev in events:
        await eventlog.emit(f"gitlab_{ev['kind']}", created_at=now, payload=ev)
        if ev["kind"] == "merge" and ev.get("project_id") is not None:
            # a canonical feature whose SOURCE lives in this repo changed → propagate to everyone who derived from it
            feats = [n for n in await store.nodes("lineage")
                     if n.get("node_type") == "feature" and n.get("source_project_id") == ev["project_id"]]
            for f in feats:
                sev = ChangeEvent(id=f"src_{uuid.uuid4().hex[:8]}", kind="source_changed", created_at=now,
                                  payload={"feature_node": f["path"], "summary": ev.get("title") or "merged upstream"})
                propagated += len(await _project_source_change(sev))
            if ev.get("author"):  # passport-increment-on-merge: credit the MR author (roster match → record_merge, else queue)
                _m = team.get(ev["author"])
                await _credit_merge(ev["author"], f"{(_m.discipline if _m else None) or 'backend'}:merge",
                                    0.85, project_id=ev["project_id"], issue_iid=ev.get("iid"))
                credited += 1
        elif ev["kind"] == "push" and ev.get("project_id") is not None:
            reembedded += await reembed_corpus(ev["project_id"], ev.get("ref", ""), ev.get("files", []))
    return {"received": kind, "events": [e["kind"] for e in events],
            "propagated_sync_tasks": propagated, "reembedded": reembedded, "credited": credited}


# Attribution queue — merges sprint0 can't map to a roster member land here (the human
# fallback in the attribution chain) for the manager to assign. In-memory (demo-grade).
ATTRIBUTIONS: list[dict] = []


def _suggest_attribution(identity: str | None) -> Optional[str]:
    """AI best-guess: fuzzy-match an unmatched merge identity to a roster username."""
    if not identity:
        return None
    keyed: dict[str, str] = {}
    for d in team.developers():
        for k in (d.username, d.gitlab_username, d.name):
            if k:
                keyed[k.lower()] = d.username
    hit = difflib.get_close_matches(identity.lower(), list(keyed), n=1, cutoff=0.6)
    return keyed[hit[0]] if hit else None


async def _credit_merge(gitlab_username: str, task_type: str, score: float, *,
                        project_id: int | None = None, issue_iid: int | None = None) -> dict:
    """Passport-increment-on-merge with the attribution fallback chain — shared by POST /api/merge and the
    GitLab webhook's merge branch. Roster match → record_merge (Atlas) / grow_demo_member (demo); no match
    → the manager's attribution queue (durable, fuzzy-suggested)."""
    if demo.is_demo():  # record_merge's Atlas read returns nothing in demo → grow the in-mem roster dev
        grown = team.grow_demo_member(gitlab_username, task_type)
        if grown:
            return grown
    result = await record_merge(gitlab_username, task_type, score)
    if result:
        return result
    aid = f"att_{uuid.uuid4().hex[:8]}"
    ATTRIBUTIONS.append({
        "id": aid, "gitlab_username": gitlab_username, "task_type": task_type,
        "score": score, "project_id": project_id, "issue_iid": issue_iid,
        "suggested": _suggest_attribution(gitlab_username),
    })
    await _persist("attributions", "_all", {"v": ATTRIBUTIONS})  # durable: the manager's attribution queue
    return {"needs_attribution": True, "attribution_id": aid, "suggested": ATTRIBUTIONS[-1]["suggested"]}


class AttributionResolve(BaseModel):
    username: str
    task_type: Optional[str] = None


async def _verify_on_merge(req: MergeRequest) -> Optional[dict]:
    """The VERIFY beat at the ONLY listened action — MERGE. If the merge carries the producer's output
    sample (the real response shape the dev's CI already verified) + its plan/issue, shape-check it against
    the ratified interface contract. A violation = the merged reality diverging from a ratified agreement →
    an IntegrationSignal that holds the gate + pings the producer (the same enforcement the manual verify
    uses). No sample → nothing to check (graceful — a missed contract never becomes a false alarm)."""
    if not (req.plan_id and req.issue_id and req.output_sample is not None):
        return None
    plan = PLANS.get(req.plan_id)
    if plan is None:
        return None
    state = RELAYS.get(req.plan_id)
    now = datetime.now(timezone.utc).isoformat()
    prod = next((i for e in plan.epics for i in e.issues if i.id == req.issue_id), None)
    results: list[dict] = []
    for raw in await agreements_for_plan(req.plan_id):  # a producer can own >1 contract (one per consuming lane) — check ALL
        if raw.get("type") != "interface" or raw.get("state") not in const.DONE:
            continue
        if raw.get("producer_issue_id") != req.issue_id:
            continue
        viol = agreements.verify_against(InterfaceDraft(**(raw.get("interface") or {})), req.output_sample)
        results.append({"agreement_id": raw.get("id"), "subject": raw.get("subject"), "ok": not viol, "violations": viol})
        if viol and state is not None:  # drift → the existing integration gate enforces it
            relay.record_integration_signal(state, IntegrationSignal(
                target_issue_id=req.issue_id, state="failing", by="sprint0", source="ai",
                note=f"Contract violation on merge: {'; '.join(viol)}", created_at=now))
            if prod and prod.assignee:
                await notify(prod.assignee, "qa_failed", f"Contract violation · {raw.get('subject')}",
                             body="; ".join(viol), ref={"plan_id": req.plan_id, "issue_id": req.issue_id}, actionable=True)
    await _persist_relay(req.plan_id)  # durable: a merge-time contract-violation signal survives a restart
    if not results:
        return None
    return {"ok": all(r["ok"] for r in results),
            "violations": [v for r in results for v in r["violations"]], "results": results}


@app.post("/api/merge")
async def merge(req: MergeRequest, _: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Passport-increment-on-merge (+ auto-promotion). If it resolves a rejected issue, clear it
    from the re-QA queue. If no roster member matches the merge identity → queue for manager
    attribution (chain priority: gitlab_user_id → runner label → here, the human fallback).
    Merge is the verify beat: if the slice carries an output sample, shape-check it vs its contract."""
    if req.project_id is not None and req.issue_iid is not None:
        REQA.get(req.project_id, set()).discard(req.issue_iid)
        await _persist("reqa", req.project_id, {"v": sorted(REQA.get(req.project_id, set()))})  # durable
    contract = await _verify_on_merge(req)  # the verify beat (None when the merge carries no sample to check)

    def _with(out: dict) -> dict:
        if contract is not None:
            out["contract"] = contract
        return out
    return _with(await _credit_merge(req.gitlab_username, req.task_type, req.score,
                                     project_id=req.project_id, issue_iid=req.issue_iid))


@app.get("/api/attributions")
async def list_attributions(_: DeveloperProfile = Depends(auth.current_manager)) -> list[dict]:
    """Unattributed merges awaiting the manager's call (the non-automated-actions panel)."""
    return ATTRIBUTIONS


@app.post("/api/attributions/{aid}/resolve")
async def resolve_attribution(
    aid: str, req: AttributionResolve, _: DeveloperProfile = Depends(auth.current_manager)
) -> dict:
    ev = next((a for a in ATTRIBUTIONS if a["id"] == aid), None)
    if ev is None:
        raise HTTPException(404, "no such attribution")
    member = team.get(req.username)
    if member is None:
        raise HTTPException(404, f"no member '{req.username}'")
    grown = await record_merge(member.gitlab_username, req.task_type or ev["task_type"], ev.get("score", 0.85))
    ATTRIBUTIONS.remove(ev)
    await _persist("attributions", "_all", {"v": ATTRIBUTIONS})  # durable: queue shrinks on resolve
    await team.refresh()
    return {"resolved": aid, "attributed_to": member.username, "profile": grown}


@app.post("/api/members/{username}/link")
async def link_member(username: str, _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    """Resolve a member's intended gitlab_username to a real account id (manual Link)."""
    out = await link_gitlab(username)
    await team.refresh()
    return out


@app.post("/api/team/reconcile")
async def reconcile_team(_: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    """Member-sync: link every still-unlinked member (e.g. after the team seats the junior)."""
    out = await reconcile_links()
    await team.refresh()
    return out


class DisciplineBody(BaseModel):
    discipline: Discipline


@app.post("/api/members/{username}/discipline")
async def set_member_discipline(username: str, body: DisciplineBody, _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    """Seat a member in a discipline (e.g. a freshly onboarded junior) so they enter the assignment
    pool in-lane. Persists to the in-mem roster (demo) or Mongo (live)."""
    if demo.is_demo():
        team.set_demo_discipline(username, body.discipline)
    else:
        await set_developer_discipline(username, body.discipline)
        await team.refresh()
    m = team.get(username)
    return m.model_dump() if m else {}


@app.get("/api/developers", response_model=list[DeveloperProfile])
async def list_developers() -> list[DeveloperProfile]:
    await team.ensure_loaded()
    # The roster the frontend shows is the WHOLE team incl. the manager (Team view). Internal staffing
    # still uses team.developers() directly; pickers filter by role/discipline, so the manager never
    # surfaces as an assignable candidate.
    members = await _attach_availability(team.all_members() or CANNED_DEVELOPERS)
    # flag repo-needing devs with no GitLab link → the Team view shows "link this dev" (the manager + a uiux dev never need one)
    return [m.model_copy(update={"needs_link": not m.is_manager and any(policy.needs_repo(d) for d in m.disciplines) and not m.gitlab_user_id}) for m in members]


@app.post("/api/developers")
async def add_developer(text: Optional[str] = Form(None), file: Optional[UploadFile] = File(None), _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    """Cold-Start onboarding: drop a CV (text or PDF) → parse → upsert (Trust: Low). Returns the new
    member plus the AI's `suggested_discipline` (the manager confirms it in the wizard to seat them)."""
    cv = (text or "").strip()
    if file is not None:
        raw = await file.read()
        if (file.filename or "").lower().endswith(".pdf"):
            from pypdf import PdfReader

            cv = "\n".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(raw)).pages).strip()
        else:
            cv = raw.decode("utf-8", "ignore").strip()
    if not cv:
        raise HTTPException(400, "empty CV")
    prof = await onboard_developer(cv)
    member = DeveloperProfile(**prof)
    if demo.is_demo():
        team.add_demo_member(member)  # the Atlas insert is a no-op in demo → keep the new dev in-mem
    await team.refresh()  # the new member joins the roster immediately (login + assignment pool)
    return {**member.model_dump(), "suggested_discipline": prof.get("suggested_discipline")}


@app.websocket("/api/plans/{plan_id}/events")
async def plan_events(ws: WebSocket, plan_id: str) -> None:
    """Scaffold progress stream. (Execute currently runs in /approve; this emits
    a step sequence for the UI. Real per-step streaming is a polish item.)"""
    await ws.accept()
    steps = [
        "Creating GitLab project…",
        "Committing boilerplate…",
        "Creating labels (type · risk · runner)…",
        "Batch-creating issues with 🎯 context scope…",
        "Done.",
    ]
    try:
        for i, msg in enumerate(steps):
            await ws.send_json({"step": i + 1, "of": len(steps), "message": msg})
            await asyncio.sleep(0.5)
        await ws.close()
    except WebSocketDisconnect:
        return


# ── Subscriptions + live notifications (roadmap System 5) ──
class SubscriptionRequest(BaseModel):
    subject_id: str
    events: list[str] = ["assigned", "qa_failed"]


@app.post("/api/subscriptions")
async def subscribe(req: SubscriptionRequest, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Follow another member's events (notification fan-out — not visibility)."""
    if req.subject_id == member.username:
        raise HTTPException(400, "can't subscribe to yourself")
    valid = [e for e in req.events if e in ("assigned", "completed", "qa_failed", "drift_flagged")]
    sub = UserSubscription(id=f"sub_{uuid.uuid4().hex[:8]}", watcher_id=member.username,
                           subject_id=req.subject_id, events=valid or ["assigned", "qa_failed"],
                           created_at=datetime.now(timezone.utc).isoformat())
    await save_subscription(sub.model_dump())
    return sub.model_dump()


@app.delete("/api/subscriptions/{subject_id}")
async def unsubscribe(subject_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    await delete_subscription(member.username, subject_id)
    return {"unsubscribed": subject_id}


@app.get("/api/subscriptions")
async def list_subscriptions(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    return {"watching": await subscriptions_of(member.username), "watchers": await watchers_of(member.username)}


@app.websocket("/api/ws/notifications")
async def ws_notifications(ws: WebSocket, user: str = "") -> None:
    """Live notification stream (System 5). Connect with ?user=<username>; notify()/notify_watchers push
    new Notifications here in real time (the bell updates without polling). Query-param identity — unauthed,
    matching the existing demo WS (browsers can't set custom WS headers)."""
    await ws.accept()
    if not user:
        await ws.close()
        return
    _WS_CLIENTS.setdefault(user, set()).add(ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive; client messages are ignored
    except WebSocketDisconnect:
        pass
    finally:
        socks = _WS_CLIENTS.get(user)
        if socks is not None:
            socks.discard(ws)
            if not socks:
                _WS_CLIENTS.pop(user, None)
