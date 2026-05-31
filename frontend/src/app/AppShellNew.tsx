/* sprint0 — app shell (TanStack Router). Persistent chrome: role-gated nav rail (Link-based) +
 * topbar + the routed <Outlet/>. Login/session gating + the wizard modal live here. Styling is still
 * the current tokens — P3 re-skins this to the Linear design. */
import { Link, Outlet } from "@tanstack/react-router";
import { useApp } from "./AppContext";
import type { Role } from "./types";
import type { Member } from "../lib/api";
import { Icon, type IconName } from "../lib/icon";
import { Login } from "../views/Login";
import { Wizard } from "../wizard/Wizard";
import { Mascot, Sprint0Logo } from "../components/Mascot";
import { CommandPalette } from "../features/palette/CommandPalette";
import { BellPanel } from "../features/notify/BellPanel";
import { useNotificationsWS } from "../features/notify/useNotifications";

export function AppShellNew() {
  const { member, authLoading, wizardOpen, wizardKind } = useApp();
  useNotificationsWS(member?.username); // live notifications WS → invalidates the inbox query

  if (authLoading) return <SessionLoading />;
  if (!member) return <Login />;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--cream)" }}>
      <Sidebar />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar />
        <div style={{ flex: 1, overflow: "auto" }}>
          <div style={{ padding: "24px 32px 40px" }}>
            <Outlet />
          </div>
        </div>
      </main>
      {wizardOpen && <Wizard kind={wizardKind} />}
      <CommandPalette />
    </div>
  );
}

function SessionLoading() {
  return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "var(--cream)" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <Mascot size={64} expression="working" className="wiggle" />
        <div className="mono" style={{ fontSize: 13, color: "var(--ink-mute)" }}>restoring your session…</div>
      </div>
    </div>
  );
}

interface NavItem { to: string; label: string; icon: IconName }
interface NavSection { title?: string; items: NavItem[] }

function navFor(role: Role): NavSection[] {
  if (role === "manager") {
    return [
      { items: [
        { to: "/inbox", label: "Inbox", icon: "inbox" },
        { to: "/work", label: "My Work", icon: "board" },
        { to: "/dashboard", label: "Projects", icon: "projects" },
      ]},
      { title: "Team", items: [
        { to: "/relays", label: "Relay", icon: "relay" },
        { to: "/queue", label: "Ratify", icon: "ratify" },
        { to: "/team", label: "Team", icon: "team" },
        { to: "/profiles", label: "Profiles", icon: "profiles" },
        { to: "/attributions", label: "Merges", icon: "merges" },
        { to: "/codegraph", label: "Code graph", icon: "codegraph" },
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
        { to: "/passport", label: "My Passport", icon: "passport" },
      ]},
    ];
  }
  return [
    { items: [
      { to: "/inbox", label: "Inbox", icon: "inbox" },
      { to: "/work", label: "My Work", icon: "board" },
      { to: "/queue", label: "Ratify", icon: "relay" },
    ]},
    { title: "You", items: [
      { to: "/portfolio", label: "Portfolio", icon: "portfolio" },
      { to: "/passport", label: "My Passport", icon: "passport" },
    ]},
  ];
}

const ROLE_LABEL: Record<Role, string> = {
  manager: "Manager", uiux: "UI/UX lead", backend: "Backend dev", frontend: "Frontend dev", qa: "QA tester",
};
const TRUST_COLOR: Record<string, string> = { high: "var(--positive)", medium: "var(--info)", low: "var(--ink-mute)" };
const navLinkStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10,
  color: "var(--ink-soft)", fontWeight: 600, fontSize: 14, textAlign: "left", width: "100%",
};
const navLinkActive: React.CSSProperties = { background: "var(--orange-soft)", color: "var(--orange-deep)", fontWeight: 700 };

function initialsOf(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function Sidebar() {
  const { member, role, setWizardOpen, setWizardKind, setFeatureProjectId, logout } = useApp();
  const sections = navFor(role);
  const isManager = role === "manager";

  return (
    <aside style={{ width: 240, background: "var(--paper)", borderRight: "1.5px solid var(--line)", padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 4 }}>
        <Sprint0Logo size={18} />
      </div>

      {isManager ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button onClick={() => { setFeatureProjectId(null); setWizardKind("brief"); setWizardOpen(true); }}
            className="btn btn-primary" style={{ justifyContent: "center", padding: "11px 14px", fontSize: 14 }}>+ New project</button>
          <button onClick={() => { setWizardKind("hire"); setWizardOpen(true); }}
            className="btn btn-ghost" style={{ justifyContent: "center", padding: "9px 14px", fontSize: 13 }}>+ Onboard a dev</button>
        </div>
      ) : (
        <div style={{ padding: 12, background: "var(--orange-tint)", borderRadius: 12, border: "1.5px solid var(--orange-soft)" }}>
          <div className="kicker" style={{ color: "var(--orange-deep)" }}>Your discipline</div>
          <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>{ROLE_LABEL[role]}</div>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>ratify your slice · pass the baton</div>
        </div>
      )}

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {sections.map((section, si) => (
          <div key={si}>
            {section.title && (
              <div className="kicker" style={{ marginTop: si === 0 ? 0 : 10, marginBottom: 2, paddingLeft: 12 }}>{section.title}</div>
            )}
            {section.items.map((it) => (
              <Link key={it.to} to={it.to} style={navLinkStyle} activeProps={{ style: { ...navLinkStyle, ...navLinkActive } }}>
                <Icon name={it.icon} size={16} style={{ opacity: 0.85 }} />
                {it.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--positive)", flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>MCP · online</span>
        </div>
        <button onClick={logout} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-mute)", padding: "6px 10px", textAlign: "left", fontWeight: 600 }}
          title={member ? `Signed in as ${member.username}` : undefined}>
          <Icon name="logout" size={14} /> Log out
        </button>
      </div>
    </aside>
  );
}

function TopBar() {
  const { member, role, view } = useApp();
  const titles: Record<string, string> = {
    work: "My Work", dashboard: "Projects", team: "Team", relay: "Ratification relay", relays: "Active relays",
    today: "Today", issue: "Active issue", passport: "My Passport", ratify: "Ratify", queue: "Ratify queue",
    attributions: "Merge attribution", portfolio: "Decision Portfolio", codegraph: "Code Graph", profiles: "Capability profiles", qa: "QA gate", inbox: "Inbox",
  };
  const isManager = role === "manager";
  const m = member as Member;
  const trustC = TRUST_COLOR[m.trust_level] ?? "var(--ink-mute)";

  return (
    <header style={{ padding: "16px 32px", borderBottom: "1.5px solid var(--line)", background: "var(--paper)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
          {ROLE_LABEL[role].toUpperCase()} · {m.name.toUpperCase()}
        </div>
        <div className="display" style={{ fontSize: 22, marginTop: 2 }}>{titles[view] ?? "—"}</div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {!isManager && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "var(--cream-deep)", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: trustC }} />
            <span style={{ color: trustC, textTransform: "capitalize" }}>{m.trust_level} trust</span>
            <span style={{ color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>load {m.load}%</span>
          </div>
        )}
        <BellPanel />
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: isManager ? "var(--orange)" : "var(--info)", color: "var(--paper)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, border: "2px solid var(--ink)" }}>
          {initialsOf(m.name) || "?"}
        </div>
      </div>
    </header>
  );
}
