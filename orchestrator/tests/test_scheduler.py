from datetime import date
from app import scheduler as S
from app.contracts import ChangeEvent, ContextScope, DeveloperProfile, Task

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


# ── Reflow engine: availability-aware scheduling (blocked days = extra weekends) ──
def test_availability_blocks_first_day():
    # 6/8 (Mon) blocked for se → a 1-day task starts the next free workday (Tue 6/9).
    [t] = S.schedule_tasks([_task("a", "se", est=1)], [_member("se", "senior")], ANCHOR,
                           availability={"se": {date(2026, 6, 8)}})
    assert t.scheduled_start == "2026-06-09"

def test_availability_extends_duration():
    # A 3-day senior task from Mon 6/8 normally ends Wed 6/10; blocking Tue 6/9 pushes end to Thu 6/11.
    [base] = S.schedule_tasks([_task("a", "se", est=3)], [_member("se", "senior")], ANCHOR)
    assert base.scheduled_end == "2026-06-10"
    [blocked] = S.schedule_tasks([_task("a", "se", est=3)], [_member("se", "senior")], ANCHOR,
                                 availability={"se": {date(2026, 6, 9)}})
    assert blocked.scheduled_start == "2026-06-08" and blocked.scheduled_end == "2026-06-11"


# ── Reflow engine: pinned tasks are fixed points (locked dates + reserve capacity) ──
def test_pinned_task_keeps_its_dates():
    a = _task("a", "se", est=2)
    a.pinned, a.scheduled_start, a.scheduled_end = True, "2026-07-01", "2026-07-02"
    [out] = S.schedule_tasks([a], [_member("se", "senior")], ANCHOR)
    assert out.scheduled_start == "2026-07-01" and out.scheduled_end == "2026-07-02"

def test_pinned_task_reserves_capacity():
    # A pinned Mon–Fri task forces the same assignee's later task to start after the pin ends.
    p = _task("p", "se", est=2)
    p.pinned, p.scheduled_start, p.scheduled_end = True, "2026-06-08", "2026-06-12"
    q = _task("q", "se", est=1)
    out = {t.id: t for t in S.schedule_tasks([p, q], [_member("se", "senior")], ANCHOR)}
    assert out["q"].scheduled_start > out["p"].scheduled_end


# ── Reflow engine: incremental, minimal-perturbation, cross-project (zero thrash) ──
def _se_fe():
    return [_member("se", "senior"), _member("fe", "senior")]

def test_reflow_freezes_unaffected_tasks():
    # Different people, no dependency → a change to se's task leaves fe's task byte-identical.
    s, f = _task("s", "se", est=2), _task("f", "fe", est=2)
    m = _se_fe()
    S.schedule_tasks([s, f], m, ANCHOR)
    f_prior = (f.scheduled_start, f.scheduled_end)
    s.estimate_days = 6
    S.reflow([s, f], m, ANCHOR, changed_ids=["s"])
    assert (f.scheduled_start, f.scheduled_end) == f_prior

def test_reflow_shifts_downstream_dependent():
    # A heavier upstream task pushes its dependent later (temporal ripple).
    b, f = _task("b", "se", est=2), _task("f", "fe", est=2, deps=["b"])
    m = _se_fe()
    S.schedule_tasks([b, f], m, ANCHOR)
    f_prior_start = f.scheduled_start
    b.estimate_days = 6
    S.reflow([b, f], m, ANCHOR, changed_ids=["b"])
    assert f.scheduled_start > b.scheduled_end and f.scheduled_start > f_prior_start

def test_reflow_does_not_pull_earlier_than_prior():
    # Shrinking an upstream same-person task frees capacity, but the later task must NOT slide earlier.
    a, b = _task("a", "se", est=4), _task("b", "se", est=2)
    m = [_member("se", "senior")]
    S.schedule_tasks([a, b], m, ANCHOR)
    b_prior_start = b.scheduled_start
    a.estimate_days = 1
    S.reflow([a, b], m, ANCHOR, changed_ids=["a"])
    assert b.scheduled_start == b_prior_start

