/* sprint0 × Linear — Projects. Dense list + project detail sub-panel.
   Ported 1:1 from v4 mockup app/Projects.jsx; mock constants swapped for the useApp() adapter
   (PROJECTS→projects, MEMBERS→members, RELAY.gates→gates). Exported as Dashboard for the router. */
import { useState, Fragment, type CSSProperties } from "react";
import { Button, IconButton, Tab, Avatar, Badge, DiscDot, DISC } from "../components/ui";
import { Icon } from "../lib/icon";
import { ViewChrome } from "../components/ViewChrome";
import { useApp } from "../app/useApp";

/* GATE_META — ported verbatim from the mockup's data.jsx (panel reads it in MiniRelay). */
const GATE_META: Record<string, { label: string; tone: string; fg: string }> = {
  ratified:          { label: "Ratified",          tone: "green",   fg: "var(--green)" },
  auto_passed:       { label: "Auto-passed",       tone: "blue",    fg: "var(--blue)" },
  changes_requested: { label: "Changes requested", tone: "amber",   fg: "var(--amber)" },
  blocked:           { label: "Blocked",           tone: "red",     fg: "var(--red)" },
  locked:            { label: "Locked",            tone: "neutral", fg: "var(--text-quaternary)" },
  pending:           { label: "Pending",           tone: "outline", fg: "var(--text-tertiary)" },
};

