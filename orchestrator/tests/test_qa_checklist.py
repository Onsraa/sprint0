"""Tester redesign — deterministic acceptance checklist + HUMAN verdicts + AI risk hints.
States join the Task store (awaiting / ready / bounced), the tester records pass (fail comes from
the reject flow), verdicts persist + rehydrate, and the AI hints endpoint emits notes only.
Endpoints driven directly with asyncio.run and an explicit `member` (bypassing auth Depends);
`team` is monkeypatched so no Atlas/Vertex/GitLab is touched (conftest forces DEMO_MODE)."""
import asyncio

import pytest
from fastapi import HTTPException

from app import main, rag
from app.contracts import ContextScope, DeveloperProfile, Epic, Issue, PlanJSON, QAReport, TechStack
from app.main import MergeRequest, RejectRequest, VerdictRequest


def _dev(username, discipline, role="developer"):
    return DeveloperProfile(name=username, gitlab_username=username, skills_text="",
                            username=username, role=role, discipline=discipline)


ROSTER = [
    _dev("sprint0-fe", "frontend"),
    _dev("sprint0-se", "backend"),
    _dev("gabinvr", "qa"),
    _dev("Onsraa", None, role="manager"),
]


def _by(username):
    return next(m for m in ROSTER if m.username == username)


def _issue(i, t, assignee=None, acceptance=""):
    return Issue(id=i, title=i.upper(), description="d", type=t, estimate_days=2, risk="low",
                 required_skill="", context_scope=ContextScope(files=[f"{i}.py"]),
                 assignee=assignee, acceptance=acceptance)


def _plan(issues):
    return PlanJSON(project_name="HomeHero", client_summary="", grounded_on=[], timeline_weeks=4,
                    tech_stack=TechStack(frontend="R", backend="P", db="PG", infra="-"),
                    epics=[Epic(id="e1", title="E", issues=issues)])


PID = 4201


@pytest.fixture(autouse=True)
def _patch_team(monkeypatch):
    async def _noop():
        return None
    monkeypatch.setattr(main.team, "all_members", lambda: ROSTER)
    monkeypatch.setattr(main.team, "ensure_loaded", _noop)
    main.PROJECTS.pop(PID, None)
    main.REQA.pop(PID, None)
    main.VERDICTS.pop(PID, None)
    yield
    main.PROJECTS.pop(PID, None)
    main.REQA.pop(PID, None)
    main.VERDICTS.pop(PID, None)


def _seed(statuses: dict[str, str], iids: dict[str, int] | None = None, reqa: set[int] | None = None):
    """PROJECTS plan + demo Task store rows with the given statuses (+ optional GitLab iids + REQA)."""
    issues = [_issue("b1", "backend", assignee="sprint0-se", acceptance="API returns 200 with valid token"),
              _issue("f1", "frontend", assignee="sprint0-fe")]
    plan = _plan(issues)
    main.PROJECTS[PID] = plan
    iids = iids or {}
    rows = [{"id": i.id, "project_id": PID, "title": i.title, "description": "d", "discipline": i.discipline,
             "assignee": i.assignee, "assigned_by": "ai", "estimate_days": 1, "risk": "low",
             "priority": "normal", "status": statuses.get(i.id, "in_progress"),
             "gitlab_issue_iid": iids.get(i.id), "depends_on": [], "pinned": False,
             "context_scope": {"files": [], "note": ""},
             "created_at": "t", "updated_at": "t"} for i in issues]
    asyncio.run(rag.save_tasks(rows))
    if reqa:
        main.REQA[PID] = set(reqa)
    return plan


def _checklist(member="gabinvr"):
    return asyncio.run(main.qa_checklist(PID, _by(member)))


def _pass(issue_id, member="gabinvr"):
    return asyncio.run(main.qa_verdict(PID, VerdictRequest(issue_id=issue_id), member=_by(member)))


def test_checklist_states_join_tasks():
    _seed({"b1": "done", "f1": "in_progress"}, iids={"b1": 51, "f1": 52})
    rows = {i.issue_id: i for i in _checklist().items}
    assert rows["b1"].state == "ready" and rows["b1"].iid == 51
    assert rows["f1"].state == "awaiting"
    assert rows["b1"].criterion == "API returns 200 with valid token"   # authored DoD text
    assert "works end-to-end" in rows["f1"].criterion                    # generic fallback
    assert rows["b1"].verdict is None                                    # no AI verdicts, ever


