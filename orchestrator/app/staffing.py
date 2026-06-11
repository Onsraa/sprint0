"""Staffing advisor — when the plan needs a discipline the team can't cover, sprint0 proposes how
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
_FREE_HORIZON = 20   # workdays — a stretch candidate free within this window is worth proposing now


def _free_in(m: DeveloperProfile) -> int | None:
    """Workdays until the member can start new work (from the live schedule). None when the roster
    wasn't availability-enriched — callers then fall back to the static `load`."""
    return m.availability.free_in_days if m.availability else None


def _available(m: DeveloperProfile) -> bool:
    """Worth proposing for a gap: free within the horizon (real availability), else not fully loaded."""
    fid = _free_in(m)
    return fid <= _FREE_HORIZON if fid is not None else m.load < 100


def _avail_label(m: DeveloperProfile) -> str:
    fid = _free_in(m)
    if fid is None:
        return "available"
    return "available now" if fid == 0 else f"free in {fid}d"


def _needed(plan: PlanJSON) -> set[str]:
    return {i.discipline for e in plan.epics for i in e.issues}


def _qualified(member: DeveloperProfile, discipline: str) -> bool:
    # coverage = whether the member can cover the lane (presence), NOT a trust threshold. Trust is a
    # scoring/auto-pass signal, not a coverage gate — a present low-trust dev is COVERED, not a gap.
    return member.covers(discipline)


def recommend(discipline: str, devs: list[DeveloperProfile]) -> dict:
    """Ranked options to fill a gap: scored stretch candidates + an onboard suggestion."""
    scored = []
    for m in (d for d in devs if _available(d)):
        skill = _RANK.get(m.trust_in(discipline), 0)
        adjacent = m.discipline in _ADJACENT.get(discipline, set())
        serializes = m.discipline in _PARALLEL and discipline in _PARALLEL and m.discipline != discipline
        fid = _free_in(m)
        avail_pen = 0.0 if fid is None else min(fid, _FREE_HORIZON) / _FREE_HORIZON  # sooner free → higher
        score = skill * 2 + (1 if adjacent else 0) - (2 if serializes else 0) - avail_pen
        pros, cons = [], []
        pros.append(_avail_label(m))
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
    """Per needed discipline: covered (SOMEONE covers the lane — presence, not availability) or a true
    gap + recommendation. A busy coverer is still a dedicated dev (not a dashed gap); availability only
    picks WHICH coverer leads. Every member counts — a manager who covers a lane staffs it like anyone."""
    devs = list(members)
    out = []
    for disc in sorted(_needed(plan)):
        coverers = [m for m in devs if _qualified(m, disc)]
        lead = next((m for m in coverers if _available(m)), coverers[0] if coverers else None)
        out.append({
            "discipline": disc,
            "covered": bool(coverers),
            "lead": lead.username if lead else None,
            "recommendation": None if coverers else recommend(disc, devs),
        })
    return out


def is_orphan(discipline: str, members: list[DeveloperProfile]) -> bool:
    """No one covers this discipline at all → its relay gate has no one to ratify it and falls to the
    manager. Ownership is about who *covers* the lane, not trust or capacity (those gate work assignment
    + the Trust Dial auto-pass, not who signs the gate off). A manager who covers the lane counts."""
    return not any(m.covers(discipline) for m in members)
