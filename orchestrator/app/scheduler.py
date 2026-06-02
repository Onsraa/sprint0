"""Pure deterministic scheduler — no I/O. Computes working-day scheduled_start/end for a
project's Tasks from the dependency DAG × estimate × assignee capacity. (Phase C.)"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta

from app.contracts import Availability, ChangeEvent, DeveloperProfile, Task

_ACTIVE_STATUSES = {"planned", "in_progress", "in_review", "blocked"}   # everything except "done"

CALENDAR_BLOCK_KINDS = {"sick", "holiday", "time_off"}   # full-day absences that block scheduling

SENIORITY_CAPACITY = {"senior": 1.0, "mid": 0.7, "junior": 0.5}
_DEFAULT_CAPACITY = 0.7          # unknown/unassigned seniority
BUSY_HORIZON_WORKDAYS = 10       # load 100% → first start pushed out this many workdays


def next_workday(d: date, blocked: frozenset[date] = frozenset()) -> date:
    """Same day if a free weekday, else the next day that is neither a weekend nor blocked.
    `blocked` (the assignee's unavailable days — holidays/sick/time-off) acts as extra weekends."""
    while d.weekday() >= 5 or d in blocked:    # 5=Sat, 6=Sun
        d += timedelta(days=1)
    return d


def add_workdays(d: date, n: int, blocked: frozenset[date] = frozenset()) -> date:
    """Advance `n` business days from `d` (n=0 → next_workday(d)), skipping weekends and `blocked`."""
    d = next_workday(d, blocked)
    while n > 0:
        d = next_workday(d + timedelta(days=1), blocked)
        n -= 1
    return d


def capacity_of(member: DeveloperProfile | None) -> float:
    if member is None:
        return 1.0
    override = getattr(member, "capacity_per_day", None)   # honored if the field is added later
    if override:
        return float(override)
    return SENIORITY_CAPACITY.get(member.seniority, _DEFAULT_CAPACITY)


def _anchor_date(anchor: str) -> date:
    return next_workday(datetime.fromisoformat(anchor.replace("Z", "+00:00")).date())


_PRI = {"urgent": 0, "high": 1, "normal": 2, "low": 3}   # lower rank = scheduled first


def _topo(tasks: list[Task]) -> list[Task]:
    """Kahn's topological sort by depends_on; among READY tasks, higher priority schedules first
    (urgent→low) so urgent work claims a person's calendar ahead of lower-priority work. The ordering
    IS the (bounded) preemption — no recursion. Stable: equal priority keeps insertion order. Cycle-safe."""
    by_id = {t.id: t for t in tasks}
    indeg = {t.id: sum(1 for d in t.depends_on if d in by_id) for t in tasks}
    queue = [t for t in tasks if indeg[t.id] == 0]
    order, seen = [], set()
    while queue:
        queue.sort(key=lambda t: _PRI.get(t.priority, 2))  # stable → ties keep insertion order
        t = queue.pop(0)
        order.append(t); seen.add(t.id)
        for u in tasks:
            if t.id in u.depends_on and u.id not in seen:
                indeg[u.id] -= 1
                if indeg[u.id] == 0:
                    queue.append(u)
    order.extend(t for t in tasks if t.id not in seen)
    return order


def _avail(assignee: str, anchor_d: date, load: dict[str, int], blocked: frozenset[date]) -> date:
    """Earliest start for an assignee: anchor pushed out by their load (0-100% → 0-BUSY_HORIZON days)."""
    if not assignee:
        return anchor_d
    busy = round((load.get(assignee, 0) / 100) * BUSY_HORIZON_WORKDAYS)
    return add_workdays(anchor_d, busy, blocked)


def _workdays_between(a: date, b: date) -> int:
    """Count of working days from `a` (inclusive) up to `b` (exclusive). a==b → 0. Assumes a<=b."""
    n, d = 0, a
    while d < b:
        d = add_workdays(d, 1)
        n += 1
    return n


def availability(members: list[DeveloperProfile], tasks: list[Task], anchor: str) -> dict[str, Availability]:
    """When can each member start NEW work — the honest capacity signal (not a load %). Per member:
    `available_on` = max(their external-commitment baseline via `_avail`, the day after their last
    scheduled active task). No active scheduled work and no baseline → free now. Pure + deterministic."""
    anchor_d = _anchor_date(anchor)
    load = {m.username: m.load for m in members}
    out: dict[str, Availability] = {}
    for m in members:
        u = m.username
        active = [t for t in tasks if t.assignee == u and t.status in _ACTIVE_STATUSES]
        baseline_free = _avail(u, anchor_d, load, frozenset())
        sched_ends = [date.fromisoformat(t.scheduled_end) for t in active if t.scheduled_end]
        task_free = add_workdays(max(sched_ends), 1) if sched_ends else anchor_d
        on = max(baseline_free, task_free)
        out[u] = Availability(
            available_on=on.isoformat(),
            free_in_days=_workdays_between(anchor_d, on),
            queued_days=round(sum(t.estimate_days for t in active), 1),
            active_count=len(active),
        )
    return out


def _pack(tasks: list[Task], cap: dict[str, float], load: dict[str, int], anchor_d: date,
          avail_map: dict[str, set[date]], frozen_ids: set[str],
          floor_starts: dict[str, date]) -> list[Task]:
    """Core packing pass (topological + per-assignee greedy). `frozen_ids` keep their prior dates
    (pinned or unaffected) and only reserve capacity; `floor_starts` give a task a minimum start —
    the minimal-perturbation lever: an affected task is never pulled earlier than where it already sits."""
    free: dict[str, date] = {}
    end_of: dict[str, date] = {}
    for t in _topo(tasks):
        a = t.assignee or ""
        blk = frozenset(avail_map.get(a, ()))
        if t.status == "done":
            continue  # completed work draws no future capacity and imposes no scheduling floor on dependents
        if t.id in frozen_ids and t.scheduled_start and t.scheduled_end:
            end = date.fromisoformat(t.scheduled_end)
            end_of[t.id] = end
            free[a] = max(free.get(a, anchor_d), add_workdays(end, 1, blk))
            continue
        c = cap.get(a, 1.0)
        dur = max(1, math.ceil(t.estimate_days / c))
        start = free.get(a) or _avail(a, anchor_d, load, blk)
        for d in t.depends_on:
            if d in end_of:
                start = max(start, add_workdays(end_of[d], 1, blk))
        floor = floor_starts.get(t.id)
        if floor:
            start = max(start, floor)
        start = next_workday(start, blk)
        end = add_workdays(start, dur - 1, blk)
        t.scheduled_start, t.scheduled_end = start.isoformat(), end.isoformat()
        end_of[t.id] = end
        free[a] = add_workdays(end, 1, blk)
    return tasks


def schedule_tasks(tasks: list[Task], members: list[DeveloperProfile], anchor: str,
                   availability: dict[str, set[date]] | None = None) -> list[Task]:
    """Full solve from scratch (used at dispatch). Pure — returns the same Task objects.
    `availability` maps username → blocked days (holiday/sick/time-off); treated as extra weekends."""
    anchor_d = _anchor_date(anchor)
    cap = {m.username: capacity_of(m) for m in members}
    load = {m.username: m.load for m in members}
    # in_progress work is protected like a pin: it keeps its slot + reserves capacity, so urgent
    # planned work bumps only UNSTARTED lower-priority tasks, never active work.
    frozen = {t.id for t in tasks if (t.pinned or t.status == "in_progress") and t.scheduled_start and t.scheduled_end}
    return _pack(tasks, cap, load, anchor_d, availability or {}, frozen, {})


def _affected_set(tasks: list[Task], changed: set[str]) -> set[str]:
    """Tasks impacted by a change = transitive temporal dependents ∪ each affected person's later
    tasks (any project — shared people are how a change ripples across the roadmap). Fixpoint."""
    affected = set(changed)
    growing = True
    while growing:
        growing = False
        for t in tasks:                                       # transitive temporal dependents
            if t.id not in affected and any(d in affected for d in t.depends_on):
                affected.add(t.id); growing = True
        floor: dict[str, str] = {}                            # earliest affected start per assignee
        for t in tasks:
            if t.id in affected and t.assignee and t.scheduled_start:
                if t.assignee not in floor or t.scheduled_start < floor[t.assignee]:
                    floor[t.assignee] = t.scheduled_start
        for t in tasks:                                       # that person's later tasks ripple
            if (t.id not in affected and t.assignee in floor
                    and t.scheduled_start and t.scheduled_start >= floor[t.assignee]):
                affected.add(t.id); growing = True
    return affected


def reflow(tasks: list[Task], members: list[DeveloperProfile], anchor: str,
           changed_ids: list[str], availability: dict[str, set[date]] | None = None) -> list[Task]:
    """Incremental, minimal-perturbation re-solve. Recompute only the affected subgraph, freeze the
    rest at their prior dates, and never pull an affected task earlier than where it already sits."""
    anchor_d = _anchor_date(anchor)
    cap = {m.username: capacity_of(m) for m in members}
    load = {m.username: m.load for m in members}
    affected = _affected_set(tasks, set(changed_ids))
    frozen = {t.id for t in tasks
              if (t.id not in affected or t.pinned or t.status == "in_progress") and t.scheduled_start and t.scheduled_end}
    floors = {t.id: date.fromisoformat(t.scheduled_start)
              for t in tasks if t.id in affected and not t.pinned and t.scheduled_start}
    ordered = sorted(tasks, key=lambda t: t.scheduled_start or "9999")  # stable per-person packing
    _pack(ordered, cap, load, anchor_d, availability or {}, frozen, floors)
    return tasks


# ── Layer 0 fold: change-events → availability the scheduler can consume ──
def blocked_days(events: list[ChangeEvent]) -> dict[str, set[date]]:
    """Fold full-day absence events (sick/holiday/time_off) into per-person blocked days. Output plugs
    straight into schedule_tasks/reflow's `availability` param. Meetings (sub-day) and work events have
    no calendar effect here."""
    out: dict[str, set[date]] = {}
    for e in events:
        if e.kind not in CALENDAR_BLOCK_KINDS or not e.user_id or not e.start:
            continue
        start = date.fromisoformat(e.start)
        end = date.fromisoformat(e.end) if e.end else start
        days = out.setdefault(e.user_id, set())
        d = start
        while d <= end:
            days.add(d)
            d += timedelta(days=1)
    return out
