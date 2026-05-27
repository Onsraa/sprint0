"""sprint0 gateway (Phase 4) — FastAPI.

Wires the REASON pipeline (`app.reason.run_brief`) and the EXECUTE step
(`app.execute.execute_plan`) behind the REST/WS API the frontend calls.
In-memory stores (demo-grade). Reason needs Atlas reachable on :27017;
execute hits GitLab over 443. Developers are canned for now (Atlas read = TODO).
"""
from __future__ import annotations

import asyncio
import io
import uuid
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google.genai.errors import ClientError

from pydantic import BaseModel

from app import auth, handoff, relay, staffing, team
from app.canned import CANNED_DEVELOPERS
from app.contracts import (
    ApproveRequest, ArchitectureOptions, ClarifiedSpec, ClarifyResolution, Constraints,
    DeveloperProfile, DispatchRequest, FeatureRequest, PlanJSON, PlanRequest, ProjectRecord,
    QAReport, RatifyRequest, RelayState,
)
from app.execute import execute_plan, extend_project
from app.rag import all_project_records, get_project_record, record_merge, save_project_record, update_project_record
from app.reason import (
    clarify_brief, close_project, delta_brief, onboard_developer, propose_architectures, qa_review, run_brief,
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
    return await propose_architectures(BRIEFS[brief_id], constraints or Constraints())


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
        try:
            await save_project_record(record.model_dump())
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


@app.post("/api/merge")
async def merge(req: MergeRequest) -> dict:
    """Idea 2: passport-increment-on-merge (+ auto-promotion). If it resolves a rejected issue,
    clear it from the re-QA queue — closing the reject→fix→re-QA loop."""
    if req.project_id is not None and req.issue_iid is not None:
        REQA.get(req.project_id, set()).discard(req.issue_iid)
    return await record_merge(req.gitlab_username, req.task_type, req.score)


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
