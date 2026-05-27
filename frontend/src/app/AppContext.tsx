import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { LS } from "../lib/storage";
import type { Mode, Project, Role, View, WizardKind } from "./types";
import type { PlanJSON, RelayState } from "../lib/api";

interface AppContextValue {
  setupDone: boolean;
  setSetupDone: Dispatch<SetStateAction<boolean>>;
  role: Role;
  setRole: Dispatch<SetStateAction<Role>>;
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
  devTrust: number;
  setDevTrust: Dispatch<SetStateAction<number>>;
  tweaksOpen: boolean;
  setTweaksOpen: Dispatch<SetStateAction<boolean>>;
  activeIssue: string | null;
  setActiveIssue: Dispatch<SetStateAction<string | null>>;
  activeDev: string | null;
  setActiveDev: Dispatch<SetStateAction<string | null>>;
  projects: Project[];
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
}

const AppCtx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used within <AppProvider>");
  return ctx;
}

const MANAGER_VIEWS: View[] = ["dashboard", "team", "relay"];
const DEV_VIEWS: View[] = ["today", "issue", "passport", "ratify", "qa"];

/** Where each role lands. */
const ROLE_HOME: Record<Role, View> = {
  manager: "dashboard",
  uiux: "ratify",
  backend: "ratify",
  frontend: "ratify",
  qa: "qa",
};

function roleToMode(role: Role): Mode {
  return role === "manager" ? "manager" : "dev";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [setupDone, setSetupDone] = useState<boolean>(() => LS.get("setup", false));
  const [role, setRole] = useState<Role>(() => LS.get<Role>("role", "manager"));
  const mode = roleToMode(role);
  const [view, setView] = useState<View>(() => ROLE_HOME[LS.get<Role>("role", "manager")]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKind, setWizardKind] = useState<WizardKind>("brief");
  const [featureProjectId, setFeatureProjectId] = useState<number | null>(null);
  const [devTrust, setDevTrust] = useState<number>(() => LS.get("devTrust", 65));
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [activeIssue, setActiveIssue] = useState<string | null>(null);
  const [activeDev, setActiveDev] = useState<string | null>(null);

  const [plan, setPlan] = useState<PlanJSON | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [relay, setRelay] = useState<RelayState | null>(null);
  const [liveProjectId, setLiveProjectId] = useState<number | null>(null);

  useEffect(() => {
    LS.set("role", role);
  }, [role]);
  useEffect(() => {
    LS.set("devTrust", devTrust);
  }, [devTrust]);

  // Keep the active view valid for the current role; switching roles lands on home.
  useEffect(() => {
    const valid = mode === "manager" ? MANAGER_VIEWS : DEV_VIEWS;
    setView((v) => (valid.includes(v) ? v : ROLE_HOME[role]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const projects = useMemo<Project[]>(
    () => [
      {
        id: "p_001",
        name: "luxe-real-estate",
        client: "Luxe Properties LLC",
        status: "shipping",
        progress: 72,
        sprint: 3,
        devs: 4,
        issues: 32,
        stack: ["Next.js", "Postgres", "Stripe"],
        created: "3w ago",
        color: "#0F8E5C",
        match: { name: "zillow-clone-2024", pct: 92 },
      },
      {
        id: "p_002",
        name: "courier-track",
        client: "Bolt Delivery",
        status: "review",
        progress: 28,
        sprint: 0,
        devs: 3,
        issues: 18,
        stack: ["React Native", "Node", "PostGIS"],
        created: "2d ago",
        color: "#D97706",
        match: { name: "delivery-track-2024", pct: 88 },
      },
      {
        id: "p_003",
        name: "fintech-jr-v2",
        client: "BridgePay",
        status: "shipped",
        progress: 100,
        sprint: 6,
        devs: 5,
        issues: 47,
        stack: ["Next.js", "Stripe", "Plaid"],
        created: "2mo ago",
        color: "#2A6FDB",
        match: { name: "fintech-jr-2024", pct: 95 },
      },
    ],
    [],
  );

  const value: AppContextValue = {
    setupDone,
    setSetupDone,
    role,
    setRole,
    mode,
    view,
    setView,
    wizardOpen,
    setWizardOpen,
    wizardKind,
    setWizardKind,
    featureProjectId,
    setFeatureProjectId,
    devTrust,
    setDevTrust,
    tweaksOpen,
    setTweaksOpen,
    activeIssue,
    setActiveIssue,
    activeDev,
    setActiveDev,
    projects,
    plan,
    setPlan,
    planId,
    setPlanId,
    relay,
    setRelay,
    liveProjectId,
    setLiveProjectId,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
