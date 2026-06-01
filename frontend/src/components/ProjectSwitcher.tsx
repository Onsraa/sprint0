/* sprint0 — shared project switcher. A compact topbar dropdown (mirrors the persona switcher in
   AppShellNew) that drives the cross-view project filter (useUI.projectFilter; null = All projects).
   Dropped into Relays · My Work · Tester so any role can narrow to one project or see everything. */
import { useState } from "react";
import { Icon } from "../lib/icon";
import { useUI } from "../lib/store";
import { useApp } from "../app/useApp";

export function ProjectSwitcher() {
  const { projects } = useApp();
  const projectFilter = useUI((s) => s.projectFilter);
  const setProjectFilter = useUI((s) => s.setProjectFilter);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [h, setH] = useState(false);

  const sel = (projects as any[]).find((p) => p.project_id === projectFilter);
  const label = sel ? sel.name : "All projects";
  const list = (projects as any[]).filter((p) => !q || (p.name || "").toLowerCase().includes(q.toLowerCase()));

  const pick = (id: number | null) => { setProjectFilter(id); setOpen(false); setQ(""); };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
        title="Filter by project"
        style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 28, padding: "0 9px",
          borderRadius: "var(--r-md)", border: "0.5px solid var(--border-strong)",
          background: open || h ? "var(--bg-hover)" : "var(--bg-elevated)", color: "var(--text-secondary)",
          fontSize: 12, fontWeight: 500, maxWidth: 220, transition: "background var(--t-quick)" }}>
        <Icon name="projects" size={13} style={{ color: "var(--text-tertiary)" }} />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <Icon name="chevronDown" size={13} style={{ color: "var(--text-quaternary)" }} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div style={{ position: "absolute", top: 34, right: 0, width: 252, zIndex: 61, background: "var(--bg-elevated)",
            border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-3)",
            padding: 6, animation: "s0-pop-in var(--t-reg) var(--ease-out) both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 8px",
              borderBottom: "0.5px solid var(--border-subtle)", marginBottom: 4 }}>
              <Icon name="search" size={14} style={{ color: "var(--text-tertiary)" }} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter projects…"
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13, color: "var(--text-primary)" }} />
            </div>
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              <Row label="All projects" active={projectFilter == null} onClick={() => pick(null)} />
              {list.map((p) => (
                <Row key={p.project_id} label={p.name} accent={p.accent} active={projectFilter === p.project_id} onClick={() => pick(p.project_id)} />
              ))}
              {list.length === 0 && <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-quaternary)" }}>No projects</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, accent, active, onClick }: { label: string; accent?: string; active: boolean; onClick: () => void }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", height: 32, padding: "0 8px",
        borderRadius: "var(--r-md)", textAlign: "left", background: active || h ? "var(--bg-hover)" : "transparent" }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: accent || "var(--text-quaternary)" }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: "var(--text-primary)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {active && <Icon name="check" size={14} style={{ color: "var(--text-primary)" }} />}
    </button>
  );
}
