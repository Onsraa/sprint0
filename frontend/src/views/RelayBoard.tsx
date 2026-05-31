/* sprint0 × Linear — Ratification Relay. Data-driven stages
   {UI/UX ∥ Backend ∥ DevOps} → Frontend → QA. Now carries the routing tier on each
   gate (§10), an inline Trust Dial (§10), a staffing-coverage strip (§7), and the
   deepened failing-API flow (§9). The Decision Card + ratify panel live in RatifyPanel.

   Ported 1:1 from the v4 mockup (Relay.jsx). Mock module constants are replaced by
   the useApp() adapter per the port spec; panel-local helpers (TrustDialMini,
   CoverageStrip, GateCard, FlowConnector, IntegrationStrip) are ported verbatim.
   TierBadge + GATE_META are imported from the sibling RatifyPanel.tsx. */
import { useState } from "react";
import { Avatar, Badge, DiscDot, DISC, LoadMeter, TrustDot, Button } from "../components/ui";
import { Icon } from "../lib/icon";
import { ViewChrome } from "../components/ViewChrome";
import { useApp } from "../app/useApp";
import { RatifyPanel, TierBadge, GATE_META } from "./RatifyPanel";

const ROW1 = ["uiux", "backend", "devops"];

/* §7 staffing coverage — the per-plan gap advisor payload (was data2.jsx STAFFING).
   TODO(reconcile): useApp() does not yet expose staffing coverage; the orchestrator
   should add `staffing` (GET /api/plans/{id}/staffing). Kept verbatim so the strip
   is pixel-identical until that field lands. */
const STAFFING_COVERAGE = {
  per_discipline: [
    { discipline: "uiux",     covered: false, devs: [] as string[],       note: "orphan gap" },
    { discipline: "backend",  covered: true,  devs: ["rajiv", "priya"],   note: "rajiv at 91% load" },
    { discipline: "frontend", covered: true,  devs: ["talia", "noah"],    note: "" },
    { discipline: "qa",       covered: true,  devs: ["elena"],            note: "" },
    { discipline: "devops",   covered: true,  devs: ["dario"],            note: "" },
  ],
  gaps: ["uiux"],
  stretch_candidates: [
    { username: "talia", load: 78, trust: "high",   score: 0.74, why: "frontend senior · strongest design-adjacent skill cosine" },
    { username: "noah",  load: 54, trust: "medium", score: 0.61, why: "frontend mid · has headroom, weaker on tokens" },
    { username: "mira",  load: 62, trust: "high",   score: 0.55, why: "manager covering — temporary, not sustainable" },
  ],
};

/* §9 deepened failing-API flow — candidate producers (was data.jsx-local API_CANDIDATES). */
const API_CANDIDATES = [
  { id: "HARB-090", title: "Token-scope service", assignee: "rajiv", api_contract: "POST /scopes" },
  { id: "HARB-091", title: "Rate-limit + retry budget", assignee: "rajiv", api_contract: "middleware/ratelimit" },
];

/* TODO(reconcile): useApp() exposes `gates` but not the plan id or the integration
   seed; the orchestrator should surface `planId` + relay `integration_signals`.
   Kept as a local seed so the board renders identically until then. */
const RELAY_PLAN_ID = "plan_HARB_42";
const RELAY_INTEGRATION = [
  { target: "HARB-090", title: "Token-scope service", by: "noah", reporter: "HARB-104", note: "429s under burst — missing retry budget.", state: "failing" },
];

