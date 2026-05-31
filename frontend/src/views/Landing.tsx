/* sprint0 — Landing (ported from the v4 design Landing.jsx). Minimal header + split hero: title +
 * the dynamic connexion card (GitLab / email → password). For the demo every path logs in as the
 * manager ("Try Demo"); the persona switcher in the nav rail re-chromes from there. */
import { useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useLogin } from "../features/auth/useAuth";
import { Button } from "../components/ui";
import { Icon, ZeroMark, Logo } from "../lib/icon";

const DEMO_USER = "Onsraa"; // the manager persona — Try Demo drops you here

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
  const [mode, setMode] = useState<"choose" | "email" | "password">("choose");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  return (
    <div style={{ background: "var(--bg-elevated)", border: "0.5px solid var(--border)", borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-2)", padding: 28, animation: "s0-pop-in var(--t-slow) var(--ease-out) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <ZeroMark size={22} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            {mode === "choose" ? "Pick up the baton" : mode === "email" ? "Continue with email" : "Welcome back"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-quaternary)" }}>{mode === "password" ? email : "Sign in to your workspace"}</div>
        </div>
      </div>
      <div style={{ marginTop: 22 }}>
        {mode === "choose" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, animation: "s0-fade-in var(--t-reg) both" }}>
            <AuthBtn icon="gitlab" label="Continue with GitLab" onClick={onEnter} primary />
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "6px 0" }}>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>OR</span>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
            <AuthBtn icon="mail" label="Continue with email" onClick={() => setMode("email")} />
          </div>
        )}
        {mode === "email" && (
          <div style={{ animation: "s0-panel-in var(--t-reg) var(--ease-out) both" }}>
            <Field label="Work email">
              <input autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@studio.com"
                onKeyDown={(e) => e.key === "Enter" && validEmail && setMode("password")} style={inputStyle} />
            </Field>
            <Button variant="primary" size="lg" style={{ width: "100%", marginTop: 14, opacity: validEmail ? 1 : 0.45 }} disabled={!validEmail} onClick={() => setMode("password")} iconRight="arrowRight">Continue</Button>
            <BackRow onClick={() => setMode("choose")} />
          </div>
        )}
        {mode === "password" && (
          <div style={{ animation: "s0-panel-in var(--t-reg) var(--ease-out) both" }}>
            <Field label="Password" right={<a href="#" style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 500 }}>Forgot?</a>}>
              <input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••••"
                onKeyDown={(e) => e.key === "Enter" && pw.length >= 1 && onEnter()} style={inputStyle} />
            </Field>
            <Button variant="primary" size="lg" style={{ width: "100%", marginTop: 14, opacity: pw.length ? 1 : 0.45 }} disabled={!pw.length} onClick={onEnter} iconRight="arrowRight">Sign in</Button>
            <BackRow onClick={() => setMode("email")} />
          </div>
        )}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--text-quaternary)", lineHeight: 1.5, marginTop: 20, marginBottom: 0, textAlign: "center" }}>
        By continuing you agree to the <a href="#" style={{ color: "var(--text-tertiary)", textDecoration: "underline" }}>Terms</a> & <a href="#" style={{ color: "var(--text-tertiary)", textDecoration: "underline" }}>Privacy</a>.
      </p>
    </div>
  );
}

function AuthBtn({ icon, label, onClick, primary }: { icon: "gitlab" | "mail"; label: string; onClick: () => void; primary?: boolean }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, height: 42, borderRadius: "var(--r-md)", fontSize: 13.5, fontWeight: 500,
        background: primary ? (h ? "var(--ink-fill-hover)" : "var(--ink-fill)") : (h ? "var(--bg-hover)" : "var(--bg-elevated)"),
        color: primary ? "#fff" : "var(--text-secondary)", border: primary ? "none" : "0.5px solid var(--border-strong)",
        boxShadow: primary ? "none" : "var(--shadow-1)", transition: "background var(--t-quick)" }}>
      {icon && <Icon name={icon} size={16} />}
      {label}
    </button>
  );
}
function Field({ label, right, children }: { label: string; right?: ReactNode; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>{label}</span>
        {right}
      </div>
      {children}
    </label>
  );
}
function BackRow({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 12.5, fontWeight: 500, color: "var(--text-tertiary)" }}>
      <Icon name="chevronLeft" size={13} /> Other options
    </button>
  );
}
const inputStyle: CSSProperties = {
  width: "100%", height: 42, padding: "0 12px", fontSize: 14, color: "var(--text-primary)",
  background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)",
  outline: "none", boxShadow: "var(--shadow-inset)",
};

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
