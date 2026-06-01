"""best_tester — the acceptance gate goes to the best verifier BY PASSPORT, not by job title.
Locks the demo narrative: the QA (accept-lane trust) wins over higher OVERALL-trust non-QA devs,
falls back to a developer when no QA is seeded, and to the manager when there are no developers."""
from app import relay
from app.contracts import DeveloperProfile


def _dev(name, disc, trust, *, seniority="mid", load=0, role="developer"):
    return DeveloperProfile(name=name, gitlab_username=name, skills_text="", role=role,
                            discipline=disc, seniority=seniority, load=load, trust=trust)


PASCAL = _dev("pascal", "qa", {"qa": "medium"})
TONY = _dev("tony", "devops", {"devops": "high", "backend": "high"}, seniority="senior")
JEAN = _dev("jean", "backend", {"backend": "high"}, seniority="senior", load=100)
SAM = _dev("sam", "frontend", {"frontend": "medium"})
TEDDY = _dev("teddy", None, {}, seniority="senior", role="manager")


def test_qa_wins_over_higher_overall_trust_non_qa():
    # Tony/Jean have higher overall trust, but only Pascal has accept-lane (qa) trust → Pascal runs it.
    pick = relay.best_tester([TEDDY, JEAN, TONY, SAM, PASCAL])
    assert pick is not None
    assert pick.username == "pascal"
    assert pick.discipline == "qa"
    assert "verification trust" in pick.reason
    assert pick.score > 0


def test_falls_back_to_a_developer_when_no_qa():
    # No accept-lane member: the gate must still land on a developer (not the manager), explained.
    pick = relay.best_tester([TEDDY, JEAN, TONY, SAM])
    assert pick is not None
    assert pick.username in {"tony", "sam"}          # available developers (jean is at load 100)
    assert pick.username != "teddy"
    assert "no QA" in pick.reason


def test_manager_inherits_when_no_developers():
    pick = relay.best_tester([TEDDY])
    assert pick is not None
    assert pick.username == "teddy"
    assert "manager" in pick.reason


def test_empty_roster_returns_none():
    assert relay.best_tester([]) is None
