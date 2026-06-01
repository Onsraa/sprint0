/* sprint0 — the workspace label (the GitLab demo group's display name). One shared query feeds the
   sidebar header ("sprint0 · <group>") and the breadcrumb root crumb. Falls back to "Studio" while
   loading or if GitLab is unreachable, so the UI never shows a blank. */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

export function useWorkspace(): string {
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => api.workspace(),
    staleTime: 5 * 60_000,
  });
  return data?.name ?? "Studio";
}
