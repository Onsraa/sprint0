import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUI } from "../lib/store";
import { useView } from "../features/nav/nav";
import { api } from "../lib/api";
import type { QueueItem } from "../lib/api";
import { qk } from "../lib/query";
import { DISCIPLINE_LABEL, DISCIPLINE_COLOR, statusStyle } from "../lib/relayUtils";

// Cross-project ratify queue: every relay gate currently awaiting the
// logged-in user, across all active projects. Clicking an item loads that
// plan+relay into context and switches to the RatifyPanel focused on the
// gate — the fix for a lead landing on an empty RatifyPanel after login.

export function RatifyQueue() {
  const setPlan = useUI((s) => s.setPlan);
  const setPlanId = useUI((s) => s.setPlanId);
  const setActiveGate = useUI((s) => s.setActiveGate);
  const { setView } = useView();
  const qc = useQueryClient();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .myQueue()
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setErr(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = async (item: QueueItem) => {
    setOpening(item.plan_id + item.discipline);
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
      setErr(e instanceof Error ? e.message : String(e));
      setOpening(null);
    }
  };

  const count = items.length;
  const title =
    count === 0
      ? "All clear"
      : `${count} ${count === 1 ? "gate" : "gates"} awaiting you`;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <div className="kicker">Relay</div>
      <div className="display">{title}</div>
      <div style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 4 }}>
        Gates across every active project where you hold the baton.
      </div>

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div className="card-soft" style={{ textAlign: "center" }}>Loading…</div>
        ) : err ? (
          <div className="card-soft mono" style={{ color: "var(--orange-deep)" }}>{err}</div>
        ) : count === 0 ? (
          <div
            className="card-soft"
            style={{ textAlign: "center", border: "1px dashed var(--line-strong)" }}
          >
            <div className="display">No gates awaiting you.</div>
            <div style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 6 }}>
              When a manager drafts a plan that needs your discipline, it shows up here.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {items.map((item) => {
              const ss = statusStyle(item.status);
              const busy = opening === item.plan_id + item.discipline;
              return (
                <div
                  key={item.plan_id + item.discipline}
                  className="card-soft"
                  onClick={() => !busy && open(item)}
                  style={{
                    cursor: busy ? "default" : "pointer",
                    textAlign: "left",
                    width: "100%",
                    borderColor: DISCIPLINE_COLOR[item.discipline],
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span
                      className="chip"
                      style={{
                        background: DISCIPLINE_COLOR[item.discipline],
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
                    <span
                      className="chip"
                      style={{ marginLeft: "auto", background: ss.bg, color: ss.fg, borderColor: ss.border }}
                    >
                      {ss.label}
                    </span>
                  </div>
                  <div style={{ marginTop: 6, color: "var(--ink-soft)", fontSize: 13 }}>
                    {item.issue_count} {item.issue_count === 1 ? "issue" : "issues"} in your slice
                  </div>
                  <div style={{ marginTop: 8, color: "var(--ink-mute)", fontSize: 12 }}>
                    {busy ? "Opening…" : "Open to ratify →"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
