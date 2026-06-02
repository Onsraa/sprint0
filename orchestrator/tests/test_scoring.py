"""Scored attribution — the lane is one weighted signal, not a gate (no I/O, no LLM)."""
from app import scoring
from app.contracts import ContextScope, Issue


def _iss(typ="backend", risk="low", tags=None, lane=None, skill="api:x"):
    return Issue(id="i", title="t", description="d", type=typ, estimate_days=1, risk=risk,
                 required_skill=skill, context_scope=ContextScope(files=["a.py"]),
                 capability_tags=tags or [], lane=lane)


def _cand(user, disc, score=0.5, trust_level="medium", load=20, seniority="mid",
          role="developer", history=None):
    return {"gitlab_username": user, "name": user, "discipline": disc, "score": score,
            "trust_level": trust_level, "trust": {}, "load": load, "seniority": seniority,
            "role": role, "history": history or []}


def test_high_skill_out_of_lane_beats_low_skill_in_lane():
    # the whole point: discipline is a SIGNAL, not a gate
    issue = _iss(typ="backend")
    in_lane = _cand("bob", "backend", score=0.2, trust_level="low")
    out_lane = _cand("ann", "frontend", score=0.95, trust_level="high")
    chosen, s, below = scoring.best_assignment(issue, [in_lane, out_lane])
    assert chosen["gitlab_username"] == "ann" and not below


def test_in_lane_nudge_breaks_ties():
    # identical candidates except lane → the in-lane one wins (lane as a soft positive)
    issue = _iss(typ="backend")
    a = _cand("a", "backend")
    b = _cand("b", "frontend")
    chosen, _, _ = scoring.best_assignment(issue, [a, b])
    assert chosen["gitlab_username"] == "a"


def test_fully_loaded_excluded():
    issue = _iss()
    busy = _cand("busy", "backend", score=0.99, load=100)
    free = _cand("free", "backend", score=0.4, load=10)
    chosen, _, _ = scoring.best_assignment(issue, [busy, free])
    assert chosen["gitlab_username"] == "free"


def test_below_floor_flags_weak_match():
    issue = _iss(risk="high")
    weak = _cand("weak", "frontend", score=0.05, trust_level="low", load=95, seniority="junior")
    chosen, s, below = scoring.best_assignment(issue, [weak])
    assert chosen["gitlab_username"] == "weak" and below  # assigned but flagged for the manager


def test_no_developer_returns_none():
    issue = _iss()
    mgr = _cand("mgr", None, role="manager")
    chosen, _, below = scoring.best_assignment(issue, [mgr])
    assert chosen is None and below


def test_availability_breaks_tie_toward_sooner_free():
    # identical skill/trust/lane → whoever can start SOONEST wins (availability factor, Phase 2)
    issue = _iss(typ="backend")
    soon = _cand("soon", "backend"); soon["free_in_days"] = 0
    later = _cand("later", "backend"); later["free_in_days"] = 12
    chosen, _, _ = scoring.best_assignment(issue, [later, soon])
    assert chosen["gitlab_username"] == "soon"


def test_availability_falls_back_to_load_when_absent():
    # no free_in_days on the dict → the factor still falls back to the static load baseline
    issue = _iss(typ="backend")
    busy = _cand("busy", "backend", load=90)   # no free_in_days key
    free = _cand("free", "backend", load=0)
    chosen, _, _ = scoring.best_assignment(issue, [busy, free])
    assert chosen["gitlab_username"] == "free"
