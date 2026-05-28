/* Persona the user is acting as. Manager runs intake/relay; the four leads
   ratify + work their own discipline; QA runs the acceptance gate. */
export type Role = "manager" | "uiux" | "backend" | "frontend" | "qa";

/* Legacy mode kept for the dev-surface views (Today / Active issue / Passport),
   which a lead drops into. Derived from Role. */
export type Mode = "manager" | "dev";

export type ManagerView = "dashboard" | "team" | "relay" | "relays";
export type DevView = "today" | "issue" | "passport" | "ratify" | "qa" | "queue" | "portfolio";
export type View = ManagerView | DevView;
export type WizardKind = "brief" | "hire";

export type ProjectStatus = "parsing" | "review" | "shipping" | "shipped";

export interface ProjectMatch {
  name: string;
  pct: number;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  status: ProjectStatus;
  progress: number;
  sprint: number;
  devs: number;
  issues: number;
  stack: string[];
  created: string;
  color: string;
  match: ProjectMatch;
  /** Real GitLab project id once dispatched — enables mid-prod feature add / QA. */
  projectId?: number;
}
