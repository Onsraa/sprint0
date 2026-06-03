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
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google.genai.errors import ClientError

from pydantic import BaseModel

from app import agreements, auth, canned, demo, gitlab, grading, graph, handoff, policy, relay, routing, scheduler, solutions as soln, staffing, strategist, tasks as tasklib, team
from app.canned import CANNED_DEVELOPERS
from app.contracts import (
    AccessGrant, Agreement, InterfaceDraft, ApproveRequest, ArchitectureOptions, ChangeEvent, ClarifiedSpec, ClarifyResolution, Constraints,
    Decision, DeveloperProfile, DispatchRequest, FeatureRequest, IntegrationSignal, Notification, PlanJSON,
    PlanRequest, ProjectRecord, QAReport, QAQueue, QAQueueEntry, RatifyRequest, RelayState, Task, UserSubscription,
    ContextScope, DecisionCard, Discipline, DriftReport, GovernanceRule, GraphEdge, GraphNode, ImpactedTask, RescheduleProposal,
    SolutionCard, SolutionSet,
)
from app.agent import AIOutputError, DECISION_DOMAIN_CONSTRAINTS, generate_adapted_code, generate_conflict, generate_decision_card, generate_interface
from app.execute import execute_plan, extend_project
from app.rag import (
    access_grants_for_subject, access_grants_for_requester, all_project_records, decisions_by_owner,
    all_decisions, decisions_for_project, delete_decision, get_decision, update_decision,
    save_graph, graph_nodes, graph_edges, save_governance_rule, all_governance_rules,
    all_profiles, update_profile,
    save_subscription, delete_subscription, subscriptions_of, watchers_of,
    get_access_grant, get_project_record, past_projects, record_merge, set_developer_discipline,
    save_access_grant, save_decision, save_notification, notifications_for_user, mark_all_read,
    notification_exists, dedup_notifications,
    save_project_record, update_access_grant, update_project_record,
    all_events, all_tasks, delete_tasks_for_project, get_task, mongo_close, save_event, save_tasks,
    tasks_for_project, update_task,
    save_reschedule_proposal, open_reschedule_proposals,
    get_reschedule_proposal, update_reschedule_proposal,
    save_agreement, agreements_for_plan, agreements_for_ratifier, get_agreement, update_agreement, all_agreements, reuse_pack,
)
from app.reason import (
    clarify_brief, close_project, delta_brief, link_gitlab, onboard_developer, propose_architectures,
    propose_interfaces, propose_solutions, qa_review, reconcile_links, regenerate_slice, run_brief,
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
        *([os.environ["FRONTEND_ORIGIN"]] if os.getenv("FRONTEND_ORIGIN") else []),
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


# ── Rate-limit for the PUBLIC (unauthenticated) AI intake endpoints ──
# clarify + architectures stay open by design (demo "drop a brief"), so cap anonymous Gemini
# cost/quota abuse with a per-IP sliding window. Per-worker (in-process); swap to Redis if multi-worker.
_AI_RATE_MAX = 5          # calls allowed
_AI_RATE_WINDOW_S = 60    # per this many seconds, per client IP
_ai_calls: dict[str, list[float]] = {}


def _ai_throttle(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    recent = [t for t in _ai_calls.get(ip, []) if now - t < _AI_RATE_WINDOW_S]
    if len(recent) >= _AI_RATE_MAX:
        raise HTTPException(429, "rate limited — too many AI requests, retry shortly")
    recent.append(now)
    _ai_calls[ip] = recent


# Demo-grade in-memory stores.
BRIEFS: dict[str, str] = {}
SPECS: dict[str, ClarifiedSpec] = {}
ARCHS: dict[str, ArchitectureOptions] = {}  # brief_id → cached architecture options (wizard resume, no Gemini re-run)
PLANS: dict[str, PlanJSON] = {}
RELAYS: dict[str, RelayState] = {}
RESULTS: dict[str, dict] = {}
DELTA_TARGET: dict[str, int] = {}  # plan_id → existing project_id (mid-prod delta plans extend, not create)
DELTA_PRIORITY: dict[str, str] = {}  # plan_id → feature priority (urgent → its tasks preempt planned work)
PROJECTS: dict[int, PlanJSON] = {}  # project_id → live plan (for QA review + mid-prod, this session)
REQA: dict[int, set] = {}  # project_id → reopened issue iids awaiting re-QA (the reject→fix→re-QA loop)
SOLUTIONS: dict[tuple[str, str], SolutionSet] = {}  # (plan_id, discipline) → cached reuse-or-innovate set (lazy)
CHOSEN: dict[tuple[str, str], SolutionCard] = {}    # (plan_id, discipline) → the ratified solution pick


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
    return {"status": "ok" if ok else "degraded", "service": "sprint0", "mongo": ok, "ok": ok}


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
    RELAYS[plan_id] = relay.build_relay(plan)
    relay.auto_pass(RELAYS[plan_id], plan, _dev_trust(), 65, edges=None)  # posture clears low-risk gates → a mid-flight board, not all-grey
    objs = tasklib.materialize_tasks(plan, pid, now)
    for t, st in zip(objs, ["done", "done", "in_review", "in_progress", "in_progress"]):
        t.status = st  # a lively board; the rest stay planned
    scheduler.schedule_tasks(objs, team.all_members(), now)
    await save_tasks([o.model_dump() for o in objs])


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
            mine = (member.discipline == g.discipline) or (
                member.role == "manager" and staffing.is_orphan(g.discipline, members)
            )
            if not mine:
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


async def notify(user_id: str, type: Literal["ratify_needed", "access_requested", "access_granted", "qa_failed", "project_shipped", "reschedule_proposed", "reschedule_resolved", "task_assigned", "task_completed", "drift_flagged", "agreement_proposed"], title: str, *, body: str = "", ref: dict | None = None, actionable: bool = False) -> None:
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
            is_mgr = member.role == "manager"
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
    if demo.is_demo():
        notes = [dict(n) for n in canned.CANNED_INBOX]
    notes.sort(key=lambda n: n.get("created_at", ""), reverse=True)
    unread = len(needs_action) + sum(1 for n in notes if not n.get("read"))
    return {"needs_action": needs_action, "notifications": notes, "unread": unread}


@app.post("/api/inbox/read-all")
async def inbox_read_all(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    await mark_all_read(member.username)
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
            "gates": [{"discipline": g.discipline, "status": g.status, "note": g.note} for g in state.gates],
            "is_delta": plan_id in DELTA_TARGET, "target_project_id": DELTA_TARGET.get(plan_id),
            "all_ratified": relay.all_ratified(state),
        })
    return {"count": len(out), "relays": out}


@app.get("/api/qa/queue", response_model=QAQueue)
async def qa_queue(_: DeveloperProfile = Depends(auth.current_member)) -> QAQueue:
    """Cross-project Tester queue: every dispatched project with QA work outstanding. QA runs off the
    live plan (PROJECTS — persisted + rebuilt on startup); the relay state (RELAYS, if still active this
    session) supplies the accept-gate status + baton. So a tester sees all their acceptance work across
    projects in one place, not one locked project."""
    plan_id_by_name: dict[str, str] = {}
    for plan_id, plan in PLANS.items():
        plan_id_by_name.setdefault(plan.project_name, plan_id)
    entries: list[QAQueueEntry] = []
    for pid, plan in PROJECTS.items():
        plan_id = plan_id_by_name.get(plan.project_name, "")
        state = RELAYS.get(plan_id) if plan_id else None
        qa_gate = next((g for g in state.gates if g.discipline == "qa"), None) if state else None
        status = qa_gate.status if qa_gate else "pending"
        reqa = sorted(REQA.get(pid, set()))
        if status in ("ratified", "auto_passed") and not reqa:
            continue  # accepted and nothing reopened → no outstanding QA
        entries.append(QAQueueEntry(
            project_id=pid, project_name=plan.project_name, plan_id=plan_id,
            qa_status=status, baton=bool(state and "qa" in state.baton),
            issue_count=sum(len(e.issues) for e in plan.epics), awaiting_reqa=reqa,
        ))
    entries.sort(key=lambda e: (e.baton, e.issue_count), reverse=True)
    return QAQueue(count=len(entries), queue=entries)


@app.get("/api/projects")
async def list_projects(_: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """All repos in the demo group (real source of truth). A repo with a ProjectRecord is
    sprint0-managed → kind=active (full plan/status/counts); the rest (agency seed repos) are
    kind=reference, enriched from PastProjects memory. Falls back to ProjectRecords if GitLab is down."""
    if demo.is_demo():  # no GitLab/Atlas on the public tier → serve the canned workspace
        return {"count": len(canned.CANNED_PROJECTS), "projects": [dict(p) for p in canned.CANNED_PROJECTS]}
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
    bid = f"brief_{uuid.uuid4().hex[:8]}"
    BRIEFS[bid] = content
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
                  _t: None = Depends(_ai_throttle)) -> ClarifiedSpec:
    """Intake: extract the spec, flag unclear features as ambiguity cards, propose reuse."""
    if brief_id not in BRIEFS:
        raise HTTPException(404, "brief not found")
    spec = await clarify_brief(BRIEFS[brief_id], constraints or Constraints())
    SPECS[brief_id] = spec
    return spec


@app.post("/api/briefs/{brief_id}/clarify/resolve", response_model=ClarifiedSpec)
async def resolve_clarify(brief_id: str, res: ClarifyResolution) -> ClarifiedSpec:
    """Manager answers the ambiguity cards (id → resolution); folds into the living spec."""
    spec = SPECS.get(brief_id)
    if spec is None:
        raise HTTPException(404, "clarify the brief first")
    for amb in spec.ambiguities:
        if amb.id in res.answers:
            amb.resolution = res.answers[amb.id]
    return spec


@app.post("/api/briefs/{brief_id}/architectures", response_model=ArchitectureOptions)
async def architectures(brief_id: str, constraints: Optional[Constraints] = None,
                        _t: None = Depends(_ai_throttle)) -> ArchitectureOptions:
    """Idea 1: 2-3 grounded Architecture Cards for the manager to pick from."""
    if brief_id not in BRIEFS:
        raise HTTPException(404, "brief not found")
    opts = await propose_architectures(BRIEFS[brief_id], constraints or Constraints())
    ARCHS[brief_id] = opts  # cache for wizard resume
    return opts


def _manifest_of(plan: PlanJSON) -> list[str]:
    """The key files a plan touches — deduped, sorted union of every issue's context_scope.files.
    Recomputed on each delta dispatch so mid-prod grounding never reads the dispatch-day snapshot."""
    return sorted({f for e in plan.epics for i in e.issues for f in (i.context_scope.files or [])})


def _plan_pid(plan_id: str) -> int:
    """Negative placeholder project_id for a plan's Tasks before dispatch assigns the real GitLab
    project_id; re-keyed on dispatch. Process-stable (fine for the draft→dispatch flow). (Phase A)"""
    return -(abs(hash(plan_id)) % 2_000_000_000)


async def _persist_draft_tasks(plan: PlanJSON, plan_id: str) -> None:
    """Best-effort: store a plan's Tasks (status 'planned') under the placeholder id so the Work
    hub sees drafted work. Idempotent — clears any prior draft for this plan first. (Phase A)"""
    try:
        now = datetime.now(timezone.utc).isoformat()
        pid = _plan_pid(plan_id)
        await delete_tasks_for_project(pid)
        objs = tasklib.materialize_tasks(plan, pid, now)
        pri = DELTA_PRIORITY.get(plan_id)
        if pri:
            for o in objs:
                o.priority = pri  # the feature's urgency rides on its tasks → drives the cascade in the preview
        await save_tasks([o.model_dump() for o in objs])
    except Exception:
        pass  # mirrors save_project_record — never fail planning over persistence


@app.post("/api/briefs/{brief_id}/plan")
async def make_plan(brief_id: str, req: Optional[PlanRequest] = None, _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    if brief_id not in BRIEFS:
        raise HTTPException(404, "brief not found")
    req = req or PlanRequest()
    # REASON: RAG (MongoDB MCP) → Gemini → assign. chosen_stack locks the stack (Idea 1).
    plan = await run_brief(BRIEFS[brief_id], chosen_stack=req.chosen_stack, constraints=req.constraints)
    plan_id = f"plan_{brief_id}"
    PLANS[plan_id] = plan
    RELAYS[plan_id] = relay.build_relay(plan)  # the one-shot output is now a DRAFT entering the relay
    await _persist_draft_tasks(plan, plan_id)
    await _create_interface_agreements(plan_id, plan)  # CDD: draft + route the cross-discipline contracts
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


async def _create_interface_agreements(plan_id: str, plan: PlanJSON) -> None:
    """Draft an interface contract at every cross-discipline dependency edge + route each to its two lane
    leads' Inboxes (minimal-ratifier). Best-effort — a miss is still caught at the integration gate."""
    try:
        members = team.all_members()
        drafts = list(await propose_interfaces(plan)) + agreements.propose_subteams(plan, members)
        if not drafts:
            return
        now = datetime.now(timezone.utc).isoformat()
        past = await all_agreements()  # the precedent pool (the compounding memory)
        for a in drafts:
            a.id = f"agr_{uuid.uuid4().hex[:8]}"
            a.plan_id = plan_id
            a.ratifiers = agreements.ratifiers_for(a, members)
            a.created_at = a.updated_at = now
            precedent = agreements.find_precedent(a.model_dump(), past)
            if precedent:
                # COMPOUND: the team already ratified this exact shape → auto-pass + seed the mock now, no routing
                a.state, a.precedent_id = "auto_passed", precedent
                if a.interface and a.producer_issue_id:
                    _apply_api_contract(plan_id, a.producer_issue_id, json.dumps(agreements.mock_from_schema(a.interface.response_fields)))
                await save_agreement(a.model_dump())
            else:
                a.state = "proposed"
                await save_agreement(a.model_dump())  # JIT: no broadcast at creation — the producer acts on this
                # contract folded into their gate; the consumer is pinged only once the producer signs (ratify_agreement).
            past.append(a.model_dump())  # a 2nd identical draft in this same plan also compounds
    except Exception:
        pass


async def _redraft_affected_interfaces(plan_id: str, plan: PlanJSON, discipline: str, slice_issues: list) -> None:
    """A gate's write-your-own choice just rewrote its issues — so any interface contract drafted from one
    of those producer issues may no longer fit the new API surface. Re-draft each affected contract, version
    it (old → superseded), and re-route the new draft to the two leads to re-ratify. Keeps CDD honest: the
    contract follows the chosen implementation, automatically, no meeting. Best-effort — the gate stands."""
    try:
        slice_ids = {i.id for i in slice_issues}
        affected = [a for a in await agreements_for_plan(plan_id)
                    if a.get("type") == "interface" and a.get("producer_issue_id") in slice_ids
                    and a.get("state") in ("proposed", "ratified", "auto_passed")]
        if not affected:
            return
        members = team.all_members()
        by_id = {i.id: i for e in plan.epics for i in e.issues}
        now = datetime.now(timezone.utc).isoformat()
        for old in affected:
            prod, cons = by_id.get(old.get("producer_issue_id")), by_id.get(old.get("consumer_issue_id"))
            if not prod or not cons:
                continue
            try:
                draft = await generate_interface(
                    f"FEATURE: {plan.project_name}\n"
                    f"PRODUCER ({prod.discipline}): {prod.title} — {(prod.description or '')[:200]}\n"
                    f"CONSUMER ({cons.discipline}): {cons.title} — {(cons.description or '')[:200]}\n"
                    f"Draft the interface contract the consumer needs from the producer.")
            except Exception:
                continue  # best-effort; the old contract + the integration gate are the net
            new = Agreement(
                id=f"agr_{uuid.uuid4().hex[:8]}", type="interface", plan_id=plan_id,
                subject=f"{prod.discipline}→{cons.discipline} · {draft.path or prod.title}",
                interface=draft, producer_issue_id=prod.id, consumer_issue_id=cons.id,
                producer_discipline=prod.discipline, consumer_discipline=cons.discipline,
                state="proposed", created_at=now, updated_at=now)
            new.ratifiers = agreements.ratifiers_for(new, members)
            await save_agreement(new.model_dump())
            await update_agreement(old["id"], {"state": "superseded", "superseded_by": new.id, "updated_at": now})
            _apply_api_contract(plan_id, prod.id, json.dumps(agreements.mock_from_schema(draft.response_fields)))  # refresh the FE mock to the new shape (the old one is stale)
            for u in new.ratifiers:
                await notify(u, "agreement_proposed", f"Interface contract changed · {new.subject}",
                             body=f"{discipline}'s gate choice reshaped this API — re-ratify the new version.",
                             ref={"agreement_id": new.id, "plan_id": plan_id}, actionable=True)
    except Exception:
        pass


@app.get("/api/plans/{plan_id}/agreements")
async def list_agreements(plan_id: str, _: DeveloperProfile = Depends(auth.current_member)) -> dict:
    return {"agreements": await agreements_for_plan(plan_id)}


@app.get("/api/me/agreements")
async def my_agreements(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The agreements awaiting MY signature — the Inbox queue (minimal-ratifier routing, no broadcast)."""
    return {"agreements": await agreements_for_ratifier(member.username)}


class RatifyAgreementBody(BaseModel):
    decision: Literal["ratified", "rejected"] = "ratified"
    note: str = ""


@app.post("/api/agreements/{agreement_id}/ratify")
async def ratify_agreement(agreement_id: str, body: RatifyAgreementBody,
                           member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    raw = await get_agreement(agreement_id)
    if not raw:
        raise HTTPException(404, "agreement not found")
    a = Agreement(**raw)
    if member.username not in a.ratifiers and member.role != "manager":
        raise HTTPException(403, "not a ratifier of this agreement")
    now = datetime.now(timezone.utc).isoformat()
    agreements.apply_ratification(a, member.username, body.decision, body.note, now)
    # Auto-mock, JIT-split: the producer signs FIRST (at their gate) → seed a PROVISIONAL mock so the
    # consumer reviews a real shape at its (later) gate, and ping the consumer then — not at creation.
    # Both signed → the SAME mock is finalized (what the FE builds against + QA verifies).
    if a.type == "interface" and a.interface and a.producer_issue_id:
        mock = json.dumps(agreements.mock_from_schema(a.interface.response_fields))
        if a.state == "ratified":
            _apply_api_contract(a.plan_id, a.producer_issue_id, mock)  # finalize
        elif body.decision == "ratified" and member.discipline == a.producer_discipline:
            _apply_api_contract(a.plan_id, a.producer_issue_id, mock)  # provisional, on the producer's sign
            signed = {r["by"] for r in a.ratifications if r.get("decision") == "ratified"}
            for u in a.ratifiers:
                if u not in signed:  # ping the consumer JIT — the producer validated; review the API your side consumes
                    await notify(u, "agreement_proposed", f"Interface contract ready · {a.subject}",
                                 body="The producer signed — review + ratify the API your side consumes.",
                                 ref={"agreement_id": a.id, "plan_id": a.plan_id}, actionable=True)
    await update_agreement(agreement_id, a.model_dump())
    return a.model_dump()


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
        if raw.get("type") != "interface" or raw.get("state") not in ("ratified", "auto_passed"):
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
    return {"checked": len(results), "violations": len([r for r in results if not r["ok"]]), "results": results}


@app.get("/api/reuse-pack")
async def get_reuse_pack(projects: str = "", _: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """The REUSE agreement made executable: the cited source files for a chosen memory solution — the dev
    pulls them (link → file list → seed the focus branch). 'it was built before' → 'it's in your branch'."""
    names = [p.strip() for p in projects.split(",") if p.strip()]
    files = await reuse_pack(names)
    return {"count": len(files), "files": files}


@app.get("/api/plans/{plan_id}", response_model=PlanJSON)
async def get_plan(plan_id: str) -> PlanJSON:
    if plan_id not in PLANS:
        raise HTTPException(404, "plan not found")
    return PLANS[plan_id]


@app.get("/api/plans/{plan_id}/relay", response_model=RelayState)
async def get_relay(plan_id: str) -> RelayState:
    if plan_id not in RELAYS:
        raise HTTPException(404, "relay not found")
    return RELAYS[plan_id]


class DialRequest(BaseModel):
    dial: int = 70


@app.post("/api/plans/{plan_id}/relay/auto", response_model=RelayState)
async def apply_dial(plan_id: str, req: DialRequest,
                     _: DeveloperProfile = Depends(auth.current_manager)) -> RelayState:
    """Manager-only: set the AI-autonomy posture → auto-pass every gate whose slice clears trust×risk."""
    state, plan = RELAYS.get(plan_id), PLANS.get(plan_id)
    if state is None or plan is None:
        raise HTTPException(404, "plan not found")
    relay.auto_pass(state, plan, _dev_trust(), req.dial, edges=await _routing_edges())
    return state


@app.post("/api/plans/{plan_id}/ratify/{discipline}", response_model=RelayState)
async def ratify_gate(
    plan_id: str, discipline: str, req: RatifyRequest,
    member: DeveloperProfile = Depends(auth.current_member),
) -> RelayState:
    """The discipline lead — or the MANAGER, for an orphan gate (no one holds that discipline) —
    adjusts the slice and passes the baton."""
    state, plan = RELAYS.get(plan_id), PLANS.get(plan_id)
    if state is None or plan is None:
        raise HTTPException(404, "plan not found")
    if discipline not in {g.discipline for g in state.gates}:
        raise HTTPException(404, f"no {discipline} gate")
    if member.role != "manager" and member.discipline != discipline:
        raise HTTPException(403, f"only the {discipline} lead or the manager can ratify this gate")
    if next(g.status for g in state.gates if g.discipline == discipline) == "blocked":
        raise HTTPException(409, "gate is blocked by an open integration failure — mark it api-ok first")
    relay.ratify(state, plan, discipline, req.edits, req.approve, req.note)  # type: ignore[arg-type]
    chosen = req.chosen_solution
    if req.approve:  # capture the pick + a durable Decision record (reasoning memory) — only on approval
        sl = [i for e in plan.epics for i in e.issues if i.discipline == discipline]
        if chosen is not None:  # reuse-or-innovate: record the pick
            CHOSEN[(plan_id, discipline)] = chosen
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
                await _redraft_affected_interfaces(plan_id, plan, discipline, sl)  # a reshaped slice → re-draft its interface contracts
            # Cross-gate impact: ONLY when the choice ADDED files (a user rewrite) that touch another gate.
            # A memory/ai pick changes no files → never bounces another discipline's already-ratified gate.
            added = sorted(soln.gate_slice_files(plan, discipline) - pre_files)
            if added:
                await team.ensure_loaded()
                for d in soln.cross_gate_overlap(plan, discipline, added):
                    for g in state.gates:
                        if g.discipline == d and g.status in ("ratified", "auto_passed"):
                            g.status = "changes_requested"
                            g.note = f"re-ratify — {discipline}'s chosen solution now touches your slice"
                    owner = next((m.username for m in team.all_members() if m.discipline == d), None)
                    if owner:
                        await notify(owner, "ratify_needed",
                                     f"Re-ratify {d}: {discipline}'s choice now touches your slice",
                                     ref={"plan_id": plan_id, "discipline": d}, actionable=True)
                relay._recompute_baton(state)  # bounced gates re-enter the baton
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
    if relay.all_ratified(state):           # relay fully cleared → ping the plan's assignees + their watchers
        for a in sorted({i.assignee for e in plan.epics for i in e.issues if i.assignee}):
            await notify(a, "task_completed", f"{plan.project_name}: all relay gates ratified", ref={"plan_id": plan_id})
            await notify_watchers(a, "completed", f"{plan.project_name} cleared the relay", ref={"plan_id": plan_id})
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
    member_owns = relay.lane_stage(member.discipline or "") == "accept"
    has_owner = any(relay.lane_stage(m.discipline or "") == "accept" for m in members if m.role == "developer")
    return member_owns or (member.role == "manager" and not has_owner)


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


async def _can_read_contract(member: DeveloperProfile, discipline: str) -> bool:
    """Contract visibility: a gate's Contract (solutions + decision card) is private to the gate OWNER (the
    dev in that lane), the MANAGER, or anyone holding a GRANTED Watch on the owner. Tickets stay fully open —
    this gates only the Contract reads (the per-gate reuse-or-innovate set + decision card)."""
    if member.role == "manager":
        return True
    if member.discipline == discipline:
        return True
    owner = next((m.username for m in team.all_members() if m.discipline == discipline), None)
    if owner:
        for g in await access_grants_for_requester(member.username):
            if g.get("subject_id") == owner and g.get("status") == "granted":
                return True
    return False


@app.get("/api/plans/{plan_id}/gates/{discipline}/solutions", response_model=SolutionSet)
async def gate_solutions(
    plan_id: str, discipline: str, member: DeveloperProfile = Depends(auth.current_member),
) -> SolutionSet:
    """Reuse-or-innovate (the Contract spine): lazily generate — then cache — the solution set for ONE gate:
    a memory-grounded option + 1-2 fresh AI options + a write-your-own slot. One LLM call per gate, ever."""
    plan = PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    if not await _can_read_contract(member, discipline):
        return SolutionSet(discipline=discipline, solutions=[])  # private — owner / manager / granted Watch only
    key = (plan_id, discipline)
    if key in SOLUTIONS:
        return SOLUTIONS[key]
    slice_issues = [i for e in plan.epics for i in e.issues if i.discipline == discipline]
    if not slice_issues:
        raise HTTPException(404, "no slice for this discipline in the plan")
    try:
        sset = await propose_solutions(plan, discipline)  # MongoDB MCP grounding + one Gemini call
    except Exception:  # a transient model/DB error must NOT 500 the Contract — degrade to a stub + user slot
        sset = SolutionSet(solutions=[SolutionCard(
            source="ai", title="Define this slice",
            summary="AI proposal unavailable — describe the approach, or write your own.")])
    slice_files = soln.gate_slice_files(plan, discipline)
    dependents: dict[str, list[str]] = {}
    pid = DELTA_TARGET.get(plan_id)  # the code graph exists only for a dispatched repo (delta flow)
    if pid is not None:
        try:
            edges = [GraphEdge(**e) for e in await graph_edges(str(pid))]
            dependents = {f: graph.dependents_of(f, edges) for f in slice_files}
        except Exception:
            dependents = {}
    sset = soln.finalize_solution_set(sset, discipline, soln.impacted_files(slice_files, dependents))
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
    SOLUTIONS[key] = sset
    return sset


async def _build_reuse_seeds(plan_id: str, plan: PlanJSON) -> dict[str, list[dict]]:
    """Reuse layer-2: for each gate whose ratified pick is memory-grounded, fetch the cited source files,
    AI-adapt them to this stack, and map them to that discipline's code/infra issue branches. The result
    flows to handoff.commit_context_branches, which commits them into the dev's focus branch + a manifest.
    Live only — demo `execute_plan` is a stub, so we never spend a fetch/Gemini call there."""
    if demo.is_demo():
        return {}
    ts = plan.tech_stack
    stack = f"frontend={ts.frontend}, backend={ts.backend}, db={ts.db}, infra={ts.infra}"
    seeds: dict[str, list[dict]] = {}
    for (pid_key, disc), chosen in list(CHOSEN.items()):
        if pid_key != plan_id or not chosen.grounded_on:  # only memory-grounded (reuse) picks seed code
            continue
        targets = [i.id for e in plan.epics for i in e.issues
                   if i.discipline == disc and (i.kind or "code") in ("code", "infra")]
        if not targets:
            continue  # no code/infra branch in this gate → don't spend a GitLab fetch + a Gemini adapt
        try:
            rows = await reuse_pack(chosen.grounded_on, limit=6)
        except Exception:
            continue
        seed_files: list[dict] = []
        for f in rows:
            info = gitlab.file_ref_from_blob_url(str(f.get("web_url", "")))
            if not info:
                continue
            proj, ref, src_path = info
            try:
                raw = await run_in_threadpool(gitlab.get_file_raw, proj, src_path, ref)
            except Exception:
                continue  # cross-org / deleted / permission — the manifest link still cites it
            adapted = await generate_adapted_code(raw, stack, f"{disc} slice of {plan.project_name}")
            seed_files.append({
                "path": f"reused/{src_path}", "content": adapted,
                "source_url": str(f.get("web_url", "")), "source_project": str(f.get("project", "")),
            })
        if not seed_files:
            continue
        for iid in targets:
            seeds[iid] = seed_files  # every branch in the reusing gate opens with the reference code
    return seeds


@app.post("/api/plans/{plan_id}/approve")
async def approve_plan(plan_id: str, req: ApproveRequest, _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    plan = req.edits or PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    state = RELAYS.get(plan_id)  # create-late (decision 5): never scaffold before the relay clears
    if state is not None and not relay.all_ratified(state):
        pending = [g.discipline for g in state.gates if g.status not in ("ratified", "auto_passed")]
        raise HTTPException(409, f"Sign the Contract for {len(pending)} open gate(s) first: {', '.join(pending)}.")
    # EXECUTE: scaffold real GitLab infra (sync httpx → threadpool); seed reuse drafts into focus branches.
    seeds = await _build_reuse_seeds(plan_id, plan)
    result = await run_in_threadpool(lambda: execute_plan(plan, reuse_seeds=seeds))
    RESULTS[plan_id] = result
    return {"plan_id": plan_id, "mode": req.mode, **result}


@app.get("/api/plans/{plan_id}/dispatch/preview")
async def dispatch_preview(plan_id: str) -> dict:
    """Dry-run the irreversible GitLab creation (decision 5): what it will create, who it will invite,
    and whether the invite count exceeds the free-tier 5-member group cap. The manager reviews this
    BEFORE committing via /dispatch — the router can auto-clear the relay with no human, so this is the
    real go/no-go on spending real GitLab budget."""
    plan = PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    await team.ensure_loaded()
    issues = [i for e in plan.epics for i in e.issues]
    repo_members = sorted({
        i.assignee for i in issues
        if i.assignee and (mb := team.get(i.assignee)) and mb.gitlab_user_id and policy.needs_repo(mb.discipline)
    })
    cap = 5  # GitLab free-tier members-per-group cap
    state = RELAYS.get(plan_id)
    return {
        "plan_id": plan_id, "project_name": plan.project_name, "is_delta": plan_id in DELTA_TARGET,
        "creates": {"project": 0 if plan_id in DELTA_TARGET else 1, "issues": len(issues)},
        "member_invites": repo_members, "invite_count": len(repo_members),
        "free_tier_cap": cap, "exceeds_cap": len(repo_members) > cap,
        "relay_cleared": bool(state and relay.all_ratified(state)),
    }


@app.post("/api/plans/{plan_id}/dispatch")
async def dispatch_plan(plan_id: str, req: DispatchRequest, _: DeveloperProfile = Depends(auth.current_manager)) -> dict:
    """Scaffold (or, for a delta plan, extend) once the relay clears. Persists a ProjectRecord."""
    plan, state = PLANS.get(plan_id), RELAYS.get(plan_id)
    if plan is None or state is None:
        raise HTTPException(404, "plan not found")
    if req.mode == "autonomous":
        relay.auto_pass(state, plan, _dev_trust(), 100, edges=await _routing_edges())
    if not relay.all_ratified(state):
        pending = [g.discipline for g in state.gates if g.status not in ("ratified", "auto_passed")]
        raise HTTPException(409, f"Sign the Contract for {len(pending)} open gate(s) first: {', '.join(pending)}.")
    seeds = await _build_reuse_seeds(plan_id, plan)  # reuse layer-2: adapted reference code → focus branches
    if plan_id in DELTA_TARGET:  # mid-prod: append to the existing project
        pid = DELTA_TARGET[plan_id]
        result = await run_in_threadpool(lambda: extend_project(plan, pid, reuse_seeds=seeds))
        result["project_id"] = pid
        if pid in PROJECTS:  # grow the live plan so QA + later deltas see the new issues
            PROJECTS[pid].epics.extend(plan.epics)
        try:  # refresh the durable record so the NEXT feature-add grounds on current titles + files, not the dispatch-day snapshot
            rec = await get_project_record(pid)
            if rec and rec.get("plan"):
                merged = PlanJSON(**rec["plan"])
                merged.epics.extend(plan.epics)
                await update_project_record(pid, {"plan": merged.model_dump(), "module_manifest": _manifest_of(merged)})
        except Exception as e:
            result["persist_warning"] = str(e)[:200]
    else:
        result = await run_in_threadpool(lambda: execute_plan(plan, reuse_seeds=seeds))
        PROJECTS[result["project_id"]] = plan
        manifest = _manifest_of(plan)
        record = ProjectRecord(
            project_id=result["project_id"], name=plan.project_name, web_url=result.get("web_url", ""),
            tech_stack=plan.tech_stack, grounded_on=plan.grounded_on, plan=plan, module_manifest=manifest,
        )
        rec = record.model_dump()
        rec["created_at"] = datetime.now(timezone.utc).isoformat()
        try:
            await save_project_record(rec)
        except Exception as e:  # persistence is best-effort; never fail the scaffold over it
            result["persist_warning"] = str(e)[:200]
    # Re-key the plan's Tasks from the pre-dispatch placeholder to the real GitLab project_id and
    # flip to in_progress. Delta plans APPEND to the existing project's tasks (don't wipe them).
    # iid linking is best-effort: execute_plan returns counts, not an issue list → Phase D reconciles.
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
        avail = scheduler.blocked_days([ChangeEvent(**e) for e in await all_events()])
        scheduler.schedule_tasks(objs, team.all_members(), now, availability=avail)  # availability-aware
        await save_tasks([o.model_dump() for o in objs])
        # Tier A: re-pack the whole project (existing + new) around REAL availability — new work now
        # respects the team's calendar + roadmap instead of being scheduled in isolation.
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
        pass  # never block dispatch on task persistence
    RESULTS[plan_id] = result
    # The relay is FINISHED → drop it from the in-flight board (the project now lives in Projects + Tester).
    RELAYS.pop(plan_id, None)
    PLANS.pop(plan_id, None)
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
    if not (_is_qa_owner(member, team.all_members()) or member.role == "manager"):
        raise HTTPException(403, "only the acceptance/qa owner or the manager can reject an item")
    res = await run_in_threadpool(handoff.reroute, project_id, iid, req.comment, req.to_runner)
    REQA.setdefault(project_id, set()).add(iid)
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
    await _persist_draft_tasks(plan, plan_id)
    await _create_interface_agreements(plan_id, plan)  # CDD: a delta's cross-discipline edges get contracts too (compounding from prior plans)
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
    avail = scheduler.blocked_days([ChangeEvent(**e) for e in await all_events()])
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
    if not (member.role == "manager" or member.discipline == req.discipline):
        raise HTTPException(403, "only the manager or the discipline lead can add a task here")
    await team.ensure_loaded()
    devs = team.all_members()
    assignee = req.assignee
    if not assignee:  # auto-route: lowest-load dev in the discipline
        cand = min((m for m in devs if m.discipline == req.discipline and m.load < 100), key=lambda m: m.load, default=None)
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
    try:
        rows = await all_tasks()
    except Exception:
        rows = []
    if scope == "me":
        rows = [t for t in rows if t.get("assignee") == member.username]
    elif scope.startswith("user:"):
        who = scope.split(":", 1)[1]
        rows = [t for t in rows if t.get("assignee") == who]
    # else: team → every task, full detail
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
    if member.discipline != t.discipline:
        raise HTTPException(403, "you can only claim tasks in your own discipline")
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
    if "assignee" not in tasklib.can_edit(
        t, editor_role=member.role, editor_user=member.username, editor_discipline=member.discipline
    ):
        raise HTTPException(403, "only the manager or the discipline lead can reassign this task")
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
            reviewers = [m for m in members if m.discipline == "qa"] or [m for m in members if m.role == "manager"]
            for r in reviewers:
                if r.username != actor.username:
                    await notify(r.username, "ratify_needed", f"Ready for review: {t.title}",
                                 body=f"@{actor.username} moved '{t.title}' to In Review.",
                                 ref={"task_id": t.id, "project_id": t.project_id}, actionable=True)
        elif t.status == "done":
            mgr = next((m for m in members if m.role == "manager"), None)
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
    if member.role != "manager" and t.assignee != member.username:
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
        avail = scheduler.blocked_days([ChangeEvent(**e) for e in await all_events()])
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
        avail = scheduler.blocked_days([ChangeEvent(**e) for e in await all_events()])
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
            mgr = next((m for m in team.all_members() if m.role == "manager"), None)
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
    avail = scheduler.blocked_days([ChangeEvent(**e) for e in await all_events()])
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
    if member.role != "manager" and member.username not in prop.get("affected_users", []):
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
    if member.role != "manager" and member.username not in prop.get("affected_users", []):
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
    if member.role != "manager" and d.get("owner_id") != member.username:
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
    if not await _can_read_contract(member, discipline):  # Contract is private — redacted for non-owner/manager/watcher
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
    if member.role != "manager":
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
async def graph_get(project_id: str = "local", member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    return {"project_id": project_id, "nodes": await graph_nodes(project_id), "edges": await graph_edges(project_id)}


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
    if member.role != "manager" and member.discipline != req.domain:
        raise HTTPException(403, "only the manager or the domain lead can set governance for this domain")
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
    lead = next((m.username for m in team.all_members() if m.role == "developer" and m.discipline == disc), None)
    return lead or next((m.username for m in team.all_members() if m.role == "manager"), None)


@app.post("/api/graph/refactor")
async def graph_refactor(req: RefactorRequest, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Drift report → a maintenance Task in the work hub / relay, ASSIGNED to the domain lead + a live
    `drift_flagged` ping (Code Graph #4 → notifications #5). Same relay system as feature work."""
    if member.role != "manager":
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
        if raw.get("type") != "interface" or raw.get("state") not in ("ratified", "auto_passed"):
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
    contract = await _verify_on_merge(req)  # the verify beat (None when the merge carries no sample to check)

    def _with(out: dict) -> dict:
        if contract is not None:
            out["contract"] = contract
        return out
    if demo.is_demo():  # grow the in-mem roster dev directly (record_merge's Atlas read returns nothing in demo)
        grown = team.grow_demo_member(req.gitlab_username, req.task_type)
        if grown:
            return _with(grown)
    result = await record_merge(req.gitlab_username, req.task_type, req.score)
    if result:
        return _with(result)
    aid = f"att_{uuid.uuid4().hex[:8]}"
    ATTRIBUTIONS.append({
        "id": aid, "gitlab_username": req.gitlab_username, "task_type": req.task_type,
        "score": req.score, "project_id": req.project_id, "issue_iid": req.issue_iid,
        "suggested": _suggest_attribution(req.gitlab_username),
    })
    return _with({"needs_attribution": True, "attribution_id": aid, "suggested": ATTRIBUTIONS[-1]["suggested"]})


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
    return await _attach_availability(team.developers() or CANNED_DEVELOPERS)


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
