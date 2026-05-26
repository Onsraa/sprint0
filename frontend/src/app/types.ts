export type Mode = "manager" | "dev";
export type ManagerView = "dashboard" | "team";
export type DevView = "today" | "issue" | "passport";
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
}
