"""Assignment — scored attribution (spine refactor P3).

Each issue's required_skill is vector-matched to developers (skill_dev); we pick the best by a
weighted score (scoring.best_assignment): skill cosine × per-lane trust × load × lane-match ×
seniority-vs-risk × history. The lane/discipline is ONE signal, not a hard gate — a high-skill
out-of-lane dev can win. A weak best score (below the floor) or an out-of-lane pick sets stretch_flag
so the manager looks. Mutates the PlanJSON in place (assignee + stretch_flag).
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
            lane = issue.lane or issue.discipline
            out_of_lane = chosen.get("discipline") != lane
            if below or out_of_lane:
                why = f"no prior {lane}" if out_of_lane else f"low match ({s})"
                issue.stretch_flag = f"{chosen.get('name', 'dev')} — scored stretch · {why}"
