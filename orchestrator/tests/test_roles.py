"""Composable role model: a user holds MULTIPLE disciplines + the manager capability is orthogonal.
Covers the model reconciliation, presence-based coverage (the dashed-gate #2 fix), orphan detection, and
the manager-as-normal-user tester pick."""
from app import relay, staffing
from app.contracts import ContextScope, DeveloperProfile, Epic, Issue, PlanJSON, TechStack


def _dev(name, user, *, disciplines=None, is_manager=False, trust=None, **kw):
    return DeveloperProfile(name=name, gitlab_username=user, username=user, skills_text="",
                            disciplines=disciplines or [], is_manager=is_manager, trust=trust or {}, **kw)


# the 3-user composable demo team
TEDDY = _dev("Teddy", "Onsraa", is_manager=True, disciplines=["qa"], trust={"qa": "high"}, seniority="senior")
TONY = _dev("Tony", "sprint0-sse", disciplines=["backend", "devops"], trust={"backend": "high", "devops": "high"}, seniority="senior")
SAM = _dev("Sam", "sprint0-fe", disciplines=["frontend"], trust={"frontend": "medium"}, seniority="mid")
ROSTER = [TEDDY, TONY, SAM]


# Issue.discipline is computed from `type` (design→uiux); qa has no issue type (it's the acceptance gate).
_LANE_TYPE = {"backend": "backend", "frontend": "frontend", "devops": "devops", "uiux": "design", "db": "db"}


def _plan(lanes):
    issues = [Issue(id=f"i{n}", title=f"I{n}", description="d", type=_LANE_TYPE[lane], estimate_days=1, risk="low",
                    required_skill="", context_scope=ContextScope(files=[f"{n}.py"]))
              for n, lane in enumerate(lanes)]
    return PlanJSON(project_name="P", client_summary="", grounded_on=[], timeline_weeks=4,
                    tech_stack=TechStack(frontend="R", backend="P", db="PG", infra="-"),
                    epics=[Epic(id="e1", title="E", issues=issues)])


def test_model_reconciles_legacy_and_new():
    # legacy construction (single discipline / role) still yields a valid composable profile
    legacy = _dev("X", "x", disciplines=None, is_manager=False)  # then set the old way
    legacy = DeveloperProfile(name="X", gitlab_username="x", skills_text="", role="developer", discipline="backend")
    assert legacy.disciplines == ["backend"] and legacy.discipline == "backend" and not legacy.is_manager
    mgr = DeveloperProfile(name="M", gitlab_username="m", skills_text="", role="manager")
    assert mgr.is_manager and mgr.role == "manager" and mgr.disciplines == []


def test_covers_is_membership():
    assert TONY.covers("backend") and TONY.covers("devops") and not TONY.covers("frontend")
    assert TEDDY.covers("qa") and not TEDDY.covers("backend")
    assert TONY.discipline == "backend"  # primary mirror = first lane


def test_coverage_presence_not_trust_gate():
    # the #2 fix: a present coverer is COVERED even at "medium" trust — never a dashed "no dedicated dev".
    cov = {c["discipline"]: c for c in staffing.coverage(_plan(["backend", "frontend"]), ROSTER)}
    assert cov["frontend"]["covered"] and cov["frontend"]["lead"] == "sprint0-fe"  # Sam, medium trust
    assert cov["backend"]["covered"] and cov["backend"]["lead"] == "sprint0-sse"   # Tony


def test_uiux_is_the_orphan_gap():
    cov = {c["discipline"]: c for c in staffing.coverage(_plan(["uiux", "backend"]), ROSTER)}
    assert cov["uiux"]["covered"] is False and cov["uiux"]["recommendation"] is not None
    assert staffing.is_orphan("uiux", ROSTER) is True
    assert staffing.is_orphan("backend", ROSTER) is False  # Tony covers it
    assert staffing.is_orphan("qa", ROSTER) is False       # the manager covers it


def test_multi_lane_member_covers_both_lanes_in_coverage():
    cov = {c["discipline"]: c for c in staffing.coverage(_plan(["backend", "devops"]), ROSTER)}
    assert cov["backend"]["lead"] == "sprint0-sse" and cov["devops"]["lead"] == "sprint0-sse"  # Tony leads both


def test_manager_who_covers_qa_wins_the_tester_pick():
    pick = relay.best_tester(ROSTER)
    assert pick is not None and pick.username == "Onsraa"  # Teddy: highest verification trust (qa:high)


def test_owns_gate_is_unique_per_user_no_role_seeall():
    from app.contracts import Gate
    be = Gate(discipline="backend", owner="sprint0-sse", depends_on=[])   # owned by Tony
    qa = Gate(discipline="qa", owner=None, depends_on=[])                  # acceptance: tester (covers qa)
    ui = Gate(discipline="uiux", owner=None, depends_on=[])               # true orphan: nobody covers uiux
    # an OWNED gate → only its owner (no manager override)
    assert relay.owns_gate(TONY, be, ROSTER) and not relay.owns_gate(TEDDY, be, ROSTER) and not relay.owns_gate(SAM, be, ROSTER)
    # the qa acceptance gate → the tester (covers qa), NOT a backend dev
    assert relay.owns_gate(TEDDY, qa, ROSTER) and not relay.owns_gate(TONY, qa, ROSTER)
    # a true orphan (uncovered) → the manager inherits it; a covered/owned gate never falls to the manager
    assert relay.owns_gate(TEDDY, ui, ROSTER) and not relay.owns_gate(TONY, ui, ROSTER)


def test_free_string_lanes_fold_to_discipline_no_phantom_gate():
    # the 'open gate is empty + 403' root cause: an AI free-string lane ("platform"/"security") has no
    # slice/coverer/solutions → a phantom ownerless gate. Normalize it to the issue's discipline.
    from app import reason

    def _iss(iid, typ, lane):
        return Issue(id=iid, title="t", description="d", type=typ, estimate_days=1, risk="low",
                     required_skill="", context_scope=ContextScope(files=[f"{iid}.x"]), lane=lane)
    plan = PlanJSON(project_name="P", client_summary="", grounded_on=[], timeline_weeks=4,
                    tech_stack=TechStack(frontend="R", backend="P", db="PG", infra="-"),
                    epics=[Epic(id="e1", title="E", issues=[
                        _iss("i1", "devops", "platform"),    # free lane → discipline devops
                        _iss("i2", "db", "security"),        # free lane → discipline backend (db→backend)
                        _iss("i3", "frontend", "frontend"),  # valid discipline lane → kept
                    ])])
    reason._normalize_plan_lanes(plan)
    assert [i.lane for e in plan.epics for i in e.issues] == ["devops", "backend", "frontend"]
    discs = {g.discipline for g in relay.build_relay(plan).gates}
    assert "platform" not in discs and "security" not in discs   # no phantom gate
    assert {"devops", "backend", "frontend"} <= discs
