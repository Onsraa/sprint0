"""baton gateway (Phase 4) — FastAPI.

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

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

from app import handoff
from app.canned import CANNED_DEVELOPERS
from app.contracts import ApproveRequest, ArchitectureOptions, Constraints, DeveloperProfile, PlanJSON, PlanRequest
from app.execute import execute_plan
from app.rag import record_merge
from app.reason import onboard_developer, propose_architectures, run_brief

app = FastAPI(title="baton", version="0.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Demo-grade in-memory stores.
BRIEFS: dict[str, str] = {}
PLANS: dict[str, PlanJSON] = {}
RESULTS: dict[str, dict] = {}


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "phase": 4, "service": "baton"}


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
    return {"plan_id": plan_id, "plan": plan.model_dump()}


@app.get("/api/plans/{plan_id}", response_model=PlanJSON)
async def get_plan(plan_id: str) -> PlanJSON:
    if plan_id not in PLANS:
        raise HTTPException(404, "plan not found")
    return PLANS[plan_id]


@app.post("/api/plans/{plan_id}/approve")
async def approve_plan(plan_id: str, req: ApproveRequest) -> dict:
    plan = req.edits or PLANS.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    # EXECUTE: scaffold real GitLab infra (sync httpx → threadpool).
    result = await run_in_threadpool(execute_plan, plan)
    RESULTS[plan_id] = result
    return {"plan_id": plan_id, "mode": req.mode, **result}


class RejectRequest(BaseModel):
    comment: str
    to_runner: Optional[str] = None


class MergeRequest(BaseModel):
    gitlab_username: str
    task_type: str
    score: float = 0.85


@app.post("/api/projects/{project_id}/issues/{iid}/reject")
async def reject_issue(project_id: int, iid: int, req: RejectRequest) -> dict:
    """Idea 2: QA reject → reopen + route back to the responsible-layer runner."""
    return await run_in_threadpool(handoff.reroute, project_id, iid, req.comment, req.to_runner)


@app.post("/api/merge")
async def merge(req: MergeRequest) -> dict:
    """Idea 2: passport-increment-on-merge (MongoDB write via the MCP)."""
    return await record_merge(req.gitlab_username, req.task_type, req.score)


@app.get("/api/developers", response_model=list[DeveloperProfile])
async def list_developers() -> list[DeveloperProfile]:
    return CANNED_DEVELOPERS


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
    return DeveloperProfile(**await onboard_developer(cv))


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
