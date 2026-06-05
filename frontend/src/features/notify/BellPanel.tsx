/* sprint0 — live notification surfaces (§6): toast host (simulated WS pushes) + the bell dropdown, which
   is now the SINGLE notification surface (the standalone Inbox view was retired). Each row keeps the v4
   design's treatment — an intent-tinted kind glyph · title + body · who · time · a ✕ delete — and routes:
   actionable kinds either REDIRECT to their subject (a gate / Contract → Gate × Contract; a failed check →
   Tester) or act INLINE (apply / reject a reflow · grant / deny a watch). The rest inform only.
   Reads useApp(); monochrome, spark events use ink, not hue. */
import { useState } from "react";
import { Icon } from "../../lib/icon";
import { useApp } from "../../app/useApp";
import { Dropdown, IconButton, Button } from "../../components/ui";
import { notifMeta, notifColor } from "./notifMeta";

/* concise notification timestamp → "DD-MM-YYYY at HH:MM" (was a raw ISO string). */
function fmtNotifTime(t?: string): string {
  if (!t) return "";
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const softBg = (kind: string) => `color-mix(in srgb, ${notifColor(kind)} 13%, transparent)`;

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
              background: softBg(t.kind), color: notifColor(t.kind) }}>
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

/* ───────── Bell button + dropdown (the notification surface) ───────── */
export function BellPanel() {
  const { unread, bellOpen, setBellOpen, notifs, markAllRead } = useApp();
  return (
    <Dropdown open={bellOpen} onClose={() => setBellOpen(false)} align="right" top={36} width={384} z={109}
      menuStyle={{ padding: 0, overflow: "hidden", maxHeight: 480, display: "flex", flexDirection: "column" }}
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
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{notifs.length} · {unread} unread</span>
        <div style={{ flex: 1 }} />
        {unread > 0 && <button onClick={markAllRead} style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-tertiary)" }}>Mark all read</button>}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {notifs.length === 0
          ? <div style={{ padding: "34px 16px", display: "grid", placeItems: "center", color: "var(--text-quaternary)" }}>
              <div style={{ textAlign: "center" }}>
                <Icon name="bell" size={22} style={{ color: "var(--border-strong)" }} />
                <div style={{ fontSize: 12.5, marginTop: 8 }}>Nothing waiting.</div>
              </div>
            </div>
          : notifs.map((n: any) => <BellRow key={n.id} n={n} />)}
      </div>
    </Dropdown>
  );
}

/* one notification row — glyph · title + body · who · time · ✕ · (redirect | inline | inform) */
function BellRow({ n }: { n: any }) {
  const { goTo, dismissNotif, resolveProposal, acceptAccess, rejectAccess, accessRequests, setBellOpen } = useApp();
  const [h, setH] = useState(false);
  const [acted, setActed] = useState<string | null>(null);
  const meta = notifMeta(n.kind);
  const fg = notifColor(n.kind);
  const who = n.who === "ai" ? "sprint0" : n.who ? "@" + n.who : null;

  const redirect = () => {
    setBellOpen(false);
    const ref = n.ref || {};
    goTo(meta.to ?? "relays", { disc: ref.discipline ?? null, agr: ref.agreement_id ?? null });
  };
  const grantId = () => n.ref?.grant_id ?? (accessRequests as any[]).find((r) => r.ref?.requester_id === n.who || r.who === n.who)?.ref?.grant_id;

  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", gap: 11, padding: "11px 13px", borderBottom: "0.5px solid var(--border-subtle)",
        background: n.unread ? softBg(n.kind) : h ? "var(--bg-hover)" : "transparent", transition: "background var(--t-quick)" }}>
      <span style={{ width: 28, height: 28, flexShrink: 0, marginTop: 1, borderRadius: "var(--r-md)", display: "grid", placeItems: "center",
        background: softBg(n.kind), color: fg, border: "0.5px solid var(--border)" }}>
        <Icon name={meta.icon} size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          {n.unread && <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: fg, marginTop: 5 }} />}
          <span style={{ fontSize: 12.5, fontWeight: n.unread ? 600 : 500, color: "var(--text-primary)", flex: 1, minWidth: 0, lineHeight: 1.35, textWrap: "pretty" }}>{n.title}</span>
          <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)", flexShrink: 0, marginTop: 1 }}>{fmtNotifTime(n.time)}</span>
          <button onClick={() => dismissNotif(n.id)} title="Dismiss"
            style={{ width: 18, height: 18, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: "var(--r-sm)",
              color: "var(--text-quaternary)", opacity: h ? 1 : 0.4, transition: "opacity var(--t-quick)" }}>
            <Icon name="close" size={12} />
          </button>
        </div>
        {n.body && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 2, lineHeight: 1.4, textWrap: "pretty" }}>{n.body}</div>}
        {who && <div className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)", marginTop: 4 }}>{who}</div>}

        {acted
          ? <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 9, height: 24, padding: "0 10px",
              borderRadius: "var(--r-pill)", background: "var(--bg-secondary)", border: "0.5px solid var(--border)" }}>
              <Icon name="check" size={11} style={{ color: "var(--green)" }} />
              <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{acted}</span>
            </div>
          : meta.act === "redirect"
            ? <div style={{ marginTop: 9 }}>
                <Button variant={meta.intent === "urgent" ? "primary" : "secondary"} size="sm" iconRight="arrowRight" onClick={redirect}>{meta.cta}</Button>
              </div>
          : n.kind === "reschedule_proposed"
            ? <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
                <Button variant="primary" size="sm" icon="check" onClick={() => { resolveProposal("applied"); setActed("Reflow applied."); }}>Apply</Button>
                <Button variant="ghost" size="sm" onClick={() => { resolveProposal("rejected"); setActed("Rejected — safe shift stands."); }}>Reject</Button>
              </div>
          : n.kind === "access_requested"
            ? <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
                <Button variant="primary" size="sm" icon="eye" onClick={() => { const g = grantId(); if (g) acceptAccess(g); setActed(`Granted${who ? ` — ${who} can watch you.` : "."}`); }}>Grant</Button>
                <Button variant="ghost" size="sm" onClick={() => { const g = grantId(); if (g) rejectAccess(g); setActed("Denied."); }}>Deny</Button>
              </div>
          : null}
      </div>
    </div>
  );
}
