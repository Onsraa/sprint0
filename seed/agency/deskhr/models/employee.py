"""employee.py — employee, role, and shift models (Django ORM).

These back both the analytics aggregates (dashboard/analytics.py) and the
scheduling engine (scheduling/calendar.py).
"""

from __future__ import annotations

from django.db import models


class Role(models.TextChoices):
    EMPLOYEE = "employee", "Employee"
    MANAGER = "manager", "Manager"
    HR_ADMIN = "hr_admin", "HR Admin"


class Department(models.Model):
    name = models.CharField(max_length=120, unique=True)

    def __str__(self) -> str:
        return self.name


class Employee(models.Model):
    full_name = models.CharField(max_length=200)
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.EMPLOYEE)
    department = models.ForeignKey(
        Department, on_delete=models.SET_NULL, null=True, related_name="employees"
    )
    manager = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="reports"
    )
    # Contracted hours per week — the denominator for utilization.
    weekly_contract_hours = models.DecimalField(max_digits=5, decimal_places=2, default=40)
    hired_at = models.DateField()
    terminated_at = models.DateField(null=True, blank=True)

    @property
    def is_active(self) -> bool:
        return self.terminated_at is None

    def __str__(self) -> str:
        return f"{self.full_name} ({self.role})"


class Shift(models.Model):
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="shifts"
    )
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    role_label = models.CharField(max_length=120, blank=True)
    published = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=["employee", "starts_at"])]
        ordering = ["starts_at"]

    @property
    def duration_hours(self) -> float:
        return (self.ends_at - self.starts_at).total_seconds() / 3600

    def overlaps(self, other: "Shift") -> bool:
        """True if this shift's time range intersects another's."""
        return self.starts_at < other.ends_at and other.starts_at < self.ends_at
