"""code_search_expanded — discipline-filtered retrieval + 1-hop import-graph expansion (fake MCP, no Atlas)."""
import asyncio

from app.rag import code_search_expanded

_VEC = [0.1] * 4


class FakeM:
    """Duck-typed MongoMCP: canned per-discipline hits, canned edge/chunk finds, call log."""

    def __init__(self, hits_by_disc: dict, edges: list[dict], chunks: list[dict], find_raises: bool = False):
        self.hits_by_disc, self.edges, self.chunks, self.find_raises = hits_by_disc, edges, chunks, find_raises
        self.calls: list[tuple] = []

    async def code_search(self, query_vec, k=5, projection=None, discipline=None, min_score=None):
        self.calls.append(("code_search", discipline))
        return [dict(h) for h in self.hits_by_disc.get(discipline, [])][:k]

    async def find(self, collection, projection=None, query=None, limit=20):
        self.calls.append(("find", collection))
        if self.find_raises:
            raise RuntimeError("graph collection unavailable")
        if collection == "GraphEdges":
            sp = set((query.get("$or") or [{}])[0].get("from_path", {}).get("$in", []))
            return [e for e in self.edges if e["from_path"] in sp or e["to_path"] in sp]
        wanted = set(query.get("file_path", {}).get("$in", []))
        return [c for c in self.chunks if c["file_path"] in wanted][:limit]


_HIT = {"project": "quantapay-2024", "file_path": "payments/server.js", "excerpt": "x", "web_url": "u"}
_EDGES = [{"from_path": "payments/server.js", "to_path": "payments/stripeClient.js"},
          {"from_path": "routes/api.js", "to_path": "payments/server.js"}]
_CHUNKS = [{"project": "quantapay-2024", "file_path": "payments/stripeClient.js", "excerpt": "s"},
           {"project": "quantapay-2024", "file_path": "routes/api.js", "excerpt": "r"}]


def test_expansion_marks_linked_neighbors_both_directions():
    m = FakeM({None: [_HIT]}, _EDGES, _CHUNKS)
    out = asyncio.run(code_search_expanded(m, _VEC, k=5))
    assert out[0] == _HIT and "linked" not in out[0]
    linked = {r["file_path"] for r in out if r.get("linked")}
    assert linked == {"payments/stripeClient.js", "routes/api.js"}  # dependency + dependent


def test_filtered_zero_hits_stays_empty():
    # STRICT per-gate retrieval: nothing in-lane → NOTHING (no cross-lane fallback) — the memory option
    # degrades to fresh + write-your-own instead of citing another lane's files on this gate.
    m = FakeM({None: [_HIT], "uiux": []}, [], [])
    out = asyncio.run(code_search_expanded(m, _VEC, k=5, discipline="uiux"))
    assert [c for c in m.calls if c[0] == "code_search"] == [("code_search", "uiux")]
    assert out == []


def test_filtered_hits_skip_retry():
    m = FakeM({"backend": [_HIT]}, [], [])
    asyncio.run(code_search_expanded(m, _VEC, k=5, discipline="backend"))
    assert [c for c in m.calls if c[0] == "code_search"] == [("code_search", "backend")]


def test_cap_k_plus_5():
    edges = [{"from_path": "payments/server.js", "to_path": f"n{i}.js"} for i in range(10)]
    chunks = [{"project": "quantapay-2024", "file_path": f"n{i}.js", "excerpt": ""} for i in range(10)]
    hits = {None: [_HIT] * 5}
    out = asyncio.run(code_search_expanded(FakeM(hits, edges, chunks), _VEC, k=5))
    assert len(out) <= 10  # k + 5 hard cap
    assert sum(1 for r in out if r.get("linked")) <= 5


def test_expansion_failure_degrades_to_plain_hits():
    m = FakeM({None: [_HIT]}, _EDGES, _CHUNKS, find_raises=True)
    out = asyncio.run(code_search_expanded(m, _VEC, k=5))
    assert out == [_HIT]  # graph trouble never blocks retrieval
