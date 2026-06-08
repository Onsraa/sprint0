"""Guards added in the 2026-06-07 audit wave: the GitLab webhook (demo-guard + fail-closed secret),
manager-only auth on the mid-wizard brief endpoints, and the project-namespaced demo task store
(no cross-project clobber). Driven directly (no TestClient) — the guards live in the function bodies /
the dependency, so we exercise them with asyncio.run + monkeypatched demo, matching the repo's test style."""
import asyncio

import pytest
from fastapi import HTTPException

from app import auth, demo, main, rag
from app.contracts import DeveloperProfile


def _dev(username, role, discipline=None):
    return DeveloperProfile(name=username, gitlab_username=username, username=username,
                            skills_text="", role=role, discipline=discipline)


class _Req:
    """Minimal stand-in for a FastAPI Request — enough for the webhook's header/secret guards, which
    fire before the body is read."""
    def __init__(self, headers=None):
        self.headers = headers or {}

    async def json(self):
        return {}


# ── GitLab webhook: demo-guard + fail-closed secret (commit eb60348) ──────────────────────────────
def test_webhook_403_in_demo(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    demo.set_live(False)
    with pytest.raises(HTTPException) as e:
        asyncio.run(main.gitlab_webhook(_Req()))
    assert e.value.status_code == 403            # public demo never receives real GitLab webhooks


def test_webhook_401_fail_closed_when_secret_unset(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", False)   # live
    monkeypatch.delenv("GITLAB_WEBHOOK_SECRET", raising=False)
    with pytest.raises(HTTPException) as e:
        asyncio.run(main.gitlab_webhook(_Req()))
    assert e.value.status_code == 401            # unconfigured secret = reject (no more fail-open)


def test_webhook_401_on_bad_token(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", False)
    monkeypatch.setenv("GITLAB_WEBHOOK_SECRET", "s3cret")
    with pytest.raises(HTTPException) as e:
        asyncio.run(main.gitlab_webhook(_Req(headers={"X-Gitlab-Token": "wrong"})))
    assert e.value.status_code == 401


# ── Manager-only auth guard the mid-wizard brief endpoints use (commit f021b6e) ───────────────────
def test_current_manager_blocks_non_manager():
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth.current_manager(member=_dev("sprint0-fe", "developer", "frontend")))
    assert e.value.status_code == 403


def test_current_manager_allows_manager():
    m = _dev("Onsraa", "manager")
    assert asyncio.run(auth.current_manager(member=m)) is m


# ── Demo task store namespaced by project — no cross-project clobber (commit 3b9d708) ─────────────
def test_demo_task_store_namespaced_by_project(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    demo.set_live(False)

    async def run():
        rag.reset_demo_tasks()
        # two projects, IDENTICAL task id (the canned-plan reuse that used to clobber)
        await rag.save_tasks([{"id": "t1", "project_id": 9001, "title": "A"}])
        await rag.save_tasks([{"id": "t1", "project_id": 9002, "title": "B"}])
        return (await rag.all_tasks(),
                await rag.tasks_for_project(9001),
                await rag.tasks_for_project(9002))

    all_tasks, p1, p2 = asyncio.run(run())
    assert sorted(t["project_id"] for t in all_tasks) == [9001, 9002]   # both coexist
    assert len(p1) == 1 and p1[0]["title"] == "A"                       # isolated per project
    assert len(p2) == 1 and p2[0]["title"] == "B"
