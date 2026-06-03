/* sprint0 × Linear — app shell (ported from the v4 design Shell.jsx). 244px role-gated nav rail with
 * the persona switcher, then the content as a floating white pane. Wired to the useApp() adapter; auth
 * gates the Landing (logged out) vs the shell (logged in). The wizard + ⌘K palette mount here. */
import { useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { useApp } from "./useApp";
import { useMe } from "../features/auth/useAuth";
import { useUI } from "../lib/store";
import { useRoleGate } from "../features/nav/nav";
import { Icon } from "../lib/icon";
import { Avatar, Kbd } from "../components/ui";
import { FullLogo } from "../lib/icon";
import { Landing } from "../views/Landing";
import { Wizard } from "../wizard/Wizard";
import { FeatureWizard } from "../wizard/FeatureWizard";
import { CommandPalette } from "../features/palette/CommandPalette";
import { useNotificationsWS } from "../features/notify/useNotifications";
import { useHealth } from "../features/health/useHealth";
import { useWorkspace } from "../features/workspace/useWorkspace";

/* The demo roster shown in the persona switcher (the 5 real seeded accounts). */
export const DEMO_PERSONAS = [
  { username: "Onsraa", name: "Teddy", role: "manager", discipline: null },
  { username: "sprint0-se", name: "Jean Gabriel", role: "developer", discipline: "backend" },
  { username: "sprint0-sse", name: "Tony Stark", role: "developer", discipline: "devops" },
  { username: "sprint0-fe", name: "Sam Dupont", role: "developer", discipline: "frontend" },
  { username: "sprint0-qa", name: "Pascal Alice", role: "qa", discipline: "qa" },
];

/* nav items carry a `roles` allowlist + capability flags — per-role chrome. */
/* v4 two-plane: the Overview group reads first (Today · Relays) → Work → Explore → System.
   Code Graph + Merges + standalone Profiles are CUT (routes stay, unlinked); Projects + Team
   are now universal; capability Profiles fold into Team's "Capabilities" tab. Tester replaces
   QA gate. Devs/managers reach Contract from the Today "Start here" card, not a standing item. */
const NAV = [
  { section: "Overview", items: [
    { id: "today", label: "Queue", icon: "inbox", kbd: ["G", "D"], roles: ["manager", "developer", "qa"] },
    { id: "relays", label: "Relays", icon: "pool", kbd: ["G", "L"], roles: ["manager", "developer", "qa"] },
  ] },
  { section: "Work", items: [
    { id: "mywork", label: "My Work", icon: "board", kbd: ["G", "W"], roles: ["manager", "developer", "qa"] },
    { id: "qagate", label: "Tester", icon: "qa", kbd: ["G", "Q"], roles: ["qa"] },
  ] },
  { section: "Explore", items: [
    { id: "projects", label: "Projects", icon: "projects", kbd: ["G", "P"], roles: ["manager", "developer", "qa"] },
    { id: "team", label: "Team", icon: "team", roles: ["manager", "developer", "qa"] },
    { id: "portfolio", label: "Decisions", icon: "portfolio", roles: ["manager", "developer", "qa"] },
    { id: "passport", label: "Passport", icon: "passport", roles: ["developer", "qa"] },
  ] },
  { section: "System", items: [
    { id: "settings", label: "Settings", icon: "settings", roles: ["manager"] },
  ] },
] as const;

export function AppShellNew() {
  const { member, authLoading, role } = useMe();
  const wizardOpen = useUI((s) => s.wizardOpen);
  const wizardKind = useUI((s) => s.wizardKind);
  const togglePalette = useUI((s) => s.togglePalette);
  useNotificationsWS(member?.username);
  useRoleGate(member ? role : null);

  if (authLoading) return <SessionLoading />;
  if (!member) return <Landing />;
  // The wizard is its own full-screen route (no sidebar), matching the v4/v5 design.
  if (wizardOpen) return <Wizard kind={wizardKind} />;

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-app)" }}>
      <Sidebar onPalette={togglePalette} />
      <div style={{ flex: 1, minWidth: 0, padding: "8px 8px 8px 0" }}>
        <div className="pane">
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
            <Outlet />
          </div>
        </div>
      </div>
      <CommandPalette />
      <FeatureWizard />
    </div>
  );
}

function SessionLoading() {
  return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "var(--bg-app)" }}>
      <div className="mono" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>restoring your session…</div>
    </div>
  );
}

function Sidebar({ onPalette }: { onPalette: () => void }) {
  const { view, setView, role, chrome } = useApp();
  const collapsed = useUI((s) => s.navCollapsed);   // store, not local state → survives shell remount + reload
  const toggleNav = useUI((s) => s.toggleNav);
  return (
    <aside style={{ width: collapsed ? 60 : "var(--nav-w)", flexShrink: 0, height: "100vh", display: "flex", flexDirection: "column", padding: "10px 8px 8px", gap: 4, transition: "width var(--t-reg) var(--ease-out)" }}>
      <Workspace collapsed={collapsed} />
      <SearchTrigger onClick={onPalette} collapsed={collapsed} />
      {chrome.canDispatch && (
        <button onClick={() => setView("wizard")} title="New from brief" style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 8, height: 32, margin: "2px 0", padding: collapsed ? 0 : "0 10px", borderRadius: "var(--r-md)", background: "var(--ink-fill)", color: "#fff", fontSize: 13, fontWeight: 500 }}>
          <Icon name="plus" size={15} />{!collapsed && " New from brief"}
        </button>
      )}
      <nav style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 4 }}>
        {NAV.map((grp, gi) => {
          const items = grp.items.filter((it) => (it.roles as readonly string[]).includes(role));
          if (!items.length) return null;
          return (
            <div key={gi} style={{ marginTop: grp.section ? 12 : 0 }}>
              {grp.section && !collapsed && (
                <div style={{ height: 24, display: "flex", alignItems: "center", padding: "0 10px", fontSize: 11, fontWeight: 500, color: "var(--text-quaternary)", letterSpacing: "0.02em" }}>{grp.section}</div>
              )}
              {items.map((it) => <NavItem key={it.label} item={it} active={view === it.id} onClick={() => setView(it.id)} collapsed={collapsed} />)}
            </div>
          );
        })}
      </nav>
      <div style={{ flex: 1 }} />
      <button onClick={toggleNav} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 9, height: 28, padding: collapsed ? 0 : "0 10px", borderRadius: "var(--r-md)", color: "var(--text-quaternary)" }}>
        <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} />{!collapsed && <span style={{ fontSize: 12, fontWeight: 500 }}>Collapse</span>}
      </button>
      <SidebarFooter collapsed={collapsed} />
    </aside>
  );
}

