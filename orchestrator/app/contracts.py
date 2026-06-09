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
    # ── per-task dev payload (WS11): the scoped brief Gemini writes for whoever picks up this task ──
    feature: str = ""                                       # the parent feature this task belongs to
    does: str = ""                                          # ≤200 — what this task SHOULD do (scoped exactly to it)
    not_does: str = ""                                      # ≤200 — what it should NOT do (the scope boundary)
    directives: list[str] = Field(default_factory=list)     # 1-3 light, concise code recommendations from the planner

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


# ── Availability (when can this person start new work — derived from the live schedule) ──
class Availability(BaseModel):
    """Honest capacity signal: NOT a load %, but the earliest day a member can pick up new work,
    computed server-side from their scheduled tasks (+ external-commitment baseline). `free_in_days==0`
    means free now."""
    available_on: str                # ISO date — earliest start for new work
    free_in_days: int = 0            # workdays from today → available_on (0 = free now)
    queued_days: float = 0.0         # Σ estimate_days of active (not-done) assigned tasks
    active_count: int = 0            # number of active assigned tasks


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
    availability: Optional[Availability] = None  # server-computed (roster API only); when they can start new work
    needs_link: bool = False                    # server-derived (roster API): a repo-needing dev with no GitLab link

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


class ReuseItem(BaseModel):
    from_project: str
    feature: str
    action: Literal["reuse", "adapt", "drop"] = "reuse"
    reason: str = ""                                       # ≤140 — why this is worth reusing for THIS brief


class MemoryCandidate(BaseModel):
    """A reusable CAPABILITY the AI found in agency memory and judged against THIS brief (CRAG: a reasoned fit
    verdict, not a similarity score). Capability-level, not file-level — paths belong to the gate's impacted
    files, not the choice. The human ratifies which capabilities ground the plan."""
    ref: str                                               # grounding key — the source project (select_grounded)
    project: str = ""                                      # source project name
    year: str = ""                                         # shipped year, parsed from the project name
    capability: str = ""                                   # short name, e.g. "Live-map vehicle tracking"
    what: str = ""                                         # ≤120 — what this capability does (the reusable part)
    reason: str = ""                                       # ≤140 — WHY it does or doesn't fit this brief
    fit: Literal["strong", "partial", "skip"] = "skip"     # the AI's relevance call — abstain = skip
    pros: list[str] = Field(default_factory=list)          # detail view — why grounding on it helps
    cons: list[str] = Field(default_factory=list)          # detail view — caveats / what differs
    used: bool = False                                     # the human's pick (server defaults strong→True; the UI toggles)


class MemoryJudgment(BaseModel):
    """The memory-judge agent's output (judge_memory): a reuse verdict per retrieved candidate, graded on the
    RESOLVED spec — after the manager answered the ambiguities, so their answers can shift the grounding."""
    candidates: list[MemoryCandidate] = []


class ArchitectureCard(BaseModel):
    name: str = Field(description="≤4 words")
    tech_stack: TechStack
    summary: str = Field(description="one line, ≤140 chars — what this stack is")
    rationale: str = Field(description="≤200 chars — why; cite past projects + which roster devs fit")
    grounded_on: list[str] = Field(default_factory=list)
    fit_to_constraints: str = Field(description="≤80 chars — how it meets the constraints")
    pros: list[str] = Field(default_factory=list)          # ≤3, each ≤8 words
    cons: list[str] = Field(default_factory=list)          # ≤3, each ≤8 words
    reuse: list[ReuseItem] = Field(default_factory=list)   # features fetched from memory + the project each came from
    recommended: bool = False                              # server-set: the deterministic pick (most proven reuse + fit)

    @field_validator("pros", "cons")
    @classmethod
    def _trunc_proscons(cls, v: list[str]) -> list[str]:
        return [_trunc_words(x, 8) for x in (v or [])[:3]]


