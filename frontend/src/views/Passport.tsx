/* sprint0 — §26 Passport: the dev's portable trust profile. A skill radar (per-
   discipline trust as axes: uiux · frontend · backend · devops · qa), seniority,
   load, and a merge-history table. "Per-discipline trust grows on every merge;
   your passport lives in MongoDB — it travels with you between agencies."

   Ported pixel-1:1 from the v5 mockup (app/Passport.jsx). Data source: useApp().
   Identity (name/discipline/username/gitlab/role) comes from useApp().me; the
   numeric radar + merge history + joined come from passportFor(me.username), a
   verbatim local seed of the mock PASSPORTS — see TODO(reconcile) below. */
import { useApp } from "../app/useApp";
import { Icon } from "../lib/icon";
import { Avatar, DiscDot, DISC } from "../components/ui";
import { ViewChrome } from "../components/ViewChrome";

/* ───────── §26 Passport — per-discipline trust radar + merge history ─────────
   trust 0–100 per discipline → tier Apprentice (<45) · Trusted (<75) · Senior (≥75)
   TODO(reconcile): the real member carries trust as per-discipline *string* levels
   (me.trust) + me.history + me.seniority/me.load; the orchestrator derives `p`
   (numeric radar + merges + joined) from those once the backend supplies them. */
const TRUST_AXES = ["uiux", "frontend", "backend", "devops", "qa"];
const trustTier = (v: number) => (v >= 75 ? "Senior" : v >= 45 ? "Trusted" : "Apprentice");
const PASSPORTS: Record<string, any> = {
  rajiv: {
    seniority: "Senior", load: 91, joined: "2024-02",
    trust: { uiux: 18, frontend: 34, backend: 92, devops: 48, qa: 30 },
    merges: [
      { project: "Harbor Logistics", mr: "feat: scoped share tokens", delta: "+0.4", grade: "retro_validated", date: "May 28" },
      { project: "Ledger Pay", mr: "fix: webhook idempotency keys", delta: "+0.3", grade: "prod_survived", date: "May 21" },
      { project: "Ledger Pay", mr: "chore: settlement export signed URL", delta: "+0.2", grade: "shipped", date: "May 9" },
      { project: "Nimbus Mail", mr: "refactor: drop bespoke queue", delta: "+0.3", grade: "prod_survived", date: "Apr 2" },
    ],
  },
  elena: {
    seniority: "Mid", load: 40, joined: "2024-08",
    trust: { uiux: 36, frontend: 30, backend: 22, devops: 16, qa: 71 },
    merges: [
      { project: "Harbor Logistics", mr: "test: a11y focus-order on filters", delta: "+0.3", grade: "shipped", date: "May 24" },
      { project: "Pulse Analytics", mr: "test: export acceptance suite", delta: "+0.2", grade: "prod_survived", date: "Apr 18" },
      { project: "Harbor Logistics", mr: "test: share-link scope assertions", delta: "+0.1", grade: "proposed", date: "May 30" },
    ],
  },
  talia: {
    seniority: "Senior", load: 78, joined: "2024-01",
    trust: { uiux: 58, frontend: 88, backend: 26, devops: 24, qa: 34 },
    merges: [
      { project: "Harbor Logistics", mr: "perf: tile-layer pin clustering", delta: "+0.4", grade: "prod_survived", date: "May 26" },
      { project: "Atlas CMS", mr: "feat: single skeleton primitive", delta: "+0.2", grade: "shipped", date: "May 12" },
    ],
  },
  dario: {
    seniority: "Senior", load: 30, joined: "2024-03",
    trust: { uiux: 14, frontend: 22, backend: 44, devops: 90, qa: 28 },
    merges: [
      { project: "Pulse Analytics", mr: "feat: per-MR preview envs on Fly", delta: "+0.4", grade: "prod_survived", date: "May 20" },
      { project: "Harbor Logistics", mr: "ci: pnpm pipeline cache", delta: "+0.2", grade: "shipped", date: "May 6" },
    ],
  },
  mira: {
    seniority: "Manager", load: 62, joined: "2023-11",
    trust: { uiux: 52, frontend: 60, backend: 40, devops: 38, qa: 44 },
    merges: [
      { project: "Atlas CMS", mr: "feat: optimistic autosave + conflict toast", delta: "+0.2", grade: "shipped", date: "May 15" },
    ],
  },
};
const passportFor = (u: string) => PASSPORTS[u] || PASSPORTS.mira;

/* §12 graded references — earned strength (ported verbatim from the mock) */
const GRADE_META: Record<string, { label: string; step: number; proven: boolean; hint: string }> = {
  proposed:        { label: "Proposed",        step: 1, proven: false, hint: "not yet proven" },
  shipped:         { label: "Shipped",         step: 2, proven: false, hint: "merged, not battle-tested" },
  prod_survived:   { label: "Prod-survived",   step: 3, proven: true,  hint: "survived in production" },
  retro_validated: { label: "Retro-validated", step: 4, proven: true,  hint: "confirmed in retro" },
};

export function Passport() {
  const { me } = useApp();
  // Real passport from the signed-in member: radar (per-discipline trust), seniority, load, joined, and
  // merge history are all adapter-derived from the live member; the scripted seed only previews merges
  // before this account's first real merge (and backs joined for any pre-`joined`-field seeded account).
  const seed = passportFor(me.username);
  const p = {
    trust: me.radar ?? seed.trust,
    seniority: me.seniority ?? seed.seniority,
    load: me.load ?? seed.load,
    joined: me.joined || seed.joined,
    merges: me.merges && me.merges.length ? me.merges : seed.merges,
  };
  const strongest = TRUST_AXES.reduce((a, b) => (p.trust[b] > p.trust[a] ? b : a), TRUST_AXES[0]);

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
                    <DiscDot d={ax} />{DISC[ax]?.label} <span className="mono" style={{ color: "var(--text-quaternary)" }}>{trustTier(p.trust[ax]).slice(0, 1)}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* tiers + caption */}
            <div>
              <div className="kicker" style={{ marginBottom: 10 }}>Trust tier by lane</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 18 }}>
                {TRUST_AXES.map(ax => {
                  const v = p.trust[ax]; const tier = trustTier(v);
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
  const valPts = axes.map((ax, i) => pt(i, R * Math.max(0.04, trust[ax] / 100)));
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
