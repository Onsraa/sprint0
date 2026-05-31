/* sprint0 — Code Graph (§4). An AST import graph (Graph A) crossed with
   decision-governance rules (Graph B) to detect drift — import cycles and
   governance breaches — which spawn maintenance tasks into the same relay.
   Rendered as a structured dependency layout + a "who breaks" focus panel
   (lighter and more on-brand than a force-directed node soup).

   Ported pixel-1:1 from the v4 mockup (app/CodeGraph.jsx). Data sources:
   role/chrome + drift/scheduleRefactor come from useApp(); the import-graph
   nodes/edges/dependents and governance rules have no adapter field yet, so they
   stay as panel-local verbatim constants. TODO(reconcile): wire GRAPH /
   GRAPH_DEPENDENTS / GOVERNANCE_RULES (and the DRIFT_REPORTS shape) from the real
   /api/graph endpoints once useApp exposes them. */
import { Fragment, useState } from "react";
import { useApp } from "../app/useApp";
import { Icon } from "../lib/icon";
import { Button, Tab, Badge, DiscDot, DISC, type BadgeTone } from "../components/ui";
import { ViewChrome } from "../components/ViewChrome";

/* ───────── §4 import graph + governance (mockup data2.jsx). TODO(reconcile). ───────── */
const GRAPH = {
  built: true, project_id: "local",
  nodes: [
    { path: "app/relay.py", domain: "backend", loc: 412 },
    { path: "app/dispatch.py", domain: "backend", loc: 388 },
    { path: "app/router.py", domain: "backend", loc: 256 },
    { path: "app/graph.py", domain: "backend", loc: 511 },
    { path: "app/tokens.py", domain: "backend", loc: 190 },
    { path: "app/api.py", domain: "backend", loc: 640 },
    { path: "web/map.tsx", domain: "frontend", loc: 302 },
    { path: "web/views.tsx", domain: "frontend", loc: 221 },
    { path: "ci/pipeline.yml", domain: "devops", loc: 88 },
  ],
  edges: [
    { src: "app/api.py", dst: "app/relay.py" }, { src: "app/api.py", dst: "app/dispatch.py" },
    { src: "app/api.py", dst: "app/router.py" }, { src: "app/relay.py", dst: "app/router.py" },
    { src: "app/relay.py", dst: "app/dispatch.py" }, { src: "app/dispatch.py", dst: "app/relay.py" }, // cycle!
    { src: "app/router.py", dst: "app/graph.py" }, { src: "app/router.py", dst: "app/tokens.py" },
    { src: "app/dispatch.py", dst: "app/tokens.py" }, { src: "web/views.tsx", dst: "web/map.tsx" },
    { src: "app/api.py", dst: "app/tokens.py" }, { src: "app/api.py", dst: "app/graph.py" },
  ],
};
const GRAPH_DEPENDENTS: Record<string, { dependents: string[]; dependencies: string[] }> = {
  "app/relay.py": { dependents: ["app/api.py", "app/dispatch.py"], dependencies: ["app/router.py", "app/dispatch.py"] },
  "app/tokens.py": { dependents: ["app/router.py", "app/dispatch.py", "app/api.py"], dependencies: [] },
  "app/router.py": { dependents: ["app/api.py", "app/relay.py"], dependencies: ["app/graph.py", "app/tokens.py"] },
  "app/graph.py": { dependents: ["app/router.py", "app/api.py"], dependencies: [] },
  "app/dispatch.py": { dependents: ["app/api.py", "app/relay.py"], dependencies: ["app/relay.py", "app/tokens.py"] },
  "app/api.py": { dependents: [], dependencies: ["app/relay.py", "app/dispatch.py", "app/router.py", "app/tokens.py", "app/graph.py"] },
  "web/map.tsx": { dependents: ["web/views.tsx"], dependencies: [] },
  "web/views.tsx": { dependents: [], dependencies: ["web/map.tsx"] },
  "ci/pipeline.yml": { dependents: [], dependencies: [] },
};
type Rule = { id: string; governs_pattern: string; constraint: string; domain: string; decision_id: string | null };
const GOVERNANCE_RULES: Rule[] = [
  { id: "g1", governs_pattern: "app/tokens.py", constraint: "Only backend may import token internals", domain: "backend", decision_id: "d_rajiv_2" },
  { id: "g2", governs_pattern: "web/**", constraint: "Frontend must not import server-only modules", domain: "frontend", decision_id: "d_talia_1" },
];
const SEVERITY_META: Record<string, { label: string; tone: BadgeTone; priority: string }> = {
  blocking: { label: "Blocking", tone: "red", priority: "urgent" },
  drift: { label: "Drift", tone: "amber", priority: "high" },
};

