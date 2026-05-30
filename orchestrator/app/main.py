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
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google.genai.errors import ClientError

from pydantic import BaseModel

from app import auth, gitlab, handoff, relay, scheduler, staffing, strategist, tasks as tasklib, team
from app.canned import CANNED_DEVELOPERS
from app.contracts import (
    AccessGrant, ApproveRequest, ArchitectureOptions, ChangeEvent, ClarifiedSpec, ClarifyResolution, Constraints,
    Decision, DeveloperProfile, DispatchRequest, FeatureRequest, IntegrationSignal, Notification, PlanJSON,
    PlanRequest, ProjectRecord, QAReport, RatifyRequest, RelayState, Task,
    ImpactedTask, RescheduleProposal,
)
from app.execute import execute_plan, extend_project
from app.rag import (
    access_grants_for_subject, access_grants_for_requester, all_project_records, decisions_by_owner,
    get_access_grant, get_project_record, past_projects, record_merge,
    save_access_grant, save_decision, save_notification, notifications_for_user, mark_all_read,
    save_project_record, update_access_grant, update_project_record,
    all_events, all_tasks, delete_tasks_for_project, get_task, mongo_close, save_event, save_tasks,
    tasks_for_project, update_task,
    save_reschedule_proposal, open_reschedule_proposals,
    get_reschedule_proposal, update_reschedule_proposal,
)
from app.reason import (
    clarify_brief, close_project, delta_brief, link_gitlab, onboard_developer, propose_architectures,
    qa_review, reconcile_links, run_brief,
)

app = FastAPI(title="sprint0", version="0.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
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

# Demo-grade in-memory stores.
BRIEFS: dict[str, str] = {}
SPECS: dict[str, ClarifiedSpec] = {}
ARCHS: dict[str, ArchitectureOptions] = {}  # brief_id → cached architecture options (wizard resume, no Gemini re-run)
PLANS: dict[str, PlanJSON] = {}
RELAYS: dict[str, RelayState] = {}
RESULTS: dict[str, dict] = {}
DELTA_TARGET: dict[str, int] = {}  # plan_id → existing project_id (mid-prod delta plans extend, not create)
PROJECTS: dict[int, PlanJSON] = {}  # project_id → live plan (for QA review + mid-prod, this session)
REQA: dict[int, set] = {}  # project_id → reopened issue iids awaiting re-QA (the reject→fix→re-QA loop)


def _dev_trust() -> dict[str, dict]:
    """username / gitlab_username → {trust: per-discipline dict, trust_level} for relay auto-pass."""
    out: dict[str, dict] = {}
    for mbr in team.all_members() or CANNED_DEVELOPERS:
        entry = {"trust": getattr(mbr, "trust", {}) or {}, "trust_level": mbr.trust_level}
        out[mbr.username if hasattr(mbr, "username") and mbr.username else mbr.gitlab_username] = entry
        out[mbr.gitlab_username] = entry
    return out


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "phase": 4, "service": "sprint0"}


@app.on_event("startup")
async def _startup() -> None:
    """Load the team roster + persisted projects so per-account views are instant + complete.
    Also backfill Tasks for projects dispatched before the Task store existed (idempotent)."""
    try:
        await team.refresh()
        now = datetime.now(timezone.utc).isoformat()
        for rec in await all_project_records():
            if not rec.get("plan"):
                continue
            pid = rec["project_id"]
            PROJECTS[pid] = PlanJSON(**rec["plan"])
            try:
                if not await tasks_for_project(pid):  # never materialized (pre-Phase-A / seeded) → backfill
                    objs = tasklib.materialize_tasks(PROJECTS[pid], pid, now)
                    for o in objs:
                        o.status = "in_progress"  # these projects are already live
                    scheduler.schedule_tasks(objs, team.all_members(), now)
                    await save_tasks([o.model_dump() for o in objs])
            except Exception:
                pass  # backfill is best-effort
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


