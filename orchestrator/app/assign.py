"""Assignment + trust gate (per-account demo).

Candidates arrive pre-ranked by skill (vector match) carrying their Member attributes
(per-discipline trust, discipline, load). Rules:
  1. Skip the unavailable (load ≥ 100 — e.g. the senior engineer already at full capacity).
  2. Prefer a qualified, in-discipline dev (per-discipline trust clears the issue's risk).
  3. Else assign the best available anyway and FLAG the stretch ("no prior <discipline>").
Mutates the PlanJSON in place (assignee + stretch_flag).
"""
from __future__ import annotations

from app.contracts import PlanJSON

_RANK = {"low": 0, "medium": 1, "high": 2}


def _trust_in(cand: dict, discipline: str) -> str:
    return (cand.get("trust") or {}).get(discipline) or cand.get("trust_level", "low")


def assign_developers(plan: PlanJSON, skill_dev: dict[str, list[dict]]) -> None:
    for epic in plan.epics:
        for issue in epic.issues:
            disc = issue.discipline
            need = _RANK[issue.risk]
            cands = [c for c in skill_dev.get(issue.required_skill, []) if c.get("role", "developer") == "developer"]
            avail = [c for c in cands if int(c.get("load", 0) or 0) < 100]  # drop the fully-loaded
            chosen: dict | None = None
            for c in avail:  # best-first by skill: qualified + in-discipline + trust clears risk
                if c.get("discipline") == disc and _RANK.get(_trust_in(c, disc), 0) >= need:
                    chosen = c
                    break
            if chosen is None and avail:  # nobody qualified+available → best available (a stretch)
                chosen = max(avail, key=lambda c: _RANK.get(_trust_in(c, disc), 0))
            if chosen:
                issue.assignee = chosen.get("gitlab_username")
                if chosen.get("discipline") != disc or _RANK.get(_trust_in(chosen, disc), 0) < need:
                    issue.stretch_flag = f"{chosen.get('name', 'dev')} has no prior {disc} experience"
