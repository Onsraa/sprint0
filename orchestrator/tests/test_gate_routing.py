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


def test_queue_routes_to_the_gate_owner_not_the_discipline(stretched_relay, monkeypatch):
    # gates are READY (choices cached) — the strict pipeline (P2) would otherwise keep them out of queues
    monkeypatch.setattr(appmain, "SOLUTIONS", {("plan_x", "backend"): object(), ("plan_x", "devops"): object()})
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
    monkeypatch.setattr(appmain, "SOLUTIONS", {("plan_y", "uiux"): object()})  # ready (P2)
    lead = _member("uma", "uiux")
    boss = _member("teddy", None, role="manager")
    assert any(i["discipline"] == "uiux" for i in appmain._my_gates(lead, [lead]))   # discipline fallback
    assert any(i["discipline"] == "uiux" for i in appmain._my_gates(boss, [boss]))   # orphan → Tech Lead


async def _none(*a, **k):
    return None


def _stub_handoff_io(monkeypatch):
    """Routing test, not a store test — stub the task/notify/persist edges (the MCP singleton can't
    cross per-asyncio.run event loops)."""
    for fn in ("get_task", "notify", "notify_watchers", "_persist_relay"):
        monkeypatch.setattr(appmain, fn, _none)


def test_handoff_allows_the_gate_owner(stretched_relay, monkeypatch):
    # the live 403: the OWNER (out-of-discipline, availability-stretched) must be able to hand the gate off
    _stub_handoff_io(monkeypatch)
    tony = _member("tony", "devops")
    state = asyncio.run(appmain.handoff_gate("plan_x", "backend", assignee="pascal", member=tony))
    assert next(g for g in state.gates if g.discipline == "backend").delegate == "pascal"


def test_handoff_denies_a_non_ratifier(stretched_relay, monkeypatch):
    _stub_handoff_io(monkeypatch)
    sam = _member("sam", "frontend")
    with pytest.raises(Exception) as e:
        asyncio.run(appmain.handoff_gate("plan_x", "backend", assignee="sam", member=sam))
    assert getattr(e.value, "status_code", None) == 403


def test_gate_ready_strict_pipeline(monkeypatch, stretched_relay):
    # P2: a pending gate is ready only once its choices are cached; no-slice gates (qa) are always ready.
    monkeypatch.setattr(appmain, "SOLUTIONS", {})
    backend = next(g for g in stretched_relay.gates if g.discipline == "backend")
    qa = next(g for g in stretched_relay.gates if g.discipline == "qa")
    assert appmain._gate_ready("plan_x", backend) is False     # pending + uncached + has a slice → preparing
    assert appmain._gate_ready("plan_x", qa) is True           # the acceptance gate has no slice → always ready
    appmain.SOLUTIONS[("plan_x", "backend")] = object()
    assert appmain._gate_ready("plan_x", backend) is True      # choices cached → open
    backend.status = "ratified"
    assert appmain._gate_ready("plan_x", backend) is True      # done gates are always ready


def test_pregenerate_fires_for_uncached_pending_gates(monkeypatch, stretched_relay):
    # P2: reserve/ratify kick a background generation for every pending gate without cached choices.
    monkeypatch.setattr(appmain, "SOLUTIONS", {})
    generated: list[str] = []

    async def _fake_gen(plan_id, plan, disc):
        generated.append(disc)
        appmain.SOLUTIONS[(plan_id, disc)] = object()
    monkeypatch.setattr(appmain, "_generate_gate_solutions", _fake_gen)

    async def _drive():
        appmain._pregenerate_open_gates("plan_x")   # create_task needs a running loop
        await asyncio.sleep(0)                       # let the fire-and-forget tasks run
        await asyncio.sleep(0)
    asyncio.run(_drive())
    assert "backend" in generated and "devops" in generated   # the pending first wave
    assert "qa" not in generated                               # no slice → nothing to generate