export function RelayBoard() {
  const { gates, dial, applyDial, me, role }: any = useApp();
  const gateOf = (d: string) => gates.find((g: any) => g.discipline === d);
  // developer/qa land focused on their own gate
  const [sel, setSel] = useState<string>(() => {
    if (me.discipline && gates.some((g: any) => g.discipline === me.discipline)) return me.discipline;
    return "backend";
  });
  const selGate = gateOf(sel);
  const autoCount = gates.filter((g: any) => g.tier === "auto_pass").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Harbor Logistics", "Relay"]}>
        <TrustDialMini dial={dial} onChange={applyDial} editable={role === "manager"} autoCount={autoCount} total={gates.length} />
        <Badge tone="outline" mono>{RELAY_PLAN_ID}</Badge>
      </ViewChrome>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "22px 28px 28px" }}>
          <div style={{ maxWidth: 780, minWidth: 520, margin: "0 auto" }}>
            <div style={{ marginBottom: 18 }}>
              <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: 0 }}>
                {role === "manager" ? "Pass the baton" : role === "qa" ? "Acceptance & integration" : "Ratify your slice"}
              </h1>
              <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "6px 0 0", lineHeight: 1.5 }}>
                <span className="mono" style={{ color: "var(--text-secondary)" }}>{"{UI/UX ∥ Backend ∥ DevOps}"}</span> → Frontend → QA ·
                expert attention is a budget — <b style={{ color: "var(--text-primary)" }}>{autoCount}</b> gates auto-pass.
              </p>
            </div>

            <CoverageStrip />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(150px, 1fr))", gap: 12 }}>
              {ROW1.map(d => <GateCard key={d} g={gateOf(d)} active={sel === d} onClick={() => setSel(d)} mine={me.discipline === d} />)}
            </div>
            <FlowConnector label="all three clear" />
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ width: "calc(33.33% - 8px)", minWidth: 150 }}><GateCard g={gateOf("frontend")} active={sel === "frontend"} onClick={() => setSel("frontend")} mine={me.discipline === "frontend"} /></div>
            </div>
            <FlowConnector label="frontend ratified" />
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ width: "calc(33.33% - 8px)", minWidth: 150 }}><GateCard g={gateOf("qa")} active={sel === "qa"} onClick={() => setSel("qa")} mine={me.discipline === "qa"} /></div>
            </div>

            <IntegrationStrip />
          </div>
        </div>

        <RatifyPanel g={selGate} />
      </div>
    </div>
  );
}

/* Inline compact Trust Dial (§10) */
function TrustDialMini({ dial, onChange, editable }: {
  dial: number; onChange: (v: number) => void; editable: boolean; autoCount?: number; total?: number;
}) {
  return (
    <div title="Trust Dial — global autonomy sensitivity" style={{ display: "flex", alignItems: "center", gap: 9, height: 28,
      padding: "0 10px", borderRadius: "var(--r-md)", background: "var(--bg-secondary)", border: "0.5px solid var(--border)" }}>
      <Icon name="load" size={14} style={{ color: "var(--text-tertiary)" }} />
      <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Trust</span>
      <input type="range" min="0" max="100" value={dial} disabled={!editable}
        onChange={e => onChange(+e.target.value)}
        style={{ width: 96, accentColor: "var(--text-primary)", cursor: editable ? "pointer" : "not-allowed" }} />
      <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-primary)", width: 26 }}>{dial}</span>
    </div>
  );
}

/* §7 staffing coverage strip */
function CoverageStrip() {
  const { chrome, setView, members }: any = useApp();
  const byUser = (u: string) => members?.find((m: any) => m.username === u);
  const cov = STAFFING_COVERAGE;
  if (!cov.gaps.length) return null;
  const gap = cov.gaps[0];
  return (
    <div style={{ border: "0.5px solid var(--text-primary)", borderRadius: "var(--r-lg)", padding: 14, marginBottom: 18,
      background: "var(--bg-secondary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon name="team" size={15} style={{ color: "var(--text-primary)" }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Coverage gap</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
          <DiscDot d={gap} />{DISC[gap].label} has no dev
        </span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>routes to manager</span>
      </div>
      <div className="kicker" style={{ marginBottom: 8 }}>Scored stretch candidates</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {cov.stretch_candidates.map(c => {
          const m = byUser(c.username);
          return (
            <div key={c.username} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: "var(--r-md)",
              background: "var(--bg-elevated)", border: "0.5px solid var(--border)" }}>
              <Avatar name={m?.name} size={22} tone={m?.role === "manager" ? "ink" : undefined} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>{m?.name} <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>· match {c.score}</span></div>
                <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.why}</div>
              </div>
              <LoadMeter value={c.load} width={36} />
              <TrustDot level={c.trust} />
            </div>
          );
        })}
      </div>
      {chrome.canOnboard && (
        <Button variant="secondary" size="sm" icon="plus" style={{ marginTop: 10 }} onClick={() => setView("team")}>Onboard a {DISC[gap].label} dev</Button>
      )}
    </div>
  );
}

