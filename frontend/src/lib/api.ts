/* Typed fetch client for the sprint0 gateway.
   Base URL from VITE_API_BASE (falls back to localhost:8000).
   JSON + FormData helpers; throws on non-2xx with the response text.

   Auth: the session token lives in sessionStorage (key `sprint0_token`) so each
   browser window logs in independently. It is sent on EVERY request as the
   `X-Sprint0-User` header — server-side it is the caller's username. */

import { z } from "zod";
import * as S from "./schemas";

// Domain types are defined once in schemas.ts (Zod → z.infer). api.ts imports them for its own
// method signatures and re-exports them, so the 20+ files importing from "../lib/api" keep one
// source of truth. (WizardDraft stays below — a localStorage shape with no runtime schema.)
import type {
  AccessGrant,
  AmbiguityCard,
  ArchitectureCard,
  ArchitectureOptions,
  Attribution,
  ClarifiedSpec,
  CloseResult,
  Constraints,
  ContextScope,
  CoverageRow,
  Decision,
  DecisionCard,
  DecisionCardResponse,
  DeveloperProfile,
  Discipline,
  DispatchResult,
  DriftReport,
  Epic,
  FeaturePlanResponse,
  FlagIntegrationResult,
  Gate,
  GateStatus,
  GovernanceRule,
  GraphEdge,
  GraphNode,
  ImpactedTask,
  InboxNeed,
  InboxResponse,
  IntegrationCandidate,
  IntegrationSignal,
  Issue,
  IssueType,
  Kind,
  LoginResponse,
  Member,
  MemberRole,
  MyIssue,
  MyIssuesResponse,
  NotificationItem,
  OnboardSuggestion,
  PlanJSON,
  PlanResponse,
  ProjectSummary,
  QAItemResult,
  QAReport,
  QAQueue,
  QAQueueEntry,
  QAVerdict,
  QueueItem,
  RejectResult,
  RelayState,
  RelaySummary,
  Reliability,
  RescheduleProposal,
  SolutionCard,
  SolutionSet,
  TesterPick,
  RescheduleStrategy,
  ReuseItem,
  Risk,
  Scalability,
  Seniority,
  StaffingRecommendation,
  StaffingResponse,
  StretchCandidate,
  TaskPriority,
  TaskStatus,
  TechStack,
  TimeToMarket,
  TrustLevel,
  UserSubscription,
  WorkResponse,
  WorkTask,
} from "./schemas";
export type {
  AccessGrant,
  AmbiguityCard,
  ArchitectureCard,
  ArchitectureOptions,
  Attribution,
  ClarifiedSpec,
  CloseResult,
  Constraints,
  ContextScope,
  CoverageRow,
  Decision,
  DecisionCard,
  DecisionCardResponse,
  DeveloperProfile,
  Discipline,
  DispatchResult,
  DriftReport,
  Epic,
  FeaturePlanResponse,
  FlagIntegrationResult,
  Gate,
  GateStatus,
  GovernanceRule,
  GraphEdge,
  GraphNode,
  ImpactedTask,
  InboxNeed,
  InboxResponse,
  IntegrationCandidate,
  IntegrationSignal,
  Issue,
  IssueType,
  Kind,
  LoginResponse,
  Member,
  MemberRole,
  MyIssue,
  MyIssuesResponse,
  NotificationItem,
  OnboardSuggestion,
  PlanJSON,
  PlanResponse,
  ProjectSummary,
  QAItemResult,
  QAReport,
  QAQueue,
  QAQueueEntry,
  QAVerdict,
  QueueItem,
  RejectResult,
  RelayState,
  RelaySummary,
  Reliability,
  RescheduleProposal,
  SolutionCard,
  SolutionSet,
  TesterPick,
  RescheduleStrategy,
  ReuseItem,
  Risk,
  Scalability,
  Seniority,
  StaffingRecommendation,
  StaffingResponse,
  StretchCandidate,
  TaskPriority,
  TaskStatus,
  TechStack,
  TimeToMarket,
  TrustLevel,
  UserSubscription,
  WorkResponse,
  WorkTask,
};


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

const LIVE_TOKEN_KEY = "sprint0_live_token";

/** Live-mode unlock token, set by the `?unlock=` magic link. Presence ⇒ this tab runs LIVE
 * (real Vertex + GitLab); absence ⇒ the public DEMO path on a demo-gated deploy. */
