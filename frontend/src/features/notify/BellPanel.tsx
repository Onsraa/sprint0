/* sprint0 — the bell + live notification dropdown (System 5). Reads the inbox Query (kept live by
 * the WS-invalidate in useNotifications); the badge + list update without polling. Monochrome. */
import { useNavigate } from "@tanstack/react-router";
import { useUI } from "../../lib/store";
import { Icon } from "../../lib/icon";
import { useInbox, useMarkAllRead } from "./useNotifications";

export function BellPanel() {
  const open = useUI((s) => s.bellOpen);
  const setOpen = useUI((s) => s.setBellOpen);
  const navigate = useNavigate();
  const { data: inbox } = useInbox();
  const markRead = useMarkAllRead();
  const unread = inbox?.unread ?? 0;
  const items = inbox?.notifications ?? [];

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} title="Notifications"
        style={{ position: "relative", width: 36, height: 36, borderRadius: "50%", background: open ? "var(--bg-hover)" : "var(--bg-secondary)", border: "0.5px solid var(--border)", display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-secondary)" }}>
        <Icon name="bell" size={16} />
        {unread > 0 && (
          <span className="mono" style={{ position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, padding: "0 3px", borderRadius: 999, background: "var(--ink-fill)", color: "var(--bg-elevated)", fontSize: 9, fontWeight: 600, display: "grid", placeItems: "center", border: "1.5px solid var(--bg-elevated)" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 109 }} />
          <div className="pop-in" style={{ position: "absolute", top: 42, right: 0, width: 360, maxHeight: 460, zIndex: 110, background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-3)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: "0.5px solid var(--border-subtle)" }}>
              <span className="kicker">Notifications</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => markRead.mutate()} className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)", cursor: "pointer" }}>Mark all read</button>
            </div>
            <div style={{ overflow: "auto" }}>
              {items.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>Nothing yet.</div>
              ) : (
                items.slice(0, 12).map((n) => (
                  <div key={n.id} style={{ display: "flex", gap: 10, padding: "11px 14px", borderBottom: "0.5px solid var(--border-subtle)", background: n.read ? "transparent" : "var(--bg-secondary)" }}>
                    <span style={{ marginTop: 3, color: "var(--text-tertiary)" }}><Icon name="dot" size={8} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 500, color: "var(--text-primary)" }}>{n.title}</div>
                      {n.body && <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 1 }}>{n.body}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => { setOpen(false); navigate({ to: "/inbox" as "/" }); }} style={{ padding: "10px 14px", borderTop: "0.5px solid var(--border-subtle)", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", textAlign: "center", cursor: "pointer" }}>
              Open Inbox
            </button>
          </div>
        </>
      )}
    </div>
  );
}
