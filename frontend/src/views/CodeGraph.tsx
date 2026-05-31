import { useState } from "react";
import { useProjects } from "../features/projects/useProjects";
import { api } from "../lib/api";
import type { DriftReport, GovernanceRule, GraphNode } from "../lib/api";

const inp: React.CSSProperties = { padding: "7px 10px", border: "1.5px solid var(--border-strong)", borderRadius: 8, fontSize: 13 };

export function CodeGraph() {
  const { projects } = useProjects();
  const [summary, setSummary] = useState<{ nodes: number; edges: number } | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [rules, setRules] = useState<GovernanceRule[]>([]);
  const [drift, setDrift] = useState<DriftReport[] | null>(null);
  const [path, setPath] = useState("");
  const [dep, setDep] = useState<{ dependents: string[]; dependencies: string[] } | null>(null);
  const [pattern, setPattern] = useState("");
  const [constraint, setConstraint] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const wrap = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const build = () => wrap("build", async () => {
    const s = await api.buildGraph();
    setSummary({ nodes: s.nodes, edges: s.edges });
    setNodes((await api.getGraph()).nodes);
    setRules((await api.listGovernance()).rules);
    setDrift(null);
  });
  const trace = () => wrap("dep", async () => setDep(await api.graphDependents(path.trim())));
  const addRule = () => wrap("rule", async () => {
    await api.addGovernance({ governs_pattern: pattern.trim(), constraint: constraint.trim(), domain: "backend" });
    setPattern(""); setConstraint("");
    setRules((await api.listGovernance()).rules);
  });
  const checkDrift = () => wrap("drift", async () => setDrift((await api.checkDrift()).reports));
  const refactor = (r: DriftReport) => wrap("rf" + r.violation, async () => {
    const pid = projects[0]?.project_id ?? 0;
    await api.createRefactorTask(pid, r);
    window.alert(`Refactor task created in project ${pid} (see Work hub).`);
  });

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="kicker">Code Graph</div>
      <div className="display" style={{ fontSize: 28 }}>Dependency graph + drift</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
        Static import graph (Python <span className="mono">ast</span>), decision governance, drift → refactor tasks.
      </div>
      {err && <div className="card-soft mono" style={{ color: "var(--text-primary)", marginTop: 12, fontSize: 12 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary btn-sm" disabled={busy === "build"} onClick={build}>
          {busy === "build" ? "Building…" : "Build graph"}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy === "drift" || nodes.length === 0} onClick={checkDrift}>
          {busy === "drift" ? "Checking…" : "Check drift"}
        </button>
        {summary && <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{summary.nodes} files · {summary.edges} imports</span>}
      </div>

      {nodes.length > 0 && (
        <div className="card-soft" style={{ padding: 14, marginTop: 16 }}>
          <div className="kicker" style={{ marginBottom: 6 }}>Impact of a file</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input list="gnodes" value={path} onChange={(e) => setPath(e.target.value)} placeholder="e.g. contracts.py"
              style={{ ...inp, flex: 1, fontFamily: "var(--font-mono)" }} />
            <datalist id="gnodes">{nodes.map((n) => <option key={n.path} value={n.path} />)}</datalist>
            <button className="btn btn-ghost btn-sm" disabled={!path.trim() || busy === "dep"} onClick={trace}>Trace</button>
          </div>
          {dep && (
            <div style={{ fontSize: 12, marginTop: 8 }}>
              <div><b>{dep.dependents.length}</b> dependents (break if it changes): <span className="mono">{dep.dependents.join(", ") || "—"}</span></div>
              <div style={{ marginTop: 4 }}><b>{dep.dependencies.length}</b> dependencies (focus-branch set): <span className="mono">{dep.dependencies.join(", ") || "—"}</span></div>
            </div>
          )}
        </div>
      )}

      {nodes.length > 0 && (
        <div className="card-soft" style={{ padding: 14, marginTop: 12 }}>
          <div className="kicker" style={{ marginBottom: 6 }}>Governance rules (Graph B)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="pattern e.g. gitlab.py"
              style={{ ...inp, width: 180, fontFamily: "var(--font-mono)" }} />
            <input value={constraint} onChange={(e) => setConstraint(e.target.value)} placeholder="constraint (why)"
              style={{ ...inp, flex: 1, minWidth: 160 }} />
            <button className="btn btn-ghost btn-sm" disabled={!pattern.trim() || busy === "rule"} onClick={addRule}>Add rule</button>
          </div>
          {rules.length > 0 && (
            <div style={{ fontSize: 12, marginTop: 8 }}>
              {rules.map((r) => <div key={r.id}><span className="mono">{r.governs_pattern}</span> — {r.constraint || "(no note)"}</div>)}
            </div>
          )}
        </div>
      )}

      {drift && (
        <div style={{ marginTop: 16 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Drift reports ({drift.length})</div>
          {drift.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No drift — graph is clean.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {drift.map((r, i) => (
                <div key={i} className="card-soft" style={{ padding: 12, borderColor: r.severity === "blocking" ? "var(--ink-fill)" : "var(--border-strong)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="chip" style={{ fontSize: 9, background: r.severity === "blocking" ? "var(--ink-fill)" : "var(--bg-app)", color: r.severity === "blocking" ? "var(--bg-elevated)" : "var(--text-secondary)" }}>{r.severity}</span>
                    <b style={{ fontSize: 13 }}>{r.violation}</b>
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} disabled={busy === "rf" + r.violation} onClick={() => refactor(r)}>Create refactor task →</button>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{r.drift_from_description} · <span className="mono">{r.affected_files.join(", ")}</span></div>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>Fix: {r.suggested_fix}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