export function Dashboard() {
  const { setView, projects, members, gates } = useApp();
  const [filter, setFilter] = useState("all"); // all | active | shipped | reference
  const [sel, setSel] = useState<any>(null);

  const list = (projects as any[]).filter(p =>
    filter === "all" ? true :
    filter === "reference" ? p.kind === "reference" :
    filter === "shipped" ? p.status === "shipped" && p.kind !== "reference" :
    p.status === "in_progress");
  const active = (projects as any[]).filter(p => p.kind === "active");
  const shipped = (projects as any[]).filter(p => p.status === "shipped");
  const selP = (projects as any[]).find(p => p.id === sel) || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Projects"]}>
        <IconButton name="filter" title="Filter" />
        <IconButton name="sort" title="Sort" />
        <Button variant="primary" size="sm" icon="plus" onClick={() => setView("wizard")}>New project</Button>
      </ViewChrome>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Summary strip */}
          <div style={{ display: "flex", alignItems: "center", gap: 28, padding: "16px 20px",
            borderBottom: "0.5px solid var(--border-subtle)" }}>
            {[["Across the studio", `${active.length} active`], ["Shipped", `${shipped.length}`],
              ["Issues in the relay", `${(projects as any[]).reduce((n, p) => n + (p.issues || 0), 0)}`]].map(([l, v], i) => (
              <div key={i}>
                <div className="kicker" style={{ marginBottom: 4 }}>{l}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.5px" }}>{v}</div>
              </div>
            ))}
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 6 }}>
              {["all", "active", "shipped", "reference"].map(f =>
                <Tab key={f} active={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</Tab>)}
            </div>
          </div>

          <div style={{ flex: 1, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", height: 30, padding: "0 20px",
              borderBottom: "0.5px solid var(--border-subtle)", position: "sticky", top: 0, background: "var(--bg-elevated)", zIndex: 1 }}>
              <span className="kicker" style={{ flex: 1, minWidth: 0 }}>Project</span>
              {!selP && <span className="kicker" style={{ width: 168, flexShrink: 0 }}>Stack</span>}
              <span className="kicker" style={{ width: 58, flexShrink: 0 }}>Issues</span>
              {!selP && <span className="kicker" style={{ width: 96, flexShrink: 0 }}>Team</span>}
              <span className="kicker" style={{ width: 78, flexShrink: 0, textAlign: "right" }}>Status</span>
            </div>
            {list.map(p => <ProjectRow key={p.id} p={p} members={members} selected={sel === p.id} compact={!!selP} onOpen={() => setSel(p.id)} />)}
          </div>
        </div>
        {selP && <ProjectPanel p={selP} gates={gates} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}

function ProjectRow({ p, members, selected, onOpen, compact }: { p: any; members: any[]; selected: boolean; onOpen: () => void; compact: boolean }) {
  const [h, setH] = useState(false);
  const isRef = p.kind === "reference";
  const st = p.status === "shipped";
  return (
    <div onClick={onOpen} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", height: 52, padding: "0 20px", cursor: "pointer",
        background: selected || h ? "var(--bg-hover)" : "transparent",
        borderBottom: "0.5px solid var(--border-subtle)" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ width: 28, height: 28, borderRadius: "var(--r-sm)", background: p.accent, color: "#fff",
          display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
          {(p.code || "").slice(0, 2)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>#{p.id} · {p.activity || p.created}</div>
        </div>
      </div>
      {!compact && (
        <div style={{ width: 168, flexShrink: 0, display: "flex", gap: 4, overflow: "hidden" }}>
          {(p.stack || []).slice(0, 2).map((s: string) => <Badge key={s} tone="outline">{s}</Badge>)}
          {(p.stack || []).length > 2 && <Badge tone="neutral">+{p.stack.length - 2}</Badge>}
        </div>
      )}
      <div style={{ width: 58, flexShrink: 0 }}>
        {isRef ? <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>—</span>
          : <span className="mono" style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{p.issues}</span>}
      </div>
      {!compact && (
        <div style={{ width: 96, flexShrink: 0 }}>
          {isRef ? <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>memory</span>
            : <AvatarStack n={p.devs} members={members} />}
        </div>
      )}
      <div style={{ width: 78, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
        <Badge tone={isRef ? "neutral" : st ? "neutral" : "green"}>{isRef ? "Reference" : st ? "Shipped" : "Active"}</Badge>
      </div>
    </div>
  );
}
function AvatarStack({ n = 0, members }: { n?: number; members: any[] }) {
  const names = members.filter(m => m.role === "developer").slice(0, Math.min(n, 4));
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {names.map((m, i) => <span key={m.username} style={{ marginLeft: i ? -6 : 0 }}><Avatar name={m.name} size={20} ring /></span>)}
      {n > 4 && <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", marginLeft: 6 }}>+{n - 4}</span>}
    </span>
  );
}

function ProjectPanel({ p, gates, onClose }: { p: any; gates: any[]; onClose: () => void }) {
  const isRef = p.kind === "reference";
  return (
    <div style={{ width: 320, flexShrink: 0, borderLeft: "0.5px solid var(--border)", display: "flex",
      flexDirection: "column", minHeight: 0, background: "var(--bg-elevated)",
      animation: "s0-panel-in var(--t-reg) var(--ease-out) both" }}>
      <div style={{ height: "var(--topbar-h)", display: "flex", alignItems: "center", gap: 8, padding: "0 8px 0 14px",
        borderBottom: "0.5px solid var(--border-subtle)" }}>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>#{p.id}</span>
        <div style={{ flex: 1 }} />
        <IconButton name="gitlab" title="Open in GitLab" />
        <IconButton name="close" onClick={onClose} />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 16 }}>
          <span style={{ width: 40, height: 40, borderRadius: "var(--r-md)", background: p.accent, color: "#fff",
            display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 14 }}>{(p.code || "").slice(0, 2)}</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.3px" }}>{p.name}</div>
            <Badge tone={isRef ? "neutral" : p.status === "shipped" ? "neutral" : "green"} style={{ marginTop: 4 }}>
              {isRef ? "Reference · agency memory" : p.status === "shipped" ? "Shipped" : "Active"}
            </Badge>
          </div>
        </div>

        {p.summary && <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-tertiary)", margin: "0 0 16px" }}>{p.summary}</p>}

        {!isRef && (
          <div style={{ display: "flex", gap: 0, marginBottom: 16, border: "0.5px solid var(--border)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
            {[["Issues", p.issues], ["Devs", p.devs], ["Created", p.created]].map(([l, v], i) => (
              <div key={l} style={{ flex: 1, padding: "10px 12px", borderLeft: i ? "0.5px solid var(--border)" : "none" }}>
                <div className="kicker" style={{ marginBottom: 4, fontSize: 10 }}>{l}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div className="kicker" style={{ marginBottom: 8 }}>Tech stack</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
          {(p.stack || []).map((s: string) => <Badge key={s} tone="outline">{s}</Badge>)}
        </div>

        {(p.grounded?.length || p.tags?.length) ? (
          <>
            <div className="kicker" style={{ marginBottom: 8 }}>{isRef ? "Reused modules" : "Grounded on memory"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
              {(p.grounded || p.tags || []).map((g: string) => (
                <span key={g} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 8px",
                  borderRadius: "var(--r-sm)", background: "var(--accent-soft)", color: "var(--accent-deep)", fontSize: 11.5, fontWeight: 500 }}>
                  <Icon name="merges" size={12} />{g}
                </span>
              ))}
            </div>
          </>
        ) : null}

        {!isRef && (
          <>
            <div className="kicker" style={{ marginBottom: 8 }}>Relay status</div>
            <MiniRelay gates={gates} />
          </>
        )}
      </div>
      {!isRef && (
        <div style={{ borderTop: "0.5px solid var(--border-subtle)", padding: 10, display: "flex", gap: 8 }}>
          <Button variant="secondary" size="md" icon="plus" style={{ flex: 1 }}>Add feature</Button>
          <Button variant="secondary" size="md">Close</Button>
        </div>
      )}
    </div>
  );
}
function MiniRelay({ gates }: { gates: any[] }) {
  const order = ["uiux", "backend", "devops", "frontend", "qa"];
  const statusByDisc: Record<string, string> = Object.fromEntries(gates.map(g => [g.discipline, g.status]));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 4px" }}>
      {order.map((d, i) => {
        const s = statusByDisc[d] || "pending";
        const done = s === "ratified" || s === "auto_passed";
        const cr = s === "changes_requested";
        return (
          <Fragment key={d}>
            <div title={`${DISC[d].label} · ${GATE_META[s].label}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center",
                background: done ? "var(--green)" : cr ? "var(--amber)" : "var(--bg-secondary)",
                color: done || cr ? "#fff" : "var(--text-quaternary)", border: "0.5px solid var(--border)" } as CSSProperties}>
                {done ? <Icon name="ratify" size={13} /> : <DiscDot d={d} size={8} />}
              </span>
              <span style={{ fontSize: 9.5, color: "var(--text-quaternary)" }}>{DISC[d].label}</span>
            </div>
            {i < order.length - 1 && <span style={{ flex: 1, height: 1, background: "var(--border-strong)", marginTop: -16 }} />}
          </Fragment>
        );
      })}
    </div>
  );
}
