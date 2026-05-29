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
  | "changes_requested";

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
}

export interface RelayState {
  gates: Gate[];
  baton: Discipline[];
}

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
  created_at: string;
  updated_at: string;
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
    body: { edits?: Issue[]; note?: string; approve?: boolean; reasoning?: string },
  ): Promise<RelayState> {
    return jpost(`/api/plans/${planId}/ratify/${discipline}`, body);
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
};
