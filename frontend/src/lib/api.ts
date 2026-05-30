/* Typed fetch client for the sprint0 gateway.
   Base URL from VITE_API_BASE (falls back to localhost:8000).
   JSON + FormData helpers; throws on non-2xx with the response text.

   Auth: the session token lives in sessionStorage (key `sprint0_token`) so each
   browser window logs in independently. It is sent on EVERY request as the
   `X-Sprint0-User` header — server-side it is the caller's username. */

const BASE: string = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const TOKEN_KEY = "sprint0_token";

export const token = {
  get(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(value: string): void {
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch {
      /* ignore disabled storage */
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Headers carrying the session token (when present). */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const t = token.get();
  return { ...(extra ?? {}), ...(t ? { "X-Sprint0-User": t } : {}) };
}

/* ── Wire types (mirror orchestrator/app/contracts.py) ───────────────── */

export type TimeToMarket = "fast" | "balanced" | "thorough";
export type Scalability = "small" | "medium" | "large";
export type Reliability = "low-cost" | "standard" | "high-availability";

export interface Constraints {
  time_to_market: TimeToMarket;
  scalability: Scalability;
  reliability: Reliability;
}

export interface TechStack {
  frontend: string;
  backend: string;
  db: string;
  infra: string;
}

export type IssueType = "backend" | "frontend" | "db" | "devops" | "design";
export type Risk = "low" | "medium" | "high";
export type Discipline = "uiux" | "backend" | "frontend" | "qa" | "devops";
export type Kind = "code" | "design" | "audit" | "content" | "infra" | "runbook";
export type GateStatus =
  | "pending"
  | "locked"
  | "auto_passed"
  | "ratified"
  | "changes_requested"
  | "blocked";

export interface ContextScope {
  files: string[];
  note: string;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  type: IssueType;
  estimate_days: number;
  risk: Risk;
  required_skill: string;
  context_scope: ContextScope;
  assignee: string | null;
  kind: Kind;
  discipline: Discipline;
  depends_on: string[];
  api_contract: string | null;
  context: Record<string, unknown>;
  /** Set by the assignment engine when a dev is stretched out of discipline. */
  stretch_flag: string | null;
}

export interface Epic {
  id: string;
  title: string;
  issues: Issue[];
}

export interface PlanJSON {
  project_name: string;
  client_summary: string;
  tech_stack: TechStack;
  grounded_on: string[];
  timeline_weeks: number;
  epics: Epic[];
}

export interface AmbiguityCard {
  id: string;
  feature: string;
  question: string;
  options: string[];
  resolution: string | null;
}

export interface ReuseItem {
  from_project: string;
  feature: string;
  action: "reuse" | "adapt" | "drop";
}

export interface ClarifiedSpec {
  goal: string;
  users: string[];
  must_haves: string[];
  constraints: string[];
  ambiguities: AmbiguityCard[];
  reuse: ReuseItem[];
}

export interface ArchitectureCard {
  name: string;
  tech_stack: TechStack;
  summary: string;
  rationale: string;
  grounded_on: string[];
  fit_to_constraints: string;
}

export interface ArchitectureOptions {
  cards: ArchitectureCard[];
}

export interface Gate {
  discipline: Discipline;
  status: GateStatus;
  depends_on: Discipline[];
  note: string;
  /** Spine routing tier (null on legacy gates): how much expert attention the router budgeted. */
  tier?: "auto_pass" | "one_expert" | "two_expert" | null;
  confidence?: number | null;
  blast_radius?: number | null;
  expected_cost?: number | null;
  routed_note?: string;
}

/** A declared api-failing/ok flag on a producer issue (the integration gate, B+C+D). */
export interface IntegrationSignal {
  target_issue_id: string;
  state: "failing" | "ok";
  by: string;
  reporter_issue_id: string | null;
  source: "manual" | "webhook" | "ci" | "ai";
  note: string;
  created_at: string;
}

export interface RelayState {
  gates: Gate[];
  baton: Discipline[];
  integration_signals: IntegrationSignal[];
}

/** When a consumer's `depends_on` has >1 producer, the flag endpoint asks which to reject. */
export interface IntegrationCandidate {
  id: string;
  title: string;
  assignee: string | null;
  api_contract: string | null;
}
export type FlagIntegrationResult = RelayState | { need_target: true; candidates: IntegrationCandidate[] };

export interface PlanResponse {
  plan_id: string;
  plan: PlanJSON;
  relay: RelayState;
}

export interface Decision {
  id: string;
  owner_id: string;
  domain: Discipline;
  context_tags: string[];
  recommendation: string;
  reasoning: string;
  project_id: string;
  project_name: string;
  issue_ids: string[];
  outcome_validated: boolean;
  visibility: "personal" | "team";
  deprecated: boolean;
  deprecation_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DecisionCard {
  domain: string;
  context: string;
  recommendation: string;
  confidence: number;
  pros: string[];
  cons: string[];
  conflict: boolean;
  conflict_reason: string | null;
}

export interface DecisionCardResponse {
  card: DecisionCard | null;
  signal: "green" | "orange" | "grey";
  low_confidence: boolean;
  past: { own: Decision[]; team: Decision[] };
  error?: string;
}

export interface UserSubscription { id: string; watcher_id: string; subject_id: string; events: string[]; created_at: string; }

export interface GraphNode { path: string; domain: string; node_type: string; loc: number; project_id: string; }
export interface GraphEdge { from_path: string; to_path: string; edge_type: string; }
export interface GovernanceRule { id: string; decision_id: string; domain: string; governs_pattern: string; constraint: string; }
export interface DriftReport {
  severity: "blocking" | "drift" | "cosmetic";
  drift_from_decision_id: string;
  drift_from_description: string;
  affected_files: string[];
  violation: string;
  suggested_fix: string;
  effort: "small" | "medium" | "large";
  domain: string;
}

export interface QueueItem {
  plan_id: string;
  project: string;
  discipline: Discipline;
  status: GateStatus;
  issue_count: number;
  is_delta: boolean;
  target_project_id: number | null;
}

export interface RelaySummary {
  plan_id: string;
  project: string;
  baton: Discipline[];
  gates: { discipline: Discipline; status: GateStatus; note: string }[];
  is_delta: boolean;
  target_project_id: number | null;
  all_ratified: boolean;
}

/** A project on the manager Dashboard. `active` = sprint0-managed (has a ProjectRecord, full plan);
 *  `reference` = an agency past project (memory only — no plan/counts). */
export interface ProjectSummary {
  project_id: number;
  name: string;
  web_url: string;
  kind: "active" | "reference";
  tech_stack?: TechStack;
  grounded_on?: string[];
  plan?: PlanJSON;
  module_manifest?: string[];
  status?: string; // "in_progress"/"closed"/"shipped"; absent → active
  created_at?: string;
  last_activity_at?: string;
  summary?: string;
  tags?: string[];
}

export type TaskStatus = "planned" | "in_progress" | "in_review" | "done" | "blocked";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

/** A Task from /api/work (Phase A store). Non-owned/non-granted tasks come back REDACTED:
 *  only id/project_id/title/status/discipline/assignee + redacted:true are present. */
export interface WorkTask {
  id: string;
  project_id: number;
  title: string;
  status: TaskStatus;
  discipline: Discipline;
  assignee: string | null;
  redacted?: boolean;
  // full-detail fields (absent when redacted):
  description?: string;
  assigned_by?: string;        // "ai" | "self" | "<username>"
  estimate_days?: number;
  risk?: Risk;
  depends_on?: string[];
  priority?: TaskPriority;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  pinned?: boolean;            // locked dates → the reflow engine never moves this task
  gitlab_issue_iid?: number | null;
  context_scope?: ContextScope;
  created_at?: string;
  updated_at?: string;
}

export interface WorkResponse {
  scope: string;
  count: number;
  tasks: WorkTask[];
}

/** Saved wizard progress so closing never loses work; offered as "Resume" on reopen. */
export interface WizardDraft {
  briefId: string | null;
  planId: string | null;
  step: number;
  isFeature: boolean;
  featureProjectId: number | null;
  chosenStack: TechStack | null;
  dial: number;
  projectName: string;
  savedAt: number;
}

const DRAFT_KEY = "sprint0_draft";
export const draft = {
  get(): WizardDraft | null {
    try {
      const s = localStorage.getItem(DRAFT_KEY);
      return s ? (JSON.parse(s) as WizardDraft) : null;
    } catch {
      return null;
    }
  },
  set(d: WizardDraft): void {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* ignore disabled storage */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** A merge sprint0 couldn't map to a roster member — awaits the manager's call. */
export interface Attribution {
  id: string;
  gitlab_username: string;
  task_type: string;
  score: number;
  project_id: number | null;
  issue_iid: number | null;
  suggested: string | null;
}

export interface FeaturePlanResponse extends PlanResponse {
  project_id: number;
}

export interface DispatchResult {
  plan_id: string;
  mode: "copilot" | "autonomous";
  web_url: string;
  clone_url?: string;
  project_id: number;
  default_branch: string;
  issues_created: number;
  context_branches?: number;
  qa_issue_iid?: number | null;
  persist_warning?: string;
}

export type QAVerdict = "pass" | "fail" | "needs_human";

export interface QAItemResult {
  issue_id: string;
  title: string;
  verdict: QAVerdict;
  note: string;
}

export interface QAReport {
  items: QAItemResult[];
  reopened?: number[];
}

export interface RejectResult {
  issue_iid: number;
  rerouted_to: string | null;
  awaiting_reqa: number[];
}

export type TrustLevel = "low" | "medium" | "high";
export type MemberRole = "manager" | "developer";
export type Seniority = "junior" | "mid" | "senior";

/** A team member = a login account (the manager or a developer). */
export interface Member {
  username: string;
  name: string;
  email: string;
  role: MemberRole;
  discipline: Discipline | null;
  seniority: Seniority;
  load: number; // 0-100 capacity used
  gitlab_user_id: number | null;
  gitlab_username: string;
  skills_text: string;
  /** Per-discipline trust tier; falls back to trust_level. */
  trust: Partial<Record<Discipline, TrustLevel>>;
  trust_level: TrustLevel;
  history: Record<string, unknown>[];
  promoted?: boolean;
}

/** Back-compat alias — the onboarding/merge endpoints still call it a profile. */
export type DeveloperProfile = Member;

/** A single issue assigned to the logged-in member (from /api/me/issues). */
export interface MyIssue {
  project_id: number;
  project: string;
  epic: string;
  issue: Issue;
}

export interface MyIssuesResponse {
  username: string;
  count: number;
  issues: MyIssue[];
}

/* ── Staffing (gap coverage + stretch/onboard recommendations) ── */
export interface StretchCandidate {
  username: string;
  name: string;
  discipline: Discipline | null;
  score: number;
  pros: string[];
  cons: string[];
}

export interface OnboardSuggestion {
  suggestion: string;
  pros: string[];
  cons: string[];
}

export interface StaffingRecommendation {
  discipline: Discipline;
  stretch_candidates: StretchCandidate[];
  onboard: OnboardSuggestion;
  weighted_by: string;
}

export interface CoverageRow {
  discipline: Discipline;
  covered: boolean;
  lead: string | null;
  recommendation: StaffingRecommendation | null;
}

export interface StaffingResponse {
  coverage: CoverageRow[];
}

export interface LoginResponse {
  token: string;
  member: Member;
}

export interface CloseResult {
  name: string;
  added_to_memory: boolean;
}

export interface NotificationItem {
  id: string; user_id: string; type: string; title: string;
  body?: string; ref?: Record<string, unknown>; actionable?: boolean; read?: boolean; created_at: string;
}
export interface AccessGrant {
  id: string; requester_id: string; subject_id: string;
  status: "pending" | "granted" | "revoked"; notifications_muted?: boolean; created_at: string; updated_at: string;
}

export interface RescheduleStrategy {
  action: "right_shift" | "reassign" | "compress" | "descope" | "re_estimate" | "re_plan" | "escalate";
  target_task_ids: string[];
  reassign_to: string | null;
  rationale: string;
  confidence: number;
  impact_summary: string;
}

export interface ImpactedTask {
  task_id: string;
  title: string;
  assignee: string | null;
  old_start: string | null;
  old_end: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
}

export interface RescheduleProposal {
  id: string;
  project_id: number | null;
  strategy: RescheduleStrategy;
  impacted: ImpactedTask[];
  affected_users: string[];
  status: "proposed" | "applied" | "rejected";
}

export interface InboxNeed { kind: "ratify" | "access_request" | "reschedule"; title: string; ref: Record<string, unknown> & { proposal_id?: string }; item?: QueueItem | RescheduleProposal; }
export interface InboxResponse { needs_action: InboxNeed[]; notifications: NotificationItem[]; unread: number; }

/* ── Transport helpers ───────────────────────────────────────────────── */

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`);
  }
  return (await res.json()) as T;
}

async function jpost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return unwrap<T>(res);
}

async function jget<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(BASE + path, { headers: authHeaders() }));
}

async function jdelete<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(BASE + path, { method: "DELETE", headers: authHeaders() }));
}

async function fpost<T>(path: string, form: FormData): Promise<T> {
  return unwrap<T>(await fetch(BASE + path, { method: "POST", headers: authHeaders(), body: form }));
}

/* ── Endpoints ───────────────────────────────────────────────────────── */

export const api = {
  base: BASE,

  /* Auth / identity (per-account) */
  login(username: string): Promise<LoginResponse> {
    return jpost("/api/auth/login", { username });
  },
  me(): Promise<Member> {
    return jget("/api/me");
  },
  myIssues(): Promise<MyIssuesResponse> {
    return jget("/api/me/issues");
  },
  myDecisions(): Promise<{ username: string; count: number; decisions: Decision[] }> {
    return jget("/api/me/decisions");
  },
  /* Outcome Validation (roadmap System 3) — per-decision memory control + cross-user surfacing */
  surfaceDecisions(domain?: string, tags?: string): Promise<{ own: Decision[]; team: Decision[] }> {
    const q = new URLSearchParams();
    if (domain) q.set("domain", domain);
    if (tags) q.set("tags", tags);
    const qs = q.toString();
    return jget(`/api/decisions/surface${qs ? `?${qs}` : ""}`);
  },
  deprecateDecision(id: string, reason: string): Promise<Decision> {
    return jpost(`/api/decisions/${id}/deprecate`, { reason });
  },
  setDecisionVisibility(id: string, visibility: "personal" | "team"): Promise<Decision> {
    return jpost(`/api/decisions/${id}/visibility`, { visibility });
  },
  deleteDecision(id: string): Promise<{ deleted: string }> {
    return jdelete(`/api/decisions/${id}`);
  },
  myQueue(): Promise<{ username: string; count: number; items: QueueItem[] }> {
    return jget("/api/me/queue");
  },
  allRelays(): Promise<{ count: number; relays: RelaySummary[] }> {
    return jget("/api/relays");
  },
  projects(): Promise<{ count: number; projects: ProjectSummary[] }> {
    return jget("/api/projects");
  },

  /* Work hub (Phase A Task store) */
  work(scope: string): Promise<WorkResponse> {
    return jget(`/api/work?scope=${encodeURIComponent(scope)}`);
  },
  task(taskId: string): Promise<WorkTask> {
    return jget(`/api/tasks/${taskId}`);
  },
  claimTask(taskId: string): Promise<WorkTask> {
    return jpost(`/api/tasks/${taskId}/claim`);
  },
  releaseTask(taskId: string): Promise<WorkTask> {
    return jpost(`/api/tasks/${taskId}/release`);
  },
  setTaskStatus(taskId: string, status: TaskStatus): Promise<WorkTask> {
    return jpost(`/api/tasks/${taskId}/status?status=${status}`);
  },
  recomputeSchedule(projectId: number): Promise<{ project_id: number; scheduled: number }> {
    return jpost(`/api/schedule/recompute?project_id=${projectId}`);
  },
  reassignTask(taskId: string, assignee: string): Promise<WorkTask> {
    return jpost(`/api/tasks/${taskId}/reassign?assignee=${encodeURIComponent(assignee)}`);
  },
  /** Lock (or unlock) a task's dates so the reflow engine never moves it (Reclaim-style lock). */
  pinTask(taskId: string, pinned: boolean): Promise<WorkTask> {
    return jpost(`/api/tasks/${taskId}/pin?pinned=${pinned}`);
  },

  /* Briefs / intake */
  createBrief(input: { text?: string; file?: File }): Promise<{ brief_id: string }> {
    const fd = new FormData();
    if (input.file) fd.append("file", input.file);
    else fd.append("text", input.text ?? "");
    return fpost("/api/briefs", fd);
  },
  clarify(briefId: string, constraints?: Constraints | null): Promise<ClarifiedSpec> {
    return jpost(`/api/briefs/${briefId}/clarify`, constraints ?? null);
  },
  /* Wizard-resume rehydrate (cached server-side; no Gemini re-run) */
  getBrief(briefId: string): Promise<{ brief_id: string; text: string }> {
    return jget(`/api/briefs/${briefId}`);
  },
  getSpec(briefId: string): Promise<ClarifiedSpec> {
    return jget(`/api/briefs/${briefId}/spec`);
  },
  getArchitectures(briefId: string): Promise<ArchitectureOptions> {
    return jget(`/api/briefs/${briefId}/architectures`);
  },
  resolveClarify(briefId: string, answers: Record<string, string>): Promise<ClarifiedSpec> {
    return jpost(`/api/briefs/${briefId}/clarify/resolve`, { answers });
  },
  architectures(briefId: string, constraints?: Constraints | null): Promise<ArchitectureOptions> {
    return jpost(`/api/briefs/${briefId}/architectures`, constraints ?? null);
  },
  plan(
    briefId: string,
    body?: { constraints?: Constraints | null; chosen_stack?: TechStack | null },
  ): Promise<PlanResponse> {
    return jpost(`/api/briefs/${briefId}/plan`, body ?? {});
  },

  /* Plans / Relay */
  getPlan(planId: string): Promise<PlanJSON> {
    return jget(`/api/plans/${planId}`);
  },
  /** WebSocket URL for the scaffold-progress stream (unauthenticated, canned step sequence). */
  planEventsUrl(planId: string): string {
    return `${BASE.replace(/^http/, "ws")}/api/plans/${planId}/events`;
  },
  getRelay(planId: string): Promise<RelayState> {
    return jget(`/api/plans/${planId}/relay`);
  },
  relay(planId: string): Promise<RelayState> {
    return jget(`/api/plans/${planId}/relay`);
  },
  relayAuto(planId: string, dial: number): Promise<RelayState> {
    return jpost(`/api/plans/${planId}/relay/auto`, { dial });
  },
  ratify(
    planId: string,
    discipline: Discipline,
    body: {
      edits?: Issue[]; note?: string; approve?: boolean; reasoning?: string;
      ai_recommendation?: string; ai_confidence?: number | null; deviated?: boolean; deviation_reason?: string;
    },
  ): Promise<RelayState> {
    return jpost(`/api/plans/${planId}/ratify/${discipline}`, body);
  },
  /** Decision Card (System 2): two-pass adversarial AI evaluation for a relay gate. */
  decisionCard(planId: string, discipline: Discipline): Promise<DecisionCardResponse> {
    return jget(`/api/relays/${planId}/gates/${discipline}/card`);
  },
  /* Code Graph (roadmap System 4) */
  buildGraph(): Promise<{ project_id: string; root: string; nodes: number; edges: number }> {
    return jpost(`/api/graph/build`, {});
  },
  getGraph(projectId = "local"): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    return jget(`/api/graph?project_id=${projectId}`);
  },
  graphDependents(path: string): Promise<{ path: string; dependents: string[]; dependencies: string[] }> {
    return jget(`/api/graph/dependents?path=${encodeURIComponent(path)}`);
  },
  addGovernance(body: { governs_pattern: string; constraint?: string; domain?: string }): Promise<GovernanceRule> {
    return jpost(`/api/graph/governance`, body);
  },
  listGovernance(): Promise<{ rules: GovernanceRule[] }> {
    return jget(`/api/graph/governance`);
  },
  checkDrift(): Promise<{ count: number; reports: DriftReport[] }> {
    return jpost(`/api/graph/drift`, {});
  },
  createRefactorTask(projectId: number, report: DriftReport): Promise<WorkTask> {
    return jpost(`/api/graph/refactor`, { project_id: projectId, report });
  },
  /* Subscriptions + live notifications (roadmap System 5) */
  subscribe(subjectId: string, events: string[] = ["assigned", "qa_failed"]): Promise<UserSubscription> {
    return jpost(`/api/subscriptions`, { subject_id: subjectId, events });
  },
  unsubscribe(subjectId: string): Promise<{ unsubscribed: string }> {
    return jdelete(`/api/subscriptions/${subjectId}`);
  },
  listSubscriptions(): Promise<{ watching: UserSubscription[]; watchers: UserSubscription[] }> {
    return jget(`/api/subscriptions`);
  },
  /** WS URL for the live notification stream (System 5). */
  notificationsWsUrl(user: string): string {
    return `${BASE.replace(/^http/, "ws")}/api/ws/notifications?user=${encodeURIComponent(user)}`;
  },
  /** Integration gate: declare an issue's API failing/ok. Consumer (own issue) or qa-gate owner.
   *  Returns the new RelayState, or `{need_target, candidates}` when the producer is ambiguous. */
  flagIntegration(
    planId: string,
    body: {
      state: "failing" | "ok";
      reporter_issue_id?: string;
      target_issue_id?: string;
      source?: "manual";
      note?: string;
    },
  ): Promise<FlagIntegrationResult> {
    return jpost(`/api/plans/${planId}/integration/flag`, body);
  },
  staffing(planId: string): Promise<StaffingResponse> {
    return jget(`/api/plans/${planId}/staffing`);
  },

  /* Dispatch + mid-prod */
  dispatch(planId: string, mode: "copilot" | "autonomous"): Promise<DispatchResult> {
    return jpost(`/api/plans/${planId}/dispatch`, { mode });
  },
  addFeature(
    projectId: number,
    body: { text: string; constraints?: Constraints | null },
  ): Promise<FeaturePlanResponse> {
    return jpost(`/api/projects/${projectId}/features`, body);
  },

  /* QA */
  qaRun(projectId: number): Promise<QAReport> {
    return jpost(`/api/projects/${projectId}/qa/run`);
  },
  rejectIssue(
    projectId: number,
    iid: number,
    body: { comment: string; to_runner?: string },
  ): Promise<RejectResult> {
    return jpost(`/api/projects/${projectId}/issues/${iid}/reject`, body);
  },

  /* Merge / close / developers */
  merge(body: {
    gitlab_username: string;
    task_type: string;
    score?: number;
    project_id?: number;
    issue_iid?: number;
  }): Promise<DeveloperProfile> {
    return jpost("/api/merge", body);
  },
  attributions(): Promise<Attribution[]> {
    return jget("/api/attributions");
  },
  resolveAttribution(
    aid: string,
    body: { username: string; task_type?: string },
  ): Promise<{ resolved: string; attributed_to: string; profile: DeveloperProfile }> {
    return jpost(`/api/attributions/${aid}/resolve`, body);
  },
  linkMember(username: string): Promise<Record<string, unknown>> {
    return jpost(`/api/members/${username}/link`);
  },
  reconcileTeam(): Promise<Record<string, unknown>> {
    return jpost("/api/team/reconcile");
  },
  closeProject(projectId: number, outcome_notes?: string): Promise<CloseResult> {
    return jpost(`/api/projects/${projectId}/close`, { outcome_notes: outcome_notes ?? "" });
  },
  developers(): Promise<DeveloperProfile[]> {
    return jget("/api/developers");
  },
  addDeveloper(input: { text?: string; file?: File }): Promise<DeveloperProfile> {
    const fd = new FormData();
    if (input.file) fd.append("file", input.file);
    else fd.append("text", input.text ?? "");
    return fpost("/api/developers", fd);
  },

  /* Inbox / notifications */
  inbox(): Promise<InboxResponse> { return jget("/api/inbox"); },
  inboxReadAll(): Promise<{ ok: boolean }> { return jpost("/api/inbox/read-all"); },
  requestAccess(subjectId: string): Promise<AccessGrant> { return jpost("/api/access/requests", { subject_id: subjectId }); },
  acceptAccess(grantId: string): Promise<AccessGrant> { return jpost(`/api/access/requests/${grantId}/accept`); },
  rejectAccess(grantId: string): Promise<AccessGrant> { return jpost(`/api/access/requests/${grantId}/reject`); },
  listAccess(): Promise<{ i_can_see: AccessGrant[]; can_see_me: AccessGrant[]; pending_in: AccessGrant[] }> { return jget("/api/access"); },
  revokeAccess(grantId: string): Promise<AccessGrant> { return jdelete(`/api/access/${grantId}`); },
  muteAccess(grantId: string): Promise<AccessGrant> { return jpost(`/api/access/${grantId}/mute`); },

  /* Reschedule / event reflow (Phase E) */
  postEvent(body: { kind: string; user_id?: string; task_id?: string; project_id?: number; start?: string; end?: string; payload?: Record<string, unknown> }): Promise<{ event: unknown; reflowed: WorkTask[]; strategy: RescheduleStrategy | null }> {
    return jpost(`/api/events`, body);
  },
  getReschedule(id: string): Promise<RescheduleProposal> {
    return jget(`/api/reschedule/proposals/${id}`);
  },
  applyReschedule(id: string): Promise<{ status: string; action: string; flagged_manual: boolean; moved: WorkTask[] }> {
    return jpost(`/api/reschedule/proposals/${id}/apply`);
  },
  rejectReschedule(id: string): Promise<{ status: string }> {
    return jpost(`/api/reschedule/proposals/${id}/reject`);
  },
};
