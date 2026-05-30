"""Relay engine — the ratification DAG that turns the one-shot plan into a baton
passed through discipline leads (spec: "AI drafts → leads ratify").

Parallel DAG: {uiux ∥ backend ∥ devops} → frontend → qa. A gate AUTO-PASSES when every
issue in its slice is assigned to someone whose passport trust clears the issue's risk AND
the Trust Dial allows that risk tier; otherwise the baton stops for a human lead. Pure
functions over RelayState — no I/O, so it's trivially testable.
"""
from __future__ import annotations

from app.assign import _RANK
from app.contracts import Discipline, Gate, IntegrationSignal, Issue, PlanJSON, RelayState

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


# ── Integration gate (B+C+D): a declared api-failing signal blocks qa + routes to the producer ──
def open_integration_failures(state: RelayState) -> list[IntegrationSignal]:
    """The latest signal per producer issue, keeping only those still `failing` (the log is
    append-only → last write per target wins). Non-empty ⇒ the qa gate is held `blocked`."""
    latest: dict[str, IntegrationSignal] = {}
    for s in state.integration_signals:
        latest[s.target_issue_id] = s
    return [s for s in latest.values() if s.state == "failing"]


def resolve_producers(plan: PlanJSON, reporter_issue_id: str) -> list[Issue]:
    """The producer issues a consumer depends on — contract-bearing ones first (the API surface
    most likely to have failed). Empty when the reporter has no upstream dependency."""
    issues = {i.id: i for e in plan.epics for i in e.issues}
    rep = issues.get(reporter_issue_id)
    if rep is None:
        return []
    deps = [issues[d] for d in rep.depends_on if d in issues]
    deps.sort(key=lambda i: i.api_contract is None)  # api_contract set → first
    return deps


def record_integration_signal(state: RelayState, signal: IntegrationSignal) -> None:
    """Append a signal and recompute the baton (which (un)blocks the qa gate). Pure — the caller
    handles I/O side-effects (notify, GitLab reopen)."""
    state.integration_signals.append(signal)
    _recompute_baton(state)


def build_relay(plan: PlanJSON) -> RelayState:
    """Build the gate DAG from the disciplines actually present in the plan (qa always last)."""
    present = set(_issues_by_discipline(plan))
    starts = [d for d in _START if d in present]
    gates: list[Gate] = [Gate(discipline=d) for d in starts]
    if "frontend" in present:
        deps = list(starts)  # whole present start-wave (uiux ∥ backend ∥ devops) converges into frontend
        gates.append(Gate(discipline="frontend", depends_on=deps, status="locked" if deps else "pending"))
    qa_deps: list[Discipline] = ["frontend"] if "frontend" in present else list(starts)
    gates.append(Gate(discipline="qa", depends_on=qa_deps, status="locked" if qa_deps else "pending"))
    state = RelayState(gates=gates)
    _recompute_baton(state)
    return state


def _recompute_baton(state: RelayState) -> None:
    """A gate is active (holds the baton) when it isn't done and all its deps are done. An open
    integration failure forces the (terminal) qa gate to `blocked`: it stays on the baton (held),
    so the plan can't clear to dispatch until the failure is marked ok."""
    done = {g.discipline for g in state.gates if g.status in _DONE}
    blocked_qa = bool(open_integration_failures(state))
    baton: list[Discipline] = []
    for g in state.gates:
        if g.status in _DONE:
            continue
        if all(dep in done for dep in g.depends_on):
            if g.discipline == "qa" and blocked_qa:
                g.status = "blocked"          # deps met, but an integration failure is open
            elif g.status in ("locked", "blocked"):
                g.status = "pending"          # blocked clears back to pending once failures resolve
            baton.append(g.discipline)
        elif g.status not in ("changes_requested", "blocked"):
            g.status = "locked"
    state.baton = baton


def _tier(dev_trust: dict[str, dict], username: str | None, discipline: str) -> str:
    """The assignee's PER-DISCIPLINE trust (falls back to their overall trust_level)."""
    m = dev_trust.get(username or "", {})
    return (m.get("trust") or {}).get(discipline) or m.get("trust_level", "low")


def auto_pass(state: RelayState, plan: PlanJSON, dev_trust: dict[str, dict], dial: int) -> None:
    """Auto-ratify any active gate whose whole slice clears per-discipline trust×risk under the dial.
    Cascades: passing uiux+backend can unlock frontend, which may then auto-pass too."""
    by_disc = _issues_by_discipline(plan)
    all_issues = [i for e in plan.epics for i in e.issues]
    max_auto = _dial_max_risk(dial)
    changed = True
    while changed:
        changed = False
        _recompute_baton(state)
        for g in state.gates:
            if g.discipline not in state.baton or g.status in ("changes_requested", "blocked"):
                continue
            issues = all_issues if g.discipline == "qa" else by_disc.get(g.discipline, [])  # qa accepts everything
            cleared = bool(issues) and all(
                _RANK[i.risk] <= max_auto
                and _RANK.get(_tier(dev_trust, i.assignee, i.discipline), 0) >= _RANK[i.risk]
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
