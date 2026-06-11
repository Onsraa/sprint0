"""Round 7: the Create awaits the first wave (no 'pending' gate after the wizard), creation pings
(project_created → relay_created), the member-readable trace, and the per-relay Tester queue."""
import asyncio

import pytest

from app import auth, main, relay, trace
from app.contracts import (ContextScope, DeveloperProfile, DispatchRequest, Epic, Issue, PlanJSON,
                           SolutionCard, SolutionSet, TechStack)


def _dev(username, discipline, role="developer"):
    return DeveloperProfile(name=username, gitlab_username=username, skills_text="",
                            username=username, role=role, discipline=discipline)


ROSTER = [_dev("sprint0-fe", "frontend"), _dev("sprint0-se", "backend"),
          _dev("gabinvr", "qa"), _dev("Onsraa", None, role="manager")]


def _by(username):
    return next(m for m in ROSTER if m.username == username)


def _issue(i, t, assignee=None, deps=None):
    return Issue(id=i, title=i.upper(), description="d", type=t, estimate_days=2, risk="low",
                 required_skill="", context_scope=ContextScope(files=[f"{i}.py"]),
                 assignee=assignee, depends_on=deps or [])


def _plan(issues, name="HomeHero"):
    return PlanJSON(project_name=name, client_summary="", grounded_on=[], timeline_weeks=4,
                    tech_stack=TechStack(frontend="R", backend="P", db="PG", infra="-"),
                    epics=[Epic(id="e1", title="E", issues=issues)])


@pytest.fixture(autouse=True)
def _patch_team(monkeypatch):
    async def _noop():
        return None
    monkeypatch.setattr(main.team, "all_members", lambda: ROSTER)
    monkeypatch.setattr(main.team, "ensure_loaded", _noop)


def _sset():
    return SolutionSet(solutions=[SolutionCard(id="s1", source="ai", title="t", summary="s", rationale="r",
                                               pros=[], cons=[], confidence=50, grounded_on=[], delta_note="",
                                               impacted_files=[], conflict=False, conflict_reason="")])


def test_reserve_awaits_first_wave_and_pings_creation(monkeypatch):
    pid = "plan_r7a"
    plan = _plan([_issue("b1", "backend", assignee="sprint0-se"),
                  _issue("f1", "frontend", assignee="sprint0-fe", deps=["b1"])])
    main.PLANS[pid], main.RELAYS[pid] = plan, relay.build_relay(plan)
    main.RESERVED.pop(pid, None)
    generated: list[str] = []
    pings: list[tuple[str, str, str]] = []

    async def _gen(plan_id, plan_, disc):
        generated.append(disc)
        main.SOLUTIONS[(plan_id, disc)] = _sset()
        return _sset()

    async def _notify(user, kind, title="", *a, **k):
        pings.append((user, kind, title))

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(main, "reserve_project", lambda plan_, name: {"project_id": 42, "web_url": "http://x"})
    monkeypatch.setattr(main, "_generate_gate_solutions", _gen)
    monkeypatch.setattr(main, "notify", _notify)
    monkeypatch.setattr(main, "_persist", _noop)
    monkeypatch.setattr(main, "_persist_relay", _noop)
    monkeypatch.setattr(main, "save_project_record", _noop)
    monkeypatch.setattr(main, "_spawn", lambda coro: coro.close())  # contracts stay background — not under test

    res = asyncio.run(main._reserve_locked(pid, DispatchRequest()))
    assert res["relay_open"] is True
    # the Create AWAITED the first wave — by return time the open gate's choices are generated + cached
    assert generated == ["backend"]
    assert (pid, "backend") in main.SOLUTIONS
    # the create-phase trace shows the drafting and ends on "Relay open"
    labels = [s["label"] for s in trace.get("r7a:create")]
    assert "Drafting backend options" in labels
    assert labels[-1] == "Relay open"
    # creation pings: per recipient, project_created FIRST then relay_created — to every participant
    for u in ("sprint0-se", "sprint0-fe", "Onsraa"):
        kinds = [k for (pu, k, _t) in pings if pu == u]
        assert kinds == ["project_created", "relay_created"]
    assert any("2 gates" in t or "gates" in t for (_u, k, t) in pings if k == "relay_created")
    # cleanup the module stores this test seeded
    for store in (main.PLANS, main.RELAYS, main.RESERVED):
        store.pop(pid, None)
    main.SOLUTIONS.pop((pid, "backend"), None)
    main.PROJECTS.pop(42, None)


def test_trace_endpoint_is_member_readable():
    route = next(r for r in main.app.routes if getattr(r, "path", "") == "/api/briefs/{brief_id}/trace")
    deps = [d.call for d in route.dependant.dependencies]
    assert auth.current_member in deps        # leads watch contract drafting; the Tester watches the dispatch
    assert auth.current_manager not in deps   # manager-only silently 403'd those LiveTraces


def test_qa_queue_lists_each_active_relay_by_id():
    # two ACTIVE relays on ONE project (original + delta) → two rows, keyed by plan_id, never merged by name
    plan_a = _plan([_issue("b1", "backend")], name="SameName")
    plan_b = _plan([_issue("b2", "backend")], name="SameName")
    main.PLANS["r7q1"], main.RELAYS["r7q1"] = plan_a, relay.build_relay(plan_a)
    main.PLANS["r7q2"], main.RELAYS["r7q2"] = plan_b, relay.build_relay(plan_b)
    main.RESERVED["r7q1"] = {"project_id": 990}
    main.DELTA_TARGET["r7q2"] = 990
    main.PROJECTS[990] = plan_a
    try:
        q = asyncio.run(main.qa_queue(_by("gabinvr")))
        rows = [e for e in q.queue if e.project_id == 990]
        assert {e.plan_id for e in rows} == {"r7q1", "r7q2"}  # one row PER RELAY
        assert len(rows) == 2                                  # the covered project adds no third 'pending' row
    finally:
        for store in (main.PLANS, main.RELAYS):
            store.pop("r7q1", None), store.pop("r7q2", None)
        main.RESERVED.pop("r7q1", None)
        main.DELTA_TARGET.pop("r7q2", None)
        main.PROJECTS.pop(990, None)
