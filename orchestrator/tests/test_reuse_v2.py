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


def test_select_grounded_project_ref_keeps_its_code_chunks():
    # memory-candidate refs are PROJECT-level — keeping a project keeps its code chunks too
    past, code = select_grounded(_PAST, _CODE, ["quantapay-2024"])
    assert [p["name"] for p in past] == ["quantapay-2024"]
    assert [c["file_path"] for c in code] == ["src/server.js"]


# ── judge_memory: reuse is judged on the RESOLVED spec (after ambiguities), not the raw brief ──
def test_sanitize_strips_semicolons_and_dashes():
    from app.reason import _sanitize
    assert _sanitize("Fast; clean — and tidy") == "Fast. clean, and tidy"
    assert _sanitize("range 2–3 days") == "range 2-3 days"
    assert ";" not in _sanitize("a; b; c") and "—" not in _sanitize("a — b")
    assert _sanitize("") == ""


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


def test_judge_memory_snaps_refs_to_retrieved_names(monkeypatch):
    # the model's free-string ref must round-trip onto the EXACT stored project name (it is the
    # select_grounded key); a ref matching no retrieved project is left alone (the demo/canned
    # path and an abstaining judge depend on that).
    import asyncio
    from app import reason
    from app.contracts import MemoryJudgment

    class _M:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def hybrid_search(self, *a, **k): return [{"name": "quantapay-2024"}]
        async def code_search(self, *a, **k): return []
    monkeypatch.setattr(reason, "MongoMCP", _M)
    monkeypatch.setattr(reason, "embed_query", lambda q: [])

    judged = MemoryJudgment(candidates=[
        MemoryCandidate(ref="QuantaPay", capability="JWT auth", fit="strong"),
        MemoryCandidate(ref="LedgerLite", capability="CSV import", fit="partial"),
    ])

    async def _judge(prompt):
        return judged
    monkeypatch.setattr(reason, "generate_memory_judgment", _judge)

    cands = asyncio.run(reason.judge_memory(ClarifiedSpec(goal="fintech SaaS")))
    assert cands[0].ref == "quantapay-2024" and cands[0].project == "quantapay-2024"
    assert cands[0].year == "2024"                       # year backfilled from the SNAPPED name
    assert cands[1].ref == "LedgerLite"                  # no retrieved match → untouched


def test_arch_reuse_floor_retry_then_inject(monkeypatch):
    # the prompt REQUIRES >=1 card to cite the selected memory; if the model violates twice the
    # server retries once then injects a deterministic ReuseItem into card 2 (never card 1, the
    # reserved empty-reuse baseline) so the human's selection never silently vanishes.
    import asyncio
    from app import reason
    from app.contracts import ArchitectureCard, ArchitectureOptions, TechStack

    class _M:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def hybrid_search(self, *a, **k): return [{"name": "traillog-2025", "outcome_notes": "PostGIS geo queries shipped"}]
        async def find(self, *a, **k): return []
    monkeypatch.setattr(reason, "MongoMCP", _M)
    monkeypatch.setattr(reason, "embed_query", lambda q: [])

    async def _no_code(m, qv, k=5):
        return []
    monkeypatch.setattr(reason, "code_search_expanded", _no_code)

    calls = {"n": 0}
    _ts = TechStack(frontend="React", backend="FastAPI", db="Postgres", infra="Docker")

    async def _gen(prompt):
        calls["n"] += 1
        return ArchitectureOptions(cards=[
            ArchitectureCard(name="Fresh", tech_stack=_ts, summary="s", rationale="r", fit_to_constraints="f"),
            ArchitectureCard(name="Reuse-led", tech_stack=_ts, summary="s", rationale="r", fit_to_constraints="f"),
        ], ai_pick_name="Fresh")
    monkeypatch.setattr(reason, "generate_architectures", _gen)

    opts = asyncio.run(reason.propose_architectures("freight portal brief", grounded=["traillog-2025"]))
    assert calls["n"] == 2                               # exactly one retry
    assert opts.cards[0].reuse == []                     # the baseline card stays empty
    assert opts.cards[1].reuse and opts.cards[1].reuse[0].from_project == "traillog-2025"
    assert "traillog-2025" in opts.cards[1].grounded_on


def test_resolve_clarify_skips_rejudge_when_answers_unchanged(monkeypatch):
    # backing up and re-submitting the SAME answers must not re-roll the LLM judge (a re-roll
    # resamples the candidate set, shrinking/shifting the choices); a CHANGED answer re-judges.
    import asyncio
    from app import main
    from app.contracts import ClarifyResolution

    spec = ClarifiedSpec.model_validate({
        "goal": "g", "must_haves": [],
        "ambiguities": [{"id": "amb-1", "feature": "f", "question": "q",
                         "options": ["A", "B"], "resolution": "A"}],
        "memory_candidates": [{"ref": "quantapay-2024", "fit": "strong", "used": True}],
    })
    main.SPECS["b-rejudge"] = spec
    calls = {"n": 0}

    async def _judge(s):
        calls["n"] += 1
        return [MemoryCandidate(ref="traillog-2025", fit="partial")]
    monkeypatch.setattr(main, "judge_memory", _judge)   # imported by name into main — patch THERE

    try:
        out = asyncio.run(main.resolve_clarify("b-rejudge", ClarifyResolution(answers={"amb-1": "A"})))
        assert calls["n"] == 0 and out.memory_candidates[0].ref == "quantapay-2024"   # unchanged → kept
        out = asyncio.run(main.resolve_clarify("b-rejudge", ClarifyResolution(answers={"amb-1": "B"})))
        assert calls["n"] == 1 and out.memory_candidates[0].ref == "traillog-2025"    # changed → re-judged
    finally:
        main.SPECS.pop("b-rejudge", None)
