"""Routing tier — the spine. Per relay gate, decide auto_pass | one_expert | two_expert from
expected_cost_of_error = P(error) × blast_radius.

P(error) blends AI confidence (Decision Card, 0-100, blind-to-past by design) with the assignee's
trust; blast is the MEASURED count of transitive graph dependents of the slice's files, falling back
to a file-count heuristic (flagged) when those files aren't in the graph. The Trust Dial survives as
a global sensitivity multiplier that scales the cost thresholds. Grounding is asymmetric (decision 2):
a validated past that CONFLICTS (signal="orange") can only RAISE the tier, never lower it.

Pure functions over plain values — no I/O, no LLM calls (the caller fetches confidence/edges and
passes them in) — so it's trivially testable. route_gate reduces to the legacy trust×risk×dial
auto-pass when the caller opts out (no edges, no confidence), keeping existing behavior intact.
"""
from __future__ import annotations

from typing import Optional

from app import graph
from app.assign import _RANK
from app.contracts import GraphEdge, Issue, RoutingTier

# Trust → a prior probability the slice is wrong, before AI confidence refines it.
_TRUST_PRIOR = {"high": 0.15, "medium": 0.35, "low": 0.60}
_ORDER = {"auto_pass": 0, "one_expert": 1, "two_expert": 2}


def _dial_max_risk(dial: int) -> int:
    """Trust Dial (0-100) → highest risk tier eligible for auto-pass (the legacy trust floor).
    Advisor / Co-pilot / Navigator / Autonomous."""
    if dial >= 85:
        return 2  # high
    if dial >= 55:
        return 1  # medium
    if dial >= 25:
        return 0  # low only
    return -1     # nothing auto-passes — every gate needs a human


def _trust_tier(dev_trust: dict[str, dict], username: Optional[str], discipline: str) -> str:
    """The assignee's PER-DISCIPLINE trust (falls back to their overall trust_level)."""
    m = dev_trust.get(username or "", {})
    return (m.get("trust") or {}).get(discipline) or m.get("trust_level", "low")


def blast_radius(issue: Issue, edges: Optional[list[GraphEdge]]) -> tuple[int, bool]:
    """(blast, measured). Union of transitive dependents over the slice's files when those files are
    in the graph; else a file-count fallback (measured=False) so routing still discriminates without
    a per-project graph (the demo's plans aren't in the local backend import graph)."""
    files = issue.context_scope.files or []
    if edges:
        known = {e.from_path for e in edges} | {e.to_path for e in edges}
        hit = [f for f in files if f in known]
        if hit:
            dep: set[str] = set()
            for f in hit:
                dep.update(graph.dependents_of(f, edges))
            return len(dep), True
    return max(1, len(files)), False


def p_error(confidence: Optional[int], trust_level: str) -> float:
    """0..1 probability the slice is wrong. Trust sets the prior; AI confidence (0-100) refines it
    (low confidence → high P(error)). Confidence missing → the trust prior alone."""
    tp = _TRUST_PRIOR.get(trust_level, 0.5)
    if confidence is None:
        return tp
    cp = 1 - max(0, min(100, confidence)) / 100
    return round(0.5 * tp + 0.5 * cp, 3)


def _tier_from_cost(cost: float, dial: int) -> RoutingTier:
    """Threshold expected cost into a tier; the Trust Dial scales tolerance (higher dial → more
    auto-pass). Base thresholds calibrated at dial=50."""
    scale = (dial / 50) if dial > 0 else 0.01
    if cost <= 2.0 * scale:
        return "auto_pass"
    if cost <= 6.0 * scale:
        return "one_expert"
    return "two_expert"


def _escalate(tier: RoutingTier, floor: RoutingTier) -> RoutingTier:
    return tier if _ORDER[tier] >= _ORDER[floor] else floor


def route_gate(
    issues: list[Issue], edges: Optional[list[GraphEdge]], dev_trust: dict[str, dict], dial: int,
    *, confidence: Optional[int] = None, signal: Optional[str] = None,
) -> tuple[RoutingTier, Optional[float], int, str]:
    """(tier, expected_cost, blast, note). When the caller passes neither edges nor confidence
    (legacy callers / unit tests), reduces to today's trust×risk×dial auto-pass. The trust floor
    always applies — a slice whose assignee trust doesn't clear its risk never auto-passes. Orange
    (a validated-past conflict) can only raise the tier (asymmetric grounding, decision 2)."""
    max_auto = _dial_max_risk(dial)
    legacy_clears = bool(issues) and all(
        _RANK[i.risk] <= max_auto
        and _RANK.get(_trust_tier(dev_trust, i.assignee, i.discipline), 0) >= _RANK[i.risk]
        for i in issues
    )
    blast, measured = 0, False
    for i in issues:
        b, m = blast_radius(i, edges)
        blast = max(blast, b)
        measured = measured or m

    if confidence is None and edges is None:           # caller opted out → today's behavior
        tier: RoutingTier = "auto_pass" if legacy_clears else "one_expert"
        cost: Optional[float] = None
    else:
        worst = min((_trust_tier(dev_trust, i.assignee, i.discipline) for i in issues),
                    key=lambda t: _RANK.get(t, 0), default="low")
        cost = round(p_error(confidence, worst) * blast, 2)
        tier = _tier_from_cost(cost, dial)
        if tier == "auto_pass" and not legacy_clears:
            tier = "one_expert"                        # trust floor — never auto-pass un-cleared trust

    if signal == "orange":
        tier = _escalate(tier, "one_expert")           # validated-past conflict can only raise
    note = "" if (measured or not issues) else "blast estimated — no graph"
    return tier, cost, blast, note
