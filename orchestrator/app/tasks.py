"""Pure task logic — no I/O. Converts plans into persistent Tasks, derives status, and applies
permission-checked edits. Persistence lives in rag.py; endpoints in main.py. (Phase A.)"""
from __future__ import annotations

from app.contracts import PlanJSON, Task


def materialize_tasks(plan: PlanJSON, project_id: int, now: str) -> list[Task]:
    """Each plan issue → a Task. assigned_by='ai' (the assignment engine placed it)."""
    out: list[Task] = []
    for epic in plan.epics:
        for i in epic.issues:
            out.append(Task(
                id=i.id, project_id=project_id, title=i.title, description=i.description,
                discipline=i.discipline, assignee=i.assignee, assigned_by="ai",
                estimate_days=i.estimate_days, risk=i.risk, depends_on=list(i.depends_on),
                context_scope=i.context_scope, created_at=now, updated_at=now,
            ))
    return out


ASSIGNEE_FIELDS = {"title", "description", "estimate_days", "risk", "context_scope", "status"}
ALL_FIELDS = ASSIGNEE_FIELDS | {"assignee", "discipline", "depends_on", "priority",
                                "scheduled_start", "scheduled_end"}


def can_edit(task: Task, *, editor_role: str, editor_user: str | None, editor_discipline: str | None) -> set[str]:
    """Return the set of fields this editor may change on this task ({} = none)."""
    if editor_role == "manager":
        return set(ALL_FIELDS)
    if editor_discipline and editor_discipline == task.discipline:   # discipline lead
        return set(ALL_FIELDS)
    if editor_user and editor_user == task.assignee:                  # the assignee
        return set(ASSIGNEE_FIELDS)
    return set()


def apply_edit(task: Task, patch: dict, *, editor_role: str, editor_user: str | None,
               editor_discipline: str | None, now: str) -> Task:
    allowed = can_edit(task, editor_role=editor_role, editor_user=editor_user, editor_discipline=editor_discipline)
    bad = set(patch) - allowed
    if bad:
        raise PermissionError(f"not allowed to edit {sorted(bad)}")
    data = task.model_dump()
    data.update(patch)
    data["updated_at"] = now
    return Task(**data)


_STATUSES = {"planned", "in_progress", "in_review", "done", "blocked"}


def claim(task: Task, *, user: str, now: str) -> Task:
    d = task.model_dump()
    d.update(assignee=user, assigned_by="self", updated_at=now)
    return Task(**d)


def release(task: Task, *, now: str) -> Task:
    d = task.model_dump()
    d.update(assignee=None, assigned_by="ai", updated_at=now)
    return Task(**d)


def set_status(task: Task, status: str, *, now: str) -> Task:
    if status not in _STATUSES:
        raise ValueError(f"bad status {status}")
    d = task.model_dump()
    d.update(status=status, updated_at=now)
    return Task(**d)
