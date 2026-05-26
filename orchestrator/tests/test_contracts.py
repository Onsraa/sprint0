"""Phase 1 verify: the canned data validates against the locked contract, and
invalid data is rejected. This is the contract's regression guard."""
import pytest
from pydantic import ValidationError

from app.canned import CANNED_DEVELOPERS, CANNED_PLAN
from app.contracts import Issue, PlanJSON


def test_canned_plan_is_valid():
    # round-trip: dump → re-validate must not raise
    PlanJSON.model_validate(CANNED_PLAN.model_dump())


def test_canned_plan_shape():
    assert CANNED_PLAN.epics, "plan must have epics"
    assert all(e.issues for e in CANNED_PLAN.epics), "every epic has issues"
    # every issue carries a non-empty context scope (micro-contexting invariant)
    for epic in CANNED_PLAN.epics:
        for issue in epic.issues:
            assert issue.context_scope.files, f"{issue.id} missing context files"


def test_canned_developers_default_trust():
    newhire = next(d for d in CANNED_DEVELOPERS if d.gitlab_username == "newhire")
    assert newhire.trust_level == "low"


def test_invalid_risk_rejected():
    with pytest.raises(ValidationError):
        Issue.model_validate(
            {
                "id": "X", "title": "t", "description": "d", "type": "backend",
                "estimate_days": 1, "risk": "catastrophic",  # not in Literal
                "required_skill": "x", "context_scope": {"files": ["a"]},
            }
        )


def test_invalid_issue_type_rejected():
    with pytest.raises(ValidationError):
        Issue.model_validate(
            {
                "id": "X", "title": "t", "description": "d", "type": "mobile",
                "estimate_days": 1, "risk": "low",
                "required_skill": "x", "context_scope": {"files": ["a"]},
            }
        )
