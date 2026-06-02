"""Hard interface contracts (spec §5). The single source of truth for the
shape of data flowing Gemini → frontend → executor. Changing anything here
means notifying every dependent slice.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator

IssueType = Literal["backend", "frontend", "db", "devops", "design"]
Risk = Literal["low", "medium", "high"]
TrustLevel = Literal["low", "medium", "high"]

# Relay disciplines (the ratification DAG nodes) + artifact kinds (the polymorphic
# execution surface). An issue's `type` (what the planner emits) maps to both, so the
# LLM keeps emitting the small, familiar schema and we derive the rest in code.
Discipline = Literal["uiux", "backend", "frontend", "qa", "devops"]
Kind = Literal["code", "design", "audit", "content", "infra", "runbook"]
GateStatus = Literal["pending", "locked", "auto_passed", "ratified", "changes_requested", "blocked"]
Role = Literal["manager", "developer"]
Seniority = Literal["junior", "mid", "senior"]
# Spine refactor: a "lane" = a relay-DAG gate node. Bounded IN PRACTICE (the manager confirms new
# lanes), but a plain str — not a closed enum — so an AI-discovered lane can flow through the relay.
# The 5 seed lanes mirror the disciplines; capability_tags (free strings) carry the finer taxonomy.
KNOWN_LANES = ("uiux", "backend", "frontend", "qa", "devops")
Lane = str
RoutingTier = Literal["auto_pass", "one_expert", "two_expert"]

_TYPE_TO_DISCIPLINE: dict[str, Discipline] = {
    "backend": "backend", "db": "backend", "frontend": "frontend", "design": "uiux", "devops": "devops",
}
_TYPE_TO_KIND: dict[str, Kind] = {"design": "design", "devops": "infra"}


# ── PlanJSON (spec §5.1) ─────────────────────────────────────────────
class ContextScope(BaseModel):
    files: list[str]
    note: str = ""


class IssueContext(BaseModel):
    """Kind-specific execution extras — filled by discipline leads at ratify time, not the planner.
    Typed on purpose: the Gemini Developer API rejects open `dict`/additionalProperties in output schemas."""
    figma_file: Optional[str] = None
    screens: list[str] = Field(default_factory=list)
    target_pages: list[str] = Field(default_factory=list)
    rubric: list[str] = Field(default_factory=list)
    slots: list[str] = Field(default_factory=list)
    tone: Optional[str] = None
    api_contract: Optional[str] = None
    mock_payload: Optional[str] = None


class Issue(BaseModel):
    id: str
    title: str
    description: str
    type: IssueType
    estimate_days: float
    risk: Risk
    required_skill: str
    context_scope: ContextScope
    assignee: Optional[str] = None  # gitlab_username, filled by assignment engine
    # ── relay + polymorphic-kind additions (all optional → planner output stays backward-compatible) ──
    kind: Optional[Kind] = None  # artifact class; defaults from `type` (design→design, devops→infra, else code)
    depends_on: list[str] = Field(default_factory=list)  # upstream issue ids whose done-artifact feeds this one
    api_contract: Optional[str] = None  # mock payload a backend issue produces; flows into FE micro-context
    context: IssueContext = Field(default_factory=IssueContext)  # kind-specific extras, filled at ratify
    stretch_flag: Optional[str] = None  # set by assignment when a dev is stretched out of discipline (e.g. "no prior uiux")
    # ── spine refactor (P0, additive) ──
    capability_tags: list[str] = Field(default_factory=list)  # dynamic AI-discovered skills; closed list[str] (Gemini-safe)
    lane: Optional[Lane] = None  # relay-DAG gate node; defaults to `discipline` (the transition shim)

    @model_validator(mode="after")
    def _fill_kind(self) -> "Issue":
        if self.kind is None:
            self.kind = _TYPE_TO_KIND.get(self.type, "code")
        if self.lane is None:
            self.lane = self.discipline  # shim: legacy issues get lane == discipline for free
        return self

    @computed_field  # serialized so the frontend relay board can group by discipline
    @property
    def discipline(self) -> Discipline:
        return _TYPE_TO_DISCIPLINE.get(self.type, "backend")


class Epic(BaseModel):
    id: str
    title: str
    issues: list[Issue]


class TechStack(BaseModel):
    frontend: str
    backend: str
    db: str
    infra: str


class PlanJSON(BaseModel):
    project_name: str
    client_summary: str
    tech_stack: TechStack
    grounded_on: list[str] = Field(default_factory=list)
    timeline_weeks: int
    epics: list[Epic]


# ── Developer profiles (spec §4, API view — embedding stays server-side) ──
class DeveloperProfile(BaseModel):
    name: str
    gitlab_username: str
    skills_text: str
    trust_level: TrustLevel = "low"            # overall (max across disciplines) — display + back-compat
    history: list[dict] = Field(default_factory=list)
    # ── member/account fields (per-account demo: this profile IS the login account) ──
    username: str = ""                          # sprint0 login id; defaults to gitlab_username
    email: str = ""
    role: Role = "developer"
    discipline: Optional[Discipline] = None     # set for devs; None for the manager
    seniority: Seniority = "mid"
    load: int = 0                               # 0-100 capacity used; >=100 → unavailable
    gitlab_user_id: Optional[int] = None        # real GitLab user → native assignee; None = label-only
    trust: dict[str, TrustLevel] = Field(default_factory=dict)  # per-discipline tier (overrides trust_level)
    joined: Optional[str] = None                # ISO month joined the agency (YYYY-MM); shown on the Passport

    @model_validator(mode="after")
    def _default_username(self) -> "DeveloperProfile":
        if not self.username:
            self.username = self.gitlab_username
        return self

    def trust_in(self, discipline: str | None) -> TrustLevel:
        """Per-discipline trust, falling back to the overall trust_level."""
        return self.trust.get(discipline or "", self.trust_level)


# ── REST request/response helpers (spec §5.4) ───────────────────────
class BriefCreated(BaseModel):
    brief_id: str


class PlanCreated(BaseModel):
    plan_id: str


class ApproveRequest(BaseModel):
    mode: Literal["copilot", "autonomous"]
    edits: Optional[PlanJSON] = None


# ── Idea 1: constraint sliders + Architecture Cards ──
class Constraints(BaseModel):
    time_to_market: Literal["fast", "balanced", "thorough"] = "balanced"
    scalability: Literal["small", "medium", "large"] = "medium"
    reliability: Literal["low-cost", "standard", "high-availability"] = "standard"


class ArchitectureCard(BaseModel):
    name: str = Field(description="≤4 words")
    tech_stack: TechStack
    summary: str = Field(description="one line, ≤140 chars — what this stack is")
    rationale: str = Field(description="≤200 chars — why; cite past projects + which roster devs fit")
    grounded_on: list[str] = Field(default_factory=list)
    fit_to_constraints: str = Field(description="≤80 chars — how it meets the constraints")


class ArchitectureOptions(BaseModel):
    cards: list[ArchitectureCard]


class ParsedCV(BaseModel):
    name: str
    gitlab_username: str
    skills_text: str
    suggested_discipline: Optional[Discipline] = None  # the AI's lane guess (manager confirms → seats them)


class PlanRequest(BaseModel):
    constraints: Optional[Constraints] = None
    chosen_stack: Optional[TechStack] = None


# ── Intake: clarified spec + ambiguity cards (the manager's first panel) ──
class AmbiguityCard(BaseModel):
    id: str
    feature: str                       # the unclear *feature* (not a technical detail)
    question: str
    options: list[str]                 # 2-3 candidate interpretations
    resolution: Optional[str] = None   # manager's pick or free-text escape


class ReuseItem(BaseModel):
    from_project: str
    feature: str
    action: Literal["reuse", "adapt", "drop"] = "reuse"


class ClarifiedSpec(BaseModel):
    """Emitted by the clarify agent (goal/users/must_haves/constraints/ambiguities);
    `reuse` is filled server-side from the memory match."""
    goal: str
    users: list[str] = Field(default_factory=list)
    must_haves: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    ambiguities: list[AmbiguityCard] = Field(default_factory=list)
    reuse: list[ReuseItem] = Field(default_factory=list)


# ── Relay: the ratification DAG ({uiux ∥ be} → fe → qa) ──
class Gate(BaseModel):
    discipline: Lane  # the lane this gate ratifies (a seed discipline today; an AI-discovered lane tomorrow)
    status: GateStatus = "pending"
    depends_on: list[Lane] = Field(default_factory=list)  # gates that must finish first
    note: str = ""
    # ── spine refactor (P0, additive): the router's per-gate decision; all null on legacy gates ──
    tier: Optional[RoutingTier] = None            # auto_pass | one_expert | two_expert (the router's call)
    confidence: Optional[int] = None              # AI confidence (0-100) feeding P(error)
    blast_radius: Optional[int] = None            # measured graph-dependents count of the slice's files
    expected_cost: Optional[float] = None         # P(error) × blast — what the tier thresholds on
    routed_note: str = ""                         # why this tier (e.g. "blast estimated — no graph")


class IntegrationSignal(BaseModel):
    """An append-only declaration that one issue's API integration is failing (or back ok).
    The CONSUMER (a downstream issue's assignee) or the qa-gate owner fires it; it routes to the
    PRODUCER issue (`target_issue_id`, resolved from the consumer's `depends_on`). An open `failing`
    signal blocks the qa gate. `source` is the pluggable seam: `manual` now; `ci`/`ai` slot in later
    behind the same routing with no change to the relay."""
    target_issue_id: str                                   # producer issue being rejected
    state: Literal["failing", "ok"]
    by: str                                                 # username who fired it
    reporter_issue_id: Optional[str] = None                # consumer issue that flagged it (None = owner picked)
    source: Literal["manual", "webhook", "ci", "ai"] = "manual"
    note: str = ""
    created_at: str = ""


class RelayState(BaseModel):
    gates: list[Gate]
    baton: list[Lane] = Field(default_factory=list)  # active gates: unblocked, not yet done
    integration_signals: list[IntegrationSignal] = Field(default_factory=list)  # api-failing/ok flags (B+C+D)


class CapabilityProfile(BaseModel):
    """A discovered unit of capability the planner can tag work with (spine refactor). The dictionary
    grows as the AI proposes new profiles; a manager confirms (proposed→confirmed) before a profile
    shapes the bounded lane topology. `skill_keywords` feed scored attribution + soft lane adjacency."""
    id: str
    label: str
    summary: str = ""
    skill_keywords: list[str] = Field(default_factory=list)
    default_lane: Lane = "backend"
    status: Literal["seed", "proposed", "confirmed"] = "proposed"
    created_at: str = ""


# ── Persistence: a scaffolded project (for mid-prod delta grounding) ──
class ProjectRecord(BaseModel):
    project_id: int
    name: str
    web_url: str = ""
    group: str = "sprint0-demo"  # workspace group the project lives in; seam for future multi-client
    tech_stack: TechStack
    grounded_on: list[str] = Field(default_factory=list)
    plan: PlanJSON
    status: Literal["scaffolded", "in_progress", "shipped", "closed"] = "scaffolded"
    module_manifest: list[str] = Field(default_factory=list)  # key files/modules for mid-prod grounding


# ── Decision Portfolio: a durable record captured when a lead ratifies a gate ──
class Decision(BaseModel):
    """What a discipline lead decided at a relay gate + why — the agency's reasoning memory.
    AI-related fields are all optional so a record can be built with NO AI involved (a pure
    human ratification still produces a Decision)."""
    id: str
    owner_id: str                                       # the ratifying member's username
    domain: Discipline
    context_tags: list[str] = Field(default_factory=list)  # required_skills the slice touched
    recommendation: str                                 # what was decided (the ratified slice, condensed)
    reasoning: str = ""                                 # why (the lead's explanation at ratify time)
    project_id: str                                     # the plan_id this decision belongs to
    project_name: str
    issue_ids: list[str] = Field(default_factory=list)  # the slice's issue ids
    outcome_validated: bool = False                     # set later when the shipped project validates it
    visibility: Literal["personal", "team"] = "personal"
    deprecated: bool = False
    deprecation_reason: Optional[str] = None
    ai_proposal_at_time: Optional[str] = None           # the AI's draft recommendation, if any
    confidence_at_time: Optional[int] = None            # the AI's confidence (0-100), if any
    deviation_from_ai: bool = False                     # did the lead override the AI draft?
    deviation_reason: Optional[str] = None
    # ── spine refactor (P0): graded reference strength, auto-promoted by real signals at slice granularity ──
    grade: Literal["proposed", "shipped", "prod_survived", "retro_validated"] = "proposed"
    merged: bool = False                                # slice merged to the main branch
    qa_passed: bool = False                             # slice cleared QA / acceptance
    days_clean: int = 0                                 # consecutive days with no reopen on the slice
    promoted_at: Optional[str] = None                   # when grade last advanced
    created_at: str
    updated_at: str


class Notification(BaseModel):
    """A row in a member's Inbox feed. `type` covers ratify, access, QA, ship, and (Phase E)
    reschedule events; `ref` carries deep-link ids (plan_id/grant_id/task_id)."""
    id: str
    user_id: str                  # recipient username
    type: Literal["ratify_needed", "access_requested", "access_granted", "qa_failed",
                  "project_shipped", "reschedule_proposed", "reschedule_resolved", "task_assigned",
                  "task_completed", "drift_flagged"]
    title: str
    body: str = ""
    ref: dict = Field(default_factory=dict)
    actionable: bool = False
    read: bool = False
    created_at: str


class AccessGrant(BaseModel):
    """Consent-based visibility: requester asks to see subject's full task detail; subject
    accepts/revokes. Replaces the vision-spec UserSubscription."""
    id: str
    requester_id: str
    subject_id: str
    status: Literal["pending", "granted", "revoked"] = "pending"
    notifications_muted: bool = False
    created_at: str
    updated_at: str


class UserSubscription(BaseModel):
    """Roadmap System 5: a watcher opts in to another member's events (e.g. a senior follows a junior's
    `assigned`/`qa_failed`). Drives notification fan-out + live WS push — NOT visibility (that stays
    consent-based via AccessGrant)."""
    id: str
    watcher_id: str
    subject_id: str
    events: list[Literal["assigned", "completed", "qa_failed", "drift_flagged"]] = Field(default_factory=list)
    created_at: str


class ChangeEvent(BaseModel):
    """Append-only delta in the project/roadmap change log — a calendar OR a work change. Drives the
    reflow engine: calendar kinds derive per-person availability; work kinds trigger impact analysis."""
    id: str
    kind: Literal["meeting", "holiday", "sick", "time_off", "capacity",        # calendar
                  "estimate_change", "spec_change", "scope_change", "blocked", # work
                  "dependency_added", "task_done",
                  "claim", "release", "reassign"]                              # assignment
    user_id: Optional[str] = None          # whose calendar/capacity (calendar + assignment kinds)
    task_id: Optional[str] = None          # which task (work + assignment kinds)
    project_id: Optional[int] = None
    start: Optional[str] = None            # ISO date — for date-range calendar events (sick/holiday/…)
    end: Optional[str] = None              # ISO date — inclusive; defaults to `start` when absent
    payload: dict = Field(default_factory=dict)   # kind-specific, e.g. {"old": 2.0, "new": 6.0}
    created_at: str


class RescheduleStrategy(BaseModel):
    """The AI Strategist's verdict on a change — a typed strategy the deterministic solver executes,
    never prose, never dates. Typed fields only (no open dict) so Gemini's schema accepts it."""
    action: Literal["right_shift", "reassign", "compress", "descope", "re_estimate", "re_plan", "escalate"]
    target_task_ids: list[str] = Field(default_factory=list)   # tasks the action applies to
    reassign_to: Optional[str] = None                          # action=reassign → the new assignee
    rationale: str                                             # one line, ≤200 chars — why
    confidence: int = 50                                       # 0-100
    impact_summary: str = ""                                   # ≤200 chars — human-facing "what & who"


class ImpactedTask(BaseModel):
    """One task touched by a reschedule — old→new dates the reflow produced (for the consent card)."""
    task_id: str
    title: str = ""
    assignee: Optional[str] = None
    old_start: Optional[str] = None
    old_end: Optional[str] = None
    scheduled_start: Optional[str] = None
    scheduled_end: Optional[str] = None


class RescheduleProposal(BaseModel):
    """A high-impact strategy held for the manager to ratify before it applies. The reflow's
    right-shift is already live; this proposes the smarter fix (reassign/descope/re-estimate)."""
    id: str
    project_id: Optional[int] = None
    event: ChangeEvent
    strategy: RescheduleStrategy
    impacted: list[ImpactedTask] = Field(default_factory=list)
    affected_users: list[str] = Field(default_factory=list)
    status: Literal["proposed", "applied", "rejected"] = "proposed"
    created_at: str
    resolved_at: Optional[str] = None
    resolved_by: Optional[str] = None


class Task(BaseModel):
    """Persistent unit of work — source of truth for the Work hub. Materialized from a plan,
    linked to a GitLab issue on dispatch."""
    id: str
    project_id: int
    gitlab_issue_iid: Optional[int] = None
    title: str
    description: str
    discipline: Discipline
    assignee: Optional[str] = None
    assigned_by: str = "ai"   # "ai" | "self" | "<username>"
    estimate_days: float = 1.0
    risk: Risk = "medium"
    depends_on: list[str] = Field(default_factory=list)
    status: Literal["planned", "in_progress", "in_review", "done", "blocked"] = "planned"
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    scheduled_start: Optional[str] = None   # ISO date, engine-computed (Phase C)
    scheduled_end: Optional[str] = None
    pinned: bool = False                     # locked dates → reflow treats as fixed, never moves it
    context_scope: ContextScope
    kind: Optional[Kind] = None              # artifact class (mirrors the Issue) → drives the work surface in the UI
    context: IssueContext = Field(default_factory=IssueContext)  # kind-specific extras (figma/rubric/screens…)
    api_contract: Optional[str] = None       # mock payload a backend task produces
    created_at: str
    updated_at: str


# ── QA: agent-prefilled acceptance checklist ──
class QAItemResult(BaseModel):
    issue_id: str
    title: str
    verdict: Literal["pass", "fail", "needs_human"]
    note: str = ""
    runner: Optional[str] = None    # the responsible dev (issue.assignee) — reject reroutes here
    disc: Optional[Discipline] = None  # the gate this item belongs to — drives the QA route pills


class TesterPick(BaseModel):
    """Who the AI picks to run the acceptance (Tester) gate — by passport, not job title. Surfaced on
    the QA report so the Tester panel can show *who* + *why* (best verifier, usually QA, maybe a dev)."""
    username: str
    name: str
    discipline: Optional[Discipline] = None
    score: float = 0.0
    reason: str = ""


class QAReport(BaseModel):
    items: list[QAItemResult] = Field(default_factory=list)
    reopened: list[int] = Field(default_factory=list)  # iids bounced back to re-QA (set by the endpoint)
    tester: Optional[TesterPick] = None                # the best-by-passport verifier for this gate


class QAQueueEntry(BaseModel):
    """One project/relay with QA work outstanding — a row in the cross-project Tester queue."""
    project_id: int
    project_name: str
    plan_id: str
    qa_status: str                                          # the qa gate's status
    baton: bool = False                                     # qa holds the baton (it's this gate's turn)
    issue_count: int = 0                                    # issues in the accept stage
    awaiting_reqa: list[int] = Field(default_factory=list)  # reopened iids awaiting re-QA


class QAQueue(BaseModel):
    count: int = 0
    queue: list[QAQueueEntry] = Field(default_factory=list)


# ── REST request bodies (intake / relay / mid-prod) ──
class ClarifyResolution(BaseModel):
    answers: dict[str, str]  # ambiguity id → resolution text


# ── Decision Cards (roadmap System 2): two-pass adversarial AI evaluation ──
def _trunc_words(s: str, n: int) -> str:
    return " ".join((s or "").split()[:n])


class DecisionCardPass1(BaseModel):
    """Pass 1 — independent domain evaluation. NEVER sees the past decision (anti-anchoring).
    Validators truncate to force concision (the AI cannot leak a paragraph into the UI)."""
    domain: str = ""
    context: str = ""
    recommendation: str = ""
    confidence: int = 50
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)

    @field_validator("context")
    @classmethod
    def _ctx(cls, v: str) -> str:
        return (v or "")[:50]

    @field_validator("recommendation")
    @classmethod
    def _rec(cls, v: str) -> str:
        return _trunc_words(v, 10)

    @field_validator("confidence")
    @classmethod
    def _conf(cls, v: int) -> int:
        return max(0, min(100, int(v)))

    @field_validator("pros", "cons")
    @classmethod
    def _items(cls, v: list[str]) -> list[str]:
        return [_trunc_words(x, 8) for x in (v or [])[:3]]