function GateCard({ g, active, onClick, mine }: {
  g: any; active: boolean; onClick: () => void; mine: boolean;
}) {
  const [h, setH] = useState(false);
  const meta = GATE_META[g.status];
  const done = g.status === "ratified" || g.status === "auto_passed";
  const spark = g.baton || g.tier === "two_expert";
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ position: "relative", textAlign: "left", background: "var(--bg-elevated)", width: "100%",
        border: `0.5px solid ${active ? "var(--text-primary)" : spark ? "var(--text-primary)" : "var(--border)"}`,
        borderRadius: "var(--r-lg)", padding: 14,
        boxShadow: active ? "var(--shadow-2)" : h ? "var(--shadow-2)" : "var(--shadow-1)",
        transition: "box-shadow var(--t-quick), border-color var(--t-quick), transform var(--t-quick)",
        transform: h && !active ? "translateY(-1px)" : "none" }}>
      {g.baton && (
        <span style={{ position: "absolute", top: -9, right: 12, display: "inline-flex", alignItems: "center", gap: 4,
          height: 18, padding: "0 7px", borderRadius: "var(--r-pill)", background: "var(--text-primary)", color: "#fff",
          fontSize: 10.5, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
          <Icon name="flag" size={11} /> BATON
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <DiscDot d={g.discipline} size={10} />
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.2px" }}>{DISC[g.discipline].label}</span>
        {mine && <Badge tone="ink" style={{ height: 15 }}>you</Badge>}
        {g.stretched && <span title="stretched assignment — staffing gap" style={{ color: "var(--text-primary)", fontSize: 12 }}>▲</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, marginBottom: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 20, padding: "0 8px",
          borderRadius: "var(--r-sm)", fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap",
          background: meta.tone === "neutral" || meta.tone === "outline" ? "var(--bg-secondary)" : `color-mix(in srgb, ${meta.fg} 12%, transparent)`,
          color: meta.fg }}>
          {done && <Icon name="ratify" size={12} />}{meta.label}
        </span>
        <TierBadge tier={g.tier} size="sm" />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.45, marginBottom: 8 }}>{g.note}</div>
      {(g.blast_radius != null || g.expected_cost != null) && (
        <div className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>
          blast {g.blast_radius ?? "—"} · cost {g.expected_cost ?? "—"} · {g.routed_note}
        </div>
      )}
      {g.depends.length > 0 && (
        <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", marginTop: 6 }}>
          waits on {g.depends.map((d: string) => DISC[d].label).join(" · ")}
        </div>
      )}
    </button>
  );
}

function FlowConnector({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0", gap: 4 }}>
      <span style={{ width: 1, height: 16, background: "var(--border-strong)" }} />
      <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)", letterSpacing: "0.04em" }}>{label}</span>
      <Icon name="chevronDown" size={14} style={{ color: "var(--text-quaternary)", marginTop: -2 }} />
    </div>
  );
}

/* §9 deepened failing-API flow */
function IntegrationStrip() {
  const { me, role }: any = useApp();
  const [sig, setSig] = useState<any[]>(RELAY_INTEGRATION);
  const [reporting, setReporting] = useState(false);
  const isQA = role === "qa";
  return (
    <div style={{ marginTop: 28, border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--bg-secondary)",
        borderBottom: "0.5px solid var(--border-subtle)" }}>
        <Icon name="bolt" size={14} style={{ color: "var(--text-primary)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>API integration</span>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>— a failing API holds the QA gate until the producer fixes it.</span>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" icon="bolt" onClick={() => setReporting(r => !r)}>Report failing API</Button>
      </div>

      {reporting && (
        <div style={{ padding: 14, borderBottom: "0.5px solid var(--border-subtle)", background: "var(--bg-base)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Icon name="flag" size={13} style={{ color: "var(--text-tertiary)" }} />
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>More than one upstream producer — pick which contract is failing</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {API_CANDIDATES.map(c => (
              <button key={c.id} onClick={() => {
                setSig(s => [...s, { target: c.id, title: c.title, by: me.username, reporter: "HARB-104", note: `${c.api_contract} — reported failing`, state: "failing" }]);
                setReporting(false);
              }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", textAlign: "left",
                background: "var(--bg-elevated)", border: "0.5px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", width: 60 }}>{c.id}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{c.title}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{c.api_contract} · @{c.assignee}</div>
                </div>
                <Icon name="chevronRight" size={14} style={{ color: "var(--text-quaternary)" }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {sig.length === 0 ? (
        <div style={{ padding: "14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} />
          <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>All contracts green.</span>
        </div>
      ) : sig.map((s, i) => (
        <div key={s.target + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
          <Badge tone="red">failing</Badge>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{s.title} <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", fontWeight: 400 }}>{s.target}</span></div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>reported by @{s.by} · {s.note} · qa gate <b style={{ color: "var(--text-primary)" }}>blocked</b></div>
          </div>
          {isQA
            ? <Badge tone="outline" mono>acceptance held</Badge>
            : <Button variant="secondary" size="sm" icon="ratify" onClick={() => setSig(ss => ss.filter((_, j) => j !== i))}>Mark api-ok</Button>}
        </div>
      ))}
    </div>
  );
}
