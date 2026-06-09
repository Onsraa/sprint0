/* sprint0 × Linear — Projects. Dense list + project detail sub-panel.
   Ported 1:1 from v5 mockup project/app/Projects.jsx; mock constants swapped for the useApp() adapter
   (PROJECTS→projects, MEMBERS→members, RELAY.gates→gates, drafts→drafts). v5 adds the drafts section
   (wizard drafts shown above a divider before dispatch) + the s0-rise row stagger. Exported as
   Dashboard for the router. */
import { useState } from "react";
import { Button, IconButton, Tab, Avatar, Badge } from "../components/ui";
import { Icon } from "../lib/icon";
import { ViewChrome } from "../components/ViewChrome";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";

export function Dashboard() {
  const { setView, projects, members, drafts, relaySummaries } = useApp();
  const setProjectFilter = useUI((s) => s.setProjectFilter);
  const setResumeDraft = useUI((s) => s.setResumeDraft);
  const [filter, setFilter] = useState("all"); // all | drafts | active | shipped | reference
  const [sel, setSel] = useState<any>(null);

  const projList = (projects as any[]).filter(p =>
    filter === "all" ? true :
    filter === "reference" ? p.kind === "reference" :
    filter === "shipped" ? p.status === "shipped" && p.kind !== "reference" :
    p.status === "in_progress");
  const active = (projects as any[]).filter(p => p.kind === "active");
  const shipped = (projects as any[]).filter(p => p.status === "shipped");
  const selP = [...(drafts as any[]), ...(projects as any[])].find(p => p.id === sel) || null;

  // drafts sit above a divider in "all", and are the sole list under "drafts"
  const showDrafts = (filter === "all" || filter === "drafts") && (drafts as any[]).length > 0;
  const showProjects = filter !== "drafts";

  const TABS = ["all", ...((drafts as any[]).length ? ["drafts"] : []), "active", "shipped", "reference"];

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
              ["Drafts", `${(drafts as any[]).length}`]].map(([l, v], i) => (
              <div key={i}>
                <div className="kicker" style={{ marginBottom: 4 }}>{l}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.5px" }}>{v}</div>
              </div>
            ))}
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 6 }}>
              {TABS.map(f =>
                <Tab key={f} active={filter === f} onClick={() => setFilter(f)}>
                  {f[0].toUpperCase() + f.slice(1)}{f === "drafts" && (drafts as any[]).length ? ` · ${(drafts as any[]).length}` : ""}
                </Tab>)}
            </div>
          </div>

          <div style={{ flex: 1, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", height: 30, padding: "0 20px",
              borderBottom: "0.5px solid var(--border-subtle)", position: "sticky", top: 0, background: "var(--bg-elevated)", zIndex: 1 }}>
              <span className="kicker" style={{ flex: 1, minWidth: 0 }}>Project</span>
              {!selP && <span className="kicker" style={{ width: 196, flexShrink: 0 }}>Stack</span>}
              <span className="kicker" style={{ width: 76, flexShrink: 0 }}>Issues</span>
              {!selP && <span className="kicker" style={{ width: 116, flexShrink: 0 }}>Team</span>}
              <span className="kicker" style={{ width: 92, flexShrink: 0, textAlign: "right" }}>Status</span>
            </div>

            {/* drafts — above a divider */}
            {showDrafts && (drafts as any[]).map(p => <ProjectRow key={p.id} p={p} members={members} selected={sel === p.id} compact={!!selP} onOpen={() => setSel(p.id)} />)}
            {showDrafts && filter === "all" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 20px", height: 30, background: "var(--bg-secondary)",
                borderBottom: "0.5px solid var(--border-subtle)", borderTop: "0.5px solid var(--border-subtle)" }}>
                <span className="kicker" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>Dispatched & reference</span>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
            )}

            {showProjects && projList.map(p => <ProjectRow key={p.id} p={p} members={members} selected={sel === p.id} compact={!!selP} onOpen={() => setSel(p.id)} />)}

            {filter === "drafts" && (drafts as any[]).length === 0 && (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-quaternary)", fontSize: 13 }}>No drafts yet.</div>
            )}
          </div>
        </div>
        {selP && <ProjectPanel p={selP}
          hasRelays={(relaySummaries as any[]).some((r) => r.target_project_id === selP.project_id || r.project === selP.name)}
          onViewRelays={() => { setProjectFilter(selP.project_id); setView("relays"); }} onClose={() => setSel(null)} onResume={() => { if (selP?.kind === "draft") setResumeDraft(selP); setView("wizard"); }} />}
      </div>
    </div>
  );
}

