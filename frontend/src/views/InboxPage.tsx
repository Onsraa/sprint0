import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUI } from "../lib/store";
import { useView } from "../features/nav/nav";
import { api } from "../lib/api";
import type { InboxNeed, NotificationItem, QueueItem, RescheduleProposal } from "../lib/api";
import { qk } from "../lib/query";
import { useInbox } from "../features/notify/useNotifications";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL } from "../lib/relayUtils";

// Human-readable presentation for the Inbox notification feed (type → icon + chip label).
const NOTIF_META: Record<string, { label: string; icon: string }> = {
  ratify_needed: { label: "Ratify", icon: "⚖" },
  access_requested: { label: "Access", icon: "🔑" },
  access_granted: { label: "Access granted", icon: "✅" },
  qa_failed: { label: "QA failed", icon: "⚠" },
  project_shipped: { label: "Shipped", icon: "🚀" },
  reschedule_proposed: { label: "Reschedule", icon: "🔄" },
  reschedule_resolved: { label: "Reschedule done", icon: "✅" },
  task_assigned: { label: "Assigned", icon: "📌" },
  task_completed: { label: "Completed", icon: "✅" },
  drift_flagged: { label: "Drift", icon: "🕸" },
};

// Friendly labels for AI reschedule-strategy actions (shown on the proposal card).
const ACTION_LABEL: Record<string, string> = {
  right_shift: "Right-shift", reassign: "Reassign", compress: "Compress",
  descope: "De-scope", re_estimate: "Re-estimate", re_plan: "Re-plan", escalate: "Escalate",
};

// Leading icon per needs-action kind, so the queue is scannable at a glance.
const KIND_META: Record<string, { icon: string }> = {
  ratify: { icon: "⚖" },
  access_request: { icon: "🔑" },
  reschedule: { icon: "🔄" },
};

