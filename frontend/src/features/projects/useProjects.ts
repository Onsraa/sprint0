/* sprint0 — dispatched projects (the manager Dashboard + CodeGraph + RatifyPanel), lifted out of
 * AppContext (P8). GET /api/projects in TanStack Query; `refreshProjects` just invalidates the key. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";

export function useProjects() {
  const q = useQuery({ queryKey: qk.projects(), queryFn: () => api.projects().then((r) => r.projects) });
  return { projects: q.data ?? [], isLoading: q.isLoading, error: q.error };
}

/** Imperative refresh (after a dispatch / close) — returns the invalidator. */
export function useRefreshProjects() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qk.projects() });
}
