"""Architecture setup gate — a gate-0 that gates everything, injected WITHOUT touching the topology."""
from app import relay
from app.contracts import ContextScope, Epic, Issue, PlanJSON, TechStack


def _iss(i, lane):
    return Issue(id=i, title=i, description="d", type="backend", estimate_days=1, risk="low",
                 required_skill="", context_scope=ContextScope(files=[f"{i}.py"]), lane=lane)


def _plan():
    return PlanJSON(project_name="P", client_summary="", grounded_on=[], timeline_weeks=2,
                    tech_stack=TechStack(frontend="R", backend="Py", db="PG", infra="-"),
                    epics=[Epic(id="e", title="E", issues=[_iss("b", "backend"), _iss("o", "devops"), _iss("f", "frontend")])])


def test_no_owner_relay_is_unchanged():
    # the critical regression guard: without a setup_owner the relay is EXACTLY as before (topology intact)
    base = relay.build_relay(_plan())
    assert "setup" not in {g.discipline for g in base.gates}
    fe = next(g for g in base.gates if g.discipline == "frontend")
    assert set(fe.depends_on) == {"backend", "devops"}
    qa = next(g for g in base.gates if g.discipline == "qa")
    assert qa.depends_on == ["frontend"]


def test_setup_gate_gates_every_discipline():
    st = relay.build_relay(_plan(), setup_owner="sprint0-sse")
    assert st.gates[0].discipline == "setup" and st.gates[0].delegate == "sprint0-sse"
    assert st.baton == ["setup"]                                              # ONLY setup holds the baton
    assert all(g.status == "locked" for g in st.gates if g.discipline != "setup")
    fe = next(g for g in st.gates if g.discipline == "frontend")
    assert "setup" not in fe.depends_on                                       # NO setup edge — topology untouched


def test_ratifying_setup_unlocks_the_build_wave():
    plan = _plan()
    st = relay.build_relay(plan, setup_owner="sprint0-sse")
    relay.ratify(st, plan, "setup", None, True, "")
    assert next(g for g in st.gates if g.discipline == "setup").status == "ratified"
    assert {g.discipline for g in st.gates if g.discipline in ("backend", "devops")} <= set(st.baton)
    assert not relay.all_ratified(st)                                         # discipline gates still open
