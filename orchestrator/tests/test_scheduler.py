from datetime import date
from app import scheduler as S
from app.contracts import ContextScope, DeveloperProfile, Task

def test_next_workday_pushes_weekend_to_monday():
    assert S.next_workday(date(2026, 6, 6)) == date(2026, 6, 8)   # Sat → Mon
    assert S.next_workday(date(2026, 6, 7)) == date(2026, 6, 8)   # Sun → Mon
    assert S.next_workday(date(2026, 6, 5)) == date(2026, 6, 5)   # Fri stays

def test_add_workdays_skips_weekend():
    assert S.add_workdays(date(2026, 6, 5), 1) == date(2026, 6, 8)   # Fri +1 → Mon
    assert S.add_workdays(date(2026, 6, 8), 5) == date(2026, 6, 15)  # Mon +5 → next Mon
    assert S.add_workdays(date(2026, 6, 8), 0) == date(2026, 6, 8)


def _task(tid, assignee, est=2.0, deps=None):
    return Task(id=tid, project_id=1, title=tid, description="d", discipline="backend",
                assignee=assignee, estimate_days=est, risk="low",
                depends_on=deps or [], context_scope=ContextScope(files=[]),
                created_at="t", updated_at="t")

def _member(username, seniority, load=0):
    return DeveloperProfile(name=username, gitlab_username=username, skills_text="",
                            seniority=seniority, load=load)

ANCHOR = "2026-06-08T00:00:00Z"   # a Monday

def test_dependency_orders_start_after_dep_end():
    out = {t.id: t for t in S.schedule_tasks(
        [_task("b1", "se"), _task("f1", "fe", deps=["b1"])],
        [_member("se", "senior"), _member("fe", "mid")], ANCHOR)}
    assert out["f1"].scheduled_start > out["b1"].scheduled_end

def test_capacity_makes_junior_slower():
    [snr] = S.schedule_tasks([_task("x", "snr", est=2)], [_member("snr", "senior")], ANCHOR)
    [jnr] = S.schedule_tasks([_task("y", "jnr", est=2)], [_member("jnr", "junior")], ANCHOR)
    assert jnr.scheduled_end > snr.scheduled_end

def test_same_assignee_packs_sequentially():
    out = {t.id: t for t in S.schedule_tasks(
        [_task("a", "se"), _task("b", "se")], [_member("se", "senior")], ANCHOR)}
    assert out["b"].scheduled_start > out["a"].scheduled_end

def test_load_delays_first_start():
    [busy] = S.schedule_tasks([_task("x", "se")], [_member("se", "senior", load=100)], ANCHOR)
    [free] = S.schedule_tasks([_task("y", "se")], [_member("se", "senior", load=0)], ANCHOR)
    assert busy.scheduled_start > free.scheduled_start

def test_sets_iso_dates():
    [t] = S.schedule_tasks([_task("a", "se")], [_member("se", "senior")], ANCHOR)
    assert t.scheduled_start == "2026-06-08" and t.scheduled_end >= t.scheduled_start
