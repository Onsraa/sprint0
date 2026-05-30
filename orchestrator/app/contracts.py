"""Hard interface contracts (spec §5). The single source of truth for the
shape of data flowing Gemini → frontend → executor. Changing anything here
means notifying every dependent slice.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, computed_field, model_validator

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

    @model_validator(mode="after")
    def _fill_kind(self) -> "Issue":
        if self.kind is None:
            self.kind = _TYPE_TO_KIND.get(self.type, "code")
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
    discipline: Discipline
    status: GateStatus = "pending"
    depends_on: list[Discipline] = Field(default_factory=list)  # gates that must finish first
    note: str = ""


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
    baton: list[Discipline] = Field(default_factory=list)  # active gates: unblocked, not yet done
    integration_signals: list[IntegrationSignal] = Field(default_factory=list)  # api-failing/ok flags (B+C+D)


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
    created_at: str
    updated_at: str


class Notification(BaseModel):
    """A row in a member's Inbox feed. `type` covers ratify, access, QA, ship, and (Phase E)
    reschedule events; `ref` carries deep-link ids (plan_id/grant_id/task_id)."""
    id: str
    user_id: str                  # recipient username
    type: Literal["ratify_needed", "access_requested", "access_granted", "qa_failed",
                  "project_shipped", "reschedule_proposed", "reschedule_resolved"]
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
    """One task touched by a reschedule — the new dates the reflow produced (for the consent card)."""
    task_id: str
    title: str = ""
    assignee: Optional[str] = None
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
    created_at: str
    updated_at: str


# ── QA: agent-prefilled acceptance checklist ──
class QAItemResult(BaseModel):
    issue_id: str
    title: str
    verdict: Literal["pass", "fail", "needs_human"]
    note: str = ""


class QAReport(BaseModel):
    items: list[QAItemResult] = Field(default_factory=list)
    reopened: list[int] = Field(default_factory=list)  # iids bounced back to re-QA (set by the endpoint)


# ── REST request bodies (intake / relay / mid-prod) ──
class ClarifyResolution(BaseModel):
    answers: dict[str, str]  # ambiguity id → resolution text


class RatifyRequest(BaseModel):
    edits: Optional[list[Issue]] = None  # the lead's adjusted slice; None = accept the draft as-is
    note: str = ""
    reasoning: str = ""  # why the lead ratified this way → captured into the durable Decision record
    approve: bool = True


class DispatchRequest(BaseModel):
    mode: Literal["copilot", "autonomous"] = "copilot"


class FeatureRequest(BaseModel):  # mid-prod feature add
    text: str
    constraints: Optional[Constraints] = None
