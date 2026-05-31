/* sprint0 — one QueryClient for the app. Defaults tuned for an internal, always-fresh-ish
 * orchestrator: refetch on focus, modest stale window. Server data lives here (TanStack Query),
 * never in Zustand. Centralised query keys — import these, never hand-write key arrays. */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000, refetchOnWindowFocus: true, retry: 1 },
    mutations: { retry: 0 },
  },
});

export const qk = {
  me: () => ["me"] as const,
  projects: () => ["projects"] as const,
  work: (scope: string) => ["work", scope] as const,
  relay: (planId: string) => ["relay", planId] as const,
  roster: () => ["roster"] as const,
  inbox: () => ["inbox"] as const,
  profiles: () => ["profiles"] as const,
  myQueue: () => ["myQueue"] as const,
  allRelays: () => ["allRelays"] as const,
  decisions: () => ["decisions"] as const,
  staffing: (planId: string) => ["staffing", planId] as const,
} as const;
