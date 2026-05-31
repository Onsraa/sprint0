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