def test_reflow_ripples_across_projects_via_shared_person():
    # se has a task in two projects; a heavier project-1 task pushes the project-2 task; others untouched.
    p1, p2 = _task("p1", "se", est=2), _task("p2", "se", est=2)
    p2.project_id = 2
    other = _task("o", "fe", est=2)
    m = _se_fe()
    S.schedule_tasks([p1, p2, other], m, ANCHOR)
    p2_prior, other_prior = p2.scheduled_start, (other.scheduled_start, other.scheduled_end)
    p1.estimate_days = 8
    S.reflow([p1, p2, other], m, ANCHOR, changed_ids=["p1"])
    assert p2.scheduled_start > p2_prior
    assert (other.scheduled_start, other.scheduled_end) == other_prior


# ── Reflow engine: availability fold (change-events → per-person blocked days) ──
def _ev(kind, user=None, start=None, end=None):
    return ChangeEvent(id="e", kind=kind, user_id=user, start=start, end=end, created_at="t")

def test_blocked_days_from_sick_range():
    av = S.blocked_days([_ev("sick", user="se", start="2026-06-10", end="2026-06-12")])
    assert av["se"] == {date(2026, 6, 10), date(2026, 6, 11), date(2026, 6, 12)}

def test_blocked_days_single_day_defaults_end_to_start():
    av = S.blocked_days([_ev("holiday", user="se", start="2026-06-10")])
    assert av["se"] == {date(2026, 6, 10)}

def test_blocked_days_ignores_non_calendar_events():
    av = S.blocked_days([_ev("estimate_change"), _ev("reassign", user="se")])
    assert av == {}

def test_blocked_days_feeds_scheduler():
    # The fold output plugs straight into schedule_tasks' availability param.
    av = S.blocked_days([_ev("sick", user="se", start="2026-06-08", end="2026-06-08")])
    [t] = S.schedule_tasks([_task("a", "se", est=1)], [_member("se", "senior")], ANCHOR, availability=av)
    assert t.scheduled_start == "2026-06-09"


# ── availability() — the honest "when can this person start" signal ──────────
def _sched_task(tid, assignee, est=2.0, status="planned", end=None):
    t = _task(tid, assignee, est=est)
    t.status = status
    t.scheduled_end = end
    return t

def test_availability_free_now_with_no_tasks():
    av = S.availability([_member("a", "mid")], [], ANCHOR)
    assert av["a"].free_in_days == 0
    assert av["a"].active_count == 0 and av["a"].queued_days == 0.0

def test_availability_from_last_scheduled_end_excludes_done():
    tasks = [
        _sched_task("t1", "a", est=3, status="in_progress", end="2026-06-10"),
        _sched_task("t2", "a", est=2, status="planned", end="2026-06-12"),   # Fri — the latest active end
        _sched_task("t3", "a", est=5, status="done", end="2026-06-19"),      # done → ignored entirely
    ]
    av = S.availability([_member("a", "mid")], tasks, ANCHOR)
    assert av["a"].available_on == "2026-06-15"   # day after Fri 06-12 → Mon
    assert av["a"].active_count == 2              # done excluded
    assert av["a"].queued_days == 5.0             # 3 + 2 (done's 5 excluded)

def test_availability_external_baseline_offsets_taskless_member():
    # load=100 (busy elsewhere) → free only after BUSY_HORIZON workdays, honestly, even with zero kanban tasks
    av = S.availability([_member("busy", "senior", load=100)], [], ANCHOR)
    assert av["busy"].free_in_days == S.BUSY_HORIZON_WORKDAYS
    assert av["busy"].active_count == 0

def test_availability_takes_max_of_baseline_and_task_schedule():
    tasks = [_sched_task("t1", "b", status="planned", end="2026-06-09")]   # tiny task load
    av = S.availability([_member("b", "mid", load=100)], tasks, ANCHOR)
    assert av["b"].free_in_days == S.BUSY_HORIZON_WORKDAYS                  # baseline (10) > task (~1)
