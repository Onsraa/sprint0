"""The DEMO plane — every in-memory stand-in for Atlas, in ONE place.

DEMO_MODE (app/demo.py) runs the public hosted demo with no Atlas and no real GitLab writes: the storage
functions in rag.py branch here instead of MongoDB. This module is that branch's ONLY home — the
demo/live boundary is a security boundary (auth is header-only), so it must be physically auditable:
LIVE code never touches these dicts, and a demo flow never leaves them. rag.py re-exports the reset_*
names so callers keep importing from the storage facade.

Everything here is process-local and disposable — `reset_demo_*` wipes a store back to empty; the canned
workspace (canned.py fixtures) is re-seeded on top by main._seed_demo.
"""
from __future__ import annotations

# ── the in-mem stores (one per Atlas collection the demo stands in for) ──
_DEMO_PROJECTS: dict[int, dict] = {}            # ProjectRecords — dispatched projects
_DEMO_AGREEMENTS: dict[str, dict] = {}          # Agreements — interface contracts
_DEMO_GRAPH_NODES: list[dict] = []              # GraphNodes — the lineage/feature graph
_DEMO_GRAPH_EDGES: list[dict] = []              # GraphEdges
_DEMO_NOTIFICATIONS: list[dict] = []            # Notifications — the bell feed's runtime pings
_DEMO_TASKS: dict[str, dict] = {}               # Tasks — the Work hub board
_DEMO_EVENTS: list[dict] = []                   # Events — append-ordered = chronological
_DEMO_SESSION: dict[tuple[str, str], dict] = {} # SessionState — (store, key) → value write-through


def reset_demo_projects() -> None:
    """DEMO reset/seed: drop every session-dispatched project record (only the canned workspace remains)."""
    _DEMO_PROJECTS.clear()


def reset_demo_agreements() -> None:
    """DEMO reset/seed: drop every in-mem interface contract so the canned set is the only one left."""
    _DEMO_AGREEMENTS.clear()


def reset_demo_graph() -> None:
    """DEMO reset/seed: drop the in-mem graph (lineage/feature nodes + edges) before re-seeding."""
    _DEMO_GRAPH_NODES.clear()
    _DEMO_GRAPH_EDGES.clear()


def reset_demo_notifications() -> None:
    """DEMO reset: drop session-generated notifications (the canned feed is added by the inbox endpoint)."""
    _DEMO_NOTIFICATIONS.clear()


def reset_demo_tasks() -> None:
    """DEMO reset/seed: drop every in-mem task so only the freshly re-seeded board's tasks remain."""
    _DEMO_TASKS.clear()


def reset_demo_events() -> None:
    """DEMO reset: drop the session event log."""
    _DEMO_EVENTS.clear()


def reset_demo_session() -> None:
    """DEMO reset: drop the persisted session snapshot."""
    _DEMO_SESSION.clear()