def test_bounced_outranks_done():
    _seed({"b1": "done"}, iids={"b1": 51}, reqa={51})
    rows = {i.issue_id: i for i in _checklist().items}
    assert rows["b1"].state == "bounced"
    assert _checklist().reopened == [51]


def test_verdict_pass_on_ready_persists():
    _seed({"b1": "done"}, iids={"b1": 51})
    out = _pass("b1")
    assert out["verdict"] == "pass" and out["passed"] == 1 and out["total"] == 2 and not out["all_passed"]
    assert main.VERDICTS[PID]["b1"]["by"] == "gabinvr"
    assert {i.issue_id: i.verdict for i in _checklist().items}["b1"] == "pass"


def test_verdict_pass_on_awaiting_409():
    _seed({"b1": "in_progress"})
    with pytest.raises(HTTPException) as e:
        _pass("b1")
    assert e.value.status_code == 409 and "awaiting" in e.value.detail


def test_verdict_pass_on_bounced_409():
    _seed({"b1": "done"}, iids={"b1": 51}, reqa={51})
    with pytest.raises(HTTPException) as e:
        _pass("b1")
    assert e.value.status_code == 409 and "bounced" in e.value.detail


def test_verdict_auth():
    _seed({"b1": "done"}, iids={"b1": 51})
    with pytest.raises(HTTPException) as e:
        _pass("b1", member="sprint0-se")     # a backend dev is NOT the acceptance owner
    assert e.value.status_code == 403
    assert _pass("b1", member="Onsraa")["verdict"] == "pass"   # the manager can


def test_all_passed_and_queue_completion():
    _seed({"b1": "done", "f1": "done"}, iids={"b1": 51, "f1": 52})
    _pass("b1")
    out = _pass("f1")
    assert out["all_passed"] is True
    q = asyncio.run(main.qa_queue(_by("gabinvr")))
    row = next(e for e in q.queue if e.project_id == PID)
    assert row.qa_status == "passed" and row.passed_count == 2 and row.issue_count == 2


def test_reject_records_fail_verdict(monkeypatch):
    _seed({"b1": "done"}, iids={"b1": 51})
    monkeypatch.setattr(main.handoff, "reroute", lambda *a, **k: {"reopened": 51})
    asyncio.run(main.reject_issue(PID, 51, RejectRequest(comment="bad", to_runner=None), member=_by("gabinvr")))
    assert main.VERDICTS[PID]["b1"]["verdict"] == "fail"
    rows = {i.issue_id: i for i in _checklist().items}
    assert rows["b1"].state == "bounced" and rows["b1"].verdict == "fail"


def test_merge_clears_reqa_back_to_ready(monkeypatch):
    _seed({"b1": "done"}, iids={"b1": 51}, reqa={51})
    main.VERDICTS[PID] = {"b1": {"verdict": "fail", "by": "gabinvr", "at": "t"}}
    async def _credit(*a, **k):   # passport credit is not under test — only the REQA clear
        return {"ok": True}
    monkeypatch.setattr(main, "_credit_merge", _credit)
    asyncio.run(main.merge(MergeRequest(gitlab_username="sprint0-se", task_type="backend:merge",
                                        score=0.9, project_id=PID, issue_iid=51), _by("Onsraa")))
    rows = {i.issue_id: i for i in _checklist().items}
    assert rows["b1"].state == "ready"            # bounce cleared by the merge
    assert rows["b1"].verdict == "fail"           # stale fail stays visible until the tester re-passes
    assert _pass("b1")["verdict"] == "pass"


def test_hints_notes_only(monkeypatch):
    plan = _seed({"b1": "done"})
    async def _fake_review(p):
        return QAReport.model_validate({"items": [
            {"issue_id": "b1", "title": "B1", "note": "check token rotation by hand"},
            {"issue_id": "f1", "title": "F1", "note": ""}]})
    monkeypatch.setattr(main, "qa_review", _fake_review)
    out = asyncio.run(main.qa_hints(PID, _by("gabinvr")))
    assert out["hints"] == {"b1": "check token rotation by hand"}   # empty notes dropped, no verdict keys


def test_verdicts_rehydrate():
    asyncio.run(rag.save_state("verdicts", str(PID), {"v": {"b1": {"verdict": "pass", "by": "gabinvr", "at": "t"}}}))
    main.VERDICTS.clear()
    asyncio.run(main._rehydrate_session())
    assert main.VERDICTS[PID]["b1"]["verdict"] == "pass"
