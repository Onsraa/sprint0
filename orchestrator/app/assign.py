"""Assignment — scored attribution (spine refactor P3).

Each issue's required_skill is vector-matched to developers (skill_dev); among the candidates who
COVER the lane (composable disciplines) we pick the best by a weighted score (scoring.best_assignment):
skill cosine × per-lane trust × load × lane-match × seniority-vs-risk × history. A weak best score
(below the floor) sets stretch_flag so the manager looks. An uncovered lane → no assignee → the gate
falls to the manager + the staffing advisor. Mutates the PlanJSON in place (assignee + stretch_flag).
"""
from __future__ import annotations

from app import scoring
from app.contracts import PlanJSON

_RANK = {"low": 0, "medium": 1, "high": 2}  # kept here — routing.py imports it


def assign_developers(plan: PlanJSON, skill_dev: dict[str, list[dict]]) -> None:
    assigned: dict[str, float] = {}   # running per-dev pass-load → a same-discipline slice spreads (P4)
    for epic in plan.epics:
        for issue in epic.issues:
            chosen, s, below = scoring.best_assignment(issue, skill_dev.get(issue.required_skill, []), assigned)
            if chosen is None:
                continue
            user = chosen.get("gitlab_username")
            issue.assignee = user
            assigned[user] = assigned.get(user, 0.0) + float(issue.estimate_days or 1)
            if below:  # a weak best score among the lane's coverers — the manager should eyeball it
                issue.stretch_flag = f"{chosen.get('name', 'dev')} — scored stretch · low match ({s})"
