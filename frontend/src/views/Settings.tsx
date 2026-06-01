/* sprint0 × Linear — Settings: Routing & autonomy (the Trust Dial). Ported from Misc.jsx `Settings`,
 * wired to the useApp() adapter (dial/applyDial + the active plan's gate tiers). Manager-only edit. */
import { useApp, AUTONOMY_MODES } from "../app/useApp";
import { ViewChrome } from "../components/ViewChrome";
import { Icon } from "../lib/icon";
import { TierBadge } from "./RatifyPanel";

export function Settings() {
  const { autonomy, setAutonomy, role, gates } = useApp();
  const editable = role === "manager";
  const counts: Record<string, number> = { auto_pass: 0, one_expert: 0, two_expert: 0 };
  (gates as Array<{ tier?: string }>).forEach((g) => { if (g.tier && counts[g.tier] != null) counts[g.tier]++; });
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["You", "Settings"]} />
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 24px 48px" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 4px" }}>Routing & autonomy</h1>
          <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "0 0 24px", lineHeight: 1.55 }}>
            Expert attention is a budget the AI allocates. <b style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Autonomy</b> sets how aggressively sprint0 auto-ratifies low-risk gates — a posture, not the sole decider. (Per-discipline <i>trust</i> lives on the passport, not here.)
          </p>
          <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 16, marginBottom: 20, boxShadow: "var(--shadow-1)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Autonomy</span>
              <div style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{AUTONOMY_MODES.find((m) => m.id === autonomy)?.label}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {AUTONOMY_MODES.map((m) => {
                const active = m.id === autonomy;
                return (
                  <button key={m.id} disabled={!editable} onClick={() => editable && setAutonomy(m.id)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: "var(--r-md)", textAlign: "left",
                      border: `0.5px solid ${active ? "var(--text-primary)" : "var(--border)"}`,
                      background: active ? "var(--bg-secondary)" : "var(--bg-elevated)",
                      boxShadow: active ? "0 0 0 1px var(--text-primary)" : "none",
                      cursor: editable ? "pointer" : "default", transition: "border-color var(--t-quick), background var(--t-quick)" }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0,
                      background: active ? "var(--ink-fill)" : "transparent", border: active ? "none" : "1.5px solid var(--border-strong)" }}>
                      {active && <Icon name="check" size={11} style={{ color: "#fff" }} />}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</div>
                      <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 1 }}>{m.hint}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            {!editable && <div style={{ fontSize: 11.5, color: "var(--text-quaternary)", marginTop: 12 }}>Only the manager sets autonomy — leads ratify their own gates.</div>}
          </div>
          <div className="kicker" style={{ marginBottom: 10 }}>This plan's gates re-route live</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 24 }}>
            {([["auto_pass", "auto-pass", counts.auto_pass], ["one_expert", "1 expert", counts.one_expert], ["two_expert", "2 experts", counts.two_expert]] as const).map(([t, , n]) => (
              <div key={t} style={{ border: `0.5px solid ${t === "two_expert" ? "var(--text-primary)" : "var(--border)"}`, borderRadius: "var(--r-lg)", padding: 14, textAlign: "center", background: "var(--bg-elevated)" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 600 }}>{n}</div>
                <div style={{ marginTop: 6 }}><TierBadge tier={t} size="sm" /></div>
              </div>
            ))}
          </div>
          <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 16, background: "var(--bg-secondary)" }}>
            <div style={{ display: "flex", gap: 9 }}>
              <Icon name="bolt" size={15} style={{ color: "var(--text-primary)", flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0, lineHeight: 1.55 }}>
                A <b style={{ fontWeight: 600 }}>two-expert</b> gate — a high-blast change that conflicts a battle-tested reference — never silently auto-passes, no matter the posture. That's the floor autonomy can't override.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
