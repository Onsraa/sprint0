/* sprint0 — relay/ratify data hooks (TanStack Query). The marquee optimistic pattern: ratify a gate
 * and it flips in the cache before the round-trip; the server's truth (which recomputes baton/locks)
 * wins on settle. Replaces AppContext's relay/setRelay. Wired to the REAL endpoints. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../lib/api";
import type { Discipline, FlagIntegrationResult, RelayState } from "../../lib/api";
import { qk } from "../../lib/query";

export function useRelay(planId: string | null) {
  return useQuery({
    queryKey: qk.relay(planId ?? ""),
    queryFn: () => api.getRelay(planId!),
    enabled: !!planId,
    // live board: gate ready (preparing→open), baton moves and dispatch phases show without a refocus
    refetchInterval: 4000,
  });
}

/** Decision Card (System 2) — an expensive two-pass LLM call, so cache it generously. */
export function useDecisionCard(planId: string | null, discipline: Discipline | null) {
  return useQuery({
    queryKey: ["card", planId, discipline] as const,
    queryFn: () => api.decisionCard(planId!, discipline!),
    enabled: !!planId && !!discipline,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Reuse-or-innovate: a gate's solution set (memory + fresh + write-your-own). Lazy + cached server-side. */
export function useGateSolutions(planId: string | null, discipline: Discipline | null) {
  return useQuery({
    queryKey: ["solutions", planId, discipline] as const,
    queryFn: () => api.gateSolutions(planId!, discipline!),
    enabled: !!planId && !!discipline,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

type RatifyBody = Parameters<typeof api.ratify>[2];

export function useRatifyGate(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { discipline: Discipline; body: RatifyBody }) => api.ratify(planId, v.discipline, v.body),
    onMutate: async ({ discipline, body }) => {
      await qc.cancelQueries({ queryKey: qk.relay(planId) });
      const prev = qc.getQueryData<RelayState>(qk.relay(planId));
      qc.setQueryData<RelayState>(qk.relay(planId), (old) =>
        old && {
          ...old,
          gates: old.gates.map((g) =>
            g.discipline === discipline
              ? { ...g, status: body.approve ? "ratified" : "changes_requested", note: body.note ?? g.note }
              : g,
          ),
        },
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(qk.relay(planId), ctx.prev); },
    onSuccess: (next, { body }) => {
      qc.setQueryData(qk.relay(planId), next); // server truth — recomputes baton + downstream locks
      toast.success(body.approve ? "Gate ratified — baton passed" : "Changes requested");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.relay(planId) });
      qc.invalidateQueries({ queryKey: ["planAgreements", planId] }); // the gate choice may (re)generate its contract (JIT)
      qc.invalidateQueries({ queryKey: ["myAgreements"] });
    },
  });
}

/** Integration flag. Returns a RelayState (applied) or {need_target, candidates} (ambiguous producer). */
export function useFlagIntegration(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.flagIntegration>[1]) => api.flagIntegration(planId, body),
    onSuccess: (res: FlagIntegrationResult) => {
      if ("gates" in res) {
        qc.setQueryData(qk.relay(planId), res);
        toast.success("Integration status updated");
      }
    },
  });
}
