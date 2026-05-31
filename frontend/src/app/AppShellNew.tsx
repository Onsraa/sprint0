/* sprint0 × Linear — app shell. A 244px nav rail on the warm-grey canvas, then the content as a
 * floating white pane (rounded, hairline). Auth/session gating + the wizard modal + ⌘K live here.
 * Ported from the design system's Shell.jsx; wired to our real router/auth/roster. */
import { useState } from "react";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useMe, useLogout } from "../features/auth/useAuth";
import { useUI } from "../lib/store";
import { useRoleGate } from "../features/nav/nav";
import type { Role } from "./types";
import { Icon, type IconName } from "../lib/icon";
import { Login } from "../views/Login";
import { Wizard } from "../wizard/Wizard";
import { Sprint0Logo } from "../components/Mascot";
import { Avatar, Kbd } from "../components/ui";
import { CommandPalette } from "../features/palette/CommandPalette";
import { useNotificationsWS } from "../features/notify/useNotifications";

export function AppShellNew() {
  const { member, authLoading, role } = useMe();
  const wizardOpen = useUI((s) => s.wizardOpen);
  const wizardKind = useUI((s) => s.wizardKind);
  useNotificationsWS(member?.username);
  useRoleGate(member ? role : null);

  if (authLoading) return <SessionLoading />;
  if (!member) return <Login />;

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-app)" }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, padding: "8px 8px 8px 0" }}>
        <div className="pane">
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
            <Outlet />
          </div>
        </div>
      </div>
      {wizardOpen && <Wizard kind={wizardKind} />}
      <CommandPalette />
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

interface NavItemT { to: string; label: string; icon: IconName }
interface NavSection { title?: string; items: NavItemT[] }

function navFor(role: Role): NavSection[] {
  const common: NavSection = { items: [
    { to: "/inbox", label: "Inbox", icon: "inbox" },
    { to: "/work", label: "My Work", icon: "board" },
    { to: "/dashboard", label: "Projects", icon: "projects" },
  ]};
  if (role === "manager") {
    return [
      common,
      { title: "Team", items: [
        { to: "/relays", label: "Relay", icon: "relay" },
        { to: "/queue", label: "Ratify", icon: "ratify" },
        { to: "/team", label: "Team", icon: "team" },
        { to: "/profiles", label: "Profiles", icon: "profiles" },
        { to: "/codegraph", label: "Code Graph", icon: "codegraph" },
        { to: "/attributions", label: "Merges", icon: "merges" },
      ]},
      { title: "You", items: [{ to: "/portfolio", label: "Portfolio", icon: "portfolio" }] },
    ];
  }
  if (role === "qa") {
    return [
      { items: [
        { to: "/inbox", label: "Inbox", icon: "inbox" },
        { to: "/work", label: "My Work", icon: "board" },
        { to: "/qa", label: "QA gate", icon: "qa" },
      ]},
      { title: "You", items: [
        { to: "/portfolio", label: "Portfolio", icon: "portfolio" },
        { to: "/passport", label: "Passport", icon: "passport" },
      ]},
    ];
  }
  return [
    { items: [
      { to: "/inbox", label: "Inbox", icon: "inbox" },
      { to: "/work", label: "My Work", icon: "board" },
      { to: "/queue", label: "Ratify", icon: "ratify" },
    ]},
    { title: "You", items: [
      { to: "/portfolio", label: "Portfolio", icon: "portfolio" },
      { to: "/passport", label: "Passport", icon: "passport" },
    ]},
  ];
}

const ROLE_LABEL: Record<Role, string> = {
  manager: "manager", uiux: "uiux", backend: "backend", frontend: "frontend", qa: "qa",
};

