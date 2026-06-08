/* sprint0 — domain schemas. Zod is the single source of truth: it validates API responses at the
 * boundary AND produces the TypeScript types (z.infer), so the types can never drift from what we
 * accept off the wire. Mirrors orchestrator/app/contracts.py (incl. the spine fields: gate routing
 * tier, capability tags, decision grade, dispatch preview).
 *
 * Convention: `export const X` is the Zod schema (a value); `export type X = z.infer<typeof X>` is the
 * type. api.ts re-exports the types, so panels keep importing them from "@/lib/api" unchanged.
 */
import { z } from "zod";

/* ── enums ───────────────────────────────────────────────────────────── */
export const TimeToMarket = z.enum(["fast", "balanced", "thorough"]);
export const Scalability = z.enum(["small", "medium", "large"]);
export const Reliability = z.enum(["low-cost", "standard", "high-availability"]);
export const IssueType = z.enum(["backend", "frontend", "db", "devops", "design"]);
export const Risk = z.enum(["low", "medium", "high"]);
export const Discipline = z.enum(["uiux", "backend", "frontend", "qa", "devops"]);
export type Discipline = z.infer<typeof Discipline>;
export const Kind = z.enum(["code", "design", "audit", "content", "infra", "runbook"]);
export type Kind = z.infer<typeof Kind>;
export const GateStatus = z.enum([
  "pending", "locked", "auto_passed", "ratified", "changes_requested", "blocked",
]);
export type GateStatus = z.infer<typeof GateStatus>;
export const RoutingTier = z.enum(["auto_pass", "one_expert", "two_expert"]);
export const TaskStatus = z.enum(["planned", "in_progress", "in_review", "done", "blocked"]);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const TaskPriority = z.enum(["low", "normal", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPriority>;
export const TrustLevel = z.enum(["low", "medium", "high"]);
export type TrustLevel = z.infer<typeof TrustLevel>;
export const MemberRole = z.enum(["manager", "developer"]);
export const Seniority = z.enum(["junior", "mid", "senior"]);
/** Graded reference strength (spine). */
export const Grade = z.enum(["proposed", "shipped", "prod_survived", "retro_validated"]);
export const ProfileStatus = z.enum(["seed", "proposed", "confirmed"]);

const unknownRecord = z.record(z.string(), z.unknown());

/* ── plan / intake ───────────────────────────────────────────────────── */
export const Constraints = z.object({
  time_to_market: TimeToMarket, scalability: Scalability, reliability: Reliability,
});
export type Constraints = z.infer<typeof Constraints>;

export const TechStack = z.object({
  frontend: z.string(), backend: z.string(), db: z.string(), infra: z.string(),
});
export type TechStack = z.infer<typeof TechStack>;

export const ContextScope = z.object({ files: z.array(z.string()), note: z.string() });
export type ContextScope = z.infer<typeof ContextScope>;

export const Issue = z.object({
  id: z.string(), title: z.string(), description: z.string(), type: IssueType,
  estimate_days: z.number(), risk: Risk, required_skill: z.string(), context_scope: ContextScope,
  assignee: z.string().nullable(), kind: Kind, discipline: Discipline,
  depends_on: z.array(z.string()), api_contract: z.string().nullable(), context: unknownRecord,
  stretch_flag: z.string().nullable(),
  // spine (P0): dynamic taxonomy — optional so legacy/draft issues still parse
  capability_tags: z.array(z.string()).optional(), lane: z.string().nullish(),
});
export type Issue = z.infer<typeof Issue>;

export const Epic = z.object({ id: z.string(), title: z.string(), issues: z.array(Issue) });
export type Epic = z.infer<typeof Epic>;

export const PlanJSON = z.object({
  project_name: z.string(), client_summary: z.string(), tech_stack: TechStack,
  grounded_on: z.array(z.string()), timeline_weeks: z.number(), epics: z.array(Epic),
});
export type PlanJSON = z.infer<typeof PlanJSON>;

export const AmbiguityCard = z.object({
  id: z.string(), feature: z.string(), question: z.string(),
  options: z.array(z.string()), resolution: z.string().nullable(),
});
export const ReuseItem = z.object({
  from_project: z.string(), feature: z.string(), action: z.enum(["reuse", "adapt", "drop"]),
});
export const ClarifiedSpec = z.object({
  goal: z.string(), users: z.array(z.string()), must_haves: z.array(z.string()),
  constraints: z.array(z.string()), ambiguities: z.array(AmbiguityCard), reuse: z.array(ReuseItem),
});
export type ClarifiedSpec = z.infer<typeof ClarifiedSpec>;

export const ArchitectureCard = z.object({
  name: z.string(), tech_stack: TechStack, summary: z.string(), rationale: z.string(),
  grounded_on: z.array(z.string()), fit_to_constraints: z.string(),
  pros: z.array(z.string()).optional(), cons: z.array(z.string()).optional(),
  reuse: z.array(ReuseItem).optional(),          // features from memory + the project each came from (block 3)
  recommended: z.boolean().optional(),           // server-set: the deterministic "most proven reuse" pick
});
export const ArchitectureOptions = z.object({
  cards: z.array(ArchitectureCard),
  ai_pick_name: z.string().optional(),           // the option the AI itself would pick (may favor a fresh stack)
  ai_pick_why: z.string().optional(),
});
export type ArchitectureOptions = z.infer<typeof ArchitectureOptions>;

/* ── relay ───────────────────────────────────────────────────────────── */
export const Gate = z.object({
  discipline: Discipline, status: GateStatus, depends_on: z.array(Discipline), note: z.string(),
  delegate: z.string().nullish(),   // human-in-control: a lead handed this gate to this user to ratify
  // spine (P1): the router's per-gate decision; null on legacy gates
  tier: RoutingTier.nullish(), confidence: z.number().nullish(), blast_radius: z.number().nullish(),
  expected_cost: z.number().nullish(), routed_note: z.string().optional(),
});
export type Gate = z.infer<typeof Gate>;

export const IntegrationSignal = z.object({
  target_issue_id: z.string(), state: z.enum(["failing", "ok"]), by: z.string(),
  reporter_issue_id: z.string().nullable(), source: z.enum(["manual", "webhook", "ci", "ai"]),
  note: z.string(), created_at: z.string(),
});
export type IntegrationSignal = z.infer<typeof IntegrationSignal>;

export const RelayState = z.object({
  gates: z.array(Gate), baton: z.array(Discipline), integration_signals: z.array(IntegrationSignal),
});
export type RelayState = z.infer<typeof RelayState>;

export const IntegrationCandidate = z.object({
  id: z.string(), title: z.string(), assignee: z.string().nullable(), api_contract: z.string().nullable(),
});
export type IntegrationCandidate = z.infer<typeof IntegrationCandidate>;
export const FlagIntegrationResult = z.union([
  RelayState, z.object({ need_target: z.literal(true), candidates: z.array(IntegrationCandidate) }),
]);
export type FlagIntegrationResult = z.infer<typeof FlagIntegrationResult>;

export const PlanResponse = z.object({ plan_id: z.string(), plan: PlanJSON, relay: RelayState });
export type PlanResponse = z.infer<typeof PlanResponse>;
export const FeaturePlanResponse = PlanResponse.extend({ project_id: z.number() });
export type FeaturePlanResponse = z.infer<typeof FeaturePlanResponse>;

/* ── decisions (portfolio + cards + grades) ──────────────────────────── */
export const Decision = z.object({
  id: z.string(), owner_id: z.string(), domain: Discipline, context_tags: z.array(z.string()),
  recommendation: z.string(), reasoning: z.string(), project_id: z.string(), project_name: z.string(),
  issue_ids: z.array(z.string()), outcome_validated: z.boolean(),
  visibility: z.enum(["personal", "team"]), deprecated: z.boolean(),
  deprecation_reason: z.string().nullish(),
  grade: Grade.optional(),  // spine (P4): earned reference strength
  created_at: z.string(), updated_at: z.string(),
});
export type Decision = z.infer<typeof Decision>;

export const DecisionCard = z.object({
  domain: z.string(), context: z.string(), recommendation: z.string(), confidence: z.number(),
  pros: z.array(z.string()), cons: z.array(z.string()), conflict: z.boolean(),
  conflict_reason: z.string().nullable(),
});
export type DecisionCard = z.infer<typeof DecisionCard>;

export const DecisionCardResponse = z.object({
  card: DecisionCard.nullable(), signal: z.enum(["green", "orange", "grey"]),
  low_confidence: z.boolean(), past: z.object({ own: z.array(Decision), team: z.array(Decision) }),
  // spine (P1): the gate's tier given this card's confidence + grounding
  routing: z.object({
    tier: RoutingTier, expected_cost: z.number().nullable(), blast_radius: z.number(), note: z.string(),
  }).nullish(),
  error: z.string().optional(),
});
export type DecisionCardResponse = z.infer<typeof DecisionCardResponse>;

/* ── capability profiles (spine P2 — net-new endpoint) ───────────────── */
export const CapabilityProfile = z.object({
  id: z.string(), label: z.string(), summary: z.string(),
  skill_keywords: z.array(z.string()), default_lane: z.string(),
  status: ProfileStatus, created_at: z.string(),
});
export type CapabilityProfile = z.infer<typeof CapabilityProfile>;
export const ProfilesResponse = z.object({ profiles: z.array(CapabilityProfile) });
export type ProfilesResponse = z.infer<typeof ProfilesResponse>;

/* ── code graph (System 4) ───────────────────────────────────────────── */
export const UserSubscription = z.object({
  id: z.string(), watcher_id: z.string(), subject_id: z.string(),
  events: z.array(z.string()), created_at: z.string(),
});
export type UserSubscription = z.infer<typeof UserSubscription>;
export const GraphNode = z.object({
  path: z.string(), domain: z.string(), node_type: z.string(), loc: z.number(), project_id: z.string(),
  content_hash: z.string().optional(), title: z.string().optional(), ref_project_id: z.number().nullish(),
});
export type GraphNode = z.infer<typeof GraphNode>;
export const GraphEdge = z.object({ from_path: z.string(), to_path: z.string(), edge_type: z.string() });
export type GraphEdge = z.infer<typeof GraphEdge>;
export const GovernanceRule = z.object({
  id: z.string(), decision_id: z.string(), domain: z.string(),
  governs_pattern: z.string(), constraint: z.string(),
});
export type GovernanceRule = z.infer<typeof GovernanceRule>;
export const DriftReport = z.object({
  severity: z.enum(["blocking", "drift", "cosmetic"]), drift_from_decision_id: z.string(),
  drift_from_description: z.string(), affected_files: z.array(z.string()), violation: z.string(),
  suggested_fix: z.string(), effort: z.enum(["small", "medium", "large"]), domain: z.string(),
});
export type DriftReport = z.infer<typeof DriftReport>;

/* ── queues / relays / projects ──────────────────────────────────────── */
export const QueueItem = z.object({
  plan_id: z.string(), project: z.string(), discipline: Discipline, status: GateStatus,
  issue_count: z.number(), is_delta: z.boolean(), target_project_id: z.number().nullable(),
});
export type QueueItem = z.infer<typeof QueueItem>;

export const RelaySummary = z.object({
  plan_id: z.string(), project: z.string(), baton: z.array(Discipline),
  gates: z.array(z.object({ discipline: Discipline, status: GateStatus, note: z.string(), delegate: z.string().nullish() })),
  is_delta: z.boolean(), target_project_id: z.number().nullable(), all_ratified: z.boolean(),
});
export type RelaySummary = z.infer<typeof RelaySummary>;

export const ProjectSummary = z.object({
  project_id: z.number(), name: z.string(), web_url: z.string(), kind: z.enum(["active", "reference"]),
  tech_stack: TechStack.optional(), grounded_on: z.array(z.string()).optional(),
  plan: PlanJSON.optional(), module_manifest: z.array(z.string()).optional(),
  status: z.string().nullish(), created_at: z.string().optional(), last_activity_at: z.string().optional(),
  summary: z.string().optional(), tags: z.array(z.string()).optional(),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

/* ── work tasks ──────────────────────────────────────────────────────── */
export const WorkTask = z.object({
  id: z.string(), project_id: z.number(), title: z.string(), status: TaskStatus,
  discipline: Discipline, assignee: z.string().nullable(), redacted: z.boolean().optional(),
  description: z.string().optional(), assigned_by: z.string().optional(),
  estimate_days: z.number().optional(), risk: Risk.optional(), depends_on: z.array(z.string()).optional(),
  priority: TaskPriority.optional(), scheduled_start: z.string().nullish(), scheduled_end: z.string().nullish(),
  pinned: z.boolean().optional(), gitlab_issue_iid: z.number().nullish(), context_scope: ContextScope.optional(),
  kind: Kind.nullish(), context: unknownRecord.optional(), api_contract: z.string().nullish(),
  capability_tags: z.array(z.string()).optional(), stretch_flag: z.string().nullish(),
  created_at: z.string().optional(), updated_at: z.string().optional(),
});
export type WorkTask = z.infer<typeof WorkTask>;
export const WorkResponse = z.object({ scope: z.string(), count: z.number(), tasks: z.array(WorkTask) });
export type WorkResponse = z.infer<typeof WorkResponse>;

/* ── dispatch / qa / attributions ────────────────────────────────────── */
export const Attribution = z.object({
  id: z.string(), gitlab_username: z.string(), task_type: z.string(), score: z.number(),
  project_id: z.number().nullable(), issue_iid: z.number().nullable(), suggested: z.string().nullable(),
});
export type Attribution = z.infer<typeof Attribution>;

export const DispatchResult = z.object({
  plan_id: z.string(), mode: z.enum(["copilot", "autonomous"]), web_url: z.string(),
  clone_url: z.string().optional(), project_id: z.number(), default_branch: z.string(),
  issues_created: z.number(), context_branches: z.number().optional(),
  qa_issue_iid: z.number().nullish(), persist_warning: z.string().optional(),
});
export type DispatchResult = z.infer<typeof DispatchResult>;

/** Dispatch dry-run preview (spine P4 — net-new endpoint). */
export const DispatchPreview = z.object({
  plan_id: z.string(), project_name: z.string(), is_delta: z.boolean(),
  creates: z.object({ project: z.number(), issues: z.number() }),
  member_invites: z.array(z.string()), invite_count: z.number(),
  free_tier_cap: z.number(), exceeds_cap: z.boolean(), relay_cleared: z.boolean(),
});
export type DispatchPreview = z.infer<typeof DispatchPreview>;

export const QAItemResult = z.object({
  issue_id: z.string(), title: z.string(),
  verdict: z.enum(["pass", "fail", "needs_human"]), note: z.string(),
  runner: z.string().nullish(),   // responsible dev (issue.assignee) — reject reroutes here
  disc: z.string().nullish(),     // gate this item belongs to — drives the QA route pills
});
export const TesterPick = z.object({
  username: z.string(), name: z.string(), discipline: z.string().nullish(),
  score: z.number().default(0), reason: z.string().default(""),
});                                // who the AI picked to run the Tester gate, by passport (+why)
export type TesterPick = z.infer<typeof TesterPick>;
export const QAReport = z.object({
  items: z.array(QAItemResult), reopened: z.array(z.number()).optional(),
  tester: TesterPick.nullish(),    // best-by-passport verifier for this gate
});
export type QAReport = z.infer<typeof QAReport>;
export const QAQueueEntry = z.object({   // one project/relay with QA work outstanding (cross-project Tester queue)
  project_id: z.number(), project_name: z.string(), plan_id: z.string(),
  qa_status: z.string(), baton: z.boolean(),
  issue_count: z.number(), awaiting_reqa: z.array(z.number()),
});
export type QAQueueEntry = z.infer<typeof QAQueueEntry>;
export const QAQueue = z.object({ count: z.number(), queue: z.array(QAQueueEntry) });
export type QAQueue = z.infer<typeof QAQueue>;

// Reuse-or-Innovate (the Contract spine): per-gate solution options the lead selects.
// Every field is always serialized by the backend (Pydantic defaults), so these are required.
export const FileChange = z.object({
  path: z.string(),
  change: z.enum(["add", "modify", "remove"]).optional(),   // server-classified against the known file set; default modify
});
export type FileChange = z.infer<typeof FileChange>;
export const SolutionCard = z.object({
  id: z.string(),
  source: z.enum(["memory", "ai", "user"]),
  title: z.string(),
  summary: z.string(),
  rationale: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  confidence: z.number(),
  grounded_on: z.array(z.string()),   // past project(s) reused (memory source)
  delta_note: z.string(),             // "variant of X + Δ" when a fresh option ≈ memory
  impacted_files: z.array(z.string()),
  file_changes: z.array(FileChange).optional(),   // per-file change kind (add/modify/remove); falls back to impacted_files
  // #33 Contract richness — provenance signals (server-derived except conflict). Optional (symmetric
  // in/out) so jget's type inference stays clean; the backend always sends them.
  conflict: z.boolean().optional(),
  conflict_reason: z.string().optional(),
  grade: Grade.nullish(),                                  // earned strength (memory options only)
  signal: z.enum(["green", "orange", "grey"]).optional(),
});
export type SolutionCard = z.infer<typeof SolutionCard>;
export const SolutionSet = z.object({
  discipline: z.string(),
  solutions: z.array(SolutionCard),
  chosen: SolutionCard.nullish(),   // the ratified pick — the done-gate review renders it
});
export type SolutionSet = z.infer<typeof SolutionSet>;

/* ── Agreements (the coordination spine): AI-drafted, async-ratified ──────── */
export const SchemaField = z.object({
  name: z.string(), type: z.string(), required: z.boolean().optional(), note: z.string().optional(),
});
export const InterfaceDraft = z.object({
  method: z.string(), path: z.string(),
  request_fields: z.array(SchemaField), response_fields: z.array(SchemaField),
  errors: z.array(z.string()), note: z.string().optional(),
});
export type InterfaceDraft = z.infer<typeof InterfaceDraft>;
export const InterfaceProposal = z.object({
  id: z.string(), source: z.string(), interface: InterfaceDraft,
  why: z.string().optional(), pros: z.array(z.string()).optional(), cons: z.array(z.string()).optional(),
  grounded_on: z.array(z.string()).optional(), confidence: z.number().optional(),
});
export type InterfaceProposal = z.infer<typeof InterfaceProposal>;
export const SubteamDraft = z.object({
  discipline: z.string(), mode: z.string(), members: z.array(z.string()), rationale: z.string().optional(),
});
export type SubteamDraft = z.infer<typeof SubteamDraft>;
export const Agreement = z.object({
  id: z.string(), type: z.string(), plan_id: z.string(), subject: z.string(),
  interface: InterfaceDraft.nullish(),
  proposals: z.array(InterfaceProposal).optional(),   // reuse/fresh/write-own shape options the producer picks
  chosen_proposal_id: z.string().nullish(),
  subteam: SubteamDraft.nullish(),
  grounded_on: z.array(z.string()).optional(), ratifiers: z.array(z.string()),
  ratifications: z.array(unknownRecord).optional(), state: z.string(),
  precedent_id: z.string().nullish(),   // P3: the past ratified agreement it auto-passed from (compounded)
  producer_discipline: z.string().nullish(), consumer_discipline: z.string().nullish(),
  producer_issue_id: z.string().nullish(), consumer_issue_id: z.string().nullish(),
});
export type Agreement = z.infer<typeof Agreement>;
export const AgreementList = z.object({ agreements: z.array(Agreement) });

export const RejectResult = z.object({
  issue_iid: z.number(), rerouted_to: z.string().nullable(), awaiting_reqa: z.array(z.number()),
});
export type RejectResult = z.infer<typeof RejectResult>;

/* ── members / staffing ──────────────────────────────────────────────── */
// When a member can start NEW work — the honest capacity signal (server-computed from the live schedule).
export const Availability = z.object({
  available_on: z.string(), free_in_days: z.number(),
  queued_days: z.number(), active_count: z.number(),
});
export type Availability = z.infer<typeof Availability>;
export const Member = z.object({
  username: z.string(), name: z.string(), email: z.string(), role: MemberRole,
  discipline: Discipline.nullable(), seniority: Seniority, load: z.number(),
  gitlab_user_id: z.number().nullable(), gitlab_username: z.string(), skills_text: z.string(),
  trust: z.record(z.string(), TrustLevel), trust_level: TrustLevel,
  joined: z.string().nullish(),   // ISO month joined the agency (YYYY-MM) — shown on the Passport
  history: z.array(unknownRecord), promoted: z.boolean().optional(),
  availability: Availability.nullish(),   // server-computed; when they can start new work
  needs_link: z.boolean().optional(),     // server-derived (roster): a repo-needing dev with no GitLab link
});
export type Member = z.infer<typeof Member>;
/** Back-compat alias — onboarding/merge endpoints call it a profile. */
export type DeveloperProfile = Member;
export const DeveloperProfile = Member;

export const MyIssue = z.object({
  project_id: z.number(), project: z.string(), epic: z.string(), issue: Issue,
});
export type MyIssue = z.infer<typeof MyIssue>;
export const MyIssuesResponse = z.object({
  username: z.string(), count: z.number(), issues: z.array(MyIssue),
});
export type MyIssuesResponse = z.infer<typeof MyIssuesResponse>;

export const StretchCandidate = z.object({
  username: z.string(), name: z.string(), discipline: Discipline.nullable(),
  score: z.number(), pros: z.array(z.string()), cons: z.array(z.string()),
});
export const OnboardSuggestion = z.object({
  suggestion: z.string(), pros: z.array(z.string()), cons: z.array(z.string()),
});
export const StaffingRecommendation = z.object({
  discipline: Discipline, stretch_candidates: z.array(StretchCandidate),
  onboard: OnboardSuggestion, weighted_by: z.string(),
});
export const CoverageRow = z.object({
  discipline: Discipline, covered: z.boolean(), lead: z.string().nullable(),
  recommendation: StaffingRecommendation.nullable(),
});
export type CoverageRow = z.infer<typeof CoverageRow>;
export const StaffingResponse = z.object({ coverage: z.array(CoverageRow) });
export type StaffingResponse = z.infer<typeof StaffingResponse>;

export const LoginResponse = z.object({ token: z.string(), member: Member });
export type LoginResponse = z.infer<typeof LoginResponse>;
export const CloseResult = z.object({ name: z.string(), added_to_memory: z.boolean() });
export type CloseResult = z.infer<typeof CloseResult>;

/* ── inbox / notifications / reschedule ──────────────────────────────── */
export const NotificationItem = z.object({
  id: z.string(), user_id: z.string(), type: z.string(), title: z.string(),
  body: z.string().optional(), ref: unknownRecord.optional(), actionable: z.boolean().optional(),
  read: z.boolean().optional(), created_at: z.string(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const AccessGrant = z.object({
  id: z.string(), requester_id: z.string(), subject_id: z.string(),
  status: z.enum(["pending", "granted", "revoked"]), notifications_muted: z.boolean().optional(),
  created_at: z.string(), updated_at: z.string(),
});
export type AccessGrant = z.infer<typeof AccessGrant>;

export const RescheduleStrategy = z.object({
  action: z.enum(["right_shift", "reassign", "compress", "descope", "re_estimate", "re_plan", "escalate"]),
  target_task_ids: z.array(z.string()), reassign_to: z.string().nullable(),
  rationale: z.string(), confidence: z.number(), impact_summary: z.string(),
});
export type RescheduleStrategy = z.infer<typeof RescheduleStrategy>;
export const ImpactedTask = z.object({
  task_id: z.string(), title: z.string(), assignee: z.string().nullable(),
  old_start: z.string().nullable(), old_end: z.string().nullable(),
  scheduled_start: z.string().nullable(), scheduled_end: z.string().nullable(),
});
export type ImpactedTask = z.infer<typeof ImpactedTask>;
export const RescheduleProposal = z.object({
  id: z.string(), project_id: z.number().nullable(), strategy: RescheduleStrategy,
  impacted: z.array(ImpactedTask), affected_users: z.array(z.string()),
  status: z.enum(["proposed", "applied", "rejected"]),
});
export type RescheduleProposal = z.infer<typeof RescheduleProposal>;

export const InboxNeed = z.object({
  kind: z.enum(["ratify", "access_request", "reschedule"]), title: z.string(),
  ref: unknownRecord.and(z.object({ proposal_id: z.string().optional() })),
  item: z.union([QueueItem, RescheduleProposal]).optional(),
});
export type InboxNeed = z.infer<typeof InboxNeed>;
export const InboxResponse = z.object({
  needs_action: z.array(InboxNeed), notifications: z.array(NotificationItem), unread: z.number(),
});
export type InboxResponse = z.infer<typeof InboxResponse>;

export const QAVerdict = z.enum(["pass", "fail", "needs_human"]);

/* ── remaining type exports (so api.ts re-exports every wire type — zero panel churn) ── */
export type TimeToMarket = z.infer<typeof TimeToMarket>;
export type Scalability = z.infer<typeof Scalability>;
export type Reliability = z.infer<typeof Reliability>;
export type IssueType = z.infer<typeof IssueType>;
export type Risk = z.infer<typeof Risk>;
export type MemberRole = z.infer<typeof MemberRole>;
export type Seniority = z.infer<typeof Seniority>;
export type RoutingTier = z.infer<typeof RoutingTier>;
export type Grade = z.infer<typeof Grade>;
export type ProfileStatus = z.infer<typeof ProfileStatus>;
export type AmbiguityCard = z.infer<typeof AmbiguityCard>;
export type ReuseItem = z.infer<typeof ReuseItem>;
export type ArchitectureCard = z.infer<typeof ArchitectureCard>;
export type StretchCandidate = z.infer<typeof StretchCandidate>;
export type OnboardSuggestion = z.infer<typeof OnboardSuggestion>;
export type StaffingRecommendation = z.infer<typeof StaffingRecommendation>;
export type QAItemResult = z.infer<typeof QAItemResult>;
export type QAVerdict = z.infer<typeof QAVerdict>;
