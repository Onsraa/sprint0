"""Scored attribution — eligibility = COVERS the lane (composable roles); among coverers, the passport
(skill/trust/load/seniority/history) ranks. No I/O, no LLM."""
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


def test_out_of_lane_is_ineligible_under_covers():
    # composable roles: eligibility = COVERS the lane. An out-of-lane dev (however skilled) is ineligible;
    # the in-lane dev wins. (Replaces the old soft-stretch where a high-skill out-of-lane dev could win.)
    issue = _iss(typ="backend")
    in_lane = _cand("bob", "backend", score=0.2, trust_level="low")
    out_lane = _cand("ann", "frontend", score=0.95, trust_level="high")
    chosen, s, below = scoring.best_assignment(issue, [in_lane, out_lane])
    assert chosen["gitlab_username"] == "bob"


def test_multi_lane_dev_wins_each_covered_lane():
    # Tony covers backend AND devops → eligible (and best) for issues in EITHER lane
    tony = {**_cand("tony", "backend", score=0.6, trust_level="high"), "disciplines": ["backend", "devops"]}
    for lane in ("backend", "devops"):
        chosen, _, _ = scoring.best_assignment(_iss(lane=lane), [tony])
        assert chosen["gitlab_username"] == "tony"


def test_in_lane_nudge_breaks_ties():
    # identical candidates except lane → the in-lane one wins (lane as a soft positive)
    issue = _iss(typ="backend")
    a = _cand("a", "backend")
    b = _cand("b", "frontend")
    chosen, _, _ = scoring.best_assignment(issue, [a, b])
    assert chosen["gitlab_username"] == "a"


def test_fully_loaded_in_lane_stays_eligible():
    # load is a SIGNAL, not a gate — the busy in-lane specialist outranks a free out-of-lane dev (the
    # schedule absorbs his wait; a hard load<100 gate let whoever was free sweep every lane).
    issue = _iss(typ="backend")
    busy_specialist = _cand("jean", "backend", score=0.6, trust_level="high", load=100, seniority="senior")
    free_outlane = _cand("tony", "devops", score=0.6, trust_level="low", load=0, seniority="senior")
    chosen, _, _ = scoring.best_assignment(issue, [busy_specialist, free_outlane])
    assert chosen["gitlab_username"] == "jean"


def test_load_still_separates_in_lane_peers():
    # between same-lane peers, availability still routes to whoever can start sooner
    issue = _iss()
    busy = _cand("busy", "backend", load=100)
    free = _cand("free", "backend", load=10)
    chosen, _, _ = scoring.best_assignment(issue, [busy, free])
    assert chosen["gitlab_username"] == "free"


def test_qa_never_takes_implementation_work():
    # the one hard rule: the Tester only tests — a qa member is ineligible for non-qa lanes
    issue = _iss(typ="backend")
    qa = _cand("pascal", "qa", score=0.99, trust_level="high", load=0)
    chosen, _, _ = scoring.best_assignment(issue, [qa])
    assert chosen is None
    dev = _cand("dev", "backend", score=0.2, load=0)  # covers the backend lane
    chosen2, _, _ = scoring.best_assignment(issue, [qa, dev])
    assert chosen2["gitlab_username"] == "dev"


def test_qa_lane_still_routes_to_qa():
    issue = _iss(lane="qa")  # acceptance work — the lane (not the issue type) names the discipline
    qa = _cand("pascal", "qa", score=0.5)
    dev = _cand("dev", "backend", score=0.5)
    chosen, _, _ = scoring.best_assignment(issue, [qa, dev])
    assert chosen["gitlab_username"] == "pascal"


def test_below_floor_flags_weak_match():
    issue = _iss(risk="high")
    weak = _cand("weak", "backend", score=0.05, trust_level="low", load=95, seniority="junior")  # covers, but weak
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


def test_within_pass_load_balancing_spreads_a_slice():
    # two identical same-discipline devs → issue 1 picks one; once it's loaded THIS pass, issue 2 spreads
    issue = _iss(typ="backend")
    a = _cand("a", "backend"); a["free_in_days"] = 0
    b = _cand("b", "backend"); b["free_in_days"] = 0
    assigned: dict = {}
    c1, _, _ = scoring.best_assignment(issue, [a, b], assigned)
    assigned[c1["gitlab_username"]] = 20.0                       # the picked dev now carries this pass's load
    c2, _, _ = scoring.best_assignment(issue, [a, b], assigned)
    assert c1["gitlab_username"] != c2["gitlab_username"]        # the slice spreads, not one dev sweeping
