"""Living Project Graph P1 — GraphStore seam: bitemporal visibility (pure) + a demo round-trip + events."""
import asyncio

from app import demo, rag
from app.graphstore import store, visible_at


def test_visible_at_current_view():
    assert visible_at({"valid_to": None}, None) is True                       # open version = current
    assert visible_at({"valid_to": "2026-06-07T00:00:00Z"}, None) is False    # closed = not current
    assert visible_at({}, None) is True                                       # legacy/seed (no keys) = current


def test_visible_at_as_of_window():
    row = {"valid_from": "2026-01-01", "valid_to": "2026-06-01"}
    assert visible_at(row, "2026-03-01") is True                              # inside the window
    assert visible_at(row, "2025-12-31") is False                            # before it existed
    assert visible_at(row, "2026-06-01") is False                            # at/after close (half-open)
    assert visible_at(row, "2026-07-01") is False
    assert visible_at({"valid_from": "2026-01-01", "valid_to": None}, "2026-09-09") is True  # still-open, any later T


def test_store_bitemporal_supersede_roundtrip(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    rag.reset_demo_graph()

    async def scenario():
        await store.add_nodes([{"path": "feat:x", "project_id": "p", "node_type": "feature",
                                "content_hash": "sha256:v1", "valid_from": "2026-01-01", "valid_to": None}])
        assert [n["content_hash"] for n in await store.nodes("p")] == ["sha256:v1"]

        # a FIX: close v1 at T, append v2 open-ended
        await store.close_node("feat:x", "p", {"valid_to": "2026-06-01"})
        await store.add_nodes([{"path": "feat:x", "project_id": "p", "node_type": "feature",
                                "content_hash": "sha256:v2", "valid_from": "2026-06-01", "valid_to": None}])

        assert [n["content_hash"] for n in await store.nodes("p")] == ["sha256:v2"]              # current = the fix
        assert [n["content_hash"] for n in await store.nodes("p", as_of="2026-03-01")] == ["sha256:v1"]  # past = old
        assert [n["content_hash"] for n in await store.nodes("p", as_of="2026-09-01")] == ["sha256:v2"]  # after fix = v2

    asyncio.run(scenario())
    rag.reset_demo_graph()


def test_store_tombstone_keeps_history(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    rag.reset_demo_graph()

    async def scenario():
        await store.add_nodes([{"path": "feat:gone", "project_id": "lineage", "node_type": "feature",
                                "content_hash": "sha256:g", "valid_from": "2026-01-01", "valid_to": None}])
        assert len(await store.nodes("lineage")) == 1                          # present in current view
        # retire (tombstone): close the current version
        await store.close_node("feat:gone", "lineage", {"valid_to": "2026-06-01", "deleted": True})
        assert await store.nodes("lineage") == []                             # gone from current
        past = await store.nodes("lineage", as_of="2026-03-01")               # but history survives
        assert [n["content_hash"] for n in past] == ["sha256:g"]

    asyncio.run(scenario())
    rag.reset_demo_graph()


def test_store_event_spine_roundtrip(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    rag.reset_demo_events()

    async def scenario():
        await store.append_event({"id": "ev_p1", "kind": "source_changed", "created_at": "t", "payload": {}})
        evs = await store.events()
        assert [e["id"] for e in evs] == ["ev_p1"]

    asyncio.run(scenario())
    rag.reset_demo_events()
