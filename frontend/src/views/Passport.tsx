/* sprint0 — §26 Passport: the dev's portable trust profile. A skill radar (per-
   discipline trust as axes: uiux · frontend · backend · devops · qa) and a
   merge-history table. "Per-discipline trust grows on every merge; your passport
   lives in MongoDB — it travels with you between agencies."

   100% live: the radar derives from the member's REAL per-discipline trust tiers
   and the table from their REAL merge history (record_merge stamps project + date).
   The old PASSPORTS mock seed is gone — a fresh account shows an honest empty state. */
import { useApp } from "../app/useApp";
import { Icon } from "../lib/icon";
import { Avatar, DiscDot, DISC } from "../components/ui";
import { ViewChrome } from "../components/ViewChrome";
import { GRADE_META } from "../lib/grade";

/* trust 0–100 per discipline → tier Apprentice (<45) · Trusted (<75) · Senior (≥75) */
const TRUST_AXES = ["uiux", "frontend", "backend", "devops", "qa"];
const trustTier = (v: number) => (v >= 75 ? "Senior" : v >= 45 ? "Trusted" : "Apprentice");

export function Passport() {
  const { me } = useApp();
  // adapter-derived from the live member: radar = numeric per-discipline trust (uncovered lanes ≈ 0),
  // merges = the real history rows. No mock fallback — empty is empty.
  const p = {
    trust: (me.radar ?? {}) as Record<string, number>,
    merges: (me.merges ?? []) as any[],
  };
  const strongest = TRUST_AXES.reduce((a, b) => ((p.trust[b] ?? 0) > (p.trust[a] ?? 0) ? b : a), TRUST_AXES[0]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["You", "Passport"]} />
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "26px 28px 56px" }}>
          {/* identity */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
            <Avatar name={me.name} size={56} tone={me.role === "manager" ? "ink" : undefined} ring />
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px", margin: 0 }}>{me.name}</h1>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                {me.discipline && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-tertiary)" }}><DiscDot d={me.discipline} />{DISC[me.discipline]?.label}</span>}
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text-quaternary)", display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="gitlab" size={12} />{me.gitlab || me.username}</span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 22, alignItems: "start" }}>
            {/* radar */}
            <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: "18px 16px 8px", boxShadow: "var(--shadow-1)", background: "var(--bg-elevated)" }}>
              <div className="kicker" style={{ marginBottom: 4 }}>Per-discipline trust</div>
              <Radar trust={p.trust} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", padding: "4px 0 8px" }}>
                {TRUST_AXES.map(ax => (
                  <span key={ax} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-tertiary)" }}>
                    <DiscDot d={ax} />{DISC[ax]?.label} <span className="mono" style={{ color: "var(--text-quaternary)" }}>{trustTier(p.trust[ax] ?? 0).slice(0, 1)}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* tiers + caption */}
            <div>
              <div className="kicker" style={{ marginBottom: 10 }}>Trust tier by lane</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 18 }}>
                {TRUST_AXES.map(ax => {
                  const v = p.trust[ax] ?? 0; const tier = trustTier(v);
                  return (
                    <div key={ax} style={{ display: "flex", alignItems: "center", gap: 11, height: 38, padding: "0 4px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, width: 96 }}><DiscDot d={ax} /><span style={{ fontSize: 12.5, color: ax === strongest ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: ax === strongest ? 600 : 450 }}>{DISC[ax]?.label}</span></span>
                      <span style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--bg-tertiary)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${v}%`, borderRadius: 3, background: ax === strongest ? "var(--text-primary)" : "var(--text-tertiary)" }} />
                      </span>
                      <span style={{ width: 78, textAlign: "right", fontSize: 12, fontWeight: 500, color: tier === "Senior" ? "var(--text-primary)" : "var(--text-tertiary)" }}>{tier}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* merge history */}
          <div className="kicker" style={{ margin: "28px 0 10px" }}>Merge history · trust deltas</div>
          <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
            <div style={{ display: "flex", alignItems: "center", height: 30, padding: "0 14px", background: "var(--bg-secondary)", borderBottom: "0.5px solid var(--border-subtle)" }}>
              <span className="kicker" style={{ flex: 1, fontSize: 10 }}>Merge request</span>
              <span className="kicker" style={{ width: 140, fontSize: 10 }}>Project</span>
              <span className="kicker" style={{ width: 130, fontSize: 10 }}>Strength</span>
              <span className="kicker" style={{ width: 56, fontSize: 10, textAlign: "right" }}>Trust</span>
              <span className="kicker" style={{ width: 56, fontSize: 10, textAlign: "right" }}>Date</span>
            </div>
            {!p.merges.length && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 56, fontSize: 12.5, color: "var(--text-tertiary)" }}>
                No merges yet — trust grows on every merge.
              </div>
            )}
            {p.merges.map((m: any, i: number) => (
              <div key={i} style={{ display: "flex", alignItems: "center", height: 44, padding: "0 14px", borderTop: i ? "0.5px solid var(--border-subtle)" : "none" }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="merges" size={13} style={{ color: "var(--text-quaternary)" }} />
                  <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.mr}</span>
                </span>
                <span style={{ width: 140, fontSize: 12, color: "var(--text-tertiary)" }}>{m.project}</span>
                <span style={{ width: 130 }}><GradeChip grade={m.grade} /></span>
                <span style={{ width: 56, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--green)" }}>{m.delta}</span>
                <span style={{ width: 56, textAlign: "right" }} className="mono"><span style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{m.date}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* SVG skill radar — 5 axes, grid rings, filled trust polygon. */
function Radar({ trust }: { trust: Record<string, number> }) {
  const axes = TRUST_AXES;
  const n = axes.length;
  const cx = 140, cy = 132, R = 96;
  const angle = (i: number) => (-90 + i * 360 / n) * Math.PI / 180;
  const pt = (i: number, r: number) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  const ringPath = (frac: number) => axes.map((_, i) => { const [x, y] = pt(i, R * frac); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ") + " Z";
  const valPts = axes.map((ax, i) => pt(i, R * Math.max(0.04, (trust[ax] ?? 0) / 100)));
  const valPath = valPts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";
  return (
    <svg viewBox="0 0 280 250" style={{ width: "100%", height: "auto", display: "block" }}>
      {[0.25, 0.5, 0.75, 1].map(f => (
        <path key={f} d={ringPath(f)} fill="none" stroke="var(--border)" strokeWidth="0.75" />
      ))}
      {axes.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" strokeWidth="0.75" />; })}
      <path d={valPath} fill="rgba(31,27,23,0.10)" stroke="var(--text-primary)" strokeWidth="1.5" strokeLinejoin="round" />
      {valPts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill="var(--bg-elevated)" stroke="var(--text-primary)" strokeWidth="1.5" />)}
      {axes.map((ax, i) => {
        const [x, y] = pt(i, R + 16);
        const anchor = Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end";
        return <text key={ax} x={x} y={y + 3} textAnchor={anchor} style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, fill: "var(--text-tertiary)", letterSpacing: "0.02em" }}>{DISC[ax]?.label}</text>;
      })}
    </svg>
  );
}

/* §12 grade chip — earned-strength ticks (ported verbatim from the mock Bell.jsx) */
function GradeChip({ grade, showLabel = true }: { grade?: string; showLabel?: boolean }) {
  const m = GRADE_META[grade ?? "proposed"] || GRADE_META.proposed;
  return (
    <span title={`${m.label} · ${m.hint}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 18,
      padding: "0 7px 0 6px", borderRadius: "var(--r-sm)", background: "var(--bg-secondary)",
      border: "0.5px solid var(--border)" }}>
      <span style={{ display: "inline-flex", gap: 2 }}>
        {[1, 2, 3, 4].map(i => (
          <span key={i} style={{ width: 4, height: 9, borderRadius: 1,
            background: i <= m.step ? (m.proven ? "var(--text-primary)" : "var(--text-quaternary)") : "var(--bg-tertiary)" }} />
        ))}
      </span>
      {showLabel && <span style={{ fontSize: 10.5, fontWeight: 500, color: m.proven ? "var(--text-secondary)" : "var(--text-tertiary)" }}>{m.label}</span>}
    </span>
  );
}
