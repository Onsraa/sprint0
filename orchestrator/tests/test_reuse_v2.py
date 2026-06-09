"""Reuse v2 — the LLM relevance judge (CRAG: verdict + reason) replaces the cosine threshold.

The judge itself is the LLM (proven LIVE: a video-game brief abstains, an e-commerce+Stripe brief reuses
quantapay where the 0.75 cosine wrongly denied it). These tests cover the DETERMINISTIC pieces: the
MemoryCandidate schema, the used-default rule, and the human-selection (Use/Skip) filter.
"""
import pytest

from app.contracts import ClarifiedSpec, MemoryCandidate
from app.reason import select_grounded


def test_memory_candidate_schema_and_closed_fit():
    c = MemoryCandidate(ref="quantapay-2024", capability="JWT auth", fit="strong", reason="fintech match")
    assert c.fit == "strong" and c.used is False             # used defaults False; judge_memory sets it from the fit
    with pytest.raises(Exception):
        MemoryCandidate(ref="x", fit="definitely")            # fit is a closed {strong, partial, skip}


def test_clarified_spec_carries_candidates():
    spec = ClarifiedSpec(goal="g", memory_candidates=[MemoryCandidate(ref="p", fit="skip", reason="no fit")])
    assert len(spec.memory_candidates) == 1 and spec.memory_candidates[0].fit == "skip"


def test_used_default_rule():
    # the rule judge_memory applies: a strong-fit capability is pre-selected (used=True), partial/skip are not
    cands = [MemoryCandidate(ref="a", fit="strong"), MemoryCandidate(ref="b", fit="partial"),
             MemoryCandidate(ref="c", fit="skip")]
    for c in cands:
        c.used = c.fit == "strong"
    assert [c.used for c in cands] == [True, False, False]


_PAST = [{"name": "quantapay-2024"}, {"name": "traillog-2025"}]
_CODE = [{"project": "quantapay-2024", "file_path": "src/server.js"},
         {"project": "traillog-2025", "file_path": "app/main.py"}]


def test_select_grounded_none_keeps_all():
    past, code = select_grounded(_PAST, _CODE, None)          # None = AI judges all (no human selection yet)
    assert len(past) == 2 and len(code) == 2


def test_select_grounded_filters_to_selection():
    past, code = select_grounded(_PAST, _CODE, ["quantapay-2024", "src/server.js"])
    assert [p["name"] for p in past] == ["quantapay-2024"]
    assert [c["file_path"] for c in code] == ["src/server.js"]


def test_select_grounded_empty_means_fresh_build():
    past, code = select_grounded(_PAST, _CODE, [])            # human skipped all → fresh build
    assert past == [] and code == []


def test_select_grounded_code_matches_qualified_ref():
    # the ref may arrive as "project · file_path" (how the agent sees it in _format_code)
    past, code = select_grounded(_PAST, _CODE, ["traillog-2025 · app/main.py"])
    assert [c["file_path"] for c in code] == ["app/main.py"]


# ── judge_memory: reuse is judged on the RESOLVED spec (after ambiguities), not the raw brief ──
def test_resolved_query_includes_the_answered_calls():
    # the manager's resolutions fold into the text we ground memory on → answers can shift the RAG
    from app.reason import _resolved_query
    spec = ClarifiedSpec.model_validate({
        "goal": "personal-finance SaaS", "must_haves": ["secure login"],
        "ambiguities": [{"id": "amb-1", "feature": "Bank sync", "question": "q",
                         "options": ["Plaid production", "Manual CSV"], "resolution": "Plaid production"}],
    })
    q = _resolved_query(spec)
    assert "personal-finance SaaS" in q and "secure login" in q and "Plaid production" in q


def test_judge_memory_grades_and_presets_used(monkeypatch):
    # judge_memory retrieves (stubbed) then grades via the memory-judge agent (demo → CANNED_MEMORY);
    # the server pre-selects reuse-verdict candidates (used=True), maybe/skip stay off.
    import asyncio
    from app import reason

    class _M:  # async-ctx MongoMCP — retrieval is stubbed; we're asserting the verdict→used rule
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def hybrid_search(self, *a, **k): return []
        async def code_search(self, *a, **k): return []
    monkeypatch.setattr(reason, "MongoMCP", _M)
    monkeypatch.setattr(reason, "embed_query", lambda q: [])

    spec = ClarifiedSpec(goal="personal-finance SaaS", must_haves=["secure login"])
    cands = asyncio.run(reason.judge_memory(spec))
    assert cands, "demo judge returns graded candidates"
    assert all(c.used == (c.fit == "strong") for c in cands)      # the used-default rule
    assert any(c.used for c in cands)                              # at least one strong-fit pre-selected
