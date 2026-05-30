"""Scored attribution — replaces the hard "in-discipline only" rule with a weighted match per
(issue, candidate). The lane/discipline becomes ONE signal among skill cosine, per-lane trust, load,
seniority-vs-risk, and history — so a high-skill out-of-lane dev can win when that's the right call.

Pure + deterministic (no LLM), like staffing.py — cheap and reproducible in the demo. Candidates are
the vector-search rows for an issue's required_skill: each carries `score` (the $vectorSearch cosine),
trust/trust_level, discipline, load, seniority, role, history.
"""
from __future__ import annotations

from app.contracts import Issue

_RANK = {"low": 0, "medium": 1, "high": 2}
_SENIORITY = {"junior": 0.5, "mid": 0.7, "senior": 1.0}
_FLOOR = 0.30  # below this best-score → weak match → stretch/flag → manager looks

# weights (sum = 1.0) — skill cosine dominates; lane is a soft positive, not a gate
_W = {"skill": 0.35, "trust": 0.22, "load": 0.18, "lane": 0.12, "seniority": 0.08, "history": 0.05}


def _trust_in(cand: dict, lane: str) -> str:
    return (cand.get("trust") or {}).get(lane) or cand.get("trust_level", "low")


def _history_score(cand: dict, tags: list[str]) -> float:
    """Fraction of the candidate's GOOD merges (score ≥ 0.7) whose task_type touches the issue's
    capability tags / lane. 0 when no relevant history."""
    good = [h for h in (cand.get("history") or []) if (h.get("score", 0) or 0) >= 0.7]
    if not good or not tags:
        return 0.0
    hit = sum(1 for h in good if any(t and t in str(h.get("task_type", "")) for t in tags))
    return min(1.0, hit / len(good))


def score(cand: dict, issue: Issue) -> float:
    lane = issue.lane or issue.discipline
    skill = max(0.0, min(1.0, float(cand.get("score", 0.0) or 0.0)))  # $vectorSearch cosine
    trust = _RANK.get(_trust_in(cand, lane), 0) / 2                   # 0..1
    load = 1 - min(100, int(cand.get("load", 0) or 0)) / 100         # more free → higher
    lane_match = 1.0 if cand.get("discipline") == lane else 0.0
    sen = _SENIORITY.get(cand.get("seniority", "mid"), 0.7)
    seniority_fit = sen if _RANK.get(issue.risk, 0) <= 1 else sen ** 2  # juniors penalized on high risk
    history = _history_score(cand, [*(issue.capability_tags or []), lane, issue.required_skill])
    return round(
        _W["skill"] * skill + _W["trust"] * trust + _W["load"] * load
        + _W["lane"] * lane_match + _W["seniority"] * seniority_fit + _W["history"] * history, 4)


def best_assignment(issue: Issue, candidates: list[dict]) -> tuple[dict | None, float, bool]:
    """(chosen, score, below_floor). Argmax available developer; below_floor flags a weak match (a
    stretch the manager should eyeball). None when no developer is available."""
    avail = [c for c in candidates
             if c.get("role", "developer") == "developer" and int(c.get("load", 0) or 0) < 100]
    if not avail:
        return None, 0.0, True
    chosen = max(avail, key=lambda c: score(c, issue))
    s = score(chosen, issue)
    return chosen, s, s < _FLOOR
