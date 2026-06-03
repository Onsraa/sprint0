"""Staffing gap advisor — availability-aware, with a static-load fallback (no I/O, no LLM)."""
from app import staffing
from app.contracts import Availability, DeveloperProfile


def _dev(username, disc, trust="high", load=0, free=None):
    av = Availability(available_on="2026-06-02", free_in_days=free) if free is not None else None
    return DeveloperProfile(name=username, gitlab_username=username, username=username, skills_text="",
                            discipline=disc, trust={disc: trust}, trust_level=trust, load=load, availability=av)


def test_recommend_label_and_rank_reflect_real_availability():
    rec = staffing.recommend("backend", [_dev("a", "backend", free=0), _dev("b", "backend", free=6)])
    cands = {c["username"]: c for c in rec["stretch_candidates"]}
    assert "available now" in cands["a"]["pros"]
    assert any("free in 6d" in p for p in cands["b"]["pros"])
    assert rec["stretch_candidates"][0]["username"] == "a"   # sooner-free ranks first (same skill)


def test_recommend_excludes_beyond_horizon():
    rec = staffing.recommend("backend", [_dev("c", "backend", free=40)])  # > _FREE_HORIZON
    assert rec["stretch_candidates"] == []


def test_recommend_falls_back_to_load_without_availability():
    assert staffing.recommend("backend", [_dev("d", "backend", load=100)])["stretch_candidates"] == []
    rec = staffing.recommend("backend", [_dev("e", "backend", load=10)])
    assert rec["stretch_candidates"][0]["username"] == "e"
    assert rec["stretch_candidates"][0]["pros"][0] == "available"   # neutral label when un-enriched
