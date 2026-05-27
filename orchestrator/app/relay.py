"""Relay engine — the ratification DAG that turns the one-shot plan into a baton
passed through discipline leads (spec: "AI drafts → leads ratify").

Parallel DAG: {uiux ∥ backend ∥ devops} → frontend → qa. A gate AUTO-PASSES when every
issue in its slice is assigned to someone whose passport trust clears the issue's risk AND
the Trust Dial allows that risk tier; otherwise the baton stops for a human lead. Pure
functions over RelayState — no I/O, so it's trivially testable.
"""
from __future__ import annotations

from app.assign import _RANK
from app.contracts import Discipline, Gate, Issue, PlanJSON, RelayState

_DONE = {"auto_passed", "ratified"}
_START: list[Discipline] = ["uiux", "backend", "devops"]  # can ratify in parallel


def _issues_by_discipline(plan: PlanJSON) -> dict[str, list[Issue]]:
    out: dict[str, list[Issue]] = {}
    for epic in plan.epics:
        for issue in epic.issues:
            out.setdefault(issue.discipline, []).append(issue)
    return out


def _dial_max_risk(dial: int) -> int:
    """Trust Dial (0-100) → highest risk tier eligible for auto-pass.
    Advisor / Co-pilot / Navigator / Autonomous."""
    if dial >= 85:
        return 2  # high
    if dial >= 55:
        return 1  # medium
    if dial >= 25:
        return 0  # low only
    return -1     # nothing auto-passes — every gate needs a human


def build_relay(plan: PlanJSON) -> RelayState:
    """Build the gate DAG from the disciplines actually present in the plan (qa always last)."""
    present = set(_issues_by_discipline(plan))
    starts = [d for d in _START if d in present]
    gates: list[Gate] = [Gate(discipline=d) for d in starts]
    if "frontend" in present:
        deps = [d for d in ("uiux", "backend") if d in present]
        gates.append(Gate(discipline="frontend", depends_on=deps, status="locked" if deps else "pending"))
    qa_deps: list[Discipline] = ["frontend"] if "frontend" in present else list(starts)
    gates.append(Gate(discipline="qa", depends_on=qa_deps, status="locked" if qa_deps else "pending"))
    state = RelayState(gates=gates)
    _recompute_baton(state)
    return state


def _recompute_baton(state: RelayState) -> None:
    """A gate is active (holds the baton) when it isn't done and all its deps are done."""
    done = {g.discipline for g in state.gates if g.status in _DONE}
    baton: list[Discipline] = []
    for g in state.gates:
        if g.status in _DONE:
            continue
        if all(dep in done for dep in g.depends_on):
            if g.status == "locked":
                g.status = "pending"
            baton.append(g.discipline)
        elif g.status != "changes_requested":
            g.status = "locked"
    state.baton = baton


def auto_pass(state: RelayState, plan: PlanJSON, dev_trust: dict[str, str], dial: int) -> None:
    """Auto-ratify any active gate whose whole slice clears trust×risk under the dial.
    Cascades: passing uiux+backend can unlock frontend, which may then auto-pass too."""
    by_disc = _issues_by_discipline(plan)
    all_issues = [i for e in plan.epics for i in e.issues]
    max_auto = _dial_max_risk(dial)
    changed = True
    while changed:
        changed = False
        _recompute_baton(state)
        for g in state.gates:
            if g.discipline not in state.baton or g.status == "changes_requested":
                continue
            issues = all_issues if g.discipline == "qa" else by_disc.get(g.discipline, [])  # qa accepts everything
            cleared = bool(issues) and all(
                _RANK[i.risk] <= max_auto
                and _RANK.get(dev_trust.get(i.assignee or "", "low"), 0) >= _RANK[i.risk]
                for i in issues
            )
            if cleared:
                g.status = "auto_passed"
                g.note = f"auto-passed · trust clears risk · dial={dial}"
                changed = True
    _recompute_baton(state)


def ratify(
    state: RelayState, plan: PlanJSON, discipline: Discipline,
    edits: list[Issue] | None, approve: bool, note: str,
) -> None:
    """A lead adjusts their slice (edits replace matching issue ids in the plan) and passes
    the baton. approve=False → changes_requested (the slice bounces back for rework)."""
    if edits:
        by_id = {i.id: i for i in edits}
        for epic in plan.epics:
            epic.issues = [by_id.get(i.id, i) for i in epic.issues]
    for g in state.gates:
        if g.discipline == discipline:
            g.status = "ratified" if approve else "changes_requested"
            g.note = note
    _recompute_baton(state)


def all_ratified(state: RelayState) -> bool:
    """True when every gate is done — the plan is cleared to dispatch."""
    return all(g.status in _DONE for g in state.gates)
