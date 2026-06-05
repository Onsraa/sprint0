/* sprint0 — route tree (TanStack Router, code-based). The root renders <AppShellNew/>; children
 * render into the shell's <Outlet/>. Each `View` string maps 1:1 to a path segment (/${view}). State
 * is sourced from TanStack Query / Zustand / the router directly (no AppContext) — see features/nav
 * (useView + useRoleGate), features/auth (useMe), lib/store (useUI). */
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import type { FC } from "react";
import { AppShellNew } from "./AppShellNew";

import { GateContract } from "../views/GateContract";
import { WorkHub } from "../views/work/WorkHub";
import { Dashboard } from "../views/Dashboard";
import { TeamView } from "../views/Team";
import { RelayBoard } from "../views/RelayBoard";
import { RatifyQueue } from "../views/RatifyQueue";
import { Portfolio } from "../views/Portfolio";
import { Profiles } from "../views/Profiles";
import { Settings } from "../views/Settings";
import { QAGate } from "../views/QAGate";
import { Passport } from "../views/Passport";
// Inbox view retired — notifications live in the bell dropdown; Relays is the home.
import { Relays } from "../views/Relays";

const rootRoute = createRootRoute({
  component: () => <AppShellNew />,
});

/** path (= `/${view}`) → the existing panel component. */
const PANELS: { path: string; component: FC }[] = [
  { path: "/relays", component: Relays },
  { path: "/gatecontract", component: GateContract },
  { path: "/work", component: WorkHub },
  { path: "/dashboard", component: Dashboard },
  { path: "/relay", component: RelayBoard },
  { path: "/queue", component: RatifyQueue },
  { path: "/team", component: TeamView },
  { path: "/profiles", component: Profiles },
  { path: "/portfolio", component: Portfolio },
  { path: "/settings", component: Settings },
  { path: "/qa", component: QAGate },
  { path: "/passport", component: Passport },
];

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // a sensible default; the AppContext role-gate effect redirects to the persona home if invalid.
  // (cast: the router type isn't registered yet inside a route definition.)
  beforeLoad: () => { throw redirect({ to: "/relays" as "/" }); },
});

const panelRoutes = PANELS.map(({ path, component }) =>
  createRoute({ getParentRoute: () => rootRoute, path, component }));

const routeTree = rootRoute.addChildren([indexRoute, ...panelRoutes]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
