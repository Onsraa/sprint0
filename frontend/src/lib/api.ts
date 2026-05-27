/* Typed fetch client for the baton gateway.
   Base URL from VITE_API_BASE (falls back to localhost:8000).
   JSON + FormData helpers; throws on non-2xx with the response text. */

const BASE: string = import.meta.env.VITE_API_BASE || "http://localhost:8000";

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

export interface FeaturePlanResponse extends PlanResponse {
  project_id: number;
}

export interface DispatchResult {
  plan_id: string;
  mode: "copilot" | "autonomous";
  web_url: string;
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

export interface DeveloperProfile {
  name: string;
  gitlab_username: string;
  skills_text: string;
  trust_level: TrustLevel;
  history: Record<string, unknown>[];
  promoted?: boolean;
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
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return unwrap<T>(res);
}

async function jget<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(BASE + path));
}

async function fpost<T>(path: string, form: FormData): Promise<T> {
  return unwrap<T>(await fetch(BASE + path, { method: "POST", body: form }));
}

/* ── Endpoints ───────────────────────────────────────────────────────── */

export const api = {
  base: BASE,

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

  /* Relay */
  relay(planId: string): Promise<RelayState> {
    return jget(`/api/plans/${planId}/relay`);
  },
  relayAuto(planId: string, dial: number): Promise<RelayState> {
    return jpost(`/api/plans/${planId}/relay/auto`, { dial });
  },
  ratify(
    planId: string,
    discipline: Discipline,
    body: { edits?: Issue[]; note?: string; approve?: boolean },
  ): Promise<RelayState> {
    return jpost(`/api/plans/${planId}/ratify/${discipline}`, body);
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
