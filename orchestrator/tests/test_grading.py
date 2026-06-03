"""Graded references — strength is earned by real signals; only battle-tested grades route (no I/O)."""
from app import grading


def _d(**kw):
    return {"grade": "proposed", "merged": False, "qa_passed": False, "days_clean": 0, **kw}


def test_proposed_until_merged():
    assert grading.next_grade(_d()) == "proposed"


def test_merged_is_shipped():
    assert grading.next_grade(_d(merged=True)) == "shipped"


def test_merged_and_qa_is_prod_survived():
    assert grading.next_grade(_d(merged=True, qa_passed=True)) == "prod_survived"


def test_clean_days_promote_to_retro():
    assert grading.next_grade(_d(merged=True, qa_passed=True, days_clean=grading.RETRO_DAYS)) == "retro_validated"


def test_monotonic_never_demotes():
    # signals lost but stored grade is high → stays (regression handled upstream, not here)
    assert grading.next_grade(_d(grade="retro_validated", merged=False)) == "retro_validated"


def test_routing_weight_only_when_battle_tested():
    assert not grading.carries_routing_weight(_d(grade="proposed"))
    assert not grading.carries_routing_weight(_d(grade="shipped"))
    assert grading.carries_routing_weight(_d(grade="prod_survived"))
    assert grading.carries_routing_weight(_d(grade="retro_validated"))

# ── #33 Contract signal (Profile C) + grade_for ──────────────────────────────
from app.contracts import SolutionCard


def _card(**kw):
    base = dict(source="ai", confidence=70, grounded_on=[], grade=None, conflict=False)
    base.update(kw)
    return SolutionCard(**base)


def test_signal_conflict_always_orange():
    # even a battle-tested, confident, grounded option goes orange if it contradicts a decision
    assert grading.signal_for(_card(source="memory", confidence=95, grade="retro_validated",
                                    grounded_on=["X"], conflict=True)) == "orange"


def test_signal_green_confident_and_grounded():
    assert grading.signal_for(_card(source="memory", confidence=84, grounded_on=["QuantaPay (2024)"])) == "green"


def test_signal_grey_unbacked_ai_and_low_conf():
    assert grading.signal_for(_card(source="ai", confidence=80, grounded_on=[])) == "grey"       # ai + ungrounded
    assert grading.signal_for(_card(source="memory", confidence=30, grounded_on=["X"])) == "grey"  # < 40


def test_signal_orange_middle():
    # grounded but confidence in the 40–59 band → the middle a human weighs
    assert grading.signal_for(_card(source="memory", confidence=50, grounded_on=["X"])) == "orange"


def test_grade_for_prefers_team_decision():
    decs = [{"project_name": "QuantaPay (2024)", "domain": "backend", "grade": "prod_survived", "visibility": "team"}]
    assert grading.grade_for(["QuantaPay (2024)"], decs, "backend") == "prod_survived"


def test_grade_for_fallback_shipped_when_grounded_no_decision():
    assert grading.grade_for(["SomeProject"], [], "backend") == "shipped"


def test_grade_for_none_when_ungrounded():
    assert grading.grade_for([], [], "backend") is None


def test_grade_for_ignores_wrong_domain_and_personal_visibility():
    decs = [{"project_name": "QuantaPay (2024)", "domain": "frontend", "grade": "prod_survived", "visibility": "team"},
            {"project_name": "QuantaPay (2024)", "domain": "backend", "grade": "prod_survived", "visibility": "personal"}]
    assert grading.grade_for(["QuantaPay (2024)"], decs, "backend") == "shipped"  # neither matches → coarse fallback
