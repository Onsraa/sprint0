"""Pure deterministic scheduler — no I/O. Computes working-day scheduled_start/end for a
project's Tasks from the dependency DAG × estimate × assignee capacity. (Phase C.)"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta

from app.contracts import DeveloperProfile, Task

SENIORITY_CAPACITY = {"senior": 1.0, "mid": 0.7, "junior": 0.5}
_DEFAULT_CAPACITY = 0.7          # unknown/unassigned seniority
BUSY_HORIZON_WORKDAYS = 10       # load 100% → first start pushed out this many workdays


def next_workday(d: date) -> date:
    """Same day if a weekday, else the following Monday."""
    while d.weekday() >= 5:       # 5=Sat, 6=Sun
        d += timedelta(days=1)
    return d


def add_workdays(d: date, n: int) -> date:
    """Advance `n` business days from `d` (n=0 → next_workday(d))."""
    d = next_workday(d)
    while n > 0:
        d = next_workday(d + timedelta(days=1))
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


def _topo(tasks: list[Task]) -> list[Task]:
    """Kahn's topological sort by depends_on; ignores deps outside this set; cycle-safe."""
    by_id = {t.id: t for t in tasks}
    indeg = {t.id: sum(1 for d in t.depends_on if d in by_id) for t in tasks}
    queue = [t for t in tasks if indeg[t.id] == 0]
    order, seen = [], set()
    while queue:
        t = queue.pop(0)
        order.append(t); seen.add(t.id)
        for u in tasks:
            if t.id in u.depends_on and u.id not in seen:
                indeg[u.id] -= 1
                if indeg[u.id] == 0:
                    queue.append(u)
    order.extend(t for t in tasks if t.id not in seen)
    return order


def schedule_tasks(tasks: list[Task], members: list[DeveloperProfile], anchor: str) -> list[Task]:
    """Set scheduled_start/end (ISO dates) on each task. Pure — returns the same Task objects."""
    anchor_d = _anchor_date(anchor)
    cap = {m.username: capacity_of(m) for m in members}
    load = {m.username: m.load for m in members}

    def avail(assignee: str | None) -> date:
        if not assignee:
            return anchor_d
        busy = round((load.get(assignee, 0) / 100) * BUSY_HORIZON_WORKDAYS)
        return add_workdays(anchor_d, busy)

    free: dict[str, date] = {}
    end_of: dict[str, date] = {}
    for t in _topo(tasks):
        a = t.assignee or ""
        c = cap.get(a, 1.0)
        dur = max(1, math.ceil(t.estimate_days / c))
        start = free.get(a) or avail(t.assignee)
        for d in t.depends_on:
            if d in end_of:
                start = max(start, add_workdays(end_of[d], 1))
        start = next_workday(start)
        end = add_workdays(start, dur - 1)
        t.scheduled_start = start.isoformat()
        t.scheduled_end = end.isoformat()
        end_of[t.id] = end
        free[a] = add_workdays(end, 1)
    return tasks
