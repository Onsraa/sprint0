/* sprint0 — gateway liveness for the sidebar "MCP · online" dot. Polls the REAL /health
   (a Mongo ping behind the MCP) every 15s, so the dot reflects actual reachability, not a
   hardcoded green. `retry:false` so a down backend flips the dot promptly instead of hanging. */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: false,
  });
}
