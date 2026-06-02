/* sprint0 — Relays: the cross-project pool board (§35). Wires GET /api/relays (the `relays` route).
   One ranked row per active relay — project · a DAG mini (which gates ratified / active / blocked) ·
   where the baton sits · is_delta · all_ratified. Ranked by baton + blocks aggregated per relay, so
   the hottest front floats to the top. Ported 1:1 from the v6 design (Relays.jsx); the mock relaysFor()
   is replaced by useApp().relaySummaries, GATE_META is reused from RatifyPanel, and live dispatch is
   deferred — a ready relay's button deep-links into the relay board. */
import { useState } from "react";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { ViewChrome } from "../components/ViewChrome";
import { ProjectSwitcher } from "../components/ProjectSwitcher";
import { Button, Tab, Badge, DiscDot, DISC } from "../components/ui";
import { Icon } from "../lib/icon";
import { GATE_META } from "./RatifyPanel";
import { blocksForGate } from "../features/today/rank";
import type { RelaySummary, Discipline } from "../lib/api";

type Gate = RelaySummary["gates"][number];
const BUILD = ["uiux", "backend", "devops"] as const;
const DONE = ["ratified", "auto_passed"];
const initials = (s: string) => (s || "?").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 3).join("").toUpperCase();
const relayBlocks = (r: RelaySummary) => r.gates.reduce((n, g) => n + (DONE.includes(g.status) ? 0 : blocksForGate(g.discipline, r)), 0);
const relayScore = (r: RelaySummary) => (r.baton.length ? 1000 : 0) + relayBlocks(r) * 100;
const noteFor = (r: RelaySummary) =>
  r.all_ratified ? "All gates ratified — ready to dispatch."
    : r.baton.length ? `${r.baton.map((d) => DISC[d]?.label ?? d).join(" · ")} ${r.baton.length === 1 ? "holds" : "hold"} the baton.`
    : "Waiting on upstream gates.";

function DagLegend() {
  const items = [
    { label: "ratified / auto-passed", node: <Icon name="check" size={13} style={{ color: "var(--green)" }} /> },
    { label: "needs a call", node: <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--amber)", display: "inline-block" }} /> },
    { label: "baton here", node: <Icon name="flag" size={11} style={{ color: "var(--text-primary)" }} /> },
    { label: "locked / pending", node: <span style={{ width: 9, height: 9, borderRadius: "50%", border: "1.5px solid var(--border-strong)", display: "inline-block" }} /> },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14, padding: "8px 12px", borderRadius: "var(--r-md)",
      background: "var(--bg-secondary)", border: "0.5px solid var(--border-subtle)", flexWrap: "wrap" }}>
      <span className="kicker" style={{ fontSize: 10 }}>Legend</span>
      {items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-tertiary)" }}>
          {it.node}{it.label}
        </span>
      ))}
    </div>
  );
}

/* one gate in the DAG mini — discipline dot + status glyph, baton flagged in ink */
function GateNode({ g, baton }: { g?: Gate; baton: boolean }) {
  if (!g) return null;
  const done = DONE.includes(g.status);
  const dim = g.status === "locked" || g.status === "pending";
  return (
    <span title={`${DISC[g.discipline]?.label} · ${GATE_META[g.status]?.label ?? g.status}`}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 9px",
        borderRadius: "var(--r-pill)", border: `0.5px solid ${baton ? "var(--text-primary)" : "var(--border)"}`,
        background: baton ? "var(--bg-active)" : "var(--bg-elevated)", opacity: dim ? 0.55 : 1 }}>
      {baton && <span style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", color: "var(--text-primary)" }}><Icon name="flag" size={11} /></span>}
      <DiscDot d={g.discipline} size={8} />
      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)" }}>{DISC[g.discipline]?.label}</span>
      {done
        ? <Icon name="check" size={12} style={{ color: g.status === "ratified" ? "var(--green)" : "var(--blue)" }} />
        : g.status === "changes_requested" ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--amber)" }} />
        : g.status === "blocked" ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--red)" }} />
        : <span style={{ width: 7, height: 7, borderRadius: "50%", border: "1.5px solid var(--border-strong)" }} />}
    </span>
  );
}

function FlowArrow() {
  return <Icon name="chevronRight" size={14} style={{ color: "var(--text-quaternary)", flexShrink: 0 }} />;
}

