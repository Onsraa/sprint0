"""Endpoint layer of the integration gate: authority (consumer / producer / qa-owner / orphan
manager), producer routing + ambiguity, and the blocked-gate ratify guard. The endpoints are async;
we drive them directly with asyncio.run and an explicit `member` (bypassing the auth Depends), and
monkeypatch `team` so no Atlas/Vertex/GitLab is touched."""
import asyncio

import pytest
from fastapi import HTTPException

from app import main, relay
from app.contracts import ContextScope, DeveloperProfile, Epic, Issue, PlanJSON, RatifyRequest, TechStack
from app.main import IntegrationFlagRequest


def _dev(username, discipline, role="developer"):
    return DeveloperProfile(name=username, gitlab_username=username, skills_text="",
                            username=username, role=role, discipline=discipline)


ROSTER = [
    _dev("sprint0-fe", "frontend"),
    _dev("sprint0-se", "backend"),
    _dev("gabinvr", "qa"),
    _dev("flori", "devops"),
    _dev("Onsraa", None, role="manager"),
]


def _by(username):
    return next(m for m in ROSTER if m.username == username)


def _issue(i, t, assignee=None, deps=None, contract=None):
    return Issue(id=i, title=i.upper(), description="d", type=t, estimate_days=2, risk="low",
                 required_skill="", context_scope=ContextScope(files=[f"{i}.py"]),
                 assignee=assignee, depends_on=deps or [], api_contract=contract)


def _plan(issues):
    return PlanJSON(project_name="HomeHero", client_summary="", grounded_on=[], timeline_weeks=4,
                    tech_stack=TechStack(frontend="R", backend="P", db="PG", infra="-"),
                    epics=[Epic(id="e1", title="E", issues=issues)])


def _be_fe():
    return [_issue("b1", "backend", assignee="sprint0-se", contract='{"ok": 1}'),
            _issue("f1", "frontend", assignee="sprint0-fe", deps=["b1"])]


def _status(state, disc):
    return next(g.status for g in state.gates if g.discipline == disc)


@pytest.fixture(autouse=True)
def _patch_team(monkeypatch):
    async def _noop():
        return None
    monkeypatch.setattr(main.team, "all_members", lambda: ROSTER)
    monkeypatch.setattr(main.team, "ensure_loaded", _noop)


def _seed(pid, issues):
    """Seed the in-memory stores and ratify backend+frontend so qa is the active gate."""
    plan = _plan(issues)
    state = relay.build_relay(plan)
    main.PLANS[pid], main.RELAYS[pid] = plan, state
    relay.ratify(state, plan, "backend", None, True, "")
    relay.ratify(state, plan, "frontend", None, True, "")
    return plan, state


def _flag(pid, member, **body):
    return asyncio.run(main.flag_integration(pid, IntegrationFlagRequest(**body), member=member))


def test_consumer_flags_failing_blocks_qa():
    _, state = _seed("p1", _be_fe())
    res = _flag("p1", _by("sprint0-fe"), state="failing", reporter_issue_id="f1")   # consumer self-report
    assert "gates" in res                                                           # RelayState returned
    assert _status(state, "qa") == "blocked"
    assert [s.target_issue_id for s in relay.open_integration_failures(state)] == ["b1"]
    assert _status(state, "backend") == "ratified" and _status(state, "frontend") == "ratified"  # no cascade


def test_unauthorized_dev_gets_403():
    _seed("p2", _be_fe())
    with pytest.raises(HTTPException) as ei:                                         # devops dev: not assignee/qa/mgr
        _flag("p2", _by("flori"), state="failing", reporter_issue_id="f1")
    assert ei.value.status_code == 403


def test_qa_lead_can_flag():
    _, state = _seed("p3", _be_fe())
    res = _flag("p3", _by("gabinvr"), state="failing", reporter_issue_id="f1")       # qa-gate owner
    assert "gates" in res and _status(state, "qa") == "blocked"


def test_manager_inherits_orphan_qa(monkeypatch):
    roster_noqa = [m for m in ROSTER if m.discipline != "qa"]                        # no qa dev → orphan
    monkeypatch.setattr(main.team, "all_members", lambda: roster_noqa)
    _, state = _seed("p4", _be_fe())
    res = _flag("p4", _by("Onsraa"), state="failing", reporter_issue_id="f1")        # manager owns orphan qa
    assert "gates" in res and _status(state, "qa") == "blocked"
    with pytest.raises(HTTPException) as ei:                                         # plain dev still blocked
        _flag("p4", _by("flori"), state="failing", reporter_issue_id="f1")
    assert ei.value.status_code == 403


def test_blocked_qa_cannot_be_ratified():
    _, state = _seed("p5", _be_fe())
    _flag("p5", _by("sprint0-fe"), state="failing", reporter_issue_id="f1")
    assert _status(state, "qa") == "blocked"
    with pytest.raises(HTTPException) as ei:
        asyncio.run(main.ratify_gate("p5", "qa", RatifyRequest(approve=True), member=_by("gabinvr")))
    assert ei.value.status_code == 409                                              # must resolve the failure first


def test_ambiguous_producers_returns_candidates():
    issues = [_issue("b1", "backend", assignee="sprint0-se", contract='{"a": 1}'),
              _issue("d1", "db", assignee="sprint0-se"),
              _issue("f1", "frontend", assignee="sprint0-fe", deps=["b1", "d1"])]
    _seed("p6", issues)
    res = _flag("p6", _by("sprint0-fe"), state="failing", reporter_issue_id="f1")
    assert res.get("need_target") is True
    assert [c["id"] for c in res["candidates"]] == ["b1", "d1"]                     # contract-bearing first
    assert relay.open_integration_failures(main.RELAYS["p6"]) == []                 # no signal recorded yet


def test_producer_marks_ok_unblocks_qa():
    _, state = _seed("p7", _be_fe())
    _flag("p7", _by("sprint0-fe"), state="failing", reporter_issue_id="f1")
    assert _status(state, "qa") == "blocked"
    res = _flag("p7", _by("sprint0-se"), state="ok", target_issue_id="b1")          # producer (target assignee) clears
    assert "gates" in res and _status(state, "qa") == "pending"
