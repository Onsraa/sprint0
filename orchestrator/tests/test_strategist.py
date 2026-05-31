from app import strategist as ST
from app.contracts import ChangeEvent, ContextScope, DeveloperProfile, RescheduleStrategy, Task


def _task(tid, disc="backend", assignee=None, est=2.0, start=None, end=None, title=None):
    return Task(id=tid, project_id=1, title=title or tid, description="d", discipline=disc,
                assignee=assignee, estimate_days=est, scheduled_start=start, scheduled_end=end,
                context_scope=ContextScope(files=[]), created_at="t", updated_at="t")

def _m(u, disc, sen="mid", load=0, role="developer"):
    return DeveloperProfile(name=u, gitlab_username=u, skills_text="", seniority=sen, load=load,
                            discipline=disc, role=role)

def _ev(kind, **kw):
    return ChangeEvent(id="e", kind=kind, created_at="t", **kw)

def _strat(action, conf=80):
    return RescheduleStrategy(action=action, rationale="x", confidence=conf)


def test_prompt_carries_only_the_delta():
    impacted = [_task("t1", title="Auth API"), _task("t2", title="Login UI")]
    prompt = ST.build_strategy_prompt(_ev("spec_change", task_id="t1"), impacted, [_m("be1", "backend")])
    assert "t1" in prompt and "t2" in prompt and "@be1" in prompt and "spec_change" in prompt

def test_candidate_people_filters_to_impacted_disciplines_plus_manager():
    impacted = [_task("t1", disc="backend")]
    members = [_m("be1", "backend"), _m("fe1", "frontend"), _m("mgr", None, role="manager")]
    names = {m.username for m in ST.candidate_people(impacted, members)}
    assert "be1" in names and "fe1" not in names and "mgr" in names

def test_auto_apply_only_high_confidence_right_shift():
    assert ST.should_auto_apply(_strat("right_shift", 90)) is True
    assert ST.should_auto_apply(_strat("right_shift", 50)) is False    # low confidence → propose
    assert ST.should_auto_apply(_strat("reassign", 95)) is False       # high-impact → propose

def test_impact_notifications_are_per_person():
    moved = [_task("t1", assignee="be1", title="API"), _task("t2", assignee="fe1", title="UI")]
    notes = ST.impact_notifications(moved, _ev("sick", user_id="se"))
    assert {n["user_id"] for n in notes} == {"be1", "fe1"} and len(notes) == 2
