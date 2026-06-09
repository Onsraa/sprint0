"""ReAct trace recorder (app/trace.py) — pure, in-mem, best-effort. step() must be a no-op outside a run
(so untraced calls / the e2e never break), and accumulate across the wizard phases when a run is active."""
from app import trace


def test_step_is_noop_without_a_run():
    trace.end(); trace.clear()
    trace.step("gemini", "thought", "orphan step")   # no begin() → no current run → dropped
    assert trace.get("nope") == []


def test_records_to_the_current_run():
    trace.clear(); trace.begin("brief_x")
    trace.step("mongodb", "action", "vector search", "PastProjects")
    trace.step("gemini", "result", "2 candidates")
    steps = trace.get("brief_x")
    assert [s["seq"] for s in steps] == [0, 1]
    assert steps[0]["actor"] == "mongodb" and steps[1]["kind"] == "result"
    assert all("ts" in s and "label" in s for s in steps)


def test_begin_accumulates_across_phases():
    trace.clear(); trace.begin("b")
    trace.step("gemini", "thought", "clarify")
    trace.begin("b")                                  # a later wizard phase re-begins the same run
    trace.step("gemini", "action", "architect")
    assert len(trace.get("b")) == 2                    # accumulated, not reset


def test_detail_is_truncated():
    trace.clear(); trace.begin("t")
    trace.step("server", "action", "x", "y" * 500)
    assert len(trace.get("t")[0]["detail"]) == 200


def test_clear_one_run():
    trace.clear(); trace.begin("z")
    trace.step("server", "action", "x")
    trace.clear("z")
    assert trace.get("z") == []
    trace.end()


# ── plan-phase instrumentation (reason.run_brief) ──────────────────────────────
# run_brief emits the live trace the wizard's plan loader animates. We stub its heavy deps
# (Mongo · Gemini · assign) — we're asserting the instrumentation fires + accumulates, not the planner.
import asyncio
from types import SimpleNamespace

from app import reason


def _stub_run_brief_deps(monkeypatch):
    class _M:  # async-ctx MongoMCP whose hybrid_search returns no grounding
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def hybrid_search(self, *a, **k): return []
        async def find(self, *a, **k): return []   # roster fetch (WS12) — empty in the stub
    async def _labels(): return []
    async def _gen(_prompt): return SimpleNamespace(grounded_on=[], epics=[SimpleNamespace(issues=[1, 2, 3])])
    async def _noop_async(*a, **k): return None
    monkeypatch.setattr(reason, "_known_profile_labels", _labels)
    monkeypatch.setattr(reason, "MongoMCP", _M)
    monkeypatch.setattr(reason, "embed_query", lambda q: [])
    monkeypatch.setattr(reason, "generate_plan", _gen)
    monkeypatch.setattr(reason, "_build_plan_prompt", lambda *a, **k: "")
    monkeypatch.setattr(reason, "_normalize_plan_ids", lambda plan: None)
    monkeypatch.setattr(reason, "_match_and_assign", _noop_async)
    monkeypatch.setattr(reason, "_discover_profiles", _noop_async)


def test_run_brief_records_the_plan_phase_trace(monkeypatch):
    _stub_run_brief_deps(monkeypatch)
    trace.clear("b"); trace.begin("b")
    asyncio.run(reason.run_brief("build a thing"))
    steps = trace.get("b")
    labels = [s["label"] for s in steps]
    kinds = {(s["actor"], s["kind"]) for s in steps}
    assert "Retrieve grounding" in labels and "Plan the relay" in labels and "Assign + schedule" in labels
    assert ("mongodb", "action") in kinds and ("gemini", "action") in kinds
    assert any(s["kind"] == "result" for s in steps)   # the closing "N task(s) · M epic(s)" step
    trace.end()


def test_run_brief_trace_is_noop_without_a_run(monkeypatch):
    # the e2e/untraced path: run_brief must not blow up and records nothing when no run is active
    _stub_run_brief_deps(monkeypatch)
    trace.end(); trace.clear()
    asyncio.run(reason.run_brief("x"))
    assert trace.get("b") == []


def test_run_brief_reuses_the_arch_phase_grounding(monkeypatch):
    # T3: the arch phase cached its PastProjects retrieval — the plan phase must reuse it (no
    # re-fetch) and say so honestly in the trace.
    _stub_run_brief_deps(monkeypatch)
    fetches: list[int] = []

    class _M:  # counts hybrid_search calls — a cache hit means ZERO
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def hybrid_search(self, *a, **k): fetches.append(1); return []
        async def find(self, *a, **k): return []
    monkeypatch.setattr(reason, "MongoMCP", _M)

    reason._cache_grounding("the cached brief", [{"name": "quantapay-2024"}])
    trace.clear("c"); trace.begin("c")
    asyncio.run(reason.run_brief("the cached brief"))
    assert fetches == []   # no redundant $rankFusion round-trip
    labels = [s["label"] for s in trace.get("c")]
    assert "Reuse the architecture-phase grounding" in labels and "Retrieve grounding" not in labels
    trace.end()
