/* sprint0 × Linear — Ratify queue (ported from Misc.jsx `Ratify`). The gates awaiting the caller; a
 * manager sees all, a lead sees their own. Wired to the real myQueue via the useApp() adapter. */
import { useApp } from "../app/useApp";
import { ViewChrome } from "../components/ViewChrome";
import { Badge, DiscDot, DISC } from "../components/ui";
import { Icon } from "../lib/icon";
import { GATE_META } from "./RatifyPanel";

export function RatifyQueue() {
  const { setView, me, chrome, queue } = useApp();
  const rows = (queue as Array<{ project: string; discipline: string; status: string; issue_count: number; is_delta?: boolean }>).map((q) => ({
    project: q.project, disc: q.discipline, status: q.status, issues: q.issue_count, baton: false, gap: false,
  }));
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Ratify"]}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{rows.length} gates</span>
      </ViewChrome>
      <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 0" }}>
          <div className="kicker" style={{ padding: "0 4px 10px" }}>
            {chrome.seesAllGates ? "Gates waiting on a call" : `Your ${DISC[me.discipline ?? ""]?.label || ""} gate`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--text-quaternary)", fontSize: 13 }}>No gates need your call right now.</div>}
            {rows.map((q, i) => {
              const meta = GATE_META[q.status] ?? { fg: "var(--text-tertiary)", label: q.status };
              return (
                <button key={i} onClick={() => setView("relay")} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", textAlign: "left", background: "var(--bg-elevated)", border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-1)" }}>
                  <DiscDot d={q.disc} size={10} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{q.project}</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{DISC[q.disc]?.label ?? q.disc} gate · {q.issues} issues{q.gap ? " · orphan gap" : ""}</div>
                  </div>
                  {q.baton && <Badge tone="ink"><Icon name="flag" size={11} />baton</Badge>}
                  <span style={{ fontSize: 12, fontWeight: 500, color: meta.fg }}>{meta.label}</span>
                  <Icon name="chevronRight" size={15} style={{ color: "var(--text-quaternary)" }} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