class ArchitectureOptions(BaseModel):
    cards: list[ArchitectureCard]
    ai_pick_name: str = ""    # the option the AI itself would pick (may favor a modern/fresh stack over the most-reuse one)
    ai_pick_why: str = ""     # one-line why (≤140)

    @field_validator("ai_pick_why")
    @classmethod
    def _trunc_why(cls, v: str) -> str:
        return (v or "")[:140]


class ParsedCV(BaseModel):
    name: str
    gitlab_username: str
    skills_text: str
    suggested_discipline: Optional[Discipline] = None  # the AI's lane guess (manager confirms → seats them)


class PlanRequest(BaseModel):
    constraints: Optional[Constraints] = None
    chosen_stack: Optional[TechStack] = None
    setup_owner: Optional[str] = None       # the manager redirected the stack choice to this lead → a setup gate


# ── Intake: clarified spec + ambiguity cards (the manager's first panel) ──
class AmbiguityCard(BaseModel):
    id: str
    feature: str                       # the unclear *feature* (not a technical detail)
    question: str
    options: list[str]                 # 2-3 candidate interpretations
    resolution: Optional[str] = None   # manager's pick or free-text escape


class ClarifiedSpec(BaseModel):
    """Emitted by the clarify agent (goal/users/must_haves/constraints/ambiguities);
    `reuse` is filled server-side from the memory match."""
    goal: str
    users: list[str] = Field(default_factory=list)
    must_haves: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    ambiguities: list[AmbiguityCard] = Field(default_factory=list)
    reuse: list[ReuseItem] = Field(default_factory=list)
    memory_candidates: list[MemoryCandidate] = Field(default_factory=list)  # CRAG: judged reuse candidates (verdict + why)


# ── Relay: the ratification DAG ({uiux ∥ be} → fe → qa) ──
class Gate(BaseModel):
    discipline: Lane  # the lane this gate ratifies (a seed discipline today; an AI-discovered lane tomorrow)
    status: GateStatus = "pending"
    depends_on: list[Lane] = Field(default_factory=list)  # gates that must finish first
    note: str = ""
    owner: Optional[str] = None  # the lead this gate routes to (the lane's assignee = best profile); None = gap → Tech Lead
    delegate: Optional[str] = None  # human-in-control: a lead handed this gate (+ its slice) to this user to ratify
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
    status: Literal["reserved", "scaffolded", "in_progress", "shipped", "closed"] = "scaffolded"  # reserved = empty repo, relay still open (two-phase)
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


# ── Agreements (the coordination spine): AI-drafted, async-ratified, compounding ──
class SchemaField(BaseModel):
    """One field of an interface payload — a Gemini-safe stand-in for JSON-Schema (no open dicts)."""
    name: str
    type: Literal["string", "number", "integer", "boolean", "object", "array", "null"] = "string"
    required: bool = True
    note: str = ""


class FileChange(BaseModel):
    """One file a solution or contract touches, with the KIND of change. `change` is a closed enum (Gemini-safe).
    The SERVER reconciles it against the known file set (code graph / reuse pack): a path that does not exist can
    only be `add`, and `remove` is honored only for a known path with explicit intent — never a blind delete."""
    path: str = ""
    change: Literal["add", "modify", "remove"] = "modify"

    @field_validator("path")
    @classmethod
    def _path(cls, v: str) -> str:
        return (v or "")[:160]


class InterfaceDraft(BaseModel):
    """A cross-discipline interface contract (CDD) — the typed payload of an `interface` Agreement. The AI
    drafts it from both slices' needs, grounded on past interfaces; both leads ratify it BEFORE either builds.
    This is the **API** contract kind (backend↔frontend: method/path/schema). The CDD concept generalizes to
    other discipline pairs (deploy/runtime, design-handoff, acceptance) — a per-kind shape is future work."""
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "GET"
    path: str = ""                                            # e.g. /api/listings/{id}
    request_fields: list[SchemaField] = Field(default_factory=list)
    response_fields: list[SchemaField] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)           # e.g. ["404 not_found", "409 conflict"]
    note: str = ""


