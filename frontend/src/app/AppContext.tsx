import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { Mode, Role, View, WizardKind } from "./types";
import type { Discipline, Member, PlanJSON, ProjectSummary, RelayState, WorkTask } from "../lib/api";
import { api, token } from "../lib/api";

interface AppContextValue {
  /** Auth state. `null` member while loading or logged out → AppShell shows <Login/>. */
  member: Member | null;
  authLoading: boolean;
  login: (username: string) => Promise<Member>;
  logout: () => void;
  /** Derived persona for nav/views. */
  role: Role;
  /** The member's real relay discipline (devs only; null for manager). */
  discipline: Discipline | null;
  /** Gate discipline focused from the ratify queue — lets RatifyPanel show a
   *  gate even when the caller's own `discipline` is null (e.g. a manager). */
  activeGate: Discipline | null;
  setActiveGate: Dispatch<SetStateAction<Discipline | null>>;
  mode: Mode;
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  wizardOpen: boolean;
  setWizardOpen: Dispatch<SetStateAction<boolean>>;
  wizardKind: WizardKind;
  setWizardKind: Dispatch<SetStateAction<WizardKind>>;
  /** Existing project id to extend when the wizard opens in mid-prod feature mode. */
  featureProjectId: number | null;
  setFeatureProjectId: Dispatch<SetStateAction<number | null>>;
  activeIssue: string | null;
  setActiveIssue: Dispatch<SetStateAction<string | null>>;
  activeDev: string | null;
  setActiveDev: Dispatch<SetStateAction<string | null>>;
  /** Real dispatched projects (from GET /api/projects). Refetched on login + after dispatch/close. */
  projects: ProjectSummary[];
  refreshProjects: () => void;
  /** Live plan produced by the wizard — drives the relay/ratify/qa surfaces. */
  plan: PlanJSON | null;
  setPlan: Dispatch<SetStateAction<PlanJSON | null>>;
  planId: string | null;
  setPlanId: Dispatch<SetStateAction<string | null>>;
  relay: RelayState | null;
  setRelay: Dispatch<SetStateAction<RelayState | null>>;
  /** GitLab project id once dispatched (for QA / mid-prod). */
  liveProjectId: number | null;
  setLiveProjectId: Dispatch<SetStateAction<number | null>>;
  /** GitLab clone URL of the dispatched project (for the dev fetch block). */
  liveCloneUrl: string | null;
  setLiveCloneUrl: Dispatch<SetStateAction<string | null>>;
  /** Work-hub Task cache keyed by scope (me|team|user:<id>) — stale-while-revalidate, so
   *  navigating back to My Work is instant. */
  tasksByScope: Record<string, WorkTask[]>;
  taskFetching: string | null;
  taskErr: string | null;
  /** Fetch (or background-refresh) the Tasks for a scope into the cache. */
  loadTasks: (scope: string) => void;
  /** Drop the cache + refresh the active scope (after a task mutation or a dispatch). */
  invalidateTasks: (currentScope?: string) => void;
  /** Cached roster — the @person picker list. */
  roster: Member[];
}

const AppCtx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used within <AppProvider>");
  return ctx;
}

const MANAGER_VIEWS: View[] = ["dashboard", "work", "team", "relay", "relays", "queue", "ratify", "portfolio", "attributions"];
const DEV_VIEWS: View[] = ["work", "today", "issue", "passport", "ratify", "qa", "queue", "portfolio"];

/** Where each persona lands. Leads land on the cross-project ratify queue (not
 *  the bare RatifyPanel, which is empty until a gate is opened from the queue). */
const ROLE_HOME: Record<Role, View> = {
  manager: "dashboard",
  uiux: "work",
  backend: "work",
  frontend: "work",
  qa: "work",
};

/** Map a member to the legacy persona used for nav + view-gating.
 *  Manager → "manager"; a dev's discipline drives the rest (devops has no
 *  dedicated surface → falls back to the generic dev nav via "backend"). */
