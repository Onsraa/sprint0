/* sprint0 × Linear — Settings: Routing & autonomy (the Trust Dial). Ported from Misc.jsx `Settings`,
 * wired to the useApp() adapter (dial/applyDial + the active plan's gate tiers). Manager-only edit. */
import { useApp } from "../app/useApp";
import { ViewChrome } from "../components/ViewChrome";
import { Icon } from "../lib/icon";
import { TierBadge } from "./RatifyPanel";

export function Settings() {
  const { dial, applyDial, role, gates } = useApp();
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
            Expert attention is a budget the AI allocates. The Trust Dial scales how aggressively gates auto-pass — it's a sensitivity multiplier, not the sole decider.
          </p>
          <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 20, marginBottom: 20, boxShadow: "var(--shadow-1)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Trust Dial</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 600, letterSpacing: "-1px" }}>{dial}</span>
            </div>
            <input type="range" min="0" max="100" value={dial} disabled={!editable} onChange={(e) => applyDial(+e.target.value)}
              style={{ width: "100%", accentColor: "var(--text-primary)", cursor: editable ? "pointer" : "not-allowed", marginBottom: 6 }} />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>0 · every gate needs a human</span>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>100 · max autonomy</span>
            </div>
            {!editable && <div style={{ fontSize: 11.5, color: "var(--text-quaternary)", marginTop: 10 }}>Only the manager can move the dial.</div>}
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
                A <b style={{ fontWeight: 600 }}>two-expert</b> gate — a high-blast change that conflicts a battle-tested reference — never silently auto-passes, no matter how high the dial. That's the floor the dial can't override.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
