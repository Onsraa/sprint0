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


_AVAIL_HORIZON = 15   # workdays; a candidate free this far out (or more) scores 0 on availability


def _avail_factor(cand: dict, extra_days: float = 0.0) -> float:
    """Availability factor (0..1) — route new work to whoever can start SOONEST. Uses the real
    `free_in_days` (server-computed from the live schedule) when present; falls back to the static
    `load` baseline. `extra_days` is the load already handed to this candidate WITHIN the current
    planning pass — so a same-discipline slice spreads across devs instead of one sweeping it (P4)."""
    fid = cand.get("free_in_days")
    if fid is None:
        base = 1 - min(100, int(cand.get("load", 0) or 0)) / 100   # fallback: static load
        return max(0.0, base - min(extra_days, _AVAIL_HORIZON) / _AVAIL_HORIZON)
    return max(0.0, 1 - min(int(fid) + extra_days, _AVAIL_HORIZON) / _AVAIL_HORIZON)


def score(cand: dict, issue: Issue, extra_days: float = 0.0) -> float:
    lane = issue.lane or issue.discipline
    skill = max(0.0, min(1.0, float(cand.get("score", 0.0) or 0.0)))  # $vectorSearch cosine
    trust = _RANK.get(_trust_in(cand, lane), 0) / 2                   # 0..1
    load = _avail_factor(cand, extra_days)                            # sooner free → higher; running pass-load aware
    lane_match = 1.0 if cand.get("discipline") == lane else 0.0
    sen = _SENIORITY.get(cand.get("seniority", "mid"), 0.7)
    seniority_fit = sen if _RANK.get(issue.risk, 0) <= 1 else sen ** 2  # juniors penalized on high risk
    history = _history_score(cand, [*(issue.capability_tags or []), lane, issue.required_skill])
    return round(
        _W["skill"] * skill + _W["trust"] * trust + _W["load"] * load
        + _W["lane"] * lane_match + _W["seniority"] * seniority_fit + _W["history"] * history, 4)


def best_assignment(issue: Issue, candidates: list[dict],
                    assigned: dict[str, float] | None = None) -> tuple[dict | None, float, bool]:
    """(chosen, score, below_floor). Argmax available developer; below_floor flags a weak match (a
    stretch the manager should eyeball). None when no developer is available. `assigned` is the running
    per-dev load handed out earlier in THIS pass — so a multi-issue same-discipline slice spreads (P4)."""
    assigned = assigned or {}
    avail = [c for c in candidates
             if c.get("role", "developer") == "developer" and int(c.get("load", 0) or 0) < 100]
    if not avail:
        return None, 0.0, True
    def _extra(c: dict) -> float:
        return assigned.get(c.get("gitlab_username") or c.get("username", ""), 0.0)
    chosen = max(avail, key=lambda c: score(c, issue, _extra(c)))
    s = score(chosen, issue, _extra(chosen))
    return chosen, s, s < _FLOOR
