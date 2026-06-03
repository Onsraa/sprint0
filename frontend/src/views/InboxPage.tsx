/* sprint0 × Linear — Inbox (with the §5 reschedule consent flow). Reads the live store
   via useApp(). Ported verbatim from the v4 design's Misc.jsx (Inbox + RescheduleConsent);
   only the data source changed (mock module constants → useApp adapter). */
import { useState } from "react";
import { Icon } from "../lib/icon";
import { ZeroMark } from "../lib/icon";
import { toast } from "sonner";
import { Button, Avatar, Badge } from "../components/ui";
import { ViewChrome } from "../components/ViewChrome";
import { useApp } from "../app/useApp";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AgreementCard } from "./AgreementCard";

/* notification kind → icon + label. spark events render in ink, not hue. */
const NOTIF_META: Record<string, { icon: any; label: string; spark?: boolean }> = {
  assigned:            { icon: "board",    label: "Assigned" },
  completed:           { icon: "check",    label: "Completed" },
  qa_failed:           { icon: "bolt",     label: "QA failed",  spark: true },
  drift_flagged:       { icon: "bolt",     label: "Drift",      spark: true },
  reschedule_resolved: { icon: "calendar", label: "Reschedule" },
  merge:               { icon: "merges",   label: "Merge" },
  ratify:              { icon: "ratify",   label: "Ratify" },
  ratify_needed:       { icon: "ratify",   label: "Review",     spark: true },
  task_assigned:       { icon: "board",    label: "Assigned" },
  task_completed:      { icon: "check",    label: "Done" },
  reschedule_proposed: { icon: "calendar", label: "Reschedule", spark: true },
};

/* concise notification timestamp → "DD-MM-YYYY at HH:MM" (was a raw ISO string). */
function fmtNotifTime(t?: string): string {
  if (!t) return "";
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} at ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* §5 reschedule strategy action → label + flagged (needs manual handling) */
const RESCHEDULE_ACTION: Record<string, { label: string; flagged: boolean }> = {
  shift:    { label: "Right-shift", flagged: false },
  compress: { label: "Compress",    flagged: true },
  escalate: { label: "Escalate",    flagged: true },
  re_plan:  { label: "Re-plan",     flagged: true },
};

/* ───────── Inbox ───────── */
export function InboxPage() {
  const { notifs, markAllRead, setView, accessRequests, acceptAccess, rejectAccess } = useApp();
  const [sel, setSel] = useState<string | null>(notifs[0]?.id || null);
  const [snoozed, setSnoozed] = useState<Set<string>>(() => new Set());
  // Agreement engine: the interface contracts awaiting MY signature (minimal-ratifier routing).
  const qc = useQueryClient();
  const { data: agData } = useQuery({ queryKey: ["myAgreements"], queryFn: () => api.myAgreements() });
  const agreements = agData?.agreements ?? [];
  const ratifyAg = useMutation({
    mutationFn: ({ id, d }: { id: string; d: "ratified" | "rejected" }) => api.ratifyAgreement(id, d),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ["myAgreements"] }); toast.success(v.d === "ratified" ? "Contract ratified" : "Rejected"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const NEEDS = ["ratify", "ratify_needed", "blocked", "reschedule", "reschedule_proposed"];
  const visible = notifs.filter((n: any) => !snoozed.has(n.id));
  const needs = visible.filter((n: any) => NEEDS.includes(n.kind));
  const other = visible.filter((n: any) => !NEEDS.includes(n.kind));
  const selN = visible.find((n: any) => n.id === sel) || visible[0] || null;
  const snooze = (id: string) => { setSnoozed((s) => new Set(s).add(id)); setSel(null); toast("Snoozed — we'll resurface it later"); };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Inbox"]}>
        <Button variant="ghost" size="sm" onClick={markAllRead}>Mark all read</Button>
      </ViewChrome>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 380, flexShrink: 0, borderRight: "0.5px solid var(--border)", overflow: "auto" }}>
          <Group label="Needs your action" count={needs.length + accessRequests.length + agreements.length}>
            {agreements.map((a: any) => (
              <div key={a.id} style={{ padding: "0 12px 10px" }}>
                <AgreementCard a={a} busy={ratifyAg.isPending}
                  onRatify={() => ratifyAg.mutate({ id: a.id, d: "ratified" })}
                  onReject={() => ratifyAg.mutate({ id: a.id, d: "rejected" })} />
              </div>
            ))}
            {accessRequests.map((r: any) => <AccessRequestRow key={r.ref?.grant_id} r={r} onAccept={() => acceptAccess(r.ref.grant_id)} onReject={() => rejectAccess(r.ref.grant_id)} />)}
            {needs.map((n: any) => <InboxRow key={n.id} n={n} active={selN?.id === n.id} onClick={() => setSel(n.id)} />)}
          </Group>
          <Group label="Notifications" count={other.length}>
            {other.map((n: any) => <InboxRow key={n.id} n={n} active={selN?.id === n.id} onClick={() => setSel(n.id)} />)}
          </Group>
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 28 }}>
          {selN && (selN.kind === "reschedule"
            ? <RescheduleConsent />
            : <InboxDetail n={selN} go={setView} onSnooze={() => snooze(selN.id)} />)}
        </div>
      </div>
    </div>
  );
}

