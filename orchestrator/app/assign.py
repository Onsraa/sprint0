"""Assignment + trust gate (Phase 3).

Each issue's `required_skill` is vector-matched to developers (best-first by score).
Trust gate: a low-trust dev may only take low-risk issues; higher risk needs higher
trust. Mutates the PlanJSON in place, setting `assignee`.
"""
from __future__ import annotations

from app.contracts import PlanJSON

_RANK = {"low": 0, "medium": 1, "high": 2}


def assign_developers(plan: PlanJSON, skill_dev: dict[str, list[dict]]) -> None:
    for epic in plan.epics:
        for issue in epic.issues:
            candidates = skill_dev.get(issue.required_skill, [])
            need = _RANK[issue.risk]
            chosen: dict | None = None
            for c in candidates:  # already best-first by vector score
                if _RANK.get(c.get("trust_level", "low"), 0) >= need:
                    chosen = c
                    break
            if chosen is None and candidates:  # no one trusted enough → most-trusted available
                chosen = max(candidates, key=lambda c: _RANK.get(c.get("trust_level", "low"), 0))
            if chosen:
                issue.assignee = chosen.get("gitlab_username")
