"""Graded references — a Decision's reference strength is EARNED by real signals at the slice's own
granularity (merged → QA-passed → days-without-reopen), independent of whether the whole project
shipped. Only battle-tested grades carry routing weight: a green-but-unproven past can never override
the router (decision 4 + the asymmetric grounding rule). Pure functions — the caller persists.
"""
from __future__ import annotations

_ORDER = ["proposed", "shipped", "prod_survived", "retro_validated"]
_RANK = {g: i for i, g in enumerate(_ORDER)}
RETRO_DAYS = 14  # consecutive clean days that promote prod_survived → retro_validated


def next_grade(decision: dict) -> str:
    """The grade a decision has EARNED from its current signals. Monotonic — never demotes below the
    stored grade (a genuine regression is modelled by clearing merged/qa_passed upstream, not here)."""
    merged = bool(decision.get("merged"))
    qa = bool(decision.get("qa_passed"))
    days = int(decision.get("days_clean", 0) or 0)
    earned = "proposed"
    if merged:
        earned = "shipped"
    if merged and qa:
        earned = "prod_survived"
    if merged and qa and days >= RETRO_DAYS:
        earned = "retro_validated"
    stored = decision.get("grade", "proposed")
    return earned if _RANK.get(earned, 0) >= _RANK.get(stored, 0) else stored


def carries_routing_weight(decision: dict) -> bool:
    """Only a battle-tested reference can shift a gate's tier (the orange override). proposed/shipped
    are too green to override the router — they still SHOW in the card, just don't change the tier."""
    return _RANK.get(decision.get("grade", "proposed"), 0) >= _RANK["prod_survived"]
