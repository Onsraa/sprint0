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
