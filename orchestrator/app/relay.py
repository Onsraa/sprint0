"""Relay engine — the ratification DAG that turns the one-shot plan into a baton
passed through discipline leads (spec: "AI drafts → leads ratify").

Parallel DAG: {uiux ∥ backend ∥ devops} → frontend → qa. A gate AUTO-PASSES when every
issue in its slice is assigned to someone whose passport trust clears the issue's risk AND
the Trust Dial allows that risk tier; otherwise the baton stops for a human lead. Pure
functions over RelayState — no I/O, so it's trivially testable.
"""
from __future__ import annotations

from app import routing
from app.contracts import _TYPE_TO_DISCIPLINE, DeveloperProfile, Gate, IntegrationSignal, Issue, Lane, PlanJSON, RelayState, TesterPick

_DONE = {"auto_passed", "ratified"}

# Lane topology — the relay DAG, data-driven instead of hardcoded names. Each lane sits in a stage;
# stages run in order, each gate depending on the previous NON-EMPTY stage. Unknown (AI-discovered)
# lanes default to the build wave, so every present lane ALWAYS gets a gate — never silently dropped.
# The seed mapping reproduces the original {uiux ∥ backend ∥ devops} → frontend → qa exactly.
_LANE_STAGE: dict[str, str] = {
    "uiux": "build", "backend": "build", "devops": "build",
    "frontend": "integrate", "qa": "accept",
}
_DEFAULT_STAGE = "build"
_STAGE_ORDER = ["build", "integrate", "accept"]


def lane_stage(lane: str) -> str:
    return _LANE_STAGE.get(lane, _DEFAULT_STAGE)


def is_acceptance_gate(gate: Gate) -> bool:
    """The terminal acceptance gate (qa today). It reviews the WHOLE plan (not just its lane's slice)
    and is the gate an open integration failure holds `blocked`. Decoupled from the literal name 'qa'
    so an AI-discovered acceptance lane behaves identically."""
    return lane_stage(gate.discipline) == "accept"


def ratifier_of(gate: Gate) -> str | None:
    """THE ratifier rule, in one place: a handed-off gate is the delegate's to ratify, else the assigned
    owner's (lane lead); None = no specific person → callers fall back to discipline-match / the manager.
    Every surface (queue, handoff, contract visibility, contract actors, acceptance authoring) routes
    through this — never inline `delegate or owner` again."""
    return gate.delegate or gate.owner


def owns_gate(member: DeveloperProfile, gate: Gate, members: list[DeveloperProfile]) -> bool:
    """THE per-user gate-ownership rule (UNIQUE, never role-based). A gate belongs to exactly one user:
      1. its ratifier (delegate ?? owner) — the assigned lead (backend/devops→Tony, frontend→Sam);
      2. unowned (owner=None): a discipline COVERER owns it (the qa acceptance gate → the tester, who
         covers qa); if NO ONE covers the discipline (a true orphan, e.g. uiux), the MANAGER inherits it.
    The manager is NOT special here — they own only their own gates (setup they were handed, the tester
    gate they cover, orphans nobody covers). Manager ORCHESTRATION powers are a separate axis (auth)."""
    r = ratifier_of(gate)
    if r:
        return member.username == r
    if any(m.covers(gate.discipline) for m in members):
        return member.covers(gate.discipline)
    return member.is_manager  # true orphan → the manager inherits it


def is_setup_gate(gate: Gate) -> bool:
    """The special architecture/stack setup gate (only present when the manager redirected the stack choice
    to a lead). It's gate-0: it gates EVERY discipline gate (nothing starts until the stack is ratified),
    and it's rendered as the stack comparison, not a discipline slice."""
    return gate.discipline == "setup"


