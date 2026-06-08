"""GraphStore — the swappable persistence seam for the Living Project Graph (events + bitemporal graph).

Today: `MongoGraphStore`, backed by the MongoDB-MCP layer in rag.py — so the "MongoDB = the brain" partner
showcase stays intact. The ABC is the SWAP point: a `Neo4jGraphStore` / `XtdbGraphStore` can implement the
same interface post-hackathon without touching any caller (swap the `store` singleton). New Living-Project-
Graph code goes THROUGH `store`; legacy graph/event code keeps calling rag directly (strangler-fig).

Bitemporal model: a node/edge is a VERSION. `valid_from <= T < valid_to` is when it was true; the CURRENT
view is versions with `valid_to is None`. Supersede/tombstone CLOSES a version (sets valid_to) rather than
deleting — history stays queryable via `as_of`.
"""
from __future__ import annotations

import abc

from app import rag


def visible_at(row: dict, as_of: str | None) -> bool:
    """Bitemporal visibility (pure). Current view (as_of=None) = open versions (valid_to is None). Historical
    view = valid_from <= as_of < valid_to. ISO-8601 strings sort lexicographically → string compare is exact.
    Rows lacking bitemporal keys (legacy/seed) read as current/always — backward compatible."""
    vt = row.get("valid_to")
    vf = row.get("valid_from") or ""
    if as_of is None:
        return vt is None
    if vf and as_of < vf:
        return False
    if vt is not None and as_of >= vt:
        return False
    return True


class GraphStore(abc.ABC):
    """The swap seam. Async so a remote-DB adapter (Neo4j/XTDB) drops in without changing callers."""

    # ── event log (the spine) ──
    @abc.abstractmethod
    async def append_event(self, event: dict) -> None: ...
    @abc.abstractmethod
    async def events(self, limit: int = 1000) -> list[dict]: ...

    # ── graph (bitemporal) ──
    @abc.abstractmethod
    async def add_nodes(self, nodes: list[dict]) -> None: ...
    @abc.abstractmethod
    async def add_edges(self, edges: list[dict]) -> None: ...
    @abc.abstractmethod
    async def replace_partition(self, nodes: list[dict], edges: list[dict], project_id: str) -> None: ...
    @abc.abstractmethod
    async def nodes(self, project_id: str = "local", as_of: str | None = None) -> list[dict]: ...
    @abc.abstractmethod
    async def edges(self, project_id: str = "local", as_of: str | None = None) -> list[dict]: ...
    @abc.abstractmethod
    async def close_node(self, path: str, project_id: str, patch: dict) -> None: ...


class MongoGraphStore(GraphStore):
    """MongoDB-MCP-backed (via rag.py, which already bifurcates demo vs Atlas). The default store."""

    async def append_event(self, event: dict) -> None:
        await rag.save_event(event)

    async def events(self, limit: int = 1000) -> list[dict]:
        return await rag.all_events(limit=limit)

    async def add_nodes(self, nodes: list[dict]) -> None:
        await rag.add_graph_nodes(nodes)

    async def add_edges(self, edges: list[dict]) -> None:
        await rag.add_graph_edges(edges)

    async def replace_partition(self, nodes: list[dict], edges: list[dict], project_id: str) -> None:
        await rag.save_graph(nodes, edges, project_id)

    async def nodes(self, project_id: str = "local", as_of: str | None = None) -> list[dict]:
        return [n for n in await rag.graph_nodes(project_id) if visible_at(n, as_of)]

    async def edges(self, project_id: str = "local", as_of: str | None = None) -> list[dict]:
        return [e for e in await rag.graph_edges(project_id) if visible_at(e, as_of)]

    async def close_node(self, path: str, project_id: str, patch: dict) -> None:
        await rag.close_graph_node(path, project_id, patch)


store: GraphStore = MongoGraphStore()  # the singleton seam — swap THIS line to adopt Neo4j/XTDB later
