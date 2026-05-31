/* sprint0 — capability profiles (spine P2). The growing, manager-confirmed lane taxonomy:
 * the AI tags issues with free-text capabilities; an unknown tag becomes a `proposed` profile
 * the manager confirms before it can shape a lane. GET reads (everyone); POST confirm (manager
 * only) flips proposed → confirmed optimistically so the card promotes instantly. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import type { ProfilesResponse } from "../../lib/schemas";

export function useProfiles() {
  return useQuery({ queryKey: qk.profiles(), queryFn: () => api.profiles() });
}

/** Manager confirm gate (decision A): promote a discovered profile proposed → confirmed. */
export function useConfirmProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.confirmProfile(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.profiles() });
      const prev = qc.getQueryData<ProfilesResponse>(qk.profiles());
      qc.setQueryData<ProfilesResponse>(qk.profiles(), (cur) =>
        cur ? { profiles: cur.profiles.map((p) => (p.id === id ? { ...p, status: "confirmed" as const } : p)) } : cur,
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.profiles(), ctx.prev);
      toast.error(err instanceof Error ? err.message : "Confirm failed");
    },
    onSuccess: (_d, id) => toast.success(`Profile “${id}” confirmed`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.profiles() }),
  });
}
