/* Shared labels / colors for relay disciplines + gate statuses + issue facets.
   Pure data so the relay board, ratify panel, and dev views stay consistent. */
import type { Discipline, GateStatus, Issue, Kind, Risk } from "./api";

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  uiux: "UI/UX",
  backend: "Backend",
  frontend: "Frontend",
  qa: "QA",
  devops: "DevOps",
};

export const DISCIPLINE_COLOR: Record<Discipline, string> = {
  uiux: "var(--disc-uiux)",
  backend: "var(--disc-backend)",
  frontend: "var(--disc-frontend)",
  qa: "var(--disc-qa)",
  devops: "var(--disc-devops)",
};

export interface StatusStyle {
  label: string;
  fg: string;
  bg: string;
  border: string;
}

export function statusStyle(s: GateStatus): StatusStyle {
  switch (s) {
    case "ratified":
      return { label: "Ratified", fg: "var(--paper)", bg: "var(--positive)", border: "var(--positive)" };
    case "auto_passed":
      return { label: "Auto-passed", fg: "var(--paper)", bg: "var(--info)", border: "var(--info)" };
    case "changes_requested":
      return { label: "Changes requested", fg: "var(--paper)", bg: "var(--warn)", border: "var(--warn)" };
    case "blocked":
      return { label: "Blocked · integration", fg: "var(--bg-elevated)", bg: "var(--red)", border: "var(--red)" };
    case "locked":
      return { label: "Locked", fg: "var(--ink-mute)", bg: "var(--cream-deep)", border: "var(--line-strong)" };
    case "pending":
    default:
      return { label: "Pending", fg: "var(--ink-soft)", bg: "var(--paper)", border: "var(--line-strong)" };
  }
}

export const RISK_COLOR: Record<Risk, string> = {
  low: "var(--green)",
  medium: "var(--amber)",
  high: "var(--red)",
};

export const KIND_LABEL: Record<Kind, string> = {
  code: "Code",
  design: "Design",
  audit: "Audit",
  content: "Content",
  infra: "Infra",
  runbook: "Runbook",
};

/** Flatten a plan's epics into a single issue list. */
export function planIssues(epics: { issues: Issue[] }[] | undefined): Issue[] {
  return (epics ?? []).flatMap((e) => e.issues);
}