class InterfaceProposal(BaseModel):
    """One pickable API-shape option for a contract — the SolutionCard analogue for an interface. The producer
    picks one (or writes their own); each carries a short why + pros/cons so the call is informed."""
    id: str = ""
    source: Literal["memory", "ai", "user"] = "ai"
    interface: InterfaceDraft = Field(default_factory=InterfaceDraft)
    why: str = ""
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)
    grounded_on: list[str] = Field(default_factory=list)   # past project(s) reused (memory source)
    confidence: int = 50

    @field_validator("why")
    @classmethod
    def _why(cls, v: str) -> str:
        return (v or "")[:140]

    @field_validator("pros", "cons")
    @classmethod
    def _items(cls, v: list[str]) -> list[str]:
        return [_trunc_words(x, 8) for x in (v or [])[:3]]

    @field_validator("confidence")
    @classmethod
    def _conf(cls, v: int) -> int:
        return max(0, min(100, int(v)))


class ContractProposalSet(BaseModel):
    """The AI's answer for ONE cross-discipline edge: either it is NOT a real API boundary (`needed=false` —
    skip the contract, no noise), or a few shape options the producer chooses from. Gemini-safe (no open dict)."""
    needed: bool = True
    skip_reason: str = ""
    proposals: list[InterfaceProposal] = Field(default_factory=list)

    @field_validator("skip_reason")
    @classmethod
    def _skip(cls, v: str) -> str:
        return (v or "")[:140]


class SubteamDraft(BaseModel):
    """For 2+ devs on ONE discipline's slice — the AI proposes pair (high-risk → review / junior+senior →
    mentorship) or split (by skill, faster). The lane lead ratifies; the second dev's channel is Watch."""
    discipline: str = ""
    mode: Literal["pair", "split"] = "split"
    members: list[str] = Field(default_factory=list)
    rationale: str = ""


class Agreement(BaseModel):
    """The coordination unit: an AI-drafted, async-ratified, compounding decision. One shape per kind; the
    typed draft lives in a per-kind slot (`interface`, `subteam`). Additive — does NOT replace `Decision`."""
    id: str
    type: Literal["interface", "subteam", "reuse", "reschedule", "handoff", "assign", "priority"]
    plan_id: str
    subject: str = ""                                         # human label of what it binds
    interface: Optional[InterfaceDraft] = None                # set when type == "interface" — the CURRENT agreed shape
    proposals: list[InterfaceProposal] = Field(default_factory=list)  # the reuse/fresh/write-own options the producer picks from
    chosen_proposal_id: Optional[str] = None                  # which proposal the producer signed (→ `interface`)
    subteam: Optional[SubteamDraft] = None                    # set when type == "subteam"
    grounded_on: list[str] = Field(default_factory=list)
    ratifiers: list[str] = Field(default_factory=list)        # the MINIMAL consent set (usernames)
    ratifications: list[dict] = Field(default_factory=list)   # [{by, decision: ratified|rejected, at, note}]
    state: Literal["proposed", "auto_passed", "ratified", "rejected", "active", "validated", "superseded"] = "proposed"
    precedent_id: Optional[str] = None                        # the past ratified agreement it matched (auto-pass)
    superseded_by: Optional[str] = None                       # the newer versioned agreement that replaced this one (renegotiation)
    # interface routing/verify context
    producer_issue_id: Optional[str] = None
    consumer_issue_id: Optional[str] = None
    producer_discipline: Optional[str] = None
    consumer_discipline: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""


