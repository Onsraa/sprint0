/* sprint0 — notifications (System 5). The inbox lives in TanStack Query; the live WS only
 * INVALIDATES it (never owns data), so there's one source of truth and no stale-cache class of bug.
 * Moved out of AppContext (which had the WS + an inbox useState). */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";

export function useInbox(enabled = true) {
  return useQuery({ queryKey: qk.inbox(), queryFn: () => api.inbox(), enabled });
}

/** Open the member's live notification WS; each push invalidates the inbox query (bell updates). */
export function useNotificationsWS(username: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!username) return;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(api.notificationsWsUrl(username));
      ws.onmessage = () => qc.invalidateQueries({ queryKey: qk.inbox() });
    } catch {
      /* WS unavailable — the inbox query still refreshes on focus */
    }
    return () => { try { ws?.close(); } catch { /* ignore */ } };
  }, [username, qc]);
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.inboxReadAll(),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.inbox() }),
  });
}
