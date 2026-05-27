"""calendar.py — shift scheduling engine.

Generates shifts against employee availability and resolves conflicts before
anything is published: double-booking (overlapping shifts) and weekly-overtime
breaches. Built to be reused by any roster/booking product.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

MAX_WEEKLY_HOURS = 48.0  # overtime threshold


@dataclass
class TimeWindow:
    start: dt.datetime
    end: dt.datetime

    @property
    def hours(self) -> float:
        return (self.end - self.start).total_seconds() / 3600

    def overlaps(self, other: "TimeWindow") -> bool:
        return self.start < other.end and other.start < self.end


@dataclass
class Availability:
    employee_id: int
    windows: list[TimeWindow] = field(default_factory=list)

    def can_cover(self, shift: TimeWindow) -> bool:
        """True if the shift fits entirely inside one availability window."""
        return any(w.start <= shift.start and shift.end <= w.end for w in self.windows)


@dataclass
class Conflict:
    kind: str  # "double_booking" | "overtime" | "unavailable"
    employee_id: int
    detail: str


def detect_conflicts(
    employee_id: int,
    proposed: TimeWindow,
    existing: list[TimeWindow],
    availability: Availability | None = None,
) -> list[Conflict]:
    """Validate a single proposed shift against current state."""
    conflicts: list[Conflict] = []

    # 1. Double-booking: overlaps an already-assigned shift.
    for shift in existing:
        if proposed.overlaps(shift):
            conflicts.append(
                Conflict("double_booking", employee_id, f"overlaps {shift.start:%a %H:%M}")
            )
            break

    # 2. Overtime: would push the ISO-week total over the cap.
    week_hours = _week_hours(proposed.start, existing) + proposed.hours
    if week_hours > MAX_WEEKLY_HOURS:
        conflicts.append(
            Conflict("overtime", employee_id, f"week total {week_hours:.1f}h > {MAX_WEEKLY_HOURS}h")
        )

    # 3. Availability: outside any declared availability window.
    if availability is not None and not availability.can_cover(proposed):
        conflicts.append(Conflict("unavailable", employee_id, "outside availability"))

    return conflicts


def _week_hours(when: dt.datetime, shifts: list[TimeWindow]) -> float:
    """Total hours already scheduled in the ISO week containing `when`."""
    target_week = when.isocalendar()[:2]  # (year, week)
    return sum(s.hours for s in shifts if s.start.isocalendar()[:2] == target_week)


def assign_if_clear(
    employee_id: int,
    proposed: TimeWindow,
    existing: list[TimeWindow],
    availability: Availability | None = None,
) -> tuple[bool, list[Conflict]]:
    """Assign the shift only when there are zero conflicts."""
    conflicts = detect_conflicts(employee_id, proposed, existing, availability)
    if conflicts:
        return False, conflicts
    existing.append(proposed)
    return True, []
