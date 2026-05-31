/* sprint0 × Linear — Inbox (with the §5 reschedule consent flow). Reads the live store
   via useApp(). Ported verbatim from the v4 design's Misc.jsx (Inbox + RescheduleConsent);
   only the data source changed (mock module constants → useApp adapter). */
import { useState } from "react";
import { Icon } from "../lib/icon";
import { ZeroMark } from "../lib/icon";
import { Button, Avatar, Badge } from "../components/ui";
import { ViewChrome } from "../components/ViewChrome";
import { useApp } from "../app/useApp";

/* notification kind → icon + label. spark events render in ink, not hue. */
const NOTIF_META: Record<string, { icon: any; label: string; spark?: boolean }> = {
  assigned:            { icon: "board",    label: "Assigned" },
  completed:           { icon: "check",    label: "Completed" },
  qa_failed:           { icon: "bolt",     label: "QA failed",  spark: true },
  drift_flagged:       { icon: "bolt",     label: "Drift",      spark: true },
  reschedule_resolved: { icon: "calendar", label: "Reschedule" },
  merge:               { icon: "merges",   label: "Merge" },
  ratify:              { icon: "ratify",   label: "Ratify" },
};

/* §5 reschedule strategy action → label + flagged (needs manual handling) */
const RESCHEDULE_ACTION: Record<string, { label: string; flagged: boolean }> = {
  shift:    { label: "Right-shift", flagged: false },
  compress: { label: "Compress",    flagged: true },
  escalate: { label: "Escalate",    flagged: true },
  re_plan:  { label: "Re-plan",     flagged: true },
};

/* ───────── Inbox ───────── */
export function InboxPage() {
  const { notifs, markAllRead, setView } = useApp();
  const [sel, setSel] = useState<string | null>(notifs[0]?.id || null);
  const needs = notifs.filter((n: any) => n.kind === "ratify" || n.kind === "blocked" || n.kind === "reschedule");
  const other = notifs.filter((n: any) => !(n.kind === "ratify" || n.kind === "blocked" || n.kind === "reschedule"));
  const selN = notifs.find((n: any) => n.id === sel) || notifs[0] || null;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Inbox"]}>
        <Button variant="ghost" size="sm" onClick={markAllRead}>Mark all read</Button>
      </ViewChrome>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 380, flexShrink: 0, borderRight: "0.5px solid var(--border)", overflow: "auto" }}>
          <Group label="Needs your action" count={needs.length}>
            {needs.map((n: any) => <InboxRow key={n.id} n={n} active={selN?.id === n.id} onClick={() => setSel(n.id)} />)}
          </Group>
          <Group label="Notifications" count={other.length}>
            {other.map((n: any) => <InboxRow key={n.id} n={n} active={selN?.id === n.id} onClick={() => setSel(n.id)} />)}
          </Group>
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 28 }}>
          {selN && (selN.kind === "reschedule"
            ? <RescheduleConsent />
            : <InboxDetail n={selN} go={setView} />)}
        </div>
      </div>
    </div>
  );
}

function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 16px", position: "sticky", top: 0, background: "var(--bg-elevated)", zIndex: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-tertiary)" }}>{label}</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{count}</span>
      </div>
      {children}
    </div>
  );
}

function InboxRow({ n, active, onClick }: { n: any; active: boolean; onClick: () => void }) {
  const [h, setH] = useState(false);
  const meta = NOTIF_META[n.kind] || NOTIF_META.assigned;
  return (
    <div onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", gap: 11, padding: "11px 16px", cursor: "pointer",
        background: active || h ? "var(--bg-hover)" : "transparent", borderBottom: "0.5px solid var(--border-subtle)" }}>
      <span style={{ marginTop: 1, color: meta.spark ? "var(--text-primary)" : "var(--text-tertiary)" }}><Icon name={meta.icon} size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {n.unread && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-primary)", flexShrink: 0 }} />}
          <span style={{ fontSize: 13, fontWeight: n.unread ? 500 : 450, color: "var(--text-primary)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.title}</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{n.time}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.body}</div>
      </div>
    </div>
  );
}

