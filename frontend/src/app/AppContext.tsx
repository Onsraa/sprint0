import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { LS } from "../lib/storage";
import type { Mode, Project, View, WizardKind } from "./types";

interface AppContextValue {
  setupDone: boolean;
  setSetupDone: Dispatch<SetStateAction<boolean>>;
  mode: Mode;
  setMode: Dispatch<SetStateAction<Mode>>;
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  wizardOpen: boolean;
  setWizardOpen: Dispatch<SetStateAction<boolean>>;
  wizardKind: WizardKind;
  setWizardKind: Dispatch<SetStateAction<WizardKind>>;
  devTrust: number;
  setDevTrust: Dispatch<SetStateAction<number>>;
  tweaksOpen: boolean;
  setTweaksOpen: Dispatch<SetStateAction<boolean>>;
  activeIssue: string | null;
  setActiveIssue: Dispatch<SetStateAction<string | null>>;
  activeDev: string | null;
  setActiveDev: Dispatch<SetStateAction<string | null>>;
  projects: Project[];
}

const AppCtx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used within <AppProvider>");
  return ctx;
}

const MANAGER_VIEWS: View[] = ["dashboard", "team"];
const DEV_VIEWS: View[] = ["today", "issue", "passport"];

export function AppProvider({ children }: { children: ReactNode }) {
  const [setupDone, setSetupDone] = useState<boolean>(() => LS.get("setup", false));
  const [mode, setMode] = useState<Mode>(() => LS.get<Mode>("mode", "manager"));
  const [view, setView] = useState<View>("dashboard");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKind, setWizardKind] = useState<WizardKind>("brief");
  const [devTrust, setDevTrust] = useState<number>(() => LS.get("devTrust", 65));
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [activeIssue, setActiveIssue] = useState<string | null>(null);
  const [activeDev, setActiveDev] = useState<string | null>(null);

  useEffect(() => {
    LS.set("mode", mode);
  }, [mode]);
  useEffect(() => {
    LS.set("devTrust", devTrust);
  }, [devTrust]);

  // Keep the active view valid for the current mode.
  useEffect(() => {
    if (mode === "manager") {
      setView((v) => (MANAGER_VIEWS.includes(v) ? v : "dashboard"));
    } else {
      setView((v) => (DEV_VIEWS.includes(v) ? v : "today"));
    }
  }, [mode]);

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
    mode,
    setMode,
    view,
    setView,
    wizardOpen,
    setWizardOpen,
    wizardKind,
    setWizardKind,
    devTrust,
    setDevTrust,
    tweaksOpen,
    setTweaksOpen,
    activeIssue,
    setActiveIssue,
    activeDev,
    setActiveDev,
    projects,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
