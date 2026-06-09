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


# ── #33 Contract signal — Profile C "two-factor" (LOCKED). Green = confident AND real grounding. ──
GREEN_CONFIDENCE = 60     # ≥ this + grounding (grade or a cited project) → green
GREY_CONFIDENCE = 40      # < this → grey (too weak to trust)


def _earned(grade: str | None) -> bool:
    """A grade of "shipped" or better is battle-tested (carries green weight)."""
    return _RANK.get(grade or "", 0) >= _RANK["shipped"]


def grade_for(grounded_on: list[str], decisions: list[dict], discipline: str) -> str | None:
    """Earned strength of a memory-grounded option (server-derived — never an LLM guess). Prefer a TEAM
    decision graded on one of the grounded projects in this discipline (the real P4 grade); else a coarse
    "shipped" since the agency's seeded past projects all shipped; ungrounded → None."""
    if not grounded_on:
        return None
    best = None
    for d in decisions:
        if (d.get("project_name") in grounded_on and d.get("domain") == discipline
                and d.get("visibility") == "team"):
            g = d.get("grade", "proposed")
            if best is None or _RANK.get(g, 0) > _RANK.get(best, 0):
                best = g
    return best or "shipped"


def signal_for(card) -> str:
    """Profile C (duck-typed on the SolutionCard): a conflict always wins (a contradiction is what a human
    ratifies); green = confident AND backed (grade≥shipped OR a cited project); grey = too weak or an
    unbacked guess; else the orange middle the human should weigh."""
    if card.conflict:
        return "orange"
    grounded = bool(card.grounded_on)
    if card.confidence >= GREEN_CONFIDENCE and (_earned(card.grade) or grounded):
        return "green"
    if card.confidence < GREY_CONFIDENCE or (card.source == "ai" and not grounded):
        return "grey"
    return "orange"


def recommend_architecture(cards: list, ai_pick_name: str = "") -> int | None:
    """The badged card follows the AI's OWN pick (`ai_pick_name`) — NOT a reuse-max heuristic. We dropped the
    old "most proven reuse" scoring (reused*2 + grounded) because it forced a reuse bias even on a mismatched
    brief; reuse is now one option among equals, and relevance is LLM-judged upstream (CRAG: verdict+reason) so a
    card only cites memory when a past project genuinely fits. Returns the index of the card whose name matches
    the AI's pick, else None (no server badge — the cards stand on their own)."""
    if not cards or not ai_pick_name:
        return None
    want = ai_pick_name.strip().lower()
    for i, c in enumerate(cards):
        if (getattr(c, "name", "") or "").strip().lower() == want:
            return i
    return None
