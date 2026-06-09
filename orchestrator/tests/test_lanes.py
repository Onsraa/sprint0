"""Lane topology — every present lane gets a gate (the silent-drop regression); QA stays terminal;
the 5 seed lanes still reproduce {uiux ∥ backend ∥ devops} → frontend → qa exactly."""
from app import relay
from app.contracts import ContextScope, Epic, Issue, PlanJSON, TechStack


def _iss(i, typ="backend", lane=None):
    return Issue(id=i, title=i, description="d", type=typ, estimate_days=1, risk="low",
                 required_skill="", context_scope=ContextScope(files=[f"{i}.py"]), lane=lane)


def _plan(*issues):
    return PlanJSON(project_name="P", client_summary="", grounded_on=[], timeline_weeks=2,
                    tech_stack=TechStack(frontend="R", backend="Py", db="PG", infra="-"),
                    epics=[Epic(id="e", title="E", issues=list(issues))])


def _lanes(state):
    return {g.discipline for g in state.gates}


def test_novel_lane_gets_a_gate():
    # an AI-discovered lane ("security") must NOT be silently dropped (the relay.py:70 bug)
    state = relay.build_relay(_plan(_iss("a", "backend"), _iss("s", "backend", lane="security")))
    assert "security" in _lanes(state)
    sec = next(g for g in state.gates if g.discipline == "security")
    assert sec.depends_on == []  # unknown lanes fold into the build wave, parallel with backend


def test_acceptance_gate_always_present_and_terminal():
    state = relay.build_relay(_plan(_iss("a", "backend")))  # no qa issues
    assert "qa" in _lanes(state)
    qa = next(g for g in state.gates if g.discipline == "qa")
    assert qa.depends_on == ["backend"] and relay.is_acceptance_gate(qa)


def test_design_lane_folds_to_the_uiux_gate():
    # the planner sometimes emits the IssueType "design" as the lane; it must become the canonical uiux gate
    # (matches the roster's "uiux" discipline + the DISC label) — a novel lane like "security" stays untouched.
    state = relay.build_relay(_plan(_iss("a", "backend"), _iss("d", "design", lane="design")))
    assert "uiux" in _lanes(state) and "design" not in _lanes(state)


def test_gate_owner_is_the_lane_assignee():
    a = _iss("a", "backend"); a.assignee = "jean"
    state = relay.build_relay(_plan(a))
    backend = next(g for g in state.gates if g.discipline == "backend")
    assert backend.owner == "jean"  # the assignee (best profile) owns/ratifies the gate


def test_unstaffed_gate_has_no_owner():
    state = relay.build_relay(_plan(_iss("d", "design", lane="design")))  # no assignee (uiux is the orphan gap)
    uiux = next(g for g in state.gates if g.discipline == "uiux")
    assert uiux.owner is None  # gap → None → the Tech Lead ratifies it


def test_seed_topology_unchanged():
    state = relay.build_relay(_plan(
        _iss("u", "design"), _iss("b", "backend"), _iss("o", "devops"), _iss("f", "frontend")))
    fe = next(g for g in state.gates if g.discipline == "frontend")
    qa = next(g for g in state.gates if g.discipline == "qa")
    assert set(fe.depends_on) == {"uiux", "backend", "devops"}  # frontend converges the build wave
    assert qa.depends_on == ["frontend"]                        # qa after frontend
    assert not relay.is_acceptance_gate(fe)
