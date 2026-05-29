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
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google.genai.errors import ClientError

from pydantic import BaseModel

from app import auth, gitlab, handoff, relay, staffing, team
from app.canned import CANNED_DEVELOPERS
from app.contracts import (
    ApproveRequest, ArchitectureOptions, ClarifiedSpec, ClarifyResolution, Constraints,
    Decision, DeveloperProfile, DispatchRequest, FeatureRequest, PlanJSON, PlanRequest, ProjectRecord,
    QAReport, RatifyRequest, RelayState,
)
from app.execute import execute_plan, extend_project
from app.rag import (
    all_project_records, decisions_by_owner, get_project_record, past_projects, record_merge,
    save_decision, save_project_record, update_project_record,
)
from app.reason import (
    clarify_brief, close_project, delta_brief, link_gitlab, onboard_developer, propose_architectures,
    qa_review, reconcile_links, run_brief,
)

app = FastAPI(title="sprint0", version="0.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
    """Load the team roster + persisted projects so per-account views are instant + complete."""
    try:
        await team.refresh()
        for rec in await all_project_records():
            if rec.get("plan"):
                PROJECTS[rec["project_id"]] = PlanJSON(**rec["plan"])
    except Exception:
        pass  # Atlas may be momentarily unreachable; lazy-load on first authed request


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


@app.get("/api/me/queue")
async def my_queue(member: DeveloperProfile = Depends(auth.current_member)) -> dict:
    """Relay gates awaiting the caller across ALL active relays: a gate that is on the baton,
    still open, and theirs (their discipline's lead — or the manager, for an orphan gate)."""
    await team.ensure_loaded()
    members = team.all_members()
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
    return {"username": member.username, "count": len(items), "items": items}


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
    return {"plan_id": plan_id, "project_id": project_id, "plan": plan.model_dump(), "relay": RELAYS[plan_id].model_dump()}


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
