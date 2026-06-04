/* sprint0 — live notification surfaces (§6): toast host (simulated WS pushes),
   the bell dropdown panel, used across views. Monochrome; spark events use ink, not hue.
   Ported verbatim from the v4 design's Bell.jsx. Exports:
   - BellPanel  = the bell button + its dropdown (mockup BellButton, dropdown inlined)
   - ToastHost  = bottom-right live toast stack */
import { Icon } from "../../lib/icon";
import { useApp } from "../../app/useApp";
import { Dropdown, IconButton } from "../../components/ui";
import { notifMeta, notifColor } from "./notifMeta";

/* ───────── Toast host — bottom-right live stack ───────── */
export function ToastHost() {
  const { toasts } = useApp();
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 120, display: "flex", flexDirection: "column",
      gap: 8, pointerEvents: "none" }}>
      {toasts.map((t: any) => {
        const meta = notifMeta(t.kind);
        return (
          <div key={t._tid} style={{ width: 320, background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)",
            borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-3)", padding: "11px 13px", display: "flex", gap: 11,
            pointerEvents: "auto", animation: "s0-toast-in var(--t-reg) var(--ease-out) both" }}>
            <span style={{ width: 28, height: 28, borderRadius: "var(--r-md)", flexShrink: 0, display: "grid", placeItems: "center",
              background: `color-mix(in srgb, ${notifColor(t.kind)} 14%, transparent)`,
              color: notifColor(t.kind) }}>
              <Icon name={meta.icon} size={15} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: notifColor(t.kind), fontWeight: 600 }}>{meta.label}</span>
                <span style={{ flex: 1 }} />
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />
                <span className="mono" style={{ fontSize: 9.5, color: "var(--text-quaternary)" }}>live</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginTop: 2, lineHeight: 1.3 }}>{t.title}</div>
              {t.body && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.body}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────── Bell button + dropdown ───────── */
export function BellPanel() {
  const { unread, bellOpen, setBellOpen, notifs, markAllRead, setView } = useApp();
  return (
    <Dropdown open={bellOpen} onClose={() => setBellOpen(false)} align="right" top={36} width={360} z={109}
      menuStyle={{ padding: 0, overflow: "hidden", maxHeight: 460, display: "flex", flexDirection: "column" }}
      trigger={
        <IconButton name="bell" title="Notifications" active={bellOpen} onClick={() => setBellOpen(!bellOpen)}>
          {unread > 0 && (
            <span className="mono" style={{ position: "absolute", top: -3, right: -3, minWidth: 15, height: 15, padding: "0 3px",
              borderRadius: 8, background: "var(--text-primary)", color: "#fff", fontSize: 9.5, fontWeight: 600,
              display: "grid", placeItems: "center", border: "1.5px solid var(--bg-elevated)" }}>{unread}</span>
          )}
        </IconButton>
      }>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: "0.5px solid var(--border-subtle)" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Notifications</span>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>WS · live</span>
        <div style={{ flex: 1 }} />
        <button onClick={markAllRead} style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-tertiary)" }}>Mark all read</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {notifs.map((n: any) => {
          const meta = notifMeta(n.kind);
          return (
            <button key={n.id} onClick={() => { setBellOpen(false); setView("inbox"); }}
              style={{ display: "flex", gap: 10, width: "100%", textAlign: "left", padding: "10px 14px",
                borderBottom: "0.5px solid var(--border-subtle)", background: n.unread ? "var(--bg-hover)" : "transparent" }}>
              <span style={{ width: 26, height: 26, borderRadius: "var(--r-md)", flexShrink: 0, display: "grid", placeItems: "center",
                background: `color-mix(in srgb, ${notifColor(n.kind)} 14%, transparent)`, color: notifColor(n.kind) }}>
                <Icon name={meta.icon} size={14} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {n.unread && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-primary)", flexShrink: 0 }} />}
                  <span style={{ fontSize: 12.5, fontWeight: n.unread ? 500 : 450, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.title}</span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>{n.time}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.body}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Dropdown>
  );
}
