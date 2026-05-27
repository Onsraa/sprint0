import { useApp } from "../app/AppContext";
import type { Role } from "../app/types";

/* Bottom-right tweaks drawer: role switcher + live trust slider.
   Dragging trust updates the dev tier badge in the topbar in real time. */

const ROLE_LABEL: Record<Role, string> = {
  manager: "Manager",
  uiux: "UI/UX lead",
  backend: "Backend dev",
  frontend: "Frontend dev",
  qa: "QA tester",
};
const ROLE_ORDER: Role[] = ["manager", "uiux", "backend", "frontend", "qa"];

export function TweaksPanel() {
  const { role, setRole, devTrust, setDevTrust, setTweaksOpen } = useApp();
  const tier =
    devTrust < 35
      ? { t: "Apprentice", c: "#888" }
      : devTrust < 75
        ? { t: "Trusted", c: "var(--info)" }
        : { t: "Senior", c: "var(--positive)" };

  return (
    <div
      className="card pop-in"
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 90,
        width: 300,
        padding: 18,
        background: "var(--paper)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div className="kicker">⚙ Tweaks</div>
        <button
          onClick={() => setTweaksOpen(false)}
          aria-label="Close tweaks"
          style={{ fontSize: 16, color: "var(--ink-mute)", fontWeight: 700 }}
        >
          ✕
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-mute)", marginBottom: 6 }}>Acting as</div>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          style={{
            width: "100%",
            padding: "9px 12px",
            borderRadius: 10,
            border: "1.5px solid var(--line-strong)",
            background: "var(--cream-deep)",
            fontWeight: 700,
            fontSize: 12,
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

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-mute)" }}>Your trust</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: tier.c }} />
            <span style={{ color: tier.c }}>{tier.t}</span>
            <span style={{ color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>{devTrust}</span>
          </div>
        </div>
        <input
          className="trust-slider"
          type="range"
          min={0}
          max={100}
          value={devTrust}
          onChange={(e) => setDevTrust(Number(e.target.value))}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--ink-faint)", fontWeight: 700, marginTop: 6, fontFamily: "var(--font-mono)" }}>
          <span>APPRENTICE</span>
          <span>TRUSTED</span>
          <span>SENIOR</span>
        </div>
      </div>
    </div>
  );
}
