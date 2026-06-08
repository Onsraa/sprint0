/* sprint0 × Linear — Settings: Routing. NO auto-approval — every gate is ratified by its owner; the AI only
 * RECOMMENDS how much review each gate needs (advisory tiers). The Autonomy dial was removed. */
import { useApp } from "../app/useApp";
import { ViewChrome } from "../components/ViewChrome";
import { Icon } from "../lib/icon";
import { TierBadge } from "./RatifyPanel";

export function Settings() {
  const { gates } = useApp();
  const counts: Record<string, number> = { auto_pass: 0, one_expert: 0, two_expert: 0 };
  (gates as Array<{ tier?: string }>).forEach((g) => { if (g.tier && counts[g.tier] != null) counts[g.tier]++; });
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["You", "Settings"]} />
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 24px 48px" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 4px" }}>Routing</h1>
          <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "0 0 24px", lineHeight: 1.55 }}>
            <b style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Every gate is ratified by its owner — nothing auto-passes.</b> The AI doesn't approve anything; it recommends how much review each gate likely needs, by weighing change-risk against blast-radius. You always have the final say (accept · reject · modify).
          </p>
          <div className="kicker" style={{ marginBottom: 10 }}>This plan — the AI's recommended review depth</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 24 }}>
            {([["auto_pass", counts.auto_pass], ["one_expert", counts.one_expert], ["two_expert", counts.two_expert]] as const).map(([t, n]) => (
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
                A <b style={{ fontWeight: 600 }}>two-expert</b> recommendation — a high-blast change that conflicts a battle-tested reference — is the AI's loudest "look closely". It still waits for a human, like every gate.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
