import { useApp } from "../app/AppContext";
import type { Mode } from "../app/types";

/* Bottom-right tweaks drawer: mode toggle + live trust slider.
   Dragging trust updates the dev tier badge in the topbar in real time. */

export function TweaksPanel() {
  const { mode, setMode, devTrust, setDevTrust, setTweaksOpen } = useApp();
  const modes: Mode[] = ["manager", "dev"];
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
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-mute)", marginBottom: 6 }}>Mode</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            background: "var(--cream-deep)",
            borderRadius: 10,
            padding: 3,
            border: "1.5px solid var(--line-strong)",
          }}
        >
          {modes.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "8px 10px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 700,
                background: mode === m ? "var(--paper)" : "transparent",
                color: mode === m ? "var(--ink)" : "var(--ink-mute)",
                boxShadow: mode === m ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                transition: "all 180ms",
              }}
            >
              {m === "manager" ? "Manager" : "Developer"}
            </button>
          ))}
        </div>
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
