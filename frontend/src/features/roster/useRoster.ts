/* sprint0 — the roster (the @person picker + team views), lifted out of AppContext (P8).
 * GET /api/developers in TanStack Query. */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";

export function useRoster() {
  const q = useQuery({ queryKey: qk.roster(), queryFn: () => api.developers() });
  return q.data ?? [];
}
