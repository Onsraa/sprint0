"""Phase E consent/apply layer — endpoint guards + status transitions + solver action routing.
Endpoints are async; we drive them directly with asyncio.run + an explicit `member` (bypassing the
auth Depends), and monkeypatch the rag/notify/team seams so no Atlas/Vertex is touched."""
import asyncio

import pytest
from fastapi import HTTPException

from app import main
from app.contracts import DeveloperProfile


def _dev(u, role="developer", disc="backend"):
    return DeveloperProfile(name=u, gitlab_username=u, skills_text="", username=u, role=role, discipline=disc)


MGR = _dev("Onsraa", role="manager", disc=None)
SE = _dev("sprint0-se", disc="backend")
FE = _dev("sprint0-fe", disc="frontend")


def _prop(status="proposed", action="reassign", affected=None, reassign_to="sprint0-fe"):
    return {
        "id": "rsp_1", "project_id": 1,
        "strategy": {"action": action, "target_task_ids": ["t1"], "reassign_to": reassign_to,
                     "rationale": "x", "confidence": 80, "impact_summary": "moved"},
        "affected_users": ["sprint0-se"] if affected is None else affected,
        "status": status,
    }


# ── apply / reject endpoints: guards + transitions ──
@pytest.fixture
def patched(monkeypatch):
    state = {"prop": _prop(), "updates": [], "notifs": [], "applied": 0}

    async def _get(_pid):
        return state["prop"]

    async def _update(_pid, patch):
        state["updates"].append(patch)

    async def _notify(uid, typ, _title, **_kw):
        state["notifs"].append((uid, typ))

    async def _apply(_prop):
        state["applied"] += 1
        return [{"id": "t1"}]

    monkeypatch.setattr(main, "get_reschedule_proposal", _get)
    monkeypatch.setattr(main, "update_reschedule_proposal", _update)
    monkeypatch.setattr(main, "notify", _notify)
    monkeypatch.setattr(main, "_apply_strategy", _apply)
    return state


def test_apply_marks_applied_and_notifies(patched):
    patched["prop"] = _prop(action="reassign", affected=["sprint0-se"])
    res = asyncio.run(main.apply_reschedule("rsp_1", member=MGR))
    assert res["status"] == "applied" and res["action"] == "reassign" and res["flagged_manual"] is False
    assert patched["applied"] == 1
    assert any(p.get("status") == "applied" for p in patched["updates"])
    assert ("sprint0-se", "reschedule_resolved") in patched["notifs"]


def test_apply_flags_manual_for_re_plan(patched):
    patched["prop"] = _prop(action="re_plan")
    res = asyncio.run(main.apply_reschedule("rsp_1", member=MGR))
    assert res["flagged_manual"] is True and res["status"] == "applied"


def test_apply_404_when_missing(patched):
    patched["prop"] = {}
    with pytest.raises(HTTPException) as e:
        asyncio.run(main.apply_reschedule("nope", member=MGR))
    assert e.value.status_code == 404


def test_apply_403_for_unrelated_dev(patched):
    patched["prop"] = _prop(affected=["sprint0-se"])   # FE is neither manager nor affected
    with pytest.raises(HTTPException) as e:
        asyncio.run(main.apply_reschedule("rsp_1", member=FE))
    assert e.value.status_code == 403
    assert patched["applied"] == 0


def test_apply_409_when_already_resolved(patched):
    patched["prop"] = _prop(status="applied")
    with pytest.raises(HTTPException) as e:
        asyncio.run(main.apply_reschedule("rsp_1", member=MGR))
    assert e.value.status_code == 409


def test_affected_member_can_apply(patched):
    patched["prop"] = _prop(affected=["sprint0-se"])
    res = asyncio.run(main.apply_reschedule("rsp_1", member=SE))   # affected, non-manager
    assert res["status"] == "applied"


def test_reject_marks_rejected_without_applying(patched):
    patched["prop"] = _prop()
    res = asyncio.run(main.reject_reschedule("rsp_1", member=MGR))
    assert res["status"] == "rejected"
    assert any(p.get("status") == "rejected" for p in patched["updates"])
    assert patched["applied"] == 0   # reject must NOT run the solver


def test_reject_409_when_already_resolved(patched):
    patched["prop"] = _prop(status="rejected")
    with pytest.raises(HTTPException) as e:
        asyncio.run(main.reject_reschedule("rsp_1", member=MGR))
    assert e.value.status_code == 409


# ── _apply_strategy: deterministic action routing ──
@pytest.fixture
def solver(monkeypatch):
    calls = {"updates": []}

    async def _get_task(tid):
        return {"id": tid}

    async def _update_task(tid, patch):
        calls["updates"].append(patch)

    async def _empty():
        return []

    async def _ensure():
        return None

    monkeypatch.setattr(main, "get_task", _get_task)
    monkeypatch.setattr(main, "update_task", _update_task)
    monkeypatch.setattr(main, "all_tasks", _empty)
    monkeypatch.setattr(main, "all_events", _empty)
    monkeypatch.setattr(main.team, "ensure_loaded", _ensure)
    monkeypatch.setattr(main.team, "all_members", lambda: [])
    return calls


def test_solver_reassign_sets_new_assignee(solver):
    prop = {"event": {}, "strategy": {"action": "reassign", "target_task_ids": ["t1"], "reassign_to": "sprint0-fe"}}
    asyncio.run(main._apply_strategy(prop))
    assert any(p.get("assignee") == "sprint0-fe" for p in solver["updates"])


def test_solver_re_plan_does_not_mutate_tasks(solver):
    # The honesty contract: re_plan is flagged-for-manual, never a faked task change.
    prop = {"event": {}, "strategy": {"action": "re_plan", "target_task_ids": ["t1"]}}
    asyncio.run(main._apply_strategy(prop))
    assert not any(p.get("assignee") or p.get("status") == "blocked" for p in solver["updates"])


def test_solver_descope_blocks_task(solver):
    prop = {"event": {}, "strategy": {"action": "descope", "target_task_ids": ["t1"]}}
    asyncio.run(main._apply_strategy(prop))
    assert any(p.get("status") == "blocked" for p in solver["updates"])


def test_solver_re_estimate_sets_estimate(solver):
    prop = {"event": {"payload": {"new": 6.0}}, "strategy": {"action": "re_estimate", "target_task_ids": ["t1"]}}
    asyncio.run(main._apply_strategy(prop))
    assert any(p.get("estimate_days") == 6.0 for p in solver["updates"])