def test_gate_solutions_prompt_carries_the_feature_context(monkeypatch):
    # P7: a gate must generate with the WHOLE feature context — product, stack, upstream ratified
    # choices, inbound signed contracts — never just its own slice.
    from types import SimpleNamespace
    from app import demo, rag, reason

    monkeypatch.setattr(demo, "DEMO_MODE", False)          # exercise the real prompt path (LLM stubbed)
    captured: dict = {}

    async def _capture(prompt):
        captured["prompt"] = prompt
        return SolutionSetStub()

    class SolutionSetStub:
        discipline = ""
        solutions = []

    class _M:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def hybrid_search(self, *a, **k): return []
    async def _no_code(*a, **k): return []
    async def _no_decisions(*a, **k): return []
    monkeypatch.setattr(reason, "MongoMCP", _M)
    monkeypatch.setattr(reason, "embed_query", lambda q: [])
    monkeypatch.setattr(reason, "code_search_expanded", _no_code)
    monkeypatch.setattr(rag, "all_decisions", _no_decisions)
    monkeypatch.setattr(reason, "generate_solutions", _capture)

    plan = _plan(_iss("f1", "frontend"))
    plan.client_summary = "A freight tenant portal with live maps"
    upstream = {"backend": SimpleNamespace(title="FastAPI CRUD with PostGIS", summary="REST endpoints over PostGIS")}
    inbound = [{"subject": "backend→frontend · /shipments", "interface": {"method": "GET", "path": "/shipments"}}]
    asyncio.run(reason.propose_solutions(plan, "frontend", upstream_choices=upstream, inbound_contracts=inbound))

    p = captured["prompt"]
    assert "freight tenant portal" in p                     # product summary
    assert "CHOSEN STACK" in p and "Py" in p                # the locked stack
    assert "FastAPI CRUD with PostGIS" in p                 # the upstream gate's ratified choice
    assert "GET /shipments" in p                            # the signed inbound contract shape


def test_spawn_keeps_a_strong_ref_until_done():
    # asyncio.create_task only weak-refs a task (GC can kill it mid-flight) — _spawn must hold it until done
    async def _drive():
        done = asyncio.Event()
        t = appmain._spawn(done.wait())
        assert t in appmain._BG_TASKS          # strong ref held while running
        done.set()
        await t
        await asyncio.sleep(0)                 # let the done_callback fire
        assert t not in appmain._BG_TASKS      # discarded once finished
    asyncio.run(_drive())


def test_gate_generation_never_calls_gitlab_in_demo(monkeypatch, stretched_relay):
    # SECURITY: a demo delta plan (DELTA_TARGET set) must never fire a real GitLab call
    from app.contracts import SolutionCard, SolutionSet

    calls = {"tree": 0}
    monkeypatch.setattr(appmain.gitlab, "list_repo_tree", lambda pid: calls.__setitem__("tree", calls["tree"] + 1) or set())
    monkeypatch.setattr(appmain, "DELTA_TARGET", {"plan_x": 999})

    async def _sols(*a, **k):
        return SolutionSet(solutions=[SolutionCard(source="ai", title="T")])
    async def _none_list(*a, **k):
        return []
    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(appmain, "propose_solutions", _sols)
    monkeypatch.setattr(appmain, "graph_edges", _none_list)
    monkeypatch.setattr(appmain, "all_decisions", _none_list)
    monkeypatch.setattr(appmain, "agreements_for_plan", _none_list)
    monkeypatch.setattr(appmain, "_persist", _noop)

    plan = appmain.PLANS["plan_x"]
    monkeypatch.setattr(appmain.demo, "is_demo", lambda: True)
    asyncio.run(appmain._generate_gate_solutions("plan_x", plan, "backend"))
    assert calls["tree"] == 0                  # demo → the real call never fires
    monkeypatch.setattr(appmain.demo, "is_demo", lambda: False)
    asyncio.run(appmain._generate_gate_solutions("plan_x", plan, "backend"))
    assert calls["tree"] == 1                  # live delta → the tree IS fetched


def test_contract_visibility_follows_the_ratifier(stretched_relay, monkeypatch):
    async def _no_grants(_u):
        return []
    monkeypatch.setattr(appmain, "access_grants_for_requester", _no_grants)  # no Watch grants in this test
    tony = _member("tony", "devops")
    jean = _member("jean", "backend")
    boss = _member("teddy", None, role="manager")
    async def _noop():
        return None
    monkeypatch.setattr(appmain.team, "ensure_loaded", _noop)
    monkeypatch.setattr(appmain.team, "all_members", lambda: [tony, jean, boss])
    can = lambda m: asyncio.run(appmain._can_read_contract(m, "backend", "plan_x"))  # noqa: E731
    assert can(tony) is True    # the OWNER reads his gate's Contract (the live bug: he got "private")
    assert can(boss) is False   # the manager does NOT read someone else's gate — gates are one user's, no role see-all
    assert can(jean) is False   # not the ratifier (and no granted Watch) → private
