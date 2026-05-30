"""Integration gate (B+C+D): a declared api-failing signal holds the qa gate `blocked` and
routes to the producer, with NO DAG cascade. Pure relay-engine tests — no I/O."""
from app import relay
from app.contracts import ContextScope, Epic, IntegrationSignal, Issue, PlanJSON, TechStack


def _issue(i, t, assignee=None, deps=None, contract=None, risk="low"):
    return Issue(id=i, title=i.upper(), description="d", type=t, estimate_days=2, risk=risk,
                 required_skill="", context_scope=ContextScope(files=[f"{i}.py"]),
                 assignee=assignee, depends_on=deps or [], api_contract=contract)


def _plan(issues):
    return PlanJSON(project_name="HomeHero", client_summary="", grounded_on=[], timeline_weeks=4,
                    tech_stack=TechStack(frontend="React", backend="Py", db="PG", infra="-"),
                    epics=[Epic(id="e1", title="E", issues=issues)])


def _be_fe():
    """Backend producer b1 (has api_contract) → frontend consumer f1 (depends_on b1)."""
    return _plan([
        _issue("b1", "backend", assignee="sprint0-se", contract='{"ok": true}'),
        _issue("f1", "frontend", assignee="sprint0-fe", deps=["b1"]),
    ])


def _sig(target, state, by="sprint0-fe", reporter="f1"):
    return IntegrationSignal(target_issue_id=target, state=state, by=by,
                             reporter_issue_id=reporter, created_at="2026-05-29T00:00:00Z")


def _status(state, disc):
    return next(g.status for g in state.gates if g.discipline == disc)


def _cleared(plan):
    """Build a relay and ratify backend+frontend so qa is the active gate."""
    state = relay.build_relay(plan)
    relay.ratify(state, plan, "backend", None, True, "")
    relay.ratify(state, plan, "frontend", None, True, "")
    return state


def test_resolve_producers_contract_first():
    plan = _plan([
        _issue("b1", "backend", contract='{"x": 1}'),
        _issue("d1", "db"),                              # another upstream, no contract
        _issue("f1", "frontend", deps=["d1", "b1"]),     # depends on both; only b1 has a contract
    ])
    assert [p.id for p in relay.resolve_producers(plan, "f1")] == ["b1", "d1"]   # contract-bearing first
    assert relay.resolve_producers(plan, "b1") == []                            # no upstream → empty


def test_failing_signal_blocks_qa_without_cascade():
    plan = _be_fe()
    state = _cleared(plan)
    assert _status(state, "qa") == "pending" and "qa" in state.baton            # qa is the active gate

    relay.record_integration_signal(state, _sig("b1", "failing"))

    assert _status(state, "qa") == "blocked" and "qa" in state.baton            # held, not advanced
    assert not relay.all_ratified(state)                                        # dispatch stays gated
    assert _status(state, "backend") == "ratified"                             # NO cascade — upstream untouched
    assert _status(state, "frontend") == "ratified"
    failing = relay.open_integration_failures(state)
    assert [s.target_issue_id for s in failing] == ["b1"]


def test_ok_signal_unblocks_qa():
    plan = _be_fe()
    state = _cleared(plan)
    relay.record_integration_signal(state, _sig("b1", "failing"))
    assert _status(state, "qa") == "blocked"

    relay.record_integration_signal(state, _sig("b1", "ok"))                    # producer fixed → re-marked ok

    assert _status(state, "qa") == "pending" and not relay.open_integration_failures(state)
    relay.ratify(state, plan, "qa", None, True, "")
    assert relay.all_ratified(state)                                            # now clears to dispatch


def test_auto_pass_cannot_clear_a_blocked_gate():
    plan = _be_fe()
    state = _cleared(plan)
    relay.record_integration_signal(state, _sig("b1", "failing"))
    trust = {"sprint0-se": {"trust": {}, "trust_level": "high"},
             "sprint0-fe": {"trust": {}, "trust_level": "high"}}

    relay.auto_pass(state, plan, trust, dial=100)                               # full autonomy...

    assert _status(state, "qa") == "blocked"                                    # ...still can't pass a block
    assert not relay.all_ratified(state)


def test_open_failures_last_write_wins():
    plan = _be_fe()
    state = relay.build_relay(plan)
    relay.record_integration_signal(state, _sig("b1", "failing"))
    relay.record_integration_signal(state, _sig("b1", "ok"))
    assert relay.open_integration_failures(state) == []                         # latest per target is ok
    relay.record_integration_signal(state, _sig("b1", "failing"))
    assert [s.target_issue_id for s in relay.open_integration_failures(state)] == ["b1"]