function RelayRow({ r, rank, onOpen }: { r: RelaySummary; rank: number; onOpen: (r: RelaySummary, g?: Discipline) => void }) {
  const [h, setH] = useState(false);
  const batonDisc = r.baton[0];
  const gateOf = (d: string) => r.gates.find((g) => g.discipline === d);
  const blocks = relayBlocks(r);
  const fe = gateOf("frontend"); const qa = gateOf("qa");
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ borderRadius: "var(--r-xl)", background: "var(--bg-elevated)",
        border: `0.5px solid ${batonDisc ? "var(--text-primary)" : "var(--border)"}`,
        boxShadow: h ? "var(--shadow-2)" : "var(--shadow-1)", transition: "box-shadow var(--t-quick)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 16px 13px" }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", width: 16, textAlign: "center", flexShrink: 0 }}>{rank}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px" }}>{r.project}</span>
            <Badge tone="outline" mono>{initials(r.project)}</Badge>
            {r.is_delta && <Badge tone="neutral" mono><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--blue)", display: "inline-block" }} />delta</Badge>}
            {r.all_ratified && <Badge tone="green"><Icon name="check" size={10} />all ratified</Badge>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 3 }}>{noteFor(r)}</div>
        </div>
        {batonDisc ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: "var(--r-pill)",
            background: "var(--ink-fill)", color: "#fff", fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
            <Icon name="flag" size={11} /> baton · {DISC[batonDisc]?.label}
          </span>
        ) : (
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{blocks === 0 ? "no blocks" : `blocks ${blocks}`}</span>
        )}
      </div>

      {/* DAG mini */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 16px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {BUILD.map((d) => { const g = gateOf(d); return g ? <GateNode key={d} g={g} baton={r.baton.includes(d)} /> : null; })}
        </div>
        {fe && <><FlowArrow /><GateNode g={fe} baton={r.baton.includes("frontend")} /></>}
        {qa && <><FlowArrow /><GateNode g={qa} baton={r.baton.includes("qa")} /></>}
        <div style={{ flex: 1 }} />
        {r.all_ratified
          ? <Button variant="primary" size="sm" icon="bolt" onClick={() => onOpen(r)}>Dispatch</Button>
          : <Button variant="secondary" size="sm" iconRight="arrowRight" onClick={() => onOpen(r, batonDisc)}>Open relay</Button>}
      </div>
    </div>
  );
}

export function Relays() {
  const { relaySummaries, role, me, setView, projects }: any = useApp();
  const setPlanId = useUI((s) => s.setPlanId);
  const setActiveGate = useUI((s) => s.setActiveGate);
  const projectFilter = useUI((s) => s.projectFilter);
  const selName = (projects as any[]).find((p) => p.project_id === projectFilter)?.name ?? null;
  const all: RelaySummary[] = relaySummaries ?? [];
  const roleFiltered = role === "manager"
    ? all
    : all.filter((r) => r.gates.some((g) => g.discipline === me?.discipline) || r.baton.includes(me?.discipline));
  const mine = selName ? roleFiltered.filter((r) => r.project === selName) : roleFiltered;
  const relays = [...mine].sort((a, b) => relayScore(b) - relayScore(a));
  const awaiting = relays.filter((r) => r.baton.length > 0).length;

  // Managers open the full RelayBoard; devs/leads land on their ratify queue (/relay isn't a dev route).
  const openRelay = (r: RelaySummary, gate?: Discipline) => {
    setPlanId(r.plan_id);
    if (gate) setActiveGate(gate);
    setView(role === "manager" ? "relay" : "ratify");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Relays"]}>
        <div style={{ display: "flex", gap: 6, marginRight: 6 }}>
          <Tab active={false} onClick={() => setView("today")}>Today</Tab>
          <Tab active={true}>By relay</Tab>
        </div>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{relays.length} active</span>
        <ProjectSwitcher />
      </ViewChrome>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "26px 28px 56px" }}>
          <div style={{ marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: 0 }}>
              {role === "manager" ? "Every relay, ranked" : "Your relays, ranked"}
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "6px 0 0", lineHeight: 1.5 }}>
              The cross-project ratification board · <span className="mono" style={{ color: "var(--text-secondary)" }}>{"{UI/UX ∥ Backend ∥ DevOps} → Frontend → QA"}</span>.
              The hottest front — most blocked, baton waiting — floats to the top. <b style={{ color: "var(--text-primary)" }}>{awaiting}</b> await a call.
            </p>
          </div>

          <DagLegend />

          {relays.length === 0 && (
            <div style={{ padding: 28, textAlign: "center", color: "var(--text-quaternary)", fontSize: 13, marginTop: 18 }}>No active relays.</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
            {relays.map((r, i) => <RelayRow key={r.plan_id} r={r} rank={i + 1} onOpen={openRelay} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
