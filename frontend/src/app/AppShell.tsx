import { useApp } from "./AppContext";
import type { Mode, Role, View } from "./types";
import { WorkHub } from "../views/work/WorkHub";
import type { Member } from "../lib/api";
import { Mascot, Sprint0Logo } from "../components/Mascot";
import { Login } from "../views/Login";
import { Dashboard } from "../views/Dashboard";
import { TeamView } from "../views/Team";
import { DevToday, DevIssue, DevPassport } from "../views/dev/DevViews";
import { RelayBoard } from "../views/RelayBoard";
import { RatifyPanel } from "../views/RatifyPanel";
import { RatifyQueue } from "../views/RatifyQueue";
import { RelayPortfolio } from "../views/RelayPortfolio";
import { Portfolio } from "../views/Portfolio";
import { Attributions } from "../views/Attributions";
import { QAGate } from "../views/QAGate";
import { Wizard } from "../wizard/Wizard";

export function AppShell() {
  const { member, authLoading, wizardOpen, wizardKind } = useApp();

  if (authLoading) return <SessionLoading />;
  if (!member) return <Login />;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--cream)" }}>
      <Sidebar />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopBar />
        <div style={{ flex: 1, overflow: "auto" }}>
          <MainView />
        </div>
      </main>
      {wizardOpen && <Wizard kind={wizardKind} />}
    </div>
  );
}

function SessionLoading() {
  return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "var(--cream)" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <Mascot size={64} expression="working" className="wiggle" />
        <div className="mono" style={{ fontSize: 13, color: "var(--ink-mute)" }}>
          restoring your session…
        </div>
      </div>
    </div>
  );
}

interface NavItem { id: View; label: string; icon: string; }
interface NavSection { title?: string; items: NavItem[]; }

/** Nav per persona. Manager runs intake/relay; leads ratify + work; QA runs the gate. */
function navFor(role: Role): NavSection[] {
  if (role === "manager") {
    return [
      { items: [
        { id: "work", label: "My Work", icon: "▦" },
        { id: "dashboard", label: "Projects", icon: "◳" },
      ]},
      { title: "Team", items: [
        { id: "relays", label: "Relay", icon: "🎽" },
        { id: "queue", label: "Ratify", icon: "✓" },
        { id: "team", label: "Team", icon: "◉" },
        { id: "attributions", label: "Merges", icon: "⇄" },
      ]},
      { title: "You", items: [
        { id: "portfolio", label: "Portfolio", icon: "🗂" },
      ]},
    ];
  }
  if (role === "qa") {
    return [
      { items: [
        { id: "work", label: "My Work", icon: "▦" },
        { id: "qa", label: "QA gate", icon: "✓" },
      ]},
      { title: "You", items: [
        { id: "portfolio", label: "Portfolio", icon: "🗂" },
        { id: "passport", label: "My Passport", icon: "★" },
      ]},
    ];
  }
  // discipline leads (uiux / backend / frontend)
  return [
    { items: [
      { id: "work", label: "My Work", icon: "▦" },
      { id: "queue", label: "Ratify", icon: "🎽" },
    ]},
    { title: "You", items: [
      { id: "portfolio", label: "Portfolio", icon: "🗂" },
      { id: "passport", label: "My Passport", icon: "★" },
    ]},
  ];
}

