/* sprint0 — UI state (Zustand). Strictly *client* state: what's open, what's selected, and the
 * imperative wizard→ratify handoff (a drafted plan + which gate is focused). Server data lives in
 * TanStack Query, never here. Keeping the two apart is what stops the "why is my state stale" class
 * of bugs. (Absorbed AppContext's UI fields across P4–P8 — the last of the spine.) */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Discipline, PlanJSON } from "./api";
import type { WizardKind } from "../app/types";

interface UIState {
  /** ⌘K command palette (P6). */
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  /** Right-hand sub-panel target (the task drawer), or null when closed (P4). */
  panelTaskId: string | null;
  openPanel: (taskId: string) => void;
  closePanel: () => void;
  /** Bell dropdown (P6). */
  bellOpen: boolean;
  setBellOpen: (open: boolean) => void;
  /** Left-nav collapsed rail. In the store (not local state) so it survives shell remounts
   *  (wizard / persona switch) and — via persist — a reload. */
  navCollapsed: boolean;
  toggleNav: () => void;

  /** Wizard modal (P8 — off AppContext). */
  wizardOpen: boolean;
  setWizardOpen: (open: boolean) => void;
  wizardKind: WizardKind;
  setWizardKind: (kind: WizardKind) => void;
  /** Existing project id to extend when the wizard opens in mid-prod feature mode. */
  featureProjectId: number | null;
  setFeatureProjectId: (id: number | null) => void;

  /** Wizard→ratify handoff: the drafted plan + which gate the ratify panel is focused on. */
  plan: PlanJSON | null;
  setPlan: (plan: PlanJSON | null) => void;
  planId: string | null;
  setPlanId: (id: string | null) => void;
  activeGate: Discipline | null;
  setActiveGate: (d: Discipline | null) => void;

  /** The dispatched GitLab project (QA / mid-prod / the dev fetch block). */
  liveProjectId: number | null;
  setLiveProjectId: (id: number | null) => void;
  liveCloneUrl: string | null;
  setLiveCloneUrl: (url: string | null) => void;

  /** Cross-view project filter (the shared topbar ProjectSwitcher): null = All projects. */
  projectFilter: number | null;
  setProjectFilter: (id: number | null) => void;

  /** Relays person filter (PersonSwitcher): review a watched person's relays. null = your own scope. */
  personFilter: string | null;
  setPersonFilter: (u: string | null) => void;

  /** Dev-surface focus. */
  activeIssue: string | null;
  setActiveIssue: (id: string | null) => void;
  activeDev: string | null;
  setActiveDev: (id: string | null) => void;

  /** Trust Dial (0–100) — global auto-pass sensitivity, surfaced in Relay/Settings. */
  dial: number;
  setDial: (d: number) => void;

  /** Wizard drafts (saved before dispatch; shown on Projects). */
  drafts: any[];
  addDraft: (d: any) => any;
  removeDraftByName: (name: string) => void;

  /** Clear all session-scoped UI on logout. */
  resetSession: () => void;
}

const SESSION_DEFAULTS = {
  wizardOpen: false,
  wizardKind: "brief" as WizardKind,
  featureProjectId: null,
  plan: null,
  planId: null,
  activeGate: null,
  liveProjectId: null,
  liveCloneUrl: null,
  projectFilter: null,
  activeIssue: null,
  activeDev: null,
  panelTaskId: null,
  bellOpen: false,
};

export const useUI = create<UIState>()(persist((set) => ({
  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  panelTaskId: null,
  openPanel: (panelTaskId) => set({ panelTaskId }),
  closePanel: () => set({ panelTaskId: null }),
  bellOpen: false,
  setBellOpen: (bellOpen) => set({ bellOpen }),
  navCollapsed: false,
  toggleNav: () => set((s) => ({ navCollapsed: !s.navCollapsed })),

  wizardOpen: false,
  setWizardOpen: (wizardOpen) => set({ wizardOpen }),
  wizardKind: "brief",
  setWizardKind: (wizardKind) => set({ wizardKind }),
  featureProjectId: null,
  setFeatureProjectId: (featureProjectId) => set({ featureProjectId }),

  plan: null,
  setPlan: (plan) => set({ plan }),
  planId: null,
  setPlanId: (planId) => set({ planId }),
  activeGate: null,
  setActiveGate: (activeGate) => set({ activeGate }),

  liveProjectId: null,
  setLiveProjectId: (liveProjectId) => set({ liveProjectId }),
  liveCloneUrl: null,
  setLiveCloneUrl: (liveCloneUrl) => set({ liveCloneUrl }),
  projectFilter: null,
  setProjectFilter: (projectFilter) => set({ projectFilter }),
  personFilter: null,
  setPersonFilter: (personFilter) => set({ personFilter }),

  activeIssue: null,
  setActiveIssue: (activeIssue) => set({ activeIssue }),
  activeDev: null,
  setActiveDev: (activeDev) => set({ activeDev }),
  dial: 55,
  setDial: (dial) => set({ dial }),
  drafts: [],
  addDraft: (d) => {
    const draft = { ...d, id: d.id || "dft_" + Date.now(), kind: "draft", status: "draft", created: "just now" };
    set((s) => ({ drafts: [draft, ...s.drafts] }));
    return draft;
  },
  removeDraftByName: (name) => set((s) => ({ drafts: s.drafts.filter((d: any) => d.name !== name) })),

  resetSession: () => set(SESSION_DEFAULTS),
}), { name: "sprint0-ui", partialize: (s) => ({ navCollapsed: s.navCollapsed }) }));