def _canon_lane(issue: Issue) -> str:
    """The canonical relay lane for an issue. Live plans are normalized to a valid discipline lane upstream
    (reason._normalize_plan_lanes), so the lane is already a discipline here; this still folds an IssueType-
    as-lane (design→uiux, db→backend) as a belt-and-suspenders for any non-normalized source (canned/tests)."""
    lane = issue.lane or issue.discipline
    return _TYPE_TO_DISCIPLINE.get(lane, lane)


def _issues_by_lane(plan: PlanJSON) -> dict[str, list[Issue]]:
    out: dict[str, list[Issue]] = {}
    for epic in plan.epics:
        for issue in epic.issues:
            out.setdefault(_canon_lane(issue), []).append(issue)
    return out


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


def build_relay(plan: PlanJSON, *, setup_owner: str | None = None) -> RelayState:
    """Build the gate DAG from the lanes actually present in the plan. Stages run in order; each
    stage's gates depend on the previous NON-EMPTY stage. Every present lane gets a gate (unknown
    lanes fold into the build wave) — nothing is silently dropped.

    `setup_owner` (the manager redirected the stack choice to a lead) prepends a special `setup` gate
    that gates EVERY discipline gate via _recompute_baton — WITHOUT adding it to any gate's `depends_on`,
    so the discipline topology (and its tests) stays byte-identical to the no-setup relay."""
    by_lane = _issues_by_lane(plan)
    present = set(by_lane)
    if not any(lane_stage(lane) == "accept" for lane in present):
        present.add("qa")  # the relay always ends in an acceptance gate (it reviews the whole plan)
    gates: list[Gate] = []
    prev: list[str] = []
    for stage in _STAGE_ORDER:
        lanes = sorted(lane for lane in present if lane_stage(lane) == stage)
        deps = list(prev)
        for lane in lanes:
            # owner = the lane's assignee (assign_developers already picked the best profile by skill+availability);
            # the most-common assignee leads. No assignee → gap → None → the Tech Lead ratifies it.
            assignees = [i.assignee for i in by_lane.get(lane, []) if i.assignee]
            owner = max(set(assignees), key=assignees.count) if assignees else None
            gates.append(Gate(discipline=lane, owner=owner, depends_on=deps, status="locked" if deps else "pending",
                              is_acceptance=(stage == "accept")))
        if lanes:
            prev = lanes  # the next stage converges on this one
    if setup_owner:  # gate-0: the architecture decision, owned by the redirected lead (delegate)
        gates.insert(0, Gate(discipline="setup", depends_on=[], status="pending", delegate=setup_owner))
    state = RelayState(gates=gates)
    _recompute_baton(state)
    return state


def _recompute_baton(state: RelayState) -> None:
    """A gate is active (holds the baton) when it isn't done and all its deps are done. An open
    integration failure forces the (terminal) qa gate to `blocked`: it stays on the baton (held),
    so the plan can't clear to dispatch until the failure is marked ok."""
    done = {g.discipline for g in state.gates if g.status in _DONE}
    setup_open = any(is_setup_gate(g) and g.status not in _DONE for g in state.gates)
    blocked_qa = bool(open_integration_failures(state))
    baton: list[Lane] = []
    for g in state.gates:
        if g.status in _DONE:
            continue
        if setup_open and not is_setup_gate(g):  # nothing starts until the architecture setup gate is ratified
            if g.status not in ("changes_requested", "blocked"):
                g.status = "locked"
            continue
        if all(dep in done for dep in g.depends_on):
            if is_acceptance_gate(g) and blocked_qa:
                g.status = "blocked"          # deps met, but an integration failure is open
            elif g.status in ("locked", "blocked"):
                g.status = "pending"          # blocked clears back to pending once failures resolve
            baton.append(g.discipline)
        elif g.status not in ("changes_requested", "blocked"):
            g.status = "locked"
    state.baton = baton