class ConflictVerdict(BaseModel):
    """Pass 2 — adversarial compare of the AI recommendation vs the user's past decision."""
    conflict: bool = False
    conflict_reason: str = ""

    @field_validator("conflict_reason")
    @classmethod
    def _cr(cls, v: str) -> str:
        return _trunc_words(v, 15)


class DecisionCard(BaseModel):
    """The assembled card the UI renders: Pass-1 fields + Pass-2 conflict. AI emits structured data
    only — no AI prose appears in the interface."""
    domain: str
    context: str = ""
    recommendation: str = ""
    confidence: int = 50
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)
    conflict: bool = False
    conflict_reason: Optional[str] = None


# ── Reuse-or-Innovate solutions (the Contract spine): per-gate choice the lead ratifies ──
class SolutionCard(BaseModel):
    """One ratifiable solution for a Contract gate. Validator-truncated so the AI emits concise data,
    never prose. `id`/`impacted_files` are server-assigned; the LLM sets the rest (source ∈ memory|ai;
    the `user` write-your-own slot is built server-side)."""
    id: str = ""
    source: Literal["memory", "ai", "user"] = "ai"
    title: str = ""
    summary: str = ""
    rationale: str = ""
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)
    confidence: int = 50
    grounded_on: list[str] = Field(default_factory=list)   # past-project name(s) reused (memory source)
    delta_note: str = ""                                   # "variant of X + <delta>" when fresh ≈ memory
    impacted_files: list[str] = Field(default_factory=list)  # server-computed (context_scope ∪ graph deps)

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        return _trunc_words(v, 7)

    @field_validator("summary", "delta_note")
    @classmethod
    def _line(cls, v: str) -> str:
        return (v or "")[:140]

    @field_validator("rationale")
    @classmethod
    def _rat(cls, v: str) -> str:
        return (v or "")[:200]

    @field_validator("confidence")
    @classmethod
    def _conf(cls, v: int) -> int:
        return max(0, min(100, int(v)))

    @field_validator("pros", "cons")
    @classmethod
    def _items(cls, v: list[str]) -> list[str]:
        return [_trunc_words(x, 8) for x in (v or [])[:3]]


