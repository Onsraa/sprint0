import { useEffect, useState } from "react";
import { useApp } from "../app/AppContext";
import { api } from "../lib/api";
import type { InboxNeed, QueueItem, RescheduleProposal } from "../lib/api";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL } from "../lib/relayUtils";

export function InboxPage() {
  const { inbox, loadInbox, setActiveGate, setView, setPlan, setPlanId, setRelay } = useApp();
  const [opening, setOpening] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadInbox(); api.inboxReadAll().catch(() => {}); }, []);

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
      setRelay(relay);
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
      loadInbox();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleApplyResched = async (id: string) => {
    setActionErr(null);
    try { await api.applyReschedule(id); loadInbox(); }
    catch (e) { setActionErr(e instanceof Error ? e.message : String(e)); }
  };

  const handleRejectResched = async (id: string) => {
    setActionErr(null);
    try { await api.rejectReschedule(id); loadInbox(); }
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
          style={{ color: "var(--orange-deep)", marginTop: 12, fontSize: 12 }}
        >
          {actionErr}
        </div>
      )}

      {/* Zone 1 — Needs action */}
      <div style={{ marginTop: 20 }}>
        <div
          className="kicker"
          style={{ marginBottom: 8, paddingLeft: 0 }}
        >
          Needs action
        </div>
        {needs.length === 0 ? (
          <div
            style={{
              color: "var(--ink-mute)",
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
                key={need.kind === "ratify" ? `r-${need.item?.plan_id}-${need.item?.discipline}` : need.kind === "reschedule" ? `s-${String(need.ref?.proposal_id)}` : `a-${String(need.ref?.grant_id)}`}
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
          style={{ marginBottom: 8, paddingLeft: 0 }}
        >
          Notifications
        </div>
        {notifications.length === 0 ? (
          <div
            style={{
              color: "var(--ink-mute)",
              fontSize: 13,
              padding: "12px 0",
            }}
          >
            No notifications.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {notifications.map((n) => (
              <div
                key={n.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 8,
                  background: n.read ? "transparent" : "var(--orange-tint)",
                  borderLeft: n.read ? "2px solid transparent" : "2px solid var(--orange)",
                  opacity: n.read ? 0.65 : 1,
                  fontSize: 13,
                }}
              >
                <span style={{ flex: 1, fontWeight: n.read ? 400 : 600 }}>
                  {n.title}
                </span>
                <span
                  className="chip"
                  style={{ fontSize: 10, flexShrink: 0 }}
                >
                  {n.type}
                </span>
                <span
                  style={{
                    color: "var(--ink-mute)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    flexShrink: 0,
                  }}
                >
                  {relTime(n.created_at)}
                </span>
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
    const item = need.item;
    const key = item.plan_id + item.discipline;
    const busy = opening === key;
    const discColor = DISCIPLINE_COLOR[item.discipline] ?? "var(--info)";
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
          <span
            className="chip"
            style={{
              background: discColor,
              color: "var(--paper)",
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
                background: "var(--orange-soft)",
                borderColor: "var(--orange)",
                color: "var(--orange-deep)",
                fontSize: 9,
              }}
            >
              ⚠ extension
            </span>
          )}
        </div>
        <div style={{ marginTop: 6, color: "var(--ink-soft)", fontSize: 13 }}>
          {item.issue_count} {item.issue_count === 1 ? "issue" : "issues"} in your slice
        </div>
        <div style={{ marginTop: 8, color: "var(--ink-mute)", fontSize: 12 }}>
          {busy ? "Opening…" : "Open to ratify →"}
        </div>
      </div>
    );
  }

  if (need.kind === "access_request") {
    const grantId = need.ref?.grant_id as string | undefined;
    return (
      <div className="card-soft" style={{ textAlign: "left" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{need.title}</div>
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
          AI reschedule · {p.strategy.action} · {p.strategy.confidence}% conf
        </div>
        <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4 }}>{p.strategy.impact_summary || p.strategy.rationale}</div>
        <div style={{ fontSize: 12, opacity: .7, marginTop: 6 }}>
          {p.impacted.length} task(s): {p.impacted.map((t) => t.title).join(", ")}
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
