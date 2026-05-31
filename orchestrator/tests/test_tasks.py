from app.contracts import Task, ContextScope


def test_task_defaults():
    t = Task(
        id="t1", project_id=1, title="Auth API", description="build it",
        discipline="backend", estimate_days=3, risk="medium",
        context_scope=ContextScope(files=["api/auth.py"]),
        created_at="2026-05-28T00:00:00Z", updated_at="2026-05-28T00:00:00Z",
    )
    assert t.status == "planned"
    assert t.priority == "normal"
    assert t.assigned_by == "ai"
    assert t.assignee is None
    assert t.scheduled_start is None and t.scheduled_end is None
    assert t.gitlab_issue_iid is None


from app import tasks as T
from app.contracts import PlanJSON, Epic, Issue, TechStack


def _issue(i, t, assignee=None, deps=None):
    return Issue(id=i, title=i.upper(), description="d", type=t, estimate_days=2, risk="low",
                 required_skill="", context_scope=ContextScope(files=[f"{i}.py"]),
                 assignee=assignee, depends_on=deps or [])


def _plan():
    return PlanJSON(project_name="HomeHero", client_summary="", grounded_on=[], timeline_weeks=4,
                    tech_stack=TechStack(frontend="React", backend="Py", db="PG", infra="-"),
                    epics=[Epic(id="e1", title="E", issues=[_issue("b1", "backend", "sprint0-se"),
                                                            _issue("f1", "frontend", deps=["b1"])])])


def test_materialize_maps_issues_to_tasks():
    out = T.materialize_tasks(_plan(), project_id=42, now="2026-05-28T00:00:00Z")
    assert len(out) == 2
    b1 = next(t for t in out if t.id == "b1")
    assert b1.project_id == 42 and b1.discipline == "backend"
    assert b1.assignee == "sprint0-se" and b1.assigned_by == "ai"   # had an assignee → AI-attributed
    f1 = next(t for t in out if t.id == "f1")
    assert f1.assignee is None and f1.assigned_by == "ai" and f1.depends_on == ["b1"]
    assert f1.status == "planned" and f1.created_at == "2026-05-28T00:00:00Z"


import pytest


def _task(**kw):
    base = dict(id="t1", project_id=1, title="x", description="d", discipline="backend",
                estimate_days=1, risk="low", context_scope=ContextScope(files=[]),
                created_at="t", updated_at="t")
    base.update(kw)
    return Task(**base)


def test_manager_can_edit_any_field():
    t = _task(assignee="sprint0-fe")
    out = T.apply_edit(t, {"assignee": "sprint0-se", "risk": "high"},
                       editor_role="manager", editor_user="Onsraa", editor_discipline=None, now="N")
    assert out.assignee == "sprint0-se" and out.risk == "high" and out.updated_at == "N"


def test_assignee_cannot_reassign_others():
    t = _task(assignee="sprint0-fe")
    with pytest.raises(PermissionError):
        T.apply_edit(t, {"assignee": "sprint0-se"},
                     editor_role="developer", editor_user="sprint0-fe", editor_discipline="frontend", now="N")


def test_assignee_can_edit_own_detail():
    t = _task(assignee="sprint0-fe")
    out = T.apply_edit(t, {"description": "new"},
                       editor_role="developer", editor_user="sprint0-fe", editor_discipline="frontend", now="N")
    assert out.description == "new"


def test_non_owner_blocked():
    t = _task(assignee="sprint0-fe", discipline="backend")
    with pytest.raises(PermissionError):
        T.apply_edit(t, {"title": "x"},
                     editor_role="developer", editor_user="gabinvr", editor_discipline="qa", now="N")


def test_claim_sets_self_and_assignee():
    out = T.claim(_task(assignee=None), user="sprint0-fe", now="N")
    assert out.assignee == "sprint0-fe" and out.assigned_by == "self"


def test_release_clears_assignee():
    out = T.release(_task(assignee="sprint0-fe", assigned_by="self"), now="N")
    assert out.assignee is None and out.assigned_by == "ai"


def test_set_status_valid():
    out = T.set_status(_task(), "in_progress", now="N")
    assert out.status == "in_progress"


def test_set_status_invalid_raises():
    with pytest.raises(ValueError):
        T.set_status(_task(), "shipped", now="N")