class Notification(BaseModel):
    """A row in a member's Inbox feed. `type` covers ratify, access, QA, ship, and (Phase E)
    reschedule events; `ref` carries deep-link ids (plan_id/grant_id/task_id)."""
    id: str
    user_id: str                  # recipient username
    type: Literal["ratify_needed", "access_requested", "access_granted", "qa_failed",
                  "project_shipped", "reschedule_proposed", "reschedule_resolved", "task_assigned",
                  "task_completed", "drift_flagged", "agreement_proposed"]
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
                  "dependency_added", "task_done", "source_changed",          # work (source_changed = a reused feature's content moved upstream)
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
    file_changes: list[FileChange] = Field(default_factory=list)  # per-file change kind (add/modify/remove); demo-authored, live = server-classified
    # ── #33 Contract richness: provenance signals (conflict LLM-flagged in context; grade/signal server-derived) ──
    conflict: bool = False                                  # contradicts a past TEAM decision fed into the prompt
    conflict_reason: str = ""                               # which decision it contradicts (≤140); shown as the warning
    grade: Optional[Literal["proposed", "shipped", "prod_survived", "retro_validated"]] = None  # earned strength (memory only)
    signal: Literal["green", "orange", "grey"] = "grey"     # server-derived triage roll-up (grading.signal_for)

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        return _trunc_words(v, 7)

    @field_validator("summary", "delta_note", "conflict_reason")
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
    chosen: Optional[SolutionCard] = None  # the ratified pick (review of a done gate); None when auto-passed


class RegenIssue(BaseModel):
    id: str
    title: str = ""
    description: str = ""
    files: list[str] = Field(default_factory=list)


class RegeneratedSlice(BaseModel):
    """The AI's rewrite of a gate's issues to match a user-WRITTEN solution (the reactive beat)."""
    issues: list[RegenIssue] = Field(default_factory=list)


class AdaptedCode(BaseModel):
    """Reuse layer-2: a reused source file lightly adapted to the new project's stack/naming — the
    seeded focus-branch draft. `code` is the adapted file content; `notes` is a one-line change summary."""
    code: str = ""
    notes: str = ""


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
    tech_stack: Optional[TechStack] = None          # setup gate only: the lead's stack choice (override or confirm)


class DispatchRequest(BaseModel):
    mode: Literal["copilot", "autonomous"] = "copilot"
    project_name: Optional[str] = None   # manager's edited name (AI auto-fills; the human validates before create)


class FeatureRequest(BaseModel):  # mid-prod feature add
    text: str
    constraints: Optional[Constraints] = None
    priority: Literal["low", "normal", "high", "urgent"] = "normal"  # urgent → the feature's tasks preempt planned work


# ── Code Graph (roadmap System 4): dependency graph (A) + decision governance (B) + drift ──
class GraphNode(BaseModel):
    path: str                                              # repo-relative file path; for a feature node: f"feat:{hash12}"
    domain: str = "backend"                                # inferred from path
    node_type: Literal["file", "module", "interface", "feature"] = "file"  # "feature" = a content-addressed reusable unit (Living Project Graph)
    project_id: str = "local"
    loc: int = 0                                           # lines of code (cheap size signal)
    governed_by: list[str] = Field(default_factory=list)   # decision ids that govern this file
    content_hash: str = ""                                  # pillar 2: sha over normalized content — the unit's identity (feature nodes); "" for file nodes
    title: str = ""                                         # human label for a feature node (e.g. "QuantaPay JWT+TOTP auth")
    ref_project_id: Optional[int] = None                    # for a reuse INSTANCE node: the real project it belongs to (so a sync task lands on the right board); None for the canonical source feature
    source_project_id: Optional[int] = None                 # for a CANONICAL feature: the GitLab project its source lives in → a real merge webhook maps to it
    # bitemporal (Living Project Graph): a node is a VERSION. Current reads see valid_to=None; as_of(T) reads see vf<=T<vt.
    valid_from: str = ""                                    # ISO time this version became true ("" = always/seed)
    valid_to: Optional[str] = None                          # ISO time it stopped being current (None = still current)
    tx_time: str = ""                                       # when the system recorded it (transaction time)
    deleted: bool = False                                   # tombstone: explicitly retired (kept for history; closed via valid_to)


class GraphEdge(BaseModel):
    from_path: str
    to_path: str
    edge_type: Literal["import", "export", "contract", "data-flow", "derived_from", "supersedes"] = "import"  # derived_from = reuse lineage; supersedes = a fix's new hash → old
    project_id: str = "local"
    valid_from: str = ""                                    # bitemporal (see GraphNode)
    valid_to: Optional[str] = None
    tx_time: str = ""
    deleted: bool = False


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
