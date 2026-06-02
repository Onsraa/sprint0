/* sprint0 — Landing. Minimal header + split hero: title + a single demo-entry card. This is a demo
 * build, so login is honest: "Enter the demo workspace" logs you in as the manager ("Onsraa") and the
 * persona switcher in the nav rail re-chromes from there. No fake OAuth / email / password screens. */
import { useNavigate } from "@tanstack/react-router";
import { useLogin } from "../features/auth/useAuth";
import { Button } from "../components/ui";
import { ZeroMark, Logo } from "../lib/icon";

const DEMO_USER = "Onsraa"; // the manager persona — Enter the demo workspace drops you here

export function Landing() {
  const login = useLogin();
  const navigate = useNavigate();
  const onEnter = () => {
    login.mutate(DEMO_USER, { onSuccess: () => navigate({ to: "/inbox" as "/" }) });
  };
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)", display: "flex", flexDirection: "column", position: "relative" }}>
      <Backdrop />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: "100vh" }}>
        <LandingHeader onEnter={onEnter} />
        <main style={{ flex: 1, display: "grid", gridTemplateColumns: "1.05fr 0.95fr", maxWidth: 1180, width: "100%", margin: "0 auto", padding: "0 40px", alignItems: "center", gap: 64 }}>
          <HeroCopy />
          <ConnexionCard onEnter={onEnter} />
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
        {["Product", "Relay", "Docs", "Changelog"].map((l) => (
          <a key={l} href="#" style={{ padding: "0 12px", height: 30, display: "inline-flex", alignItems: "center", fontSize: 13, fontWeight: 500, color: "var(--text-tertiary)" }}>{l}</a>
        ))}
        <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 8px" }} />
        <button onClick={onEnter} style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", padding: "0 10px", height: 30 }}>Log in</button>
        <Button variant="primary" size="md" onClick={onEnter}>Try Demo</Button>
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

function ConnexionCard({ onEnter }: { onEnter: () => void }) {
  return (
    <div style={{ background: "var(--bg-elevated)", border: "0.5px solid var(--border)", borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-2)", padding: 28, animation: "s0-pop-in var(--t-slow) var(--ease-out) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <ZeroMark size={22} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Pick up the baton</div>
          <div style={{ fontSize: 12, color: "var(--text-quaternary)" }}>Demo workspace</div>
        </div>
      </div>
      <div style={{ marginTop: 22 }}>
        <Button variant="primary" size="lg" style={{ width: "100%" }} onClick={onEnter} iconRight="arrowRight">
          Enter the demo workspace
        </Button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-quaternary)", lineHeight: 1.5, marginTop: 16, marginBottom: 0, textAlign: "center" }}>
        Explore as the manager; switch personas from the nav once inside. No account needed.
      </p>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1180, width: "100%", margin: "0 auto", padding: "0 40px", borderTop: "0.5px solid var(--border)" }}>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>© 2026 sprint0 · the relay orchestrator</span>
      <div style={{ display: "flex", gap: 18 }}>
        {["Status", "Security", "Careers"].map((l) => <a key={l} href="#" style={{ fontSize: 12, color: "var(--text-quaternary)", fontWeight: 500 }}>{l}</a>)}
      </div>
    </footer>
  );
}