@app.get("/api/me", response_model=DeveloperProfile)
async def me(member: DeveloperProfile = Depends(auth.current_member)) -> DeveloperProfile:
    return member


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
                if g.discipline == "qa" or i.discipline == g.discipline
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


async def notify(user_id: str, type: Literal["ratify_needed", "access_requested", "access_granted", "qa_failed", "project_shipped", "reschedule_proposed", "reschedule_resolved", "task_assigned"], title: str, *, body: str = "", ref: dict | None = None, actionable: bool = False) -> None:
    """Best-effort: append a Notification to a member's Inbox feed."""
    try:
        n = Notification(id=f"ntf_{uuid.uuid4().hex[:8]}", user_id=user_id, type=type, title=title,
                         body=body, ref=ref or {}, actionable=actionable,
                         created_at=datetime.now(timezone.utc).isoformat())
        await save_notification(n.model_dump())
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


@app.get("/api/projects")
async def list_projects(_: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """All repos in the demo group (real source of truth). A repo with a ProjectRecord is
    sprint0-managed → kind=active (full plan/status/counts); the rest (agency seed repos) are
    kind=reference, enriched from PastProjects memory. Falls back to ProjectRecords if GitLab is down."""
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
    return {"count": len(out), "projects": out}


@app.post("/api/briefs")
async def create_brief(text: Optional[str] = Form(None), file: Optional[UploadFile] = File(None)) -> dict:
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
async def clarify(brief_id: str, constraints: Optional[Constraints] = None) -> ClarifiedSpec:
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
async def architectures(brief_id: str, constraints: Optional[Constraints] = None) -> ArchitectureOptions:
    """Idea 1: 2-3 grounded Architecture Cards for the manager to pick from."""
    if brief_id not in BRIEFS:
        raise HTTPException(404, "brief not found")
    opts = await propose_architectures(BRIEFS[brief_id], constraints or Constraints())
    ARCHS[brief_id] = opts  # cache for wizard resume
    return opts


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
        await save_tasks([t.model_dump() for t in tasklib.materialize_tasks(plan, pid, now)])
    except Exception:
        pass  # mirrors save_project_record — never fail planning over persistence


@app.post("/api/briefs/{brief_id}/plan")
async def make_plan(brief_id: str, req: Optional[PlanRequest] = None) -> dict:
    if brief_id not in BRIEFS:
        raise HTTPException(404, "brief not found")
    req = req or PlanRequest()
    # REASON: RAG (MongoDB MCP) → Gemini → assign. chosen_stack locks the stack (Idea 1).
    plan = await run_brief(BRIEFS[brief_id], chosen_stack=req.chosen_stack, constraints=req.constraints)
    plan_id = f"plan_{brief_id}"
    PLANS[plan_id] = plan
    RELAYS[plan_id] = relay.build_relay(plan)  # the one-shot output is now a DRAFT entering the relay
    await _persist_draft_tasks(plan, plan_id)
    return {"plan_id": plan_id, "plan": plan.model_dump(), "relay": RELAYS[plan_id].model_dump()}


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
async def apply_dial(plan_id: str, req: DialRequest) -> RelayState:
    """Manager sets the Trust Dial → auto-pass every gate whose slice clears trust×risk."""
    state, plan = RELAYS.get(plan_id), PLANS.get(plan_id)
    if state is None or plan is None:
        raise HTTPException(404, "plan not found")
    relay.auto_pass(state, plan, _dev_trust(), req.dial)
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
    if req.approve:  # capture a durable Decision record (reasoning memory) — only on approval
        sl = [i for e in plan.epics for i in e.issues if i.discipline == discipline]
        now = datetime.now(timezone.utc).isoformat()
        dec = Decision(
            id=f"dec_{uuid.uuid4().hex[:8]}", owner_id=member.username, domain=discipline,  # type: ignore[arg-type]
            context_tags=sorted({i.required_skill for i in sl if i.required_skill}),
            recommendation=("; ".join(i.title for i in sl))[:100],
            reasoning=req.reasoning, project_id=plan_id, project_name=plan.project_name,
            issue_ids=[i.id for i in sl], created_at=now, updated_at=now,
        )
        try:
            await save_decision(dec.model_dump())
        except Exception:
            pass  # best-effort persistence, mirrors save_project_record at dispatch
    return state


# ── Integration gate (B+C+D): declared api-failing signal → reject to producer, block qa ──
def _find_issue(plan: PlanJSON, issue_id: str | None):
    if not issue_id:
        return None
    return next((i for e in plan.epics for i in e.issues if i.id == issue_id), None)


def _owns_issue(member: DeveloperProfile, issue) -> bool:
    return issue is not None and issue.assignee in (member.username, member.gitlab_username)


def _is_qa_owner(member: DeveloperProfile, members: list[DeveloperProfile]) -> bool:
    """The qa-gate owner: the qa lead, or — when no one holds qa — the manager (orphan-inheritance,
    the same rule as _my_gates / ratify_gate)."""
    return member.discipline == "qa" or (member.role == "manager" and staffing.is_orphan("qa", members))


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
    return state.model_dump()


@app.get("/api/plans/{plan_id}/staffing")
async def plan_staffing(plan_id: str) -> dict:
    """Team-coverage + gap recommendations (who to stretch / onboard) for the manager."""
    plan = PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    await team.ensure_loaded()
    return {"coverage": staffing.coverage(plan, team.all_members())}


@app.post("/api/plans/{plan_id}/approve")
async def approve_plan(plan_id: str, req: ApproveRequest) -> dict:
    plan = req.edits or PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    # EXECUTE: scaffold real GitLab infra (sync httpx → threadpool).
    result = await run_in_threadpool(execute_plan, plan)
    RESULTS[plan_id] = result
    return {"plan_id": plan_id, "mode": req.mode, **result}


@app.post("/api/plans/{plan_id}/dispatch")
async def dispatch_plan(plan_id: str, req: DispatchRequest) -> dict:
    """Scaffold (or, for a delta plan, extend) once the relay clears. Persists a ProjectRecord."""
    plan, state = PLANS.get(plan_id), RELAYS.get(plan_id)
    if plan is None or state is None:
        raise HTTPException(404, "plan not found")
    if req.mode == "autonomous":
        relay.auto_pass(state, plan, _dev_trust(), 100)
    if not relay.all_ratified(state):
        pending = [g.discipline for g in state.gates if g.status not in ("ratified", "auto_passed")]
        raise HTTPException(409, f"relay not cleared — gates still open: {pending}")
    if plan_id in DELTA_TARGET:  # mid-prod: append to the existing project
        pid = DELTA_TARGET[plan_id]
        result = await run_in_threadpool(extend_project, plan, pid)
        result["project_id"] = pid
        if pid in PROJECTS:  # grow the live plan so QA + later deltas see the new issues
            PROJECTS[pid].epics.extend(plan.epics)
    else:
        result = await run_in_threadpool(execute_plan, plan)
        PROJECTS[result["project_id"]] = plan
        manifest = sorted({f for e in plan.epics for i in e.issues for f in i.context_scope.files})
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
        for o in objs:
            o.status = "in_progress"
            o.gitlab_issue_iid = iid_by_title.get(o.title)
        await team.ensure_loaded()
        scheduler.schedule_tasks(objs, team.all_members(), now)  # compute scheduled_start/end
        await save_tasks([o.model_dump() for o in objs])
    except Exception:
        pass  # never block dispatch on task persistence
    RESULTS[plan_id] = result
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


@app.post("/api/projects/{project_id}/issues/{iid}/reject")
async def reject_issue(project_id: int, iid: int, req: RejectRequest) -> dict:
    """Idea 2: QA reject → reopen + route back to the responsible-layer runner. Flags the issue
    for re-QA so it re-enters the checklist once the fix is merged."""
    res = await run_in_threadpool(handoff.reroute, project_id, iid, req.comment, req.to_runner)
    REQA.setdefault(project_id, set()).add(iid)
    return {**res, "awaiting_reqa": sorted(REQA[project_id])}


@app.post("/api/projects/{project_id}/features")
async def add_feature(project_id: int, req: FeatureRequest) -> dict:
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
    await _persist_draft_tasks(plan, plan_id)
    return {"plan_id": plan_id, "project_id": project_id, "plan": plan.model_dump(), "relay": RELAYS[plan_id].model_dump()}


# ── Work hub (Phase A): Tasks aggregate + per-task edit/claim/status ──
class TaskPatch(BaseModel):
    patch: dict


def _redact(task: dict, viewer: DeveloperProfile, granted_subjects: set[str] | None = None) -> dict:
    """Full detail if manager, own task, or a granted viewer of the assignee; else title+status+discipline only."""
    if (viewer.role == "manager" or task.get("assignee") == viewer.username
            or (granted_subjects and task.get("assignee") in granted_subjects)):
        return task
    return {"id": task["id"], "project_id": task["project_id"], "title": task["title"],
            "status": task["status"], "discipline": task["discipline"], "assignee": task.get("assignee"),
            "redacted": True}


@app.get("/api/work")
async def work(scope: str = "me", member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Aggregate of Tasks for the Work hub. scope = me | team | user:<username>."""
    try:
        rows = await all_tasks()
    except Exception:
        rows = []
    granted = {g["subject_id"] for g in await access_grants_for_requester(member.username) if g.get("status") == "granted"}
    if scope == "me":
        rows = [t for t in rows if t.get("assignee") == member.username]
    elif scope.startswith("user:"):
        who = scope.split(":", 1)[1]
        rows = [_redact(t, member, granted) for t in rows if t.get("assignee") == who]
    else:  # team
        rows = [_redact(t, member, granted) for t in rows]
    return {"scope": scope, "count": len(rows), "tasks": rows}


async def _load_task_or_404(task_id: str) -> Task:
    doc = await get_task(task_id)
    if not doc:
        raise HTTPException(404, "no such task")
    return Task(**doc)


@app.get("/api/tasks/{task_id}")
async def task_detail(task_id: str, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    doc = await get_task(task_id)
    if not doc:
        raise HTTPException(404, "no such task")
    granted = {g["subject_id"] for g in await access_grants_for_requester(member.username) if g.get("status") == "granted"}
    return _redact(doc, member, granted)


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
    return updated.model_dump()


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
        scheduler.schedule_tasks(objs, team.all_members(), datetime.now(timezone.utc).isoformat(), availability=avail)
        for o in objs:
            await update_task(o.id, {"scheduled_start": o.scheduled_start, "scheduled_end": o.scheduled_end})
        return len(objs)
    except Exception:
        return 0  # never fail an assignment over the recompute


@app.post("/api/schedule/recompute")
async def recompute_schedule(project_id: int, member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Re-run the deterministic scheduler for a project's Tasks and persist the dates."""
    return {"project_id": project_id, "scheduled": await _reschedule_project(project_id)}


# ── Reflow engine: one event-driven, cross-roadmap, minimal-perturbation re-flow path ──
async def _reflow_for_event(ev: ChangeEvent) -> list[dict]:
    """Incremental, availability-aware, cross-project reflow for a single change event. Recomputes
    only the affected subgraph (minimal perturbation), persists ONLY tasks whose dates moved, returns
    them. A work event marks its task changed (and applies an estimate change); a calendar event marks
    the affected person's whole task stream. Best-effort: never raises into the request."""
    try:
        objs = [Task(**d) for d in await all_tasks()]
        if not objs:
            return []
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
            return []
        await team.ensure_loaded()
        avail = scheduler.blocked_days([ChangeEvent(**e) for e in await all_events()])
        prior = {o.id: (o.scheduled_start, o.scheduled_end) for o in objs}
        scheduler.reflow(objs, team.all_members(), datetime.now(timezone.utc).isoformat(),
                         changed, availability=avail)
        moved = [o for o in objs if (o.scheduled_start, o.scheduled_end) != prior[o.id]]
        for o in moved:                                           # only-changed write (not N updates)
            await update_task(o.id, {"scheduled_start": o.scheduled_start, "scheduled_end": o.scheduled_end})
        return [o.model_dump() for o in moved]
    except Exception:
        return []


SEMANTIC_KINDS = {"spec_change", "scope_change", "blocked"}  # content changes the date-graph can't judge
STRATEGIST_IMPACT_THRESHOLD = 3                              # tasks moved → high-impact enough to ask the AI


async def _maybe_strategize(ev: ChangeEvent, moved: list[dict]) -> dict | None:
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
    moved = await _reflow_for_event(ev)
    return {"event": ev.model_dump(), "reflowed": moved, "strategy": await _maybe_strategize(ev, moved)}


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
async def qa_run(project_id: int) -> QAReport:
    """Layered QA: the QA-agent prefills the acceptance checklist; reopened items are flagged."""
    plan = PROJECTS.get(project_id)
    if plan is None:
        raise HTTPException(404, "no live plan for this project — dispatch it first")
    report = await qa_review(plan)
    report.reopened = sorted(REQA.get(project_id, set()))
    return report


class CloseRequest(BaseModel):
    outcome_notes: str = ""


@app.post("/api/projects/{project_id}/close")
async def close(project_id: int, req: CloseRequest) -> dict:
    """Post-mortem: write the shipped project into agency memory; mark the record closed."""
    record = await get_project_record(project_id)
    if not record:
        raise HTTPException(404, "no project record")
    out = await close_project(record, req.outcome_notes)
    try:
        await update_project_record(project_id, {"status": "closed"})
    except Exception:
        pass
    return out


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


@app.post("/api/merge")
async def merge(req: MergeRequest) -> dict:
    """Passport-increment-on-merge (+ auto-promotion). If it resolves a rejected issue, clear it
    from the re-QA queue. If no roster member matches the merge identity → queue for manager
    attribution (chain priority: gitlab_user_id → runner label → here, the human fallback)."""
    if req.project_id is not None and req.issue_iid is not None:
        REQA.get(req.project_id, set()).discard(req.issue_iid)
    result = await record_merge(req.gitlab_username, req.task_type, req.score)
    if result:
        return result
    aid = f"att_{uuid.uuid4().hex[:8]}"
    ATTRIBUTIONS.append({
        "id": aid, "gitlab_username": req.gitlab_username, "task_type": req.task_type,
        "score": req.score, "project_id": req.project_id, "issue_iid": req.issue_iid,
        "suggested": _suggest_attribution(req.gitlab_username),
    })
    return {"needs_attribution": True, "attribution_id": aid, "suggested": ATTRIBUTIONS[-1]["suggested"]}


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


@app.get("/api/developers", response_model=list[DeveloperProfile])
async def list_developers() -> list[DeveloperProfile]:
    await team.ensure_loaded()
    return team.developers() or CANNED_DEVELOPERS


@app.post("/api/developers", response_model=DeveloperProfile)
async def add_developer(text: Optional[str] = Form(None), file: Optional[UploadFile] = File(None)) -> DeveloperProfile:
    """Cold-Start onboarding: drop a CV (text or PDF) → parse → upsert (Trust: Low)."""
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
    member = DeveloperProfile(**await onboard_developer(cv))
    await team.refresh()  # the new member joins the roster immediately (login + assignment pool)
    return member


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
