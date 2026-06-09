"""Gate routing — every surface routes a gate to its RATIFIER (delegate ?? owner ?? discipline lead).

The live bug: availability-aware assignment gave the backend slice to the devops lead (the backend dev was
at load 100), so the backend gate's owner was the devops lead — but the queue and the Contract-visibility
check still routed by DISCIPLINE: the busy backend dev was queued a gate he couldn't ratify, and the actual
owner was denied the solutions ("private" → an empty gate panel)."""
import asyncio

import pytest

from app import main as appmain
from app import relay
from app.contracts import ContextScope, DeveloperProfile, Epic, Issue, PlanJSON, TechStack


def _iss(i, typ="backend", assignee=None):
    return Issue(id=i, title=i, description="d", type=typ, estimate_days=1, risk="low",
                 required_skill="", context_scope=ContextScope(files=[f"{i}.py"]), assignee=assignee)


def _plan(*issues):
    return PlanJSON(project_name="P", client_summary="", grounded_on=[], timeline_weeks=2,
                    tech_stack=TechStack(frontend="R", backend="Py", db="PG", infra="-"),
                    epics=[Epic(id="e", title="E", issues=list(issues))])


def _member(username, discipline=None, role="developer"):
    return DeveloperProfile(name=username, gitlab_username=username, skills_text="", username=username,
                            role=role, discipline=discipline)


@pytest.fixture()
def stretched_relay(monkeypatch):
    """A relay whose backend gate is OWNED by the devops lead (the backend dev was unavailable)."""
    plan = _plan(_iss("b1", "backend", assignee="tony"), _iss("d1", "devops", assignee="tony"))
    state = relay.build_relay(plan)
    monkeypatch.setattr(appmain, "PLANS", {"plan_x": plan})
    monkeypatch.setattr(appmain, "RELAYS", {"plan_x": state})
    monkeypatch.setattr(appmain, "DELTA_TARGET", {})
    return state


def test_queue_routes_to_the_gate_owner_not_the_discipline(stretched_relay):
    jean = _member("jean", "backend")   # the discipline lead — but NOT the owner (he was busy)
    tony = _member("tony", "devops")    # the assigned owner (stretched)
    members = [jean, tony]
    tony_q = {i["discipline"] for i in appmain._my_gates(tony, members)}
    jean_q = {i["discipline"] for i in appmain._my_gates(jean, members)}
    assert "backend" in tony_q          # the owner queues his stretched gate
    assert "backend" not in jean_q      # the busy discipline lead is NOT queued a gate he can't ratify


def test_queue_unowned_gate_falls_back_to_discipline_then_tech_lead(monkeypatch):
    plan = _plan(_iss("u1", "design"))  # no assignee → the uiux gate has no owner
    state = relay.build_relay(plan)
    monkeypatch.setattr(appmain, "PLANS", {"plan_y": plan})
    monkeypatch.setattr(appmain, "RELAYS", {"plan_y": state})
    monkeypatch.setattr(appmain, "DELTA_TARGET", {})
    lead = _member("uma", "uiux")
    boss = _member("teddy", None, role="manager")
    assert any(i["discipline"] == "uiux" for i in appmain._my_gates(lead, [lead]))   # discipline fallback
    assert any(i["discipline"] == "uiux" for i in appmain._my_gates(boss, [boss]))   # orphan → Tech Lead


def test_contract_visibility_follows_the_ratifier(stretched_relay):
    tony = _member("tony", "devops")
    jean = _member("jean", "backend")
    boss = _member("teddy", None, role="manager")
    can = lambda m: asyncio.run(appmain._can_read_contract(m, "backend", "plan_x"))  # noqa: E731
    assert can(tony) is True    # the OWNER reads his gate's Contract (the live bug: he got "private")
    assert can(boss) is True    # the Tech Lead always reads
    assert can(jean) is False   # not the ratifier (and no granted Watch) → private
