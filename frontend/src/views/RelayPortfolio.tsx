import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUI } from "../lib/store";
import { useView } from "../features/nav/nav";
import { api } from "../lib/api";
import type { RelaySummary } from "../lib/api";
import { qk } from "../lib/query";
import { DISCIPLINE_LABEL, DISCIPLINE_COLOR, statusStyle } from "../lib/relayUtils";

export function RelayPortfolio() {
  const setPlan = useUI((s) => s.setPlan);
  const setPlanId = useUI((s) => s.setPlanId);
  const { setView } = useView();
  const qc = useQueryClient();
  const [relays, setRelays] = useState<RelaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .allRelays()
      .then((r) => {
        if (!cancelled) setRelays(r.relays);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = async (r: RelaySummary) => {
    try {
      const [plan, relay] = await Promise.all([api.getPlan(r.plan_id), api.getRelay(r.plan_id)]);
      setPlan(plan);
      setPlanId(r.plan_id);
      qc.setQueryData(qk.relay(r.plan_id), relay); // seed the relay query cache (no flash)
      setView("relay");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <div style={{ marginBottom: 18 }}>
        <div className="kicker">Relay</div>
        <div className="display" style={{ fontSize: 28 }}>
          {relays.length ? `${relays.length} active relays` : "Active relays"}
        </div>
        <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>
          Every plan currently moving through the relay. Open one to ratify or watch the baton.
        </div>
      </div>

      {loading ? (
        <div className="card-soft" style={{ padding: 16, textAlign: "center", color: "var(--text-secondary)" }}>
          Loading…
        </div>
      ) : err ? (
        <div className="card-soft mono" style={{ padding: 12, color: "var(--text-primary)", fontSize: 12 }}>
          {err}
        </div>
      ) : relays.length === 0 ? (
        <div
          className="card-soft"
          style={{ padding: 24, textAlign: "center", border: "1px dashed var(--border-strong)" }}
        >
          <div className="display" style={{ fontSize: 18 }}>No active relays.</div>
          <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>
            Draft a brief to put a plan into the relay.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 14,
          }}
        >
          {relays.map((r) => (
            <div
              key={r.plan_id}
              className="card-soft"
              style={{ padding: 16, cursor: "pointer" }}
              onClick={() => open(r)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="display" style={{ fontSize: 16 }}>{r.project}</span>
                {r.is_delta && (
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
                <span style={{ marginLeft: "auto" }}>
                  {r.all_ratified ? (
                    <span
                      className="chip"
                      style={{
                        background: "var(--bg-secondary)",
                        borderColor: "var(--green)",
                        color: "var(--green)",
                        fontSize: 10,
                      }}
                    >
                      Cleared ✓
                    </span>
                  ) : (
                    <span className="chip chip-soft" style={{ fontSize: 10 }}>
                      {r.baton.length} active
                    </span>
                  )}
                </span>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {r.gates.map((g) => {
                  const ss = statusStyle(g.status);
                  const isActive = r.baton.includes(g.discipline);
                  return (
                    <span
                      key={g.discipline}
                      style={{
                        background: ss.bg,
                        color: ss.fg,
                        border: `1px solid ${ss.border}`,
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 6,
                        fontWeight: isActive ? 700 : undefined,
                        outline: isActive ? `2px solid ${DISCIPLINE_COLOR[g.discipline]}` : undefined,
                      }}
                    >
                      {DISCIPLINE_LABEL[g.discipline]}
                    </span>
                  );
                })}
              </div>

              <div className="mono" style={{ marginTop: 10, fontSize: 10, color: "var(--text-tertiary)" }}>
                {r.plan_id}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