def auto_pass(
    state: RelayState, plan: PlanJSON, dev_trust: dict[str, dict], dial: int,
    *, edges: list | None = None,
    confidence_by_gate: dict[str, int] | None = None,
    signal_by_gate: dict[str, str] | None = None,
) -> None:
    """Auto-ratify any active gate the router clears (tier == auto_pass). The router scores
    expected_cost = P(error) × blast_radius scaled by the dial; with no `edges`/`confidence` it
    reduces to the legacy trust×risk×dial check, so existing callers keep today's behavior. Cascades:
    passing uiux+backend can unlock frontend, which may then auto-pass too. Populates each touched
    gate's routing fields (tier/confidence/blast_radius/expected_cost) for the UI."""
    by_lane = _issues_by_lane(plan)
    all_issues = [i for e in plan.epics for i in e.issues]
    changed = True
    while changed:
        changed = False
        _recompute_baton(state)
        for g in state.gates:
            if g.discipline not in state.baton or g.status in ("changes_requested", "blocked"):
                continue
            issues = all_issues if is_acceptance_gate(g) else by_lane.get(g.discipline, [])  # acceptance gate reviews all
            conf = (confidence_by_gate or {}).get(g.discipline)
            sig = (signal_by_gate or {}).get(g.discipline)
            tier, cost, blast, note = routing.route_gate(
                issues, edges, dev_trust, dial, confidence=conf, signal=sig)
            g.tier, g.expected_cost, g.blast_radius = tier, cost, blast
            if conf is not None:
                g.confidence = conf
            if note:
                g.routed_note = note
            if tier == "auto_pass":
                detail = f"cost={cost}" if cost is not None else "trust clears risk"
                g.status = "auto_passed"
                g.note = f"auto-passed · {detail} · dial={dial}"
                changed = True
    _recompute_baton(state)


def ratify(
    state: RelayState, plan: PlanJSON, discipline: Lane,
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


_TESTER_TRUST = {"low": 0, "medium": 1, "high": 2}
_TESTER_SENIORITY = {"junior": 0.5, "mid": 0.7, "senior": 1.0}


def best_tester(members: list[DeveloperProfile]) -> TesterPick | None:
    """Pick the best person to run the acceptance (Tester) gate — by passport, not job title.
    Verification trust (trust in an 'accept'-lane discipline, i.e. qa today) is the dominant signal;
    ties break on availability then seniority. Usually the QA, but a strong verifier in another lane
    can win, and when no one has verification trust it falls to the most-available person (often the
    manager) — picked by passport, not job title, now scored + explainable for the UI."""
    pool = list(members)  # everyone is a candidate — a manager who covers the accept lane competes like anyone
    if not pool:
        return None

    def accept_trust(m: DeveloperProfile) -> int:
        for disc, lvl in (m.trust or {}).items():
            if lane_stage(disc) == "accept":
                return _TESTER_TRUST.get(lvl, 0)
        return 0

    def avail(m: DeveloperProfile) -> float:
        return 1 - min(100, int(m.load or 0)) / 100

    def seniority(m: DeveloperProfile) -> float:
        return _TESTER_SENIORITY.get(m.seniority, 0.7)

    def in_accept_lane(m: DeveloperProfile) -> int:
        return 1 if any(lane_stage(d) == "accept" for d in m.disciplines) else 0

    chosen = max(pool, key=lambda m: (accept_trust(m), in_accept_lane(m), avail(m), seniority(m), m.username))
    at = accept_trust(chosen)
    lvl_name = {0: "low", 1: "medium", 2: "high"}[at]
    score = round(0.55 * (at / 2) + 0.25 * avail(chosen) + 0.20 * seniority(chosen), 2)
    if in_accept_lane(chosen):
        reason = f"verification trust {lvl_name} · owns the accept lane"
    elif at:
        reason = "strongest verification trust on the team"
    elif chosen.is_manager:
        reason = "no verifier on the team — the manager inherits the gate"
    else:
        reason = f"no QA seeded — {chosen.seniority} dev, most available to verify"
    return TesterPick(username=chosen.username, name=chosen.name,
                      discipline=chosen.discipline, score=score, reason=reason)