export function CodeGraph() {
  const { role: _role, chrome, drift } = useApp();
  const [tab, setTab] = useState("graph");
  const [built, setBuilt] = useState(GRAPH.built);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Team", "Code Graph"]}>
        <div style={{ display: "flex", gap: 6 }}>
          <Tab active={tab === "graph"} onClick={() => setTab("graph")}>Graph</Tab>
          <Tab active={tab === "gov"} onClick={() => setTab("gov")}>Governance</Tab>
          <Tab active={tab === "drift"} onClick={() => setTab("drift")} count={drift.length}>Drift</Tab>
        </div>
      </ViewChrome>
      {!built ? (
        <BuildEmpty onBuild={() => setBuilt(true)} />
      ) : tab === "graph" ? <GraphView />
        : tab === "gov" ? <GovernanceView canWrite={chrome.canGovern} />
        : /* TODO(reconcile): RoleChrome has no `canRefactor`; mock ROLE_CHROME gated it manager-only,
             same truth table as canGovern — using that until the adapter exposes canRefactor. */
          <DriftView canRefactor={chrome.canGovern} />}
    </div>
  );
}

function BuildEmpty({ onBuild }: { onBuild: () => void }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <span style={{ width: 48, height: 48, borderRadius: "var(--r-lg)", background: "var(--bg-secondary)", display: "grid", placeItems: "center", margin: "0 auto 16px", color: "var(--text-tertiary)" }}>
          <Icon name="merges" size={24} />
        </span>
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px" }}>Parse the import graph</h2>
        <p style={{ fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.55, margin: "0 0 18px" }}>Build the AST import graph to see dependents, register governance, and detect drift.</p>
        <Button variant="primary" size="md" icon="merges" onClick={onBuild}>Build graph</Button>
      </div>
    </div>
  );
}