function memberToRole(member: Member | null): Role {
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

function roleToMode(role: Role): Mode {
  return role === "manager" ? "manager" : "dev";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [member, setMember] = useState<Member | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(() => token.get() != null);

  const role = memberToRole(member);
  const discipline = member && member.role === "developer" ? member.discipline : null;
  const mode = roleToMode(role);

  const [view, setView] = useState<View>("dashboard");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKind, setWizardKind] = useState<WizardKind>("brief");
  const [featureProjectId, setFeatureProjectId] = useState<number | null>(null);
  const [activeIssue, setActiveIssue] = useState<string | null>(null);
  const [activeDev, setActiveDev] = useState<string | null>(null);
  const [activeGate, setActiveGate] = useState<Discipline | null>(null);

  const [plan, setPlan] = useState<PlanJSON | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [relay, setRelay] = useState<RelayState | null>(null);
  const [liveProjectId, setLiveProjectId] = useState<number | null>(null);
  const [liveCloneUrl, setLiveCloneUrl] = useState<string | null>(null);

  // Restore the session on mount: if a token exists, resolve the member.
  useEffect(() => {
    if (token.get() == null) return;
    let cancelled = false;
    setAuthLoading(true);
    api
      .me()
      .then((m) => {
        if (cancelled) return;
        setMember(m);
        setView(ROLE_HOME[memberToRole(m)]);
      })
      .catch(() => {
        if (cancelled) return;
        token.clear(); // stale / unknown token
        setMember(null);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string): Promise<Member> => {
    const res = await api.login(username);
    token.set(res.token);
    setMember(res.member);
    setView(ROLE_HOME[memberToRole(res.member)]);
    return res.member;
  }, []);

  const logout = useCallback(() => {
    token.clear();
    setMember(null);
    setPlan(null);
    setPlanId(null);
    setRelay(null);
    setLiveProjectId(null);
    setLiveCloneUrl(null);
    setActiveGate(null);
    setWizardOpen(false);
    setView("dashboard");
  }, []);

  // Keep the active view valid for the current persona.
  useEffect(() => {
    const valid = mode === "manager" ? MANAGER_VIEWS : DEV_VIEWS;
    setView((v) => (valid.includes(v) ? v : ROLE_HOME[role]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Real dispatched projects from GET /api/projects (replaces the old demo mock).
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const refreshProjects = useCallback(() => {
    if (!member) {
      setProjects([]);
      return;
    }
    api
      .projects()
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]));
  }, [member]);
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Work-hub Tasks: cached by scope, stale-while-revalidate — stops the refetch-on-every-nav.
  const [tasksByScope, setTasksByScope] = useState<Record<string, WorkTask[]>>({});
  const [taskFetching, setTaskFetching] = useState<string | null>(null);
  const [taskErr, setTaskErr] = useState<string | null>(null);
  const [roster, setRoster] = useState<Member[]>([]);
  const loadTasks = useCallback(
    (scope: string) => {
      if (!member) return;
      setTaskFetching(scope);
      api
        .work(scope)
        .then((r) => {
          setTasksByScope((p) => ({ ...p, [scope]: r.tasks }));
          setTaskErr(null);
        })
        .catch((e) => setTaskErr(e instanceof Error ? e.message : String(e)))
        .finally(() => setTaskFetching((s) => (s === scope ? null : s)));
    },
    [member],
  );
  const invalidateTasks = useCallback(
    (currentScope?: string) => {
      setTasksByScope({}); // other scopes refetch lazily on next visit
      if (currentScope) loadTasks(currentScope);
    },
    [loadTasks],
  );
  // Preload My Work + the roster on login so the first Work-hub visit is instant.
  useEffect(() => {
    if (!member) {
      setTasksByScope({});
      setRoster([]);
      return;
    }
    loadTasks("me");
    api.developers().then(setRoster).catch(() => setRoster([]));
  }, [member, loadTasks]);

  const value: AppContextValue = {
    member,
    authLoading,
    login,
    logout,
    role,
    discipline,
    activeGate,
    setActiveGate,
    mode,
    view,
    setView,
    wizardOpen,
    setWizardOpen,
    wizardKind,
    setWizardKind,
    featureProjectId,
    setFeatureProjectId,
    activeIssue,
    setActiveIssue,
    activeDev,
    setActiveDev,
    projects,
    refreshProjects,
    plan,
    setPlan,
    planId,
    setPlanId,
    relay,
    setRelay,
    liveProjectId,
    setLiveProjectId,
    liveCloneUrl,
    setLiveCloneUrl,
    tasksByScope,
    taskFetching,
    taskErr,
    loadTasks,
    invalidateTasks,
    roster,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
