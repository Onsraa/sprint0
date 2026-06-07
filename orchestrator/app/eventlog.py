"""Event log — the spine of the Living Project Graph. Append-only, monotonically sequenced, replayable.

`emit()` is the single write path (stamps id / seq / tx_time, appends through the GraphStore seam). `replay()`
folds the log through a `Projection` to rebuild a read-model deterministically — the basis for the durable
runtime (P8) and a generalization of the reflow engine. Strangler-fig: new code emits through here; the legacy
reflow emitters keep calling rag.save_event until migrated.

`created_at` is passed in by callers (this codebase stamps time at the edge, never deep in a pure core).
Seq note: in demo/single-process it's `len(log)+1`; a remote adapter would use a DB sequence — the seam hides it.
"""
from __future__ import annotations

import uuid
from typing import Any, Callable

from app.graphstore import store


async def emit(kind: str, *, created_at: str, seq: int | None = None, **fields: Any) -> dict:
    """Build + stamp + append ONE event, returning it. Monotonic seq lets projections replay since a cursor."""
    if seq is None:
        seq = len(await store.events(limit=1_000_000)) + 1
    ev = {"id": f"ev_{uuid.uuid4().hex[:10]}", "kind": kind, "seq": seq,
          "created_at": created_at, "tx_time": created_at, **fields}
    await store.append_event(ev)
    return ev


# A Projection is just (initial_state, reducer). reducer(state, event) -> state, and MUST be pure/deterministic.
Reducer = Callable[[Any, dict], Any]


async def replay(initial: Any, reduce: Reducer, *, since: int = 0, limit: int = 1_000_000) -> Any:
    """Fold the event log (events with seq > `since`, in seq order) through `reduce` → the rebuilt state.
    Deterministic: same log + same reducer → same state. This is how a projection (runtime, schedule, graph)
    is reconstructed from the spine."""
    state = initial
    for ev in sorted(await store.events(limit=limit), key=lambda e: e.get("seq", 0)):
        if ev.get("seq", 0) > since:
            state = reduce(state, ev)
    return state