export function InboxPage() {
  const setActiveGate = useUI((s) => s.setActiveGate);
  const setPlan = useUI((s) => s.setPlan);
  const setPlanId = useUI((s) => s.setPlanId);
  const { setView } = useView();
  const { data: inbox } = useInbox();
  const qc = useQueryClient();
  const [opening, setOpening] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // Landing on the inbox marks everything read, then refetches so the bell badge clears.
  useEffect(() => { api.inboxReadAll().then(() => qc.invalidateQueries({ queryKey: qk.inbox() })).catch(() => {}); }, [qc]);

  const openRatify = async (item: QueueItem) => {
    const key = item.plan_id + item.discipline;
    setOpening(key);
    setActionErr(null);
    try {
      const [plan, relay] = await Promise.all([
        api.getPlan(item.plan_id),
        api.getRelay(item.plan_id),
      ]);
      setPlan(plan);
      setPlanId(item.plan_id);
      qc.setQueryData(qk.relay(item.plan_id), relay); // seed the relay query cache (no flash)
      setActiveGate(item.discipline);
      setView("ratify");
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
      setOpening(null);
    }
  };

  const handleAccess = async (grantId: string, accept: boolean) => {
    setActionErr(null);
    try {
      if (accept) {
        await api.acceptAccess(grantId);
      } else {
        await api.rejectAccess(grantId);
      }
      qc.invalidateQueries({ queryKey: qk.inbox() });
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleApplyResched = async (id: string) => {
    setActionErr(null);
    try { await api.applyReschedule(id); qc.invalidateQueries({ queryKey: qk.inbox() }); }
    catch (e) { setActionErr(e instanceof Error ? e.message : String(e)); }
  };

  const handleRejectResched = async (id: string) => {
    setActionErr(null);
    try { await api.rejectReschedule(id); qc.invalidateQueries({ queryKey: qk.inbox() }); }
    catch (e) { setActionErr(e instanceof Error ? e.message : String(e)); }
  };

  const needs = inbox?.needs_action ?? [];
  const notifications = inbox?.notifications ?? [];

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="kicker">Notifications</div>
      <div className="display">Inbox</div>

      {actionErr && (
        <div
          className="card-soft mono"
          style={{ color: "var(--text-primary)", marginTop: 12, fontSize: 12 }}
        >
          {actionErr}
        </div>
      )}

      {/* Zone 1 — Needs action */}
      <div style={{ marginTop: 20 }}>
        <div
          className="kicker"
          style={{ marginBottom: 8, paddingLeft: 0, display: "flex", alignItems: "center", gap: 8 }}
        >
          Needs action
          {needs.length > 0 && (
            <span className="chip" style={{ fontSize: 10, background: "var(--ink-fill)", color: "var(--bg-elevated)", borderColor: "var(--ink-fill)" }}>
              {needs.length}
            </span>
          )}
        </div>
        {needs.length === 0 ? (
          <div
            style={{
              color: "var(--text-tertiary)",
              fontSize: 13,
              padding: "12px 0",
            }}
          >
            Nothing needs your action.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {needs.map((need) => (
              <NeedCard
                key={need.kind === "ratify" ? `r-${(need.item as QueueItem | undefined)?.plan_id}-${(need.item as QueueItem | undefined)?.discipline}` : need.kind === "reschedule" ? `s-${String(need.ref?.proposal_id)}` : `a-${String(need.ref?.grant_id)}`}
                need={need}
                opening={opening}
                onOpenRatify={openRatify}
                onAccess={handleAccess}
                onApplyResched={handleApplyResched}
                onRejectResched={handleRejectResched}
              />
            ))}
          </div>
        )}
      </div>

      {/* Zone 2 — Notifications */}
      <div style={{ marginTop: 28 }}>
        <div
          className="kicker"
          style={{ marginBottom: 8, paddingLeft: 0, display: "flex", alignItems: "center", gap: 8 }}
        >
          Notifications
          {notifications.length > 0 && (
            <span className="chip" style={{ fontSize: 10 }}>{notifications.length}</span>
          )}
        </div>
        {notifications.length === 0 ? (
          <div
            style={{
              color: "var(--text-tertiary)",
              fontSize: 13,
              padding: "12px 0",
            }}
          >
            No notifications.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {dayGroups(notifications).map((g) => (
              <div key={g.label}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-tertiary)", padding: "2px 12px 4px" }}>
                  {g.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {g.items.map((n) => (
                    <NotifRow key={n.id} n={n} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NeedCard({
  need,
  opening,
  onOpenRatify,
  onAccess,
  onApplyResched,
  onRejectResched,
}: {
  need: InboxNeed;
  opening: string | null;
  onOpenRatify: (item: QueueItem) => void;
  onAccess: (grantId: string, accept: boolean) => void;
  onApplyResched: (id: string) => void;
  onRejectResched: (id: string) => void;
}) {
  if (need.kind === "ratify" && need.item) {
    const item = need.item as QueueItem;  // kind==="ratify" guarantees QueueItem (P1 makes InboxNeed a discriminated union)
    const key = item.plan_id + item.discipline;
    const busy = opening === key;
    const discColor = DISCIPLINE_COLOR[item.discipline] ?? "var(--blue)";
    return (
      <div
        className="card-soft"
        onClick={() => !busy && onOpenRatify(item)}
        style={{
          cursor: busy ? "default" : "pointer",
          textAlign: "left",
          width: "100%",
          borderColor: discColor,
          opacity: busy ? 0.6 : 1,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13 }}>{KIND_META.ratify.icon}</span>
          <span
            className="chip"
            style={{
              background: discColor,
              color: "var(--bg-elevated)",
              fontSize: 10,
            }}
          >
            {DISCIPLINE_LABEL[item.discipline]}
          </span>
          <span style={{ fontWeight: 600 }}>{item.project}</span>
          {item.is_delta && (
            <span
              className="chip"
              style={{
                background: "var(--bg-secondary)",
                borderColor: "var(--ink-fill)",
                color: "var(--text-primary)",
                fontSize: 9,
              }}
            >
              ⚠ extension
            </span>
          )}
        </div>
        <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 13 }}>
          {item.issue_count} {item.issue_count === 1 ? "issue" : "issues"} in your slice
        </div>
        <div style={{ marginTop: 8, color: "var(--text-tertiary)", fontSize: 12 }}>
          {busy ? "Opening…" : "Open to ratify →"}
        </div>
      </div>
    );
  }

  if (need.kind === "access_request") {
    const grantId = need.ref?.grant_id as string | undefined;
    return (
      <div className="card-soft" style={{ textAlign: "left" }}>
        <div style={{ fontWeight: 600, fontSize: 14, display: "flex", gap: 8, alignItems: "center" }}>
          <span>{KIND_META.access_request.icon}</span>{need.title}
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: "6px 14px" }}
            onClick={() => grantId && onAccess(grantId, true)}
            disabled={!grantId}
          >
            Accept
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "6px 14px" }}
            onClick={() => grantId && onAccess(grantId, false)}
            disabled={!grantId}
          >
            Reject
          </button>
        </div>
      </div>
    );
  }

  if (need.kind === "reschedule" && need.item) {
    const p = need.item as RescheduleProposal;
    return (
      <div className="card-soft" style={{ padding: 16, textAlign: "left" }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", opacity: .7 }}>
          {KIND_META.reschedule.icon} AI reschedule · {ACTION_LABEL[p.strategy.action] ?? p.strategy.action} · {p.strategy.confidence}% conf
        </div>
        <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4 }}>{p.strategy.impact_summary || p.strategy.rationale}</div>
        <div style={{ fontSize: 12, opacity: .7, marginTop: 6 }}>
          {p.impacted.length} task(s) re-flowed:
          {p.impacted.map((t) => (
            <div key={t.task_id} style={{ marginTop: 2 }}>
              <b>{t.title}</b>: {t.old_start || "—"} → {t.scheduled_start || "—"}
            </div>
          ))}
        </div>
        {p.strategy.action === "reassign" && p.strategy.reassign_to && (
          <div style={{ fontSize: 12, marginTop: 4 }}>→ reassign to <b>@{p.strategy.reassign_to}</b></div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: "6px 14px" }}
            onClick={() => onApplyResched(p.id)}
          >
            Apply
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "6px 14px" }}
            onClick={() => onRejectResched(p.id)}
          >
            Reject
          </button>
        </div>
      </div>
    );
  }

  // Fallback for unknown kinds
  return (
    <div className="card-soft">
      <div style={{ fontWeight: 600 }}>{need.title}</div>
    </div>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function NotifRow({ n }: { n: NotificationItem }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 8,
        background: n.read ? "transparent" : "var(--bg-hover)",
        borderLeft: n.read ? "2px solid transparent" : "2px solid var(--ink-fill)",
        opacity: n.read ? 0.65 : 1,
        fontSize: 13,
      }}
    >
      <span style={{ flexShrink: 0, fontSize: 13, lineHeight: 1 }}>
        {NOTIF_META[n.type]?.icon ?? "•"}
      </span>
      <span style={{ flex: 1, fontWeight: n.read ? 400 : 600 }}>{n.title}</span>
      <span className="chip" style={{ fontSize: 10, flexShrink: 0 }}>
        {NOTIF_META[n.type]?.label ?? n.type}
      </span>
      <span style={{ color: "var(--text-tertiary)", fontSize: 11, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
        {relTime(n.created_at)}
      </span>
    </div>
  );
}

/** Bucket notifications into Today / Yesterday / Earlier (preserving the desc order within each). */
function dayBucket(iso: string): string {
  const t = new Date(iso).getTime();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - 86_400_000) return "Yesterday";
  return "Earlier";
}

function dayGroups(items: NotificationItem[]): { label: string; items: NotificationItem[] }[] {
  return ["Today", "Yesterday", "Earlier"]
    .map((label) => ({ label, items: items.filter((n) => dayBucket(n.created_at) === label) }))
    .filter((g) => g.items.length > 0);
}
