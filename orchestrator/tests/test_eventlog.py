"""Living Project Graph P2 — the event spine: emit stamps id/seq/tx_time; replay folds deterministically."""
import asyncio

from app import demo, rag, eventlog


def test_emit_stamps_and_appends(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    rag.reset_demo_events()

    async def scenario():
        ev = await eventlog.emit("source_changed", created_at="2026-06-07T00:00:00Z", payload={"x": 1})
        assert ev["seq"] == 1 and ev["kind"] == "source_changed" and ev["tx_time"] == ev["created_at"]
        assert ev["id"].startswith("ev_")
        ev2 = await eventlog.emit("task_done", created_at="2026-06-07T01:00:00Z")
        assert ev2["seq"] == 2                                            # monotonic
        assert len(await eventlog.store.events()) == 2

    asyncio.run(scenario())
    rag.reset_demo_events()


def test_replay_folds_in_seq_order(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    rag.reset_demo_events()

    async def scenario():
        for i in range(3):
            await eventlog.emit("source_changed", created_at=f"2026-06-07T0{i}:00:00Z", payload={"n": i})
        # a tiny projection: collect payload n's in order
        ns = await eventlog.replay([], lambda s, e: s + [e["payload"]["n"]])
        assert ns == [0, 1, 2]                                            # deterministic, seq-ordered
        # replay since a cursor → only later events
        tail = await eventlog.replay([], lambda s, e: s + [e["payload"]["n"]], since=2)
        assert tail == [2]

    asyncio.run(scenario())
    rag.reset_demo_events()
