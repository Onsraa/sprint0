"""Reuse-or-Innovate — the deterministic Contract-solution helpers (app/solutions.py), the SolutionCard
validator-truncation, and that RatifyRequest carries the pick. The LLM generator is smoke-tested live,
not here; these lock the pure server-side logic."""
from app import solutions as soln
from app.contracts import (
    ContextScope, Epic, Issue, PlanJSON, RatifyRequest, SolutionCard, SolutionSet, TechStack,
)


def _iss(i, typ, files):
    return Issue(id=i, title=i, description="d", type=typ, estimate_days=1, risk="low",
                 required_skill=f"{typ}:x", context_scope=ContextScope(files=files))


def _plan():
    return PlanJSON(project_name="P", client_summary="", grounded_on=[], timeline_weeks=2,
                    tech_stack=TechStack(frontend="R", backend="Py", db="PG", infra="-"),
                    epics=[Epic(id="e", title="Payment portal", issues=[
                        _iss("be1", "backend", ["billing.py", "webhooks.py"]),
                        _iss("fe1", "frontend", ["Checkout.tsx", "billing.py"]),  # shares billing.py with backend
                        _iss("do1", "devops", ["deploy.yml"]),
                    ])])


def test_gate_slice_files():
    p = _plan()
    assert soln.gate_slice_files(p, "backend") == {"billing.py", "webhooks.py"}
    assert soln.gate_slice_files(p, "frontend") == {"Checkout.tsx", "billing.py"}


def test_impacted_files_union_with_dependents():
    deps = {"billing.py": ["api.py", "report.py"], "webhooks.py": []}
    assert soln.impacted_files({"billing.py", "webhooks.py"}, deps) == ["api.py", "billing.py", "report.py", "webhooks.py"]


def test_impacted_files_no_graph_is_just_the_slice():
    assert soln.impacted_files({"b.py", "a.py"}, None) == ["a.py", "b.py"]


def test_finalize_assigns_ids_coerces_user_and_appends_slot():
    sset = SolutionSet(solutions=[
        SolutionCard(source="memory", title="Reuse X", grounded_on=["quantapay-2024"]),
        SolutionCard(source="ai", title="Fresh"),
        SolutionCard(source="user", title="LLM must not emit user"),  # coerced to ai
    ])
    out = soln.finalize_solution_set(sset, "backend", ["billing.py"])
    assert out.discipline == "backend"
    assert [s.source for s in out.solutions] == ["memory", "ai", "ai", "user"]  # +1 appended user slot
    assert [s.id for s in out.solutions] == ["sol_backend_0", "sol_backend_1", "sol_backend_2", "sol_backend_user"]
    assert out.solutions[0].impacted_files == ["billing.py"]
    assert out.solutions[-1].title == "Write your own"


def test_cross_gate_overlap_flags_only_sharers():
    p = _plan()
    assert soln.cross_gate_overlap(p, "backend", ["billing.py"]) == ["frontend"]  # frontend also touches billing.py
    assert soln.cross_gate_overlap(p, "backend", ["webhooks.py"]) == []           # nobody else touches it


def test_cross_gate_fires_only_on_ADDED_files():
    # The endpoint flags other gates only when a user-regen ADDS files (post - pre), never on an ordinary pick.
    p = _plan()
    pre = soln.gate_slice_files(p, "devops")              # {deploy.yml}
    for e in p.epics:                                      # simulate a user regen adding billing.py to devops
        for i in e.issues:
            if i.discipline == "devops":
                i.context_scope.files = ["deploy.yml", "billing.py"]
    added = sorted(soln.gate_slice_files(p, "devops") - pre)
    assert added == ["billing.py"]
    assert soln.cross_gate_overlap(p, "devops", added) == ["backend", "frontend"]  # both touch billing.py
    assert soln.cross_gate_overlap(p, "devops", []) == []                          # no added files → no bounce


def test_solutioncard_truncates():
    s = SolutionCard(title="one two three four five six seven eight nine",
                     summary="x" * 200, rationale="y" * 300,
                     pros=["a b c d e f g h i", "p2", "p3", "p4"], confidence=150)
    assert len(s.title.split()) == 7
    assert len(s.summary) == 140
    assert len(s.rationale) == 200
    assert len(s.pros) == 3
    assert len(s.pros[0].split()) == 8
    assert s.confidence == 100


def test_ratify_request_accepts_chosen_solution():
    r = RatifyRequest(approve=True, chosen_solution=SolutionCard(source="memory", title="Reuse X", grounded_on=["p"]))
    assert r.chosen_solution is not None
    assert r.chosen_solution.source == "memory"