class SolutionSet(BaseModel):
    """All solutions for one gate — one LLM call generates them. `discipline` is server-set."""
    discipline: str = ""
    solutions: list[SolutionCard] = Field(default_factory=list)


class RegenIssue(BaseModel):
    id: str
    title: str = ""
    description: str = ""
    files: list[str] = Field(default_factory=list)


class RegeneratedSlice(BaseModel):
    """The AI's rewrite of a gate's issues to match a user-WRITTEN solution (the reactive beat)."""
    issues: list[RegenIssue] = Field(default_factory=list)


class RatifyRequest(BaseModel):
    edits: Optional[list[Issue]] = None  # the lead's adjusted slice; None = accept the draft as-is
    note: str = ""
    reasoning: str = ""  # why the lead ratified this way → captured into the durable Decision record
    approve: bool = True
    # Decision Cards (System 2): what the AI proposed + whether the lead deviated → stored on the Decision
    ai_recommendation: str = ""
    ai_confidence: Optional[int] = None
    deviated: bool = False
    deviation_reason: str = ""
    chosen_solution: Optional[SolutionCard] = None  # the reuse-or-innovate pick (or write-your-own)


class DispatchRequest(BaseModel):
    mode: Literal["copilot", "autonomous"] = "copilot"


class FeatureRequest(BaseModel):  # mid-prod feature add
    text: str
    constraints: Optional[Constraints] = None
    priority: Literal["low", "normal", "high", "urgent"] = "normal"  # urgent → the feature's tasks preempt planned work


