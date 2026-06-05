/* sprint0 — Landing. Minimal header + split hero: title + the passwordless demo-entry card. Honest demo
 * auth: enter as the manager, or pick any of the 5 fixed demo personas directly — no OAuth/email/password.
 * The persona switcher in the nav re-chromes from there. */
import { useNavigate } from "@tanstack/react-router";
import { useLogin } from "../features/auth/useAuth";
import { Avatar, Button } from "../components/ui";
import { Icon, ZeroMark, Logo } from "../lib/icon";
import { DEMO_PERSONAS } from "../app/AppShellNew";

const DEMO_USER = "Onsraa"; // default entry (the manager)

export function Landing() {
  const login = useLogin();
  const navigate = useNavigate();
  const onEnter = (username: string = DEMO_USER) => {
    login.mutate(username, { onSuccess: () => navigate({ to: "/relays" as "/" }) });
  };
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", display: "flex", flexDirection: "column", position: "relative" }}>
      <Backdrop />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: "100vh" }}>
        <LandingHeader onEnter={onEnter} />
        <main style={{ flex: 1, display: "grid", gridTemplateColumns: "1.05fr 0.95fr", maxWidth: 1180, width: "100%", margin: "0 auto", padding: "0 40px", alignItems: "center", gap: 64 }}>
          <HeroCopy />
          <DemoEntry onEnter={onEnter} />
        </main>
        <LandingFooter />
      </div>
    </div>
  );
}

function Backdrop() {
  const line = "rgba(26,23,20,0.05)";
  const fadeMask = "radial-gradient(115% 90% at 50% 8%, #000 0%, #000 38%, transparent 78%)";
  return (
    <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.55,
        backgroundImage: `linear-gradient(to right, ${line} 0.5px, transparent 0.5px), linear-gradient(to bottom, ${line} 0.5px, transparent 0.5px)`,
        backgroundSize: "32px 32px", WebkitMaskImage: fadeMask, maskImage: fadeMask }} />
    </div>
  );
}

function LandingHeader({ onEnter }: { onEnter: () => void }) {
  return (
    <header style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1180, width: "100%", margin: "0 auto", padding: "0 40px" }}>
      <Logo size={20} />
      <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <a href="https://github.com/Onsraa/sprint0" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository"
          style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-md)", color: "var(--text-tertiary)" }}>
          <Icon name="github" size={17} />
        </a>
        <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 8px" }} />
        <Button variant="primary" size="md" onClick={() => onEnter()}>Enter the demo</Button>
      </nav>
    </header>
  );
}

function HeroCopy() {
  return (
    <div style={{ animation: "s0-pop-in var(--t-slow) var(--ease-out) both" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 26, padding: "0 10px 0 6px", borderRadius: "var(--r-pill)", border: "0.5px solid var(--border)", background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)", marginBottom: 26, whiteSpace: "nowrap" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
        <span className="mono" style={{ fontSize: 11, fontWeight: 500, color: "var(--text-tertiary)", letterSpacing: "0.02em" }}>THE RELAY IS LIVE · v2.0</span>
      </div>
      <h1 style={{ fontSize: 52, lineHeight: 1.02, letterSpacing: "-1.6px", fontWeight: 600, margin: 0, color: "var(--text-primary)" }}>
        From brief to shipped,<br />in a single relay.
      </h1>
      <p style={{ fontSize: 17, lineHeight: 1.55, color: "var(--text-tertiary)", maxWidth: 460, margin: "22px 0 0", fontWeight: 400 }}>
        sprint0 turns a brief into a ratified plan, routes every slice to the right discipline, and passes the baton until it ships. The manager orchestrates — each lead ratifies their own slice.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 34 }}>
        {([["34", "issues in flight"], ["5", "disciplines"], ["9 wk", "median ship"]] as const).map(([n, l]) => (
          <div key={l}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.5px" }}>{n}</div>
            <div style={{ fontSize: 12, color: "var(--text-quaternary)", marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Passwordless demo entry: enter as the manager, or pick any of the 5 fixed personas directly. */
function DemoEntry({ onEnter }: { onEnter: (username?: string) => void }) {
  const manager = DEMO_PERSONAS.find((p) => p.role === "manager") ?? DEMO_PERSONAS[0];
  const teammates = DEMO_PERSONAS.filter((p) => p.role !== "manager");
  return (
    <div style={{ background: "var(--bg-elevated)", border: "0.5px solid var(--border)", borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-2)", padding: 24, animation: "s0-pop-in var(--t-slow) var(--ease-out) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <ZeroMark size={22} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Enter the demo workspace</div>
          <div style={{ fontSize: 12, color: "var(--text-quaternary)" }}>Passwordless · pick a persona, no credentials</div>
        </div>
      </div>

      <button onClick={() => onEnter(manager.username)}
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 56, padding: "0 14px", marginTop: 20, borderRadius: "var(--r-md)", background: "var(--ink-fill)", color: "#fff", textAlign: "left" }}>
        <Avatar name={manager.name} size={30} tone="ink" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Enter the demo workspace</div>
          <div className="mono" style={{ fontSize: 11, color: "rgba(255,255,255,0.66)", marginTop: 1 }}>as {manager.name} · manager</div>
        </div>
        <Icon name="arrowRight" size={16} style={{ color: "rgba(255,255,255,0.8)", flexShrink: 0 }} />
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0 10px" }}>
        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>OR ENTER AS</span>
        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {teammates.map((p) => (
          <button key={p.username} onClick={() => onEnter(p.username)}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px", borderRadius: "var(--r-md)", background: "transparent", textAlign: "left", transition: "background var(--t-quick)" }}>
            <Avatar name={p.name} size={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{p.role}{p.discipline ? " · " + p.discipline : ""}</div>
            </div>
            <Icon name="arrowRight" size={15} style={{ color: "var(--text-quaternary)", flexShrink: 0 }} />
          </button>
        ))}
      </div>

      <p style={{ fontSize: 11.5, color: "var(--text-quaternary)", lineHeight: 1.5, marginTop: 16, marginBottom: 0, textAlign: "center" }}>
        5 fixed demo accounts · switch personas anytime from the workspace header.
      </p>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1180, width: "100%", margin: "0 auto", padding: "0 40px", borderTop: "0.5px solid var(--border)" }}>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>© 2026 sprint0 · the relay orchestrator</span>
      <a href="https://github.com/Onsraa/sprint0" target="_blank" rel="noopener noreferrer"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-quaternary)", fontWeight: 500 }}>
        <Icon name="github" size={14} /> GitHub
      </a>
    </footer>
  );
}
