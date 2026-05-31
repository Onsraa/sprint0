/* sprint0 — auth, lifted out of AppContext (P8). The member lives in TanStack Query (keyed on the
 * session token); login/logout are mutations that seed/clear that cache. role/discipline derive from
 * the member via nav helpers. Navigation after login + the logout UI reset live in the components. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, token } from "../../lib/api";
import type { Member } from "../../lib/api";
import { qk } from "../../lib/query";
import { memberToRole, disciplineOf } from "../nav/nav";

/** The logged-in member (null while loading / logged out). Enabled only when a token exists. */
export function useMe() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.me(),
    queryFn: () => api.me(),
    enabled: token.get() != null,
    retry: false,
    staleTime: Infinity,
  });
  // A stale/unknown token resolves to an error → drop it so the app falls back to <Login/>.
  if (q.isError && token.get() != null) {
    token.clear();
    qc.removeQueries({ queryKey: qk.me() });
  }
  const member: Member | null = q.data ?? null;
  return {
    member,
    authLoading: q.isLoading && token.get() != null,
    role: memberToRole(member),
    discipline: disciplineOf(member),
  };
}

/** Login mutation: exchange a username for a token + member, seed the me-cache. */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => api.login(username),
    onSuccess: (res) => {
      token.set(res.token);
      qc.setQueryData(qk.me(), res.member);
    },
  });
}

/** Logout: clear the token + the entire query cache (the caller resets UI state + navigates). */
export function useLogout() {
  const qc = useQueryClient();
  return () => {
    token.clear();
    qc.clear();
  };
}