# ── Code Graph (roadmap System 4): dependency graph (A) + decision governance (B) + drift ──
class GraphNode(BaseModel):
    path: str                                              # repo-relative file path
    domain: str = "backend"                                # inferred from path
    node_type: Literal["file", "module", "interface"] = "file"
    project_id: str = "local"
    loc: int = 0                                           # lines of code (cheap size signal)
    governed_by: list[str] = Field(default_factory=list)   # decision ids that govern this file


class GraphEdge(BaseModel):
    from_path: str
    to_path: str
    edge_type: Literal["import", "export", "contract", "data-flow"] = "import"
    project_id: str = "local"


class GovernanceRule(BaseModel):
    """Graph B: a ratified decision governs a path pattern (e.g. 'all auth code lives under app/auth')."""
    id: str
    decision_id: str = ""
    domain: str = "backend"
    governs_pattern: str                                   # glob, e.g. 'app/*auth*' or 'app/scheduler*'
    constraint: str = ""                                   # human-readable rule
    forbid_importers_outside: bool = True                  # flag files OUTSIDE the pattern importing a governed file
    created_at: str = ""


class DriftReport(BaseModel):
    """A graph-detected violation → becomes a maintenance/refactor task in the relay."""
    severity: Literal["blocking", "drift", "cosmetic"] = "drift"
    drift_from_decision_id: str = ""
    drift_from_description: str = ""                       # human-readable governing rule/cause
    affected_files: list[str] = Field(default_factory=list)
    violation: str = ""
    suggested_fix: str = ""
    effort: Literal["small", "medium", "large"] = "medium"
    domain: str = "backend"
