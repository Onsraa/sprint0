/* sprint0 — persona → nav mapping + the view↔URL bridge, lifted out of AppContext (P8). The router
 * is the source of truth: `view` derives from the path, `setView` navigates. `useRoleGate` redirects
 * a persona off a route it can't see (a dev deep-linking a manager route bounces home) — note it no
 * longer force-homes on restore, so deep-links to a *valid* route now survive a refresh. */
import { useCallback, useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { Discipline, Member } from "../../lib/api";
import type { Mode, Role, View } from "../../app/types";

export const MANAGER_VIEWS: View[] = ["dashboard", "work", "team", "relay", "relays", "queue", "ratify", "portfolio", "attributions", "codegraph", "profiles", "inbox"];
export const DEV_VIEWS: View[] = ["work", "today", "issue", "passport", "ratify", "qa", "queue", "portfolio", "inbox"];

/** Where each persona lands on a fresh login. Leads land on the cross-project ratify queue. */
export const ROLE_HOME: Record<Role, View> = {
  manager: "dashboard", uiux: "work", backend: "work", frontend: "work", qa: "work",
};

/** Manager → "manager"; a dev's discipline drives the rest (devops → generic dev nav via "backend"). */
export function memberToRole(member: Member | null): Role {
  if (!member || member.role === "manager") return "manager";
  switch (member.discipline) {
    case "uiux":
    case "backend":
    case "frontend":
    case "qa":
      return member.discipline;
    default:
      return "backend";
  }
}

export function roleToMode(role: Role): Mode {
  return role === "manager" ? "manager" : "dev";
}

/** The member's real relay discipline (devs only; null for a manager). */
export function disciplineOf(member: Member | null): Discipline | null {
  return member && member.role === "developer" ? member.discipline : null;
}

/** view ↔ URL bridge. `view` is the path segment; `setView` navigates. */
export function useView() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const view = (pathname === "/" ? "work" : pathname.slice(1)) as View;
  const setView = useCallback((v: View) => navigate({ to: `/${v}` as string }), [navigate]);
  return { view, setView };
}

/** Keep the active route valid for the persona — redirect an out-of-scope view home.
 *  No-ops when `role` is null (logged out), so it can be mounted unconditionally in the shell. */
export function useRoleGate(role: Role | null) {
  const { view, setView } = useView();
  useEffect(() => {
    if (role == null) return;
    const valid = roleToMode(role) === "manager" ? MANAGER_VIEWS : DEV_VIEWS;
    if (!valid.includes(view)) setView(ROLE_HOME[role]);
  }, [role, view, setView]);
}
