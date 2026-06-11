"""Durable session state — write-through + load round-trip (the production-persistence foundation, D0)."""
import asyncio

from app import demo, rag


def test_save_load_delete_state_roundtrip(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    rag.reset_demo_session()

    async def scenario():
        await rag.save_state("briefs", "b1", {"v": "hello"})
        await rag.save_state("briefs", "b2", {"v": "world"})
        await rag.save_state("reserved", "p1", {"project_id": 9001, "web_url": "u"})
        assert await rag.load_states("briefs") == {"b1": {"v": "hello"}, "b2": {"v": "world"}}
        assert await rag.load_states("reserved") == {"p1": {"project_id": 9001, "web_url": "u"}}
        await rag.save_state("briefs", "b1", {"v": "changed"})              # upsert (overwrite)
        assert (await rag.load_states("briefs"))["b1"] == {"v": "changed"}
        await rag.delete_state("briefs", "b2")                             # delete
        assert "b2" not in await rag.load_states("briefs")
        assert await rag.load_states("nothing") == {}                     # empty store

    asyncio.run(scenario())
    rag.reset_demo_session()


def test_rehydrate_restores_inmemory_dicts(monkeypatch):
    """The production payoff: write-through snapshots → clear the live dicts → rehydrate restores them."""
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    from app import main
    rag.reset_demo_session()

    async def scenario():
        await rag.save_state("briefs", "b1", {"v": "the client brief"})
        await rag.save_state("reqa", "4201", {"v": [7, 9]})
        await rag.save_state("delta_target", "pd1", {"v": 4201})
        await rag.save_state("attributions", "_all", {"v": [{"id": "att_1", "gitlab_username": "x"}]})
        main.BRIEFS.clear(); main.REQA.clear(); main.DELTA_TARGET.clear(); main.ATTRIBUTIONS.clear()
        await main._rehydrate_session()                                   # the restart-recovery path
        assert main.BRIEFS["b1"] == "the client brief"
        assert main.REQA[4201] == {7, 9}
        assert main.DELTA_TARGET["pd1"] == 4201
        assert main.ATTRIBUTIONS == [{"id": "att_1", "gitlab_username": "x"}]

    asyncio.run(scenario())
    rag.reset_demo_session()
    main.BRIEFS.clear(); main.REQA.clear(); main.DELTA_TARGET.clear(); main.ATTRIBUTIONS.clear()


def test_finished_delta_links_unpersist(monkeypatch):
    """A finished add-feature delta drops its delta_target/delta_priority from the durable snapshot at
    scaffold-close, so a restart never rehydrates a stale link (commit 0e28b75)."""
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    from app import main
    rag.reset_demo_session()

    async def scenario():
        await rag.save_state("delta_target", "pd1", {"v": 4201})
        await rag.save_state("delta_priority", "pd1", {"v": "urgent"})
        await main._unpersist("delta_target", "pd1")        # the scaffold-close cleanup loop
        await main._unpersist("delta_priority", "pd1")
        assert await rag.load_states("delta_target") == {}
        assert await rag.load_states("delta_priority") == {}

    asyncio.run(scenario())
    rag.reset_demo_session()


def test_no_draft_tasks_before_dispatch(monkeypatch):
    """Tasks are NOT materialized at plan time or on rehydrate — only at dispatch (_finalize_scaffold).
    An in-flight (un-dispatched) plan therefore has no tasks under the placeholder pid (this replaces the
    old draft-preview behavior, which surfaced unratified tasks under a negative-pid placeholder)."""
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    demo.set_live(False)
    from app import main
    rag.reset_demo_tasks()

    async def scenario():
        drafts = await rag.tasks_for_project(main._plan_pid("plan_inflight"))
        assert drafts == []                                 # nothing materialized before dispatch

    asyncio.run(scenario())
    rag.reset_demo_tasks()
