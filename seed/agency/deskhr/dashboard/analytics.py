"""analytics.py — headcount, utilization, and attrition aggregates.

Pure read-side functions over the employee/shift tables. Each returns plain
dicts that the Next.js dashboard renders as widgets/charts.
"""

from __future__ import annotations

import datetime as dt

from django.db.models import Count, Q, Sum

from models.employee import Employee, Shift


def headcount_by_department(as_of: dt.date | None = None) -> list[dict]:
    """Active headcount grouped by department."""
    as_of = as_of or dt.date.today()
    rows = (
        Employee.objects.filter(
            hired_at__lte=as_of,
        )
        .filter(Q(terminated_at__isnull=True) | Q(terminated_at__gt=as_of))
        .values("department__name")
        .annotate(headcount=Count("id"))
        .order_by("-headcount")
    )
    return [{"department": r["department__name"] or "Unassigned", "headcount": r["headcount"]} for r in rows]


def utilization(start: dt.datetime, end: dt.datetime) -> list[dict]:
    """Scheduled hours vs contracted hours per employee over a window.

    utilization = scheduled_hours / (contract_hours * weeks_in_window)
    """
    weeks = max((end - start).days / 7, 0.1)
    results = []

    for emp in Employee.objects.filter(terminated_at__isnull=True):
        scheduled = (
            Shift.objects.filter(employee=emp, starts_at__gte=start, ends_at__lte=end)
            .annotate(hours=(Sum("ends_at") - Sum("starts_at")))  # see note
            .count()
        )
        # Sum durations in Python for clarity (DB duration math varies by backend).
        total_hours = sum(
            s.duration_hours
            for s in Shift.objects.filter(employee=emp, starts_at__gte=start, ends_at__lte=end)
        )
        capacity = float(emp.weekly_contract_hours) * weeks
        results.append(
            {
                "employee_id": emp.id,
                "name": emp.full_name,
                "scheduled_hours": round(total_hours, 1),
                "capacity_hours": round(capacity, 1),
                "utilization_pct": round(100 * total_hours / capacity, 1) if capacity else 0.0,
            }
        )
    return sorted(results, key=lambda r: r["utilization_pct"], reverse=True)


def attrition_rate(start: dt.date, end: dt.date) -> dict:
    """Terminations in the window over average headcount — a classic HR metric."""
    leavers = Employee.objects.filter(
        terminated_at__gte=start, terminated_at__lte=end
    ).count()
    start_count = Employee.objects.filter(
        hired_at__lte=start
    ).filter(Q(terminated_at__isnull=True) | Q(terminated_at__gt=start)).count()
    end_count = Employee.objects.filter(
        hired_at__lte=end
    ).filter(Q(terminated_at__isnull=True) | Q(terminated_at__gt=end)).count()

    avg_headcount = max((start_count + end_count) / 2, 1)
    return {
        "leavers": leavers,
        "avg_headcount": round(avg_headcount, 1),
        "attrition_pct": round(100 * leavers / avg_headcount, 1),
    }