export const live = {
  get(): string | null {
    try {
      return sessionStorage.getItem(LIVE_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(value: string): void {
    try {
      sessionStorage.setItem(LIVE_TOKEN_KEY, value);
    } catch {
      /* ignore disabled storage */
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(LIVE_TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
  active(): boolean {
    return !!live.get();
  },
};

/** Headers carrying the session token (and the live-unlock token when present). */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const t = token.get();
  const lt = live.get();
  return {
    ...(extra ?? {}),
    ...(t ? { "X-Sprint0-User": t } : {}),
    ...(lt ? { "X-Sprint0-Live": lt } : {}),
  };
}

/* ── Wire types (mirror orchestrator/app/contracts.py) ───────────────── */















/** A declared api-failing/ok flag on a producer issue (the integration gate, B+C+D). */


/** When a consumer's `depends_on` has >1 producer, the flag endpoint asks which to reject. */









/** A project on the manager Dashboard. `active` = sprint0-managed (has a ProjectRecord, full plan);
 *  `reference` = an agency past project (memory only — no plan/counts). */


/** A Task from /api/work (Phase A store). Non-owned/non-granted tasks come back REDACTED:
 *  only id/project_id/title/status/discipline/assignee + redacted:true are present. */


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








/** A team member = a login account (the manager or a developer). */

/** Back-compat alias — the onboarding/merge endpoints still call it a profile. */

/** A single issue assigned to the logged-in member (from /api/me/issues). */


/* ── Staffing (gap coverage + stretch/onboard recommendations) ── */












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

async function jget<T>(path: string, schema?: z.ZodType<T>): Promise<T> {
  const data = await unwrap<T>(await fetch(BASE + path, { headers: authHeaders() }));
  // Zod validation at the boundary (opt-in): a backend contract change throws HERE with a clear,
  // located message instead of leaking undefined into a component three layers down.
  return schema ? schema.parse(data) : data;
}

async function jdelete<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(BASE + path, { method: "DELETE", headers: authHeaders() }));
}

async function jpatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return unwrap<T>(res);
}

async function fpost<T>(path: string, form: FormData): Promise<T> {
  return unwrap<T>(await fetch(BASE + path, { method: "POST", headers: authHeaders(), body: form }));
}

/* ── Endpoints ───────────────────────────────────────────────────────── */

export const api = {
  base: BASE,

  /* Liveness — REAL backend↔Mongo(MCP) reachability behind the sidebar status dot (not hardcoded) */
  health(): Promise<{ status: string; service: string; mongo: boolean; ok: boolean }> {
    return jget("/health");
  },

  /* Auth / identity (per-account) */
  login(username: string): Promise<LoginResponse> {
    return jpost("/api/auth/login", { username });
  },
  me(): Promise<Member> {
    return jget("/api/me", S.Member);
  },
  myIssues(): Promise<MyIssuesResponse> {
    return jget("/api/me/issues", S.MyIssuesResponse);
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
  patchDecision(id: string, body: { reasoning: string }): Promise<Decision> {
    return jpatch(`/api/decisions/${id}`, body);
  },
  myQueue(): Promise<{ username: string; count: number; items: QueueItem[] }> {
    return jget("/api/me/queue");
  },
  allRelays(): Promise<{ count: number; relays: RelaySummary[] }> {
    return jget("/api/relays");
  },
  projects(): Promise<{ count: number; projects: ProjectSummary[] }> {
    // Not Zod-validated: embedded stored-project plans have leaner, variable-shape issues.
    return jget("/api/projects");
  },

  /* Work hub (Phase A Task store) */
  work(scope: string): Promise<WorkResponse> {
    return jget(`/api/work?scope=${encodeURIComponent(scope)}`, S.WorkResponse);
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
  // Tier D — ad-hoc quick-add (engine-routed) + opt-in suggest + Tier C feature impact preview
  createTask(projectId: number, body: { title: string; discipline: string; estimate_days?: number; priority?: string; assignee?: string; depends_on?: string[] }): Promise<WorkTask> {
    return jpost(`/api/projects/${projectId}/tasks`, body);
  },
  suggestTask(title: string): Promise<{ discipline: string; estimate_days: number; priority: string }> {
    return jpost(`/api/tasks/suggest`, { title });
  },
  featurePreview(planId: string): Promise<{ pushed: number; moved: { task_id: string; title: string; assignee: string | null; old_end: string | null; new_end: string | null }[]; capacity: { username: string; name: string; before: number; after: number; added_days: number }[]; untouched: { id: string; title: string; status: string }[]; feature_tasks: number; at_risk: number }> {
    return jpost(`/api/plans/${planId}/reschedule-preview`);
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
    return jget(`/api/plans/${planId}/relay`, S.RelayState);
  },
  relay(planId: string): Promise<RelayState> {
    return jget(`/api/plans/${planId}/relay`, S.RelayState);
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
      chosen_solution?: SolutionCard;  // reuse-or-innovate: the selected (or write-your-own) solution
    },
  ): Promise<RelayState> {
    return jpost(`/api/plans/${planId}/ratify/${discipline}`, body);
  },
  /** Decision Card (System 2): two-pass adversarial AI evaluation for a relay gate. */
  decisionCard(planId: string, discipline: Discipline): Promise<DecisionCardResponse> {
    return jget(`/api/relays/${planId}/gates/${discipline}/card`, S.DecisionCardResponse);
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
    return jget(`/api/plans/${planId}/staffing`, S.StaffingResponse);
  },

  /* Capability profiles (spine P2 — net-new) */
  profiles(): Promise<S.ProfilesResponse> {
    return jget("/api/profiles", S.ProfilesResponse);
  },
  confirmProfile(profileId: string): Promise<{ profile_id: string; status: string }> {
    return jpost(`/api/profiles/${profileId}/confirm`);
  },
  /* Dispatch dry-run preview (spine P4 — net-new) */
  dispatchPreview(planId: string): Promise<S.DispatchPreview> {
    return jget(`/api/plans/${planId}/dispatch/preview`, S.DispatchPreview);
  },

  /* Dispatch + mid-prod */
  dispatch(planId: string, mode: "copilot" | "autonomous"): Promise<DispatchResult> {
    return jpost(`/api/plans/${planId}/dispatch`, { mode });
  },
  addFeature(
    projectId: number,
    body: { text: string; constraints?: Constraints | null; priority?: string },
  ): Promise<FeaturePlanResponse> {
    return jpost(`/api/projects/${projectId}/features`, body);
  },

  /* Reuse-or-Innovate: a gate's solution options (memory + fresh + write-your-own), lazy + cached */
  gateSolutions(planId: string, discipline: string): Promise<SolutionSet> {
    return jget(`/api/plans/${planId}/gates/${discipline}/solutions`, S.SolutionSet);
  },

  /* Agreement engine: the coordination spine — interface contracts (CDD), routed + ratified */
  myAgreements(): Promise<{ agreements: S.Agreement[] }> {
    return jget("/api/me/agreements", S.AgreementList);
  },
  planAgreements(planId: string): Promise<{ agreements: S.Agreement[] }> {
    return jget(`/api/plans/${planId}/agreements`, S.AgreementList);
  },
  ratifyAgreement(id: string, decision: "ratified" | "rejected", note = ""): Promise<S.Agreement> {
    return jpost(`/api/agreements/${id}/ratify`, { decision, note });
  },

  /* QA */
  qaRun(projectId: number): Promise<QAReport> {
    return jpost(`/api/projects/${projectId}/qa/run`);
  },
  // cross-project Tester queue: every project with QA work outstanding (mirrors /api/relays)
  qaQueue(): Promise<QAQueue> {
    return jget("/api/qa/queue", S.QAQueue);
  },
  // dynamic workspace label — the GitLab demo group's display name (sidebar + breadcrumbs)
  workspace(): Promise<{ name: string; path: string; web_url: string }> {
    return jget("/api/workspace");
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
  setDiscipline(username: string, discipline: string): Promise<DeveloperProfile> {
    return jpost(`/api/members/${username}/discipline`, { discipline });
  },
  closeProject(projectId: number, outcome_notes?: string): Promise<CloseResult> {
    return jpost(`/api/projects/${projectId}/close`, { outcome_notes: outcome_notes ?? "" });
  },
  developers(): Promise<DeveloperProfile[]> {
    return jget("/api/developers", z.array(S.Member));
  },
  addDeveloper(input: { text?: string; file?: File }): Promise<DeveloperProfile & { suggested_discipline?: Discipline | null }> {
    const fd = new FormData();
    if (input.file) fd.append("file", input.file);
    else fd.append("text", input.text ?? "");
    return fpost("/api/developers", fd);
  },

  /* Inbox / notifications */
  inbox(): Promise<InboxResponse> { return jget("/api/inbox", S.InboxResponse); },
  inboxReadAll(): Promise<{ ok: boolean }> { return jpost("/api/inbox/read-all"); },
  requestAccess(subjectId: string): Promise<AccessGrant> { return jpost("/api/access/requests", { subject_id: subjectId }); },
  acceptAccess(grantId: string): Promise<AccessGrant> { return jpost(`/api/access/requests/${grantId}/accept`); },
  rejectAccess(grantId: string): Promise<AccessGrant> { return jpost(`/api/access/requests/${grantId}/reject`); },
  listAccess(): Promise<{ i_can_see: AccessGrant[]; can_see_me: AccessGrant[]; pending_in: AccessGrant[]; pending_out: AccessGrant[] }> { return jget("/api/access"); },
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