/* §6 incoming Watch request — accept (grant access to your Contracts) or reject. Backend access-grant flow. */
function AccessRequestRow({ r, onAccept, onReject }: { r: any; onAccept: () => void; onReject: () => void }) {
  return (
    <div style={{ display: "flex", gap: 11, padding: "11px 16px", borderBottom: "0.5px solid var(--border-subtle)", alignItems: "center" }}>
      <span style={{ marginTop: 1, color: "var(--text-primary)" }}><Icon name="eye" size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>wants to watch your gates — accept to grant a peer-review Watch.</div>
      </div>
      <Button variant="primary" size="sm" onClick={onAccept}>Accept</Button>
      <Button variant="ghost" size="sm" onClick={onReject}>Reject</Button>
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
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{fmtNotifTime(n.time)}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.body}</div>
      </div>
    </div>
  );
}

function InboxDetail({ n, go, onSnooze }: { n: any; go: (v: string) => void; onSnooze: () => void }) {
  const { members }: any = useApp();
  const meta = NOTIF_META[n.kind] || NOTIF_META.assigned;
  // notifications carry no structured actor — pull the @username from the title. Title shows the NAME;
  // the byline carries the @username + a concise timestamp.
  const actorUser: string | null = (n.who && n.who !== "ai") ? n.who : (String(n.title || "").match(/@(\S+)/)?.[1] ?? null);
  const actorName: string | undefined = members.find((m: any) => m.username === actorUser)?.name;
  const title = actorUser && actorName ? String(n.title).replace(`@${actorUser}`, actorName) : n.title;
  const byline = actorUser ? `@${actorUser}` : (n.who === "ai" ? "sprint0" : "");
  return (
    <div style={{ maxWidth: 560, animation: "s0-fade-in var(--t-reg) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ width: 32, height: 32, borderRadius: "var(--r-md)", display: "grid", placeItems: "center",
          background: meta.spark ? "var(--text-primary)" : "var(--bg-secondary)", color: meta.spark ? "#fff" : "var(--text-tertiary)" }}>
          <Icon name={meta.icon} size={17} />
        </span>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.3px", margin: 0 }}>{title}</h1>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--text-quaternary)", marginTop: 2 }}>{byline}{byline ? " · " : ""}{fmtNotifTime(n.time)}</div>
        </div>
      </div>
      {n.body && <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" }}>{n.body}</p>}
      {n.kind === "ratify" && (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <Button variant="primary" size="md" icon="relay" onClick={() => go("relay")}>Open in Relay</Button>
          <Button variant="secondary" size="md" onClick={onSnooze}>Snooze</Button>
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
