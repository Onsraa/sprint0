"""Staffing advisor — when the plan needs a discipline the team can't cover, baton proposes how
to fill the gap: stretch an internal dev (ranked) or onboard someone. Weighted by sprint-timing
(stretching one dev across two PARALLEL relay gates serializes them) > skill fit > keeping seniors free.

Deterministic, pure functions over the team + plan — no LLM call (cheaper + reproducible in a demo).
"""
from __future__ import annotations

from app.contracts import DeveloperProfile, PlanJSON

_RANK = {"low": 0, "medium": 1, "high": 2}
# A stretch from A→B is more natural between adjacent disciplines.
_ADJACENT = {"uiux": {"frontend"}, "frontend": {"uiux"}, "devops": {"backend"}, "backend": {"devops", "db"}, "qa": set()}
# Relay DAG: these run in PARALLEL, so one dev covering two of them serializes the sprint.
_PARALLEL = {"uiux", "backend", "devops"}


def _needed(plan: PlanJSON) -> set[str]:
    return {i.discipline for e in plan.epics for i in e.issues}


def _qualified(member: DeveloperProfile, discipline: str) -> bool:
    return member.discipline == discipline and _RANK.get(member.trust_in(discipline), 0) >= 1


def recommend(discipline: str, devs: list[DeveloperProfile]) -> dict:
    """Ranked options to fill a gap: scored stretch candidates + an onboard suggestion."""
    scored = []
    for m in (d for d in devs if d.load < 100):
        skill = _RANK.get(m.trust_in(discipline), 0)
        adjacent = m.discipline in _ADJACENT.get(discipline, set())
        serializes = m.discipline in _PARALLEL and discipline in _PARALLEL and m.discipline != discipline
        score = skill * 2 + (1 if adjacent else 0) - (2 if serializes else 0)
        pros, cons = ([] if skill else []), []
        pros.append("available now")
        if adjacent:
            pros.append(f"adjacent skill ({m.discipline} → {discipline})")
        if skill == 0:
            cons.append(f"no prior {discipline} experience")
        if serializes:
            cons.append(f"serializes {m.discipline} + {discipline} on one person → slower sprint")
        scored.append({"username": m.username, "name": m.name, "discipline": m.discipline, "score": score, "pros": pros, "cons": cons})
    scored.sort(key=lambda x: x["score"], reverse=True)
    return {
        "discipline": discipline,
        "stretch_candidates": scored[:3],
        "onboard": {
            "suggestion": f"onboard a {discipline} apprentice",
            "pros": [f"keeps {discipline} + its dependent gates running in parallel (smooths the sprint)", "frees seniors for higher-risk work"],
            "cons": ["ramp-up time"],
        },
        "weighted_by": "sprint-timing/flow > skill fit > keep seniors free",
    }


def coverage(plan: PlanJSON, members: list[DeveloperProfile]) -> list[dict]:
    """Per needed discipline: covered (a qualified + available member exists) or a gap + recommendation."""
    devs = [m for m in members if m.role == "developer"]
    out = []
    for disc in sorted(_needed(plan)):
        lead = next((m for m in devs if _qualified(m, disc) and m.load < 100), None)
        out.append({
            "discipline": disc,
            "covered": lead is not None,
            "lead": lead.username if lead else None,
            "recommendation": None if lead else recommend(disc, devs),
        })
    return out


def is_orphan(discipline: str, members: list[DeveloperProfile]) -> bool:
    """A discipline no available team member is qualified for → its relay gate falls to the manager."""
    return not any(_qualified(m, discipline) and m.load < 100 for m in members if m.role == "developer")
