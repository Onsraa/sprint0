"""Reuse v2 — the LLM relevance judge (CRAG: verdict + reason) replaces the cosine threshold.

The judge itself is the LLM (proven LIVE: a video-game brief abstains, an e-commerce+Stripe brief reuses
quantapay where the 0.75 cosine wrongly denied it). These tests cover the DETERMINISTIC pieces: the
MemoryCandidate schema, the used-default rule, and the human-selection (Use/Skip) filter.
"""
import pytest

from app.contracts import ClarifiedSpec, MemoryCandidate
from app.reason import select_grounded


def test_memory_candidate_schema_and_closed_verdict():
    c = MemoryCandidate(ref="quantapay-2024", kind="project", verdict="reuse", reason="fintech match")
    assert c.verdict == "reuse" and c.used is False          # used defaults False; clarify sets it from the verdict
    with pytest.raises(Exception):
        MemoryCandidate(ref="x", verdict="definitely")        # verdict is a closed {reuse, maybe, skip}


def test_clarified_spec_carries_candidates():
    spec = ClarifiedSpec(goal="g", memory_candidates=[MemoryCandidate(ref="p", verdict="skip", reason="no fit")])
    assert len(spec.memory_candidates) == 1 and spec.memory_candidates[0].verdict == "skip"


def test_used_default_rule():
    # the rule clarify_brief applies: a reuse-verdict candidate is pre-selected (used=True), maybe/skip are not
    cands = [MemoryCandidate(ref="a", verdict="reuse"), MemoryCandidate(ref="b", verdict="maybe"),
             MemoryCandidate(ref="c", verdict="skip")]
    for c in cands:
        c.used = c.verdict == "reuse"
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