const DOMAIN_ORDER = ["backend", "frontend", "devops"];
function GraphView() {
  const [focus, setFocus] = useState("app/relay.py");
  const dep = GRAPH_DEPENDENTS[focus] || { dependents: [], dependencies: [] };
  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <Stat2 n={GRAPH.nodes.length} l="modules" />
          <Stat2 n={GRAPH.edges.length} l="imports" />
          <Stat2 n={1} l="cycle" spark />
        </div>
        {DOMAIN_ORDER.map((dom) => {
          const nodes = GRAPH.nodes.filter((n) => n.domain === dom);
          if (!nodes.length) return null;
          return (
            <div key={dom} style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <DiscDot d={dom} /><span style={{ fontSize: 12.5, fontWeight: 600 }}>{DISC[dom].label}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{nodes.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {nodes.map((n) => {
                  const active = focus === n.path;
                  const inCycle = ["app/relay.py", "app/dispatch.py"].includes(n.path);
                  return (
                    <button key={n.path} onClick={() => setFocus(n.path)} style={{ display: "flex", alignItems: "center", gap: 10,
                      height: 34, padding: "0 10px", borderRadius: "var(--r-md)", textAlign: "left",
                      background: active ? "var(--bg-active)" : "transparent", border: active ? "0.5px solid var(--text-primary)" : "0.5px solid transparent" }}>
                      <Icon name="merges" size={13} style={{ color: "var(--text-quaternary)" }} />
                      <span className="mono" style={{ fontSize: 12, flex: 1, color: "var(--text-secondary)" }}>{n.path}</span>
                      {inCycle && <Badge tone="red" mono>cycle</Badge>}
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{n.loc} loc</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* who breaks */}
      <div style={{ width: 320, flexShrink: 0, borderLeft: "0.5px solid var(--border)", overflow: "auto", padding: 16, background: "var(--bg-elevated)" }}>
        <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>{focus}</div>
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "0 0 16px" }}>Change-impact analysis.</p>

        <div className="kicker" style={{ marginBottom: 8 }}>Who breaks if this changes · {dep.dependents.length}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 18 }}>
          {dep.dependents.length ? dep.dependents.map((d) => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 8px", borderRadius: "var(--r-md)" }}>
              <Icon name="arrowRight" size={13} style={{ color: "var(--text-primary)" }} />
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{d}</span>
            </div>
          )) : <span style={{ fontSize: 12, color: "var(--text-quaternary)", padding: "0 8px" }}>Nothing imports this — safe to change.</span>}
        </div>

        <div className="kicker" style={{ marginBottom: 8 }}>Depends on · {dep.dependencies.length}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {dep.dependencies.length ? dep.dependencies.map((d) => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 8px", borderRadius: "var(--r-md)" }}>
              <Icon name="chevronLeft" size={13} style={{ color: "var(--text-quaternary)" }} />
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{d}</span>
            </div>
          )) : <span style={{ fontSize: 12, color: "var(--text-quaternary)", padding: "0 8px" }}>No imports — a leaf module.</span>}
        </div>
      </div>
    </div>
  );
}

function GovernanceView({ canWrite }: { canWrite: boolean }) {
  const [rules, setRules] = useState<Rule[]>(GOVERNANCE_RULES.map((r) => ({ ...r })));
  const [adding, setAdding] = useState(false);
  const [pat, setPat] = useState(""); const [con, setCon] = useState("");
  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "22px 24px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.3px", margin: 0 }}>Governance rules</h1>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: "5px 0 0" }}>Decision-backed constraints the drift check enforces against the import graph.</p>
          </div>
          <div style={{ flex: 1 }} />
          {canWrite && <Button variant="primary" size="sm" icon="plus" onClick={() => setAdding((a) => !a)}>Register rule</Button>}
        </div>

        {adding && (
          <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 14, marginBottom: 14, boxShadow: "var(--shadow-1)" }}>
            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <input value={pat} onChange={(e) => setPat(e.target.value)} placeholder="governs pattern · app/tokens.py" style={cgInput} />
              <input value={con} onChange={(e) => setCon(e.target.value)} placeholder="constraint" style={{ ...cgInput, flex: 2 }} />
            </div>
            <Button variant="primary" size="sm" disabled={!pat || !con} style={{ opacity: pat && con ? 1 : 0.5 }}
              onClick={() => { setRules((rs) => [...rs, { id: "g" + Date.now(), governs_pattern: pat, constraint: con, domain: "backend", decision_id: null }]); setPat(""); setCon(""); setAdding(false); }}>Add rule</Button>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rules.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)" }}>
              <DiscDot d={r.domain} size={9} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.constraint}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", marginTop: 2 }}>governs {r.governs_pattern}{r.decision_id ? ` · backed by ${r.decision_id}` : ""}</div>
              </div>
              <Badge tone="outline" mono>{r.domain}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DriftView({ canRefactor }: { canRefactor: boolean }) {
  /* TODO(reconcile): useApp().drift is typed DriftReport[] but the mockup markup
     reads the scripted DRIFT_REPORTS shape (id/severity/title/detail/paths/scheduled).
     Kept verbatim; the orchestrator maps the real DriftReport fields here. */
  const { drift, scheduleRefactor } = useApp();
  const [ran, setRan] = useState(true);
  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "22px 24px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.3px", margin: 0 }}>Drift</h1>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: "5px 0 0" }}>Cycles and governance breaches. Each schedules a maintenance task into the relay.</p>
          </div>
          <div style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" icon="merges" onClick={() => setRan(true)}>Run drift check</Button>
        </div>

        {ran && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(drift as unknown as DriftRow[]).map((r) => {
              const sm = SEVERITY_META[r.severity];
              return (
                <div key={r.id} style={{ border: `0.5px solid ${r.severity === "blocking" ? "var(--text-primary)" : "var(--border)"}`, borderRadius: "var(--r-lg)", overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", background: "var(--bg-secondary)", borderBottom: "0.5px solid var(--border-subtle)" }}>
                    <Icon name="bolt" size={14} style={{ color: r.severity === "blocking" ? "var(--text-primary)" : "var(--amber)" }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</span>
                    <div style={{ flex: 1 }} />
                    <Badge tone={sm.tone}>{sm.label}</Badge>
                    <Badge tone="outline" mono>→ {sm.priority}</Badge>
                  </div>
                  <div style={{ padding: 14 }}>
                    <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: "0 0 10px", lineHeight: 1.5 }}>{r.detail}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                      {r.paths.map((p, i) => (
                        <Fragment key={p}>
                          {i > 0 && <Icon name="arrowRight" size={12} style={{ color: "var(--text-quaternary)" }} />}
                          <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)", background: "var(--bg-secondary)", padding: "2px 6px", borderRadius: "var(--r-xs)" }}>{p}</span>
                        </Fragment>
                      ))}
                    </div>
                    {r.scheduled
                      ? <Badge tone="green"><Icon name="check" size={11} />Refactor scheduled → backend lead</Badge>
                      : canRefactor
                        ? <Button variant="primary" size="sm" icon="ratify" onClick={() => scheduleRefactor(r.id)}>Schedule refactor</Button>
                        : <span style={{ fontSize: 11.5, color: "var(--text-quaternary)" }}>Manager schedules the refactor.</span>}
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

/* The drift row shape the mockup markup consumes. TODO(reconcile) with real DriftReport. */
type DriftRow = { id: string; domain: string; severity: string; title: string; detail: string; paths: string[]; scheduled: boolean };

function Stat2({ n, l, spark }: { n: number; l: string; spark?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600, color: spark ? "var(--text-primary)" : "var(--text-primary)" }}>{n}</span>
      <span style={{ fontSize: 11.5, color: spark ? "var(--text-primary)" : "var(--text-quaternary)", fontWeight: spark ? 600 : 400 }}>{l}</span>
    </div>
  );
}
const cgInput: React.CSSProperties = { flex: 1, height: 32, padding: "0 10px", fontSize: 12.5, fontFamily: "var(--font-mono)", background: "var(--bg-elevated)",
  border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)", outline: "none", color: "var(--text-primary)" };