function ProjectRow({ p, members, selected, onOpen, compact }: { p: any; members: any[]; selected: boolean; onOpen: () => void; compact: boolean }) {
  const [h, setH] = useState(false);
  const isRef = p.kind === "reference";
  const isDraft = p.kind === "draft";
  const st = p.status === "shipped";
  return (
    <div onClick={onOpen} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", height: 52, padding: "0 20px", cursor: "pointer",
        background: selected || h ? "var(--bg-hover)" : isDraft ? "var(--bg-base)" : "transparent",
        borderBottom: "0.5px solid var(--border-subtle)",
        animation: isDraft ? "s0-rise 0.4s var(--ease-out) both" : "none" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ width: 28, height: 28, borderRadius: "var(--r-sm)",
          background: isDraft ? "var(--bg-secondary)" : p.accent, color: isDraft ? "var(--text-tertiary)" : "#fff",
          display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11, flexShrink: 0,
          border: isDraft ? "1px dashed var(--border-strong)" : "none" }}>
          {(p.code || "").slice(0, 2)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {isDraft ? `draft · saved at ${p.savedAt || "Brief"} · ${p.created}` : `#${p.id} · ${p.activity || p.created}`}
          </div>
        </div>
      </div>
      {!compact && (
        <div style={{ width: 196, flexShrink: 0, display: "flex", gap: 4, overflow: "hidden" }}>
          {(p.stack || []).slice(0, 2).map((s: string) => <Badge key={s} tone="outline">{s}</Badge>)}
          {(p.stack || []).length > 2 && <Badge tone="neutral">+{p.stack.length - 2}</Badge>}
        </div>
      )}
      <div style={{ width: 76, flexShrink: 0 }}>
        {isRef || isDraft ? <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>—</span>
          : <span className="mono" style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{p.issues}</span>}
      </div>
      {!compact && (
        <div style={{ width: 116, flexShrink: 0, overflow: "hidden" }}>
          {isRef ? <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>memory</span>
            : isDraft ? <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>—</span>
            : <AvatarStack n={p.devs} members={members} />}
        </div>
      )}
      <div style={{ width: 92, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
        {isDraft
          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 20, padding: "0 8px 0 7px", borderRadius: "var(--r-pill)",
              border: "1px dashed var(--border-strong)", fontSize: 11, fontWeight: 500, color: "var(--text-tertiary)" }}>
              <Icon name="clock" size={11} />Draft
            </span>
          : <Badge tone={isRef ? "neutral" : st ? "neutral" : "green"}>{isRef ? "Reference" : st ? "Shipped" : "Active"}</Badge>}
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

function ProjectPanel({ p, hasRelays, onViewRelays, onClose, onResume }: { p: any; hasRelays: boolean; onViewRelays: () => void; onClose: () => void; onResume: () => void }) {
  const setFeatureProjectId = useUI((s) => s.setFeatureProjectId);
  const isRef = p.kind === "reference";
  const isDraft = p.kind === "draft";
  return (
    <div style={{ width: 320, flexShrink: 0, borderLeft: "0.5px solid var(--border)", display: "flex",
      flexDirection: "column", minHeight: 0, background: "var(--bg-elevated)",
      animation: "s0-panel-in var(--t-reg) var(--ease-out) both" }}>
      <div style={{ height: "var(--topbar-h)", display: "flex", alignItems: "center", gap: 8, padding: "0 8px 0 14px",
        borderBottom: "0.5px solid var(--border-subtle)" }}>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{isDraft ? "draft" : `#${p.id}`}</span>
        <div style={{ flex: 1 }} />
        {!isDraft && p.web_url && <IconButton name="gitlab" title="Open in GitLab" onClick={() => window.open(p.web_url, "_blank", "noopener")} />}
        <IconButton name="close" onClick={onClose} />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 16 }}>
          <span style={{ width: 40, height: 40, borderRadius: "var(--r-md)",
            background: isDraft ? "var(--bg-secondary)" : p.accent, color: isDraft ? "var(--text-tertiary)" : "#fff",
            border: isDraft ? "1px dashed var(--border-strong)" : "none",
            display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 14 }}>{(p.code || "").slice(0, 2)}</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.3px" }}>{p.name}</div>
            {isDraft
              ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 20, padding: "0 8px 0 7px", marginTop: 4, borderRadius: "var(--r-pill)",
                  border: "1px dashed var(--border-strong)", fontSize: 11, fontWeight: 500, color: "var(--text-tertiary)" }}><Icon name="clock" size={11} />Draft · not dispatched</span>
              : <Badge tone={isRef ? "neutral" : p.status === "shipped" ? "neutral" : "green"} style={{ marginTop: 4 }}>
                  {isRef ? "Reference · agency memory" : p.status === "shipped" ? "Shipped" : "Active"}
                </Badge>}
          </div>
        </div>

        {p.summary && <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-tertiary)", margin: "0 0 16px" }}>{p.summary}</p>}

        {!isRef && !isDraft && (
          <div style={{ display: "flex", gap: 0, marginBottom: 16, border: "0.5px solid var(--border)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
            {[["Issues", p.issues], ["Devs", p.devs], ["Created", p.created]].map(([l, v], i) => (
              <div key={l} style={{ flex: 1, padding: "10px 12px", borderLeft: i ? "0.5px solid var(--border)" : "none" }}>
                <div className="kicker" style={{ marginBottom: 4, fontSize: 10 }}>{l}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div className="kicker" style={{ marginBottom: 8 }}>{isDraft ? "Proposed stack" : "Tech stack"}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
          {(p.stack || []).filter(Boolean).length
            ? (p.stack as string[]).filter(Boolean).map((s) => <Badge key={s} tone="outline">{s}</Badge>)
            : <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>not set</span>}
        </div>

        {isRef && (p.grounded?.length || p.tags?.length) ? (
          <>
            <div className="kicker" style={{ marginBottom: 8 }}>Reused modules</div>
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

        {!isRef && !isDraft && (
          hasRelays
            ? <Button variant="secondary" size="sm" iconRight="arrowRight" style={{ width: "100%" }} onClick={onViewRelays}>
                View this project's relays
              </Button>
            : <Button variant="secondary" size="sm" disabled style={{ width: "100%", opacity: 0.5, cursor: "default" }}>
                No relays yet
              </Button>
        )}
      </div>
      {isDraft ? (
        <div style={{ borderTop: "0.5px solid var(--border-subtle)", padding: 10, display: "flex", gap: 8 }}>
          <Button variant="primary" size="md" iconRight="arrowRight" style={{ flex: 1 }} onClick={onResume}>Resume in wizard</Button>
        </div>
      ) : !isRef && (
        <div style={{ borderTop: "0.5px solid var(--border-subtle)", padding: 10, display: "flex", gap: 8 }}>
          <Button variant="secondary" size="md" icon="plus" style={{ flex: 1 }} onClick={() => setFeatureProjectId(p.project_id)}>Add feature</Button>
          <Button variant="secondary" size="md" onClick={onClose}>Close</Button>
        </div>
      )}
    </div>
  );
}
