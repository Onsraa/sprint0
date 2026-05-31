/* sprint0 — Work-hub data hooks (TanStack Query). Replaces AppContext's tasksByScope cache +
 * loadTasks/invalidateTasks/patchTask. The optimistic status mutation mirrors the old patchTask's
 * key property: it patches the task ACROSS ALL cached scopes (me|team|user:*) in place, so a card
 * moved in "me" also moves in "team" — TanStack is per-key, so we iterate the cached work queries. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api, type TaskStatus, type WorkTask } from "../../lib/api";
import { qk } from "../../lib/query";

const WORK = ["work"] as const; // matches every qk.work(scope) = ["work", scope]

export function useWork(scope: string) {
  return useQuery({
    queryKey: qk.work(scope),
    queryFn: () => api.work(scope).then((r) => r.tasks),
  });
}

/** Optimistic in-place patch of one task across EVERY cached scope (no refetch, no blank). */
export function patchTaskInCache(qc: QueryClient, taskId: string, patch: Partial<WorkTask>) {
  qc.getQueriesData<WorkTask[]>({ queryKey: WORK }).forEach(([key, tasks]) => {
    if (!tasks) return;
    qc.setQueryData<WorkTask[]>(key, tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
  });
}

/** Patch a batch of already-persisted tasks into the cache across scopes (the reflow result). */
export function patchTasksInCache(qc: QueryClient, moved: WorkTask[]) {
  const byId = new Map(moved.map((t) => [t.id, t]));
  qc.getQueriesData<WorkTask[]>({ queryKey: WORK }).forEach(([key, tasks]) => {
    if (!tasks) return;
    qc.setQueryData<WorkTask[]>(key, tasks.map((t) => {
      const m = byId.get(t.id);
      return m ? { ...t, ...m } : t;
    }));
  });
}

/** Optimistic status change: patch across scopes now, roll back on error, invalidate on settle. */
export function useSetTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.setTaskStatus(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: WORK });
      const prev = qc.getQueriesData<WorkTask[]>({ queryKey: WORK });
      patchTaskInCache(qc, id, { status });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: WORK }),
  });
}
