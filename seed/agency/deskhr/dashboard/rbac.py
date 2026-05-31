"""rbac.py — role-based access control.

A small permission matrix plus a view decorator. The same PERMISSIONS map is
exported to the frontend so `web/Dashboard.tsx` can hide widgets the viewer
isn't allowed to see (defense-in-depth: the API still enforces it here).
"""

from __future__ import annotations

import functools

from django.http import JsonResponse

from models.employee import Role


class Permission:
    VIEW_OWN_SCHEDULE = "view_own_schedule"
    VIEW_TEAM_ANALYTICS = "view_team_analytics"
    VIEW_COMPANY_ANALYTICS = "view_company_analytics"
    EDIT_SCHEDULE = "edit_schedule"
    MANAGE_EMPLOYEES = "manage_employees"


# Role -> set of permissions. Higher roles are supersets, kept explicit for clarity.
PERMISSIONS: dict[str, set[str]] = {
    Role.EMPLOYEE: {
        Permission.VIEW_OWN_SCHEDULE,
    },
    Role.MANAGER: {
        Permission.VIEW_OWN_SCHEDULE,
        Permission.VIEW_TEAM_ANALYTICS,
        Permission.EDIT_SCHEDULE,
    },
    Role.HR_ADMIN: {
        Permission.VIEW_OWN_SCHEDULE,
        Permission.VIEW_TEAM_ANALYTICS,
        Permission.VIEW_COMPANY_ANALYTICS,
        Permission.EDIT_SCHEDULE,
        Permission.MANAGE_EMPLOYEES,
    },
}


def has_permission(role: str, permission: str) -> bool:
    return permission in PERMISSIONS.get(role, set())


def require_permission(permission: str):
    """Decorator for Django views. Expects request.user.employee with a `.role`."""

    def decorator(view_func):
        @functools.wraps(view_func)
        def wrapper(request, *args, **kwargs):
            employee = getattr(request.user, "employee", None)
            if employee is None:
                return JsonResponse({"error": "unauthenticated"}, status=401)
            if not has_permission(employee.role, permission):
                return JsonResponse({"error": "forbidden", "need": permission}, status=403)
            return view_func(request, *args, **kwargs)

        return wrapper

    return decorator