function Workspace({ collapsed }: { collapsed?: boolean }) {
  const { me, switchPersona } = useApp();
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} title={collapsed ? `· ${workspace}` : undefined}
        style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 9, height: 36, padding: collapsed ? 0 : "0 8px", borderRadius: "var(--r-md)", width: "100%", background: open || h ? "var(--bg-hover)" : "transparent", transition: "background var(--t-quick)" }}>
        <FullLogo size={17} />
        {!collapsed && <>
          <span style={{ fontSize: 12, color: "var(--text-quaternary)", fontWeight: 500 }}>· {workspace}</span>
          <div style={{ flex: 1 }} />
          <Icon name="chevronDown" size={14} style={{ color: "var(--text-quaternary)" }} />
        </>}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div style={{ position: "absolute", top: 40, left: 0, width: 256, zIndex: 61, background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-3)", padding: 6, animation: "s0-pop-in var(--t-reg) var(--ease-out) both" }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)", padding: "6px 8px 4px", letterSpacing: "0.05em", textTransform: "uppercase" }}>Switch persona · demo</div>
            {DEMO_PERSONAS.map((p) => (
              <button key={p.username} onClick={() => { switchPersona(p.username); setOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px", borderRadius: "var(--r-md)", background: p.username === me.username ? "var(--bg-hover)" : "transparent", textAlign: "left" }}>
                <Avatar name={p.name} size={26} tone={p.role === "manager" ? "ink" : undefined} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{p.role}{p.discipline ? " · " + p.discipline : ""}</div>
                </div>
                {p.username === me.username && <Icon name="check" size={15} style={{ color: "var(--text-primary)" }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SearchTrigger({ onClick, collapsed }: { onClick: () => void; collapsed?: boolean }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} title={collapsed ? "Search · ⌘K" : undefined}
      style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 8, height: 30, padding: collapsed ? 0 : "0 8px", borderRadius: "var(--r-md)", background: h ? "var(--bg-hover)" : "transparent", color: "var(--text-tertiary)", transition: "background var(--t-quick)" }}>
      <Icon name="search" size={15} />
      {!collapsed && <>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Search</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", gap: 2 }}><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
      </>}
    </button>
  );
}

function NavItem({ item, active, onClick, collapsed }: { item: { id: string; label: string; icon: string; kbd?: readonly string[] }; active: boolean; onClick: () => void; collapsed?: boolean }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} title={collapsed ? item.label : undefined}
      style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 9, width: "100%", height: 28, padding: collapsed ? 0 : "0 10px", borderRadius: "var(--r-md)", textAlign: "left",
        background: active ? "var(--bg-active)" : h ? "var(--bg-hover)" : "transparent", color: active ? "var(--text-primary)" : "var(--text-secondary)", transition: "background var(--t-quick), color var(--t-quick)" }}>
      <Icon name={item.icon as never} size={16} style={{ color: active ? "var(--text-secondary)" : "var(--text-tertiary)" }} />
      {!collapsed && <>
        <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.1px" }}>{item.label}</span>
        <div style={{ flex: 1 }} />
        {h && item.kbd && <span style={{ display: "inline-flex", gap: 2 }}>{item.kbd.map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>}
      </>}
    </button>
  );
}

function SidebarFooter({ collapsed }: { collapsed?: boolean }) {
  const { me, role } = useApp();
  // REAL liveness — green when the gateway reaches Mongo/MCP, red when it can't, amber while checking.
  const { data: health } = useHealth();
  const online = health?.ok;
  const dot = online === true ? "var(--green)" : online === false ? "var(--red)" : "var(--amber)";
  const label = online === true ? "MCP · online" : online === false ? "MCP · offline" : "MCP · …";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 7, height: 28, padding: collapsed ? 0 : "0 10px" }} title={collapsed ? label : undefined}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />
        {!collapsed && <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", fontWeight: 500 }}>{label}</span>}
      </div>
      <button title={collapsed ? `${me.name} · ${role}` : undefined} style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 9, height: 36, padding: collapsed ? 0 : "0 8px", borderRadius: "var(--r-md)" }}>
        <Avatar name={me.name ?? "?"} size={22} tone={role === "manager" ? "ink" : undefined} />
        {!collapsed && <>
          <div style={{ textAlign: "left", lineHeight: 1.2 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)" }}>{me.name}</div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{role}{me.discipline ? " · " + me.discipline : ""}</div>
          </div>
          <div style={{ flex: 1 }} />
          <Icon name="more" size={16} style={{ color: "var(--text-quaternary)" }} />
        </>}
      </button>
    </div>
  );
}
