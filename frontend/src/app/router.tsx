/* sprint0 — route tree (TanStack Router, code-based). The root renders <AppProvider><AppShellNew/></,
 * so every panel still gets useApp() via the bridge; children render into the shell's <Outlet/>.
 * Each `View` string maps 1:1 to a path segment (/${view}), which keeps the AppContext view↔URL
 * bridge trivial. Role-gating is the existing AppContext effect (redirects an invalid view home). */
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import type { FC } from "react";
import { AppProvider } from "./AppContext";
import { AppShellNew } from "./AppShellNew";

import { InboxPage } from "../views/InboxPage";
import { WorkHub } from "../views/work/WorkHub";
import { Dashboard } from "../views/Dashboard";
import { TeamView } from "../views/Team";
import { RelayBoard } from "../views/RelayBoard";
import { RatifyPanel } from "../views/RatifyPanel";
import { RatifyQueue } from "../views/RatifyQueue";
import { RelayPortfolio } from "../views/RelayPortfolio";
import { Portfolio } from "../views/Portfolio";
import { Attributions } from "../views/Attributions";
import { CodeGraph } from "../views/CodeGraph";
import { QAGate } from "../views/QAGate";
import { DevToday, DevIssue, DevPassport } from "../views/dev/DevViews";

const rootRoute = createRootRoute({
  component: () => (
    <AppProvider>
      <AppShellNew />
    </AppProvider>
  ),
});

/** path (= `/${view}`) → the existing panel component. */
const PANELS: { path: string; component: FC }[] = [
  { path: "/inbox", component: InboxPage },
  { path: "/work", component: WorkHub },
  { path: "/dashboard", component: Dashboard },
  { path: "/team", component: TeamView },
  { path: "/relay", component: RelayBoard },
  { path: "/relays", component: RelayPortfolio },
  { path: "/queue", component: RatifyQueue },
  { path: "/ratify", component: RatifyPanel },
  { path: "/attributions", component: Attributions },
  { path: "/codegraph", component: CodeGraph },
  { path: "/portfolio", component: Portfolio },
  { path: "/qa", component: QAGate },
  { path: "/today", component: DevToday },
  { path: "/issue", component: DevIssue },
  { path: "/passport", component: DevPassport },
];

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // a sensible default; the AppContext role-gate effect redirects to the persona home if invalid.
  // (cast: the router type isn't registered yet inside a route definition.)
  beforeLoad: () => { throw redirect({ to: "/work" as "/" }); },
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
