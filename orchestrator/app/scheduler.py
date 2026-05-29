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
