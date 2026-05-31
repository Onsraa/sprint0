/* sprint0 — UI state (Zustand). Strictly *client* state: what's open, what's selected. Server data
 * lives in TanStack Query, never here. Keeping the two apart is what stops the "why is my state
 * stale" class of bugs. (Migrated off AppContext's UI fields across P4–P7.) */
import { create } from "zustand";

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
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  panelTaskId: null,
  openPanel: (panelTaskId) => set({ panelTaskId }),
  closePanel: () => set({ panelTaskId: null }),
  bellOpen: false,
  setBellOpen: (bellOpen) => set({ bellOpen }),
}));