function InboxDetail({ n, go }: { n: any; go: (v: string) => void }) {
  const meta = NOTIF_META[n.kind] || NOTIF_META.assigned;
  return (
    <div style={{ maxWidth: 560, animation: "s0-fade-in var(--t-reg) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ width: 32, height: 32, borderRadius: "var(--r-md)", display: "grid", placeItems: "center",
          background: meta.spark ? "var(--text-primary)" : "var(--bg-secondary)", color: meta.spark ? "#fff" : "var(--text-tertiary)" }}>
          <Icon name={meta.icon} size={17} />
        </span>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.3px", margin: 0 }}>{n.title}</h1>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--text-quaternary)", marginTop: 2 }}>{n.who === "ai" ? "sprint0" : "@" + n.who} · {n.time}</div>
        </div>
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" }}>{n.body}.</p>
      {n.kind === "ratify" && (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <Button variant="primary" size="md" icon="relay" onClick={() => go("relay")}>Open in Relay</Button>
          <Button variant="secondary" size="md">Snooze</Button>
        </div>
      )}
      {(n.kind === "blocked" || n.kind === "qa_failed") && (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <Button variant="primary" size="md" icon="bolt" onClick={() => go("relay")}>View failing API</Button>
        </div>
      )}
      {n.kind === "drift_flagged" && (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <Button variant="primary" size="md" icon="merges" onClick={() => go("codegraph")}>Open Code Graph</Button>
        </div>
      )}
      {n.kind === "merge" && (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <Button variant="secondary" size="md" onClick={() => go("merges")}>Review attribution</Button>
        </div>
      )}
    </div>
  );
}

/* ───────── §5 reschedule / reflow consent ───────── */
export function RescheduleConsent() {
  const { proposal, resolveProposal, me, role, members } = useApp();
  const byUser = (u: string) => members.find((m: any) => m.username === u) || { name: u, username: u };
  const p = proposal;
  const act = RESCHEDULE_ACTION[p.strategy.action];
  const canAct = role === "manager" || p.affected_users.includes(me.username);
  return (
    <div style={{ maxWidth: 620, animation: "s0-fade-in var(--t-reg) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ width: 32, height: 32, borderRadius: "var(--r-md)", display: "grid", placeItems: "center", background: "var(--bg-secondary)", color: "var(--text-tertiary)" }}>
          <Icon name="calendar" size={17} />
        </span>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.3px", margin: 0 }}>Reflow proposed</h1>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--text-quaternary)", marginTop: 2 }}>{p.trigger}</div>
        </div>
        <Badge tone={act.flagged ? "amber" : "neutral"}>{act.label}</Badge>
        {p.status !== "pending" && <Badge tone={p.status === "applied" ? "green" : "neutral"}>{p.status}</Badge>}
      </div>

      <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 14, marginBottom: 16, background: "var(--bg-secondary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <ZeroMark size={15} /><span style={{ fontSize: 12.5, fontWeight: 600 }}>AI strategy</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.55 }}>{p.strategy.impact_summary}</p>
      </div>

      <div className="kicker" style={{ marginBottom: 10 }}>Impacted slices · old → new</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 18 }}>
        {p.impacted.map((t: any) => {
          const shifted = t.old_start !== t.new_start || t.old_end !== t.new_end;
          const compressed = t.title.includes("Settlement");
          return (
            <div key={t.task_id} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 42, padding: "8px 10px", borderRadius: "var(--r-md)" }}>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", width: 64, flexShrink: 0 }}>{t.task_id}</span>
              <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", textDecoration: shifted ? "line-through" : "none" }}>{t.old_start}–{t.old_end}</span>
                {shifted && <Icon name="arrowRight" size={12} style={{ color: "var(--text-quaternary)" }} />}
                {shifted && <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: compressed ? "var(--green)" : "var(--text-primary)" }}>{t.new_start}–{t.new_end}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span className="kicker">Affected</span>
        {p.affected_users.map((u: string) => <span key={u} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Avatar name={byUser(u).name} size={18} /><span style={{ fontSize: 12 }}>{byUser(u).name.split(" ")[0]}</span></span>)}
      </div>

      {p.status === "pending" ? (
        canAct ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" size="md" icon="check" onClick={() => resolveProposal("applied")}>Apply AI strategy</Button>
            <Button variant="secondary" size="md" onClick={() => resolveProposal("rejected")}>Reject — keep safe shift</Button>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--text-quaternary)" }}>Only the manager or an affected member can apply this.</div>
        )
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", borderRadius: "var(--r-md)", background: act.flagged && p.status === "applied" ? "rgba(199,120,0,0.10)" : "var(--bg-secondary)" }}>
          <Icon name={p.status === "applied" ? "check" : "close"} size={14} style={{ color: p.status === "applied" ? "var(--green)" : "var(--text-tertiary)" }} />
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
            {p.status === "applied"
              ? (act.flagged ? `Applied — ${act.label.toLowerCase()} flagged for manual handling.` : "Applied.")
              : "Rejected — the safe right-shift stands."}
          </span>
        </div>
      )}
    </div>
  );
}