function Sidebar() {
  const { member, role } = useMe();
  const isManager = role === "manager";
  const setWizardOpen = useUI((s) => s.setWizardOpen);
  const setWizardKind = useUI((s) => s.setWizardKind);
  const setFeatureProjectId = useUI((s) => s.setFeatureProjectId);
  const togglePalette = useUI((s) => s.togglePalette);
  const sections = navFor(role);

  return (
    <aside style={{ width: "var(--nav-w)", flexShrink: 0, height: "100vh", display: "flex", flexDirection: "column", padding: "10px 8px 8px", gap: 4 }}>
      <Workspace />
      <SearchTrigger onClick={togglePalette} />
      {isManager && (
        <button onClick={() => { setFeatureProjectId(null); setWizardKind("brief"); setWizardOpen(true); }}
          style={{ display: "flex", alignItems: "center", gap: 8, height: 32, margin: "2px 0", padding: "0 10px",
            borderRadius: "var(--r-md)", background: "var(--ink-fill)", color: "#fff", fontSize: 13, fontWeight: 500 }}>
          <Icon name="plus" size={15} /> New from brief
        </button>
      )}
      <nav style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 4 }}>
        {sections.map((grp, gi) => (
          <div key={gi} style={{ marginTop: grp.title ? 12 : 0 }}>
            {grp.title && (
              <div style={{ height: 24, display: "flex", alignItems: "center", padding: "0 10px", fontSize: 11, fontWeight: 500, color: "var(--text-quaternary)", letterSpacing: "0.02em" }}>{grp.title}</div>
            )}
            {grp.items.map((it) => <NavItem key={it.to} item={it} />)}
          </div>
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      <SidebarFooter name={member?.name ?? ""} role={role} />
    </aside>
  );
}

function Workspace() {
  const [h, setH] = useState(false);
  return (
    <button onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 9, height: 36, padding: "0 8px", borderRadius: "var(--r-md)", width: "100%",
        background: h ? "var(--bg-hover)" : "transparent", transition: "background var(--t-quick)" }}>
      <Sprint0Logo size={17} />
      <span style={{ fontSize: 12, color: "var(--text-quaternary)", fontWeight: 500 }}>· Studio</span>
      <div style={{ flex: 1 }} />
      <Icon name="chevronDown" size={14} style={{ color: "var(--text-quaternary)" }} />
    </button>
  );
}

function SearchTrigger({ onClick }: { onClick: () => void }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 8px", borderRadius: "var(--r-md)",
        background: h ? "var(--bg-hover)" : "transparent", color: "var(--text-tertiary)", transition: "background var(--t-quick)" }}>
      <Icon name="search" size={15} />
      <span style={{ fontSize: 13, fontWeight: 500 }}>Search</span>
      <div style={{ flex: 1 }} />
      <span style={{ display: "inline-flex", gap: 2 }}><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
    </button>
  );
}

const navItemBase: React.CSSProperties = {
  position: "relative", display: "flex", alignItems: "center", gap: 9, width: "100%", height: 28,
  padding: "0 10px", borderRadius: "var(--r-md)", textAlign: "left",
  color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, letterSpacing: "-0.1px",
  transition: "background var(--t-quick), color var(--t-quick)",
};
function NavItem({ item }: { item: NavItemT }) {
  const [h, setH] = useState(false);
  return (
    <Link to={item.to} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ ...navItemBase, background: h ? "var(--bg-hover)" : "transparent" }}
      activeProps={{ style: { ...navItemBase, background: "var(--bg-active)", color: "var(--text-primary)" } }}>
      <Icon name={item.icon} size={16} style={{ color: "var(--text-tertiary)" }} />
      <span>{item.label}</span>
    </Link>
  );
}

function SidebarFooter({ name, role }: { name: string; role: Role }) {
  const navigate = useNavigate();
  const resetSession = useUI((s) => s.resetSession);
  const doLogout = useLogout();
  const [h, setH] = useState(false);
  const logout = () => { doLogout(); resetSession(); navigate({ to: "/" as "/" }); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, height: 28, padding: "0 10px" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", fontWeight: 500 }}>MCP · online</span>
      </div>
      <button onClick={logout} title="Log out" onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
        style={{ display: "flex", alignItems: "center", gap: 9, height: 36, padding: "0 8px", borderRadius: "var(--r-md)", background: h ? "var(--bg-hover)" : "transparent", transition: "background var(--t-quick)" }}>
        <Avatar name={name} size={22} tone={role === "manager" ? "ink" : undefined} />
        <div style={{ textAlign: "left", lineHeight: 1.2 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)" }}>{name}</div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{ROLE_LABEL[role]}</div>
        </div>
        <div style={{ flex: 1 }} />
        <Icon name="logout" size={15} style={{ color: "var(--text-quaternary)" }} />
      </button>
    </div>
  );
}