function Sidebar() {
  const { member, role, view, setView, setWizardOpen, setWizardKind, setFeatureProjectId, logout } = useApp();
  const sections = navFor(role);
  const isManager = role === "manager";

  return (
    <aside
      style={{
        width: 240,
        background: "var(--paper)",
        borderRight: "1.5px solid var(--line)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 4 }}>
        <Sprint0Logo size={18} />
      </div>

      {isManager ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            onClick={() => {
              setFeatureProjectId(null);
              setWizardKind("brief");
              setWizardOpen(true);
            }}
            className="btn btn-primary"
            style={{ justifyContent: "center", padding: "11px 14px", fontSize: 14 }}
          >
            + New project
          </button>
          <button
            onClick={() => {
              setWizardKind("hire");
              setWizardOpen(true);
            }}
            className="btn btn-ghost"
            style={{ justifyContent: "center", padding: "9px 14px", fontSize: 13 }}
          >
            + Onboard a dev
          </button>
        </div>
      ) : (
        <div
          style={{
            padding: 12,
            background: "var(--orange-tint)",
            borderRadius: 12,
            border: "1.5px solid var(--orange-soft)",
          }}
        >
          <div className="kicker" style={{ color: "var(--orange-deep)" }}>
            Your discipline
          </div>
          <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>{ROLE_LABEL[role]}</div>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>ratify your slice · pass the baton</div>
        </div>
      )}

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {sections.map((section, si) => (
          <div key={si}>
            {section.title && (
              <div
                className="kicker"
                style={{ marginTop: si === 0 ? 0 : 10, marginBottom: 2, paddingLeft: 12 }}
              >
                {section.title}
              </div>
            )}
            {section.items.map((it) => (
              <button
                key={it.id}
                onClick={() => setView(it.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: view === it.id ? "var(--orange-soft)" : "transparent",
                  color: view === it.id ? "var(--orange-deep)" : "var(--ink-soft)",
                  fontWeight: view === it.id ? 700 : 600,
                  fontSize: 14,
                  textAlign: "left",
                  transition: "all 120ms",
                  width: "100%",
                }}
              >
                <span style={{ fontSize: 16, opacity: 0.8 }}>{it.icon}</span>
                {it.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--positive)", flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
            MCP · online
          </span>
        </div>
        <button
          onClick={logout}
          style={{ fontSize: 12, color: "var(--ink-mute)", padding: "6px 10px", textAlign: "left", fontWeight: 600 }}
          title={member ? `Signed in as ${member.username}` : undefined}
        >
          ⏻ Log out
        </button>
      </div>
    </aside>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  manager: "Manager",
  uiux: "UI/UX lead",
  backend: "Backend dev",
  frontend: "Frontend dev",
  qa: "QA tester",
};

const TRUST_COLOR: Record<string, string> = {
  high: "var(--positive)",
  medium: "var(--info)",
  low: "var(--ink-mute)",
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function TopBar() {
  const { member, role, view } = useApp();
  const titles: Partial<Record<View, string>> = {
    work: "My Work",
    dashboard: "Projects",
    team: "Team",
    relay: "Ratification relay",
    relays: "Active relays",
    today: "Today",
    issue: "Active issue",
    passport: "My Passport",
    ratify: "Ratify",
    queue: "Ratify queue",
    attributions: "Merge attribution",
    portfolio: "Decision Portfolio",
    qa: "QA gate",
  };
  const isManager = role === "manager";
  const m = member as Member;
  const trustC = TRUST_COLOR[m.trust_level] ?? "var(--ink-mute)";

  return (
    <header
      style={{
        padding: "16px 32px",
        borderBottom: "1.5px solid var(--line)",
        background: "var(--paper)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-mute)",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            letterSpacing: "0.08em",
            whiteSpace: "nowrap",
          }}
        >
          {ROLE_LABEL[role].toUpperCase()} · {m.name.toUpperCase()}
        </div>
        <div className="display" style={{ fontSize: 22, marginTop: 2 }}>
          {titles[view] ?? "—"}
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {!isManager && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: "var(--cream-deep)",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: trustC }} />
            <span style={{ color: trustC, textTransform: "capitalize" }}>{m.trust_level} trust</span>
            <span style={{ color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>load {m.load}%</span>
          </div>
        )}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: isManager ? "var(--orange)" : "var(--info)",
            color: "var(--paper)",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 14,
            border: "2px solid var(--ink)",
          }}
        >
          {initialsOf(m.name) || "?"}
        </div>
      </div>
    </header>
  );
}

function MainView() {
  const { mode, view } = useApp();
  const m: Mode = mode;
  if (m === "manager") {
    return (
      <div style={{ padding: "24px 32px 40px" }}>
        {view === "work" && <WorkHub />}
        {view === "dashboard" && <Dashboard />}
        {view === "team" && <TeamView />}
        {view === "relays" && <RelayPortfolio />}
        {view === "relay" && <RelayBoard />}
        {view === "queue" && <RatifyQueue />}
        {view === "ratify" && <RatifyPanel />}
        {view === "attributions" && <Attributions />}
        {view === "portfolio" && <Portfolio />}
      </div>
    );
  }
  return (
    <div style={{ padding: "24px 32px 40px" }}>
      {view === "work" && <WorkHub />}
      {view === "today" && <DevToday />}
      {view === "issue" && <DevIssue />}
      {view === "passport" && <DevPassport />}
      {view === "queue" && <RatifyQueue />}
      {view === "ratify" && <RatifyPanel />}
      {view === "qa" && <QAGate />}
      {view === "portfolio" && <Portfolio />}
    </div>
  );
}
