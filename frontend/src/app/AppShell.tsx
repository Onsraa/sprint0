import { useApp } from "./AppContext";
import type { Mode, Role, View } from "./types";
import { Mascot, Sprint0Logo } from "../components/Mascot";
import { SetupGate } from "../views/SetupGate";
import { Dashboard } from "../views/Dashboard";
import { TeamView } from "../views/Team";
import { DevToday, DevIssue, DevPassport } from "../views/dev/DevViews";
import { RelayBoard } from "../views/RelayBoard";
import { RatifyPanel } from "../views/RatifyPanel";
import { QAGate } from "../views/QAGate";
import { Wizard } from "../wizard/Wizard";
import { TweaksPanel } from "../tweaks/TweaksPanel";

export function AppShell() {
  const { setupDone, wizardOpen, wizardKind, tweaksOpen } = useApp();

  if (!setupDone) return <SetupGate />;

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
      {tweaksOpen && <TweaksPanel />}
    </div>
  );
}

interface NavItem {
  id: View;
  label: string;
  icon: string;
}

/** Nav per persona. Manager runs intake/relay; leads ratify + work; QA runs the gate. */
function navFor(role: Role): NavItem[] {
  if (role === "manager") {
    return [
      { id: "dashboard", label: "Projects", icon: "▦" },
      { id: "team", label: "Team", icon: "◉" },
      { id: "relay", label: "Relay", icon: "🎽" },
    ];
  }
  if (role === "qa") {
    return [
      { id: "qa", label: "QA gate", icon: "✓" },
      { id: "today", label: "Today", icon: "◎" },
      { id: "passport", label: "My Passport", icon: "★" },
    ];
  }
  // discipline leads (uiux / backend / frontend)
  return [
    { id: "ratify", label: "Ratify", icon: "🎽" },
    { id: "issue", label: "Active issue", icon: "▶" },
    { id: "today", label: "Today", icon: "◎" },
    { id: "passport", label: "My Passport", icon: "★" },
  ];
}

function Sidebar() {
  const { role, view, setView, setWizardOpen, setWizardKind, setTweaksOpen } = useApp();
  const items = navFor(role);

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

      <RoleSwitcher />

      {role === "manager" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            onClick={() => {
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
        {items.map((it) => (
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
            }}
          >
            <span style={{ fontSize: 16, opacity: 0.8 }}>{it.icon}</span>
            {it.label}
          </button>
        ))}
      </nav>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        <button
          onClick={() => setTweaksOpen(true)}
          style={{ fontSize: 12, color: "var(--ink-mute)", padding: "6px 10px", textAlign: "left", fontWeight: 600 }}
        >
          ⚙ Tweaks
        </button>
        <div style={{ padding: 12, background: "var(--cream)", borderRadius: 12, border: "1.5px solid var(--line-strong)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Mascot size={28} expression="happy" />
            <div style={{ fontSize: 12, fontWeight: 700 }}>baton is awake</div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              fontSize: 10,
              color: "var(--ink-mute)",
              fontFamily: "var(--font-mono)",
            }}
          >
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--positive)" }} />
            MCP · online
          </div>
        </div>
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

const ROLE_ORDER: Role[] = ["manager", "uiux", "backend", "frontend", "qa"];

function RoleSwitcher() {
  const { role, setRole } = useApp();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="kicker" style={{ fontSize: 10 }}>
        Acting as
      </div>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        style={{
          padding: "9px 12px",
          borderRadius: 10,
          border: "1.5px solid var(--line-strong)",
          background: "var(--cream-deep)",
          fontWeight: 700,
          fontSize: 13,
          color: "var(--ink)",
          fontFamily: "inherit",
          outline: "none",
          cursor: "pointer",
        }}
      >
        {ROLE_ORDER.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
    </div>
  );
}

function TopBar() {
  const { role, view, devTrust } = useApp();
  const titles: Partial<Record<View, string>> = {
    dashboard: "Projects",
    team: "Team",
    relay: "Ratification relay",
    today: "Today",
    issue: "Active issue",
    passport: "My Passport",
    ratify: "Ratify",
    qa: "QA gate",
  };
  const isManager = role === "manager";
  const tier =
    devTrust < 35
      ? { t: "Apprentice", c: "#888" }
      : devTrust < 75
        ? { t: "Trusted", c: "var(--info)" }
        : { t: "Senior", c: "var(--positive)" };

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
          {isManager ? "AGENCY · DUSK STUDIO" : `${ROLE_LABEL[role].toUpperCase()} · MARIA R.`}
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
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: tier.c }} />
            <span style={{ color: tier.c }}>{tier.t}</span>
            <span style={{ color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>{devTrust}</span>
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
          {isManager ? "EM" : "MR"}
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
        {view === "dashboard" && <Dashboard />}
        {view === "team" && <TeamView />}
        {view === "relay" && <RelayBoard />}
      </div>
    );
  }
  return (
    <div style={{ padding: "24px 32px 40px" }}>
      {view === "today" && <DevToday />}
      {view === "issue" && <DevIssue />}
      {view === "passport" && <DevPassport />}
      {view === "ratify" && <RatifyPanel />}
      {view === "qa" && <QAGate />}
    </div>
  );
}
