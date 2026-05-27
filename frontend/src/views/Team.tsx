import { useApp } from "../app/AppContext";

/* Team roster: dev cards w/ trust tier, skills, click → passport */

interface Dev {
  i: string;
  n: string;
  role: string;
  trust: number;
  color: string;
  projects: string[];
  load: number;
  top: string[];
  onboarded: string;
  isNew?: boolean;
}

const TEAM: Dev[] = [
  { i: "MR", n: "Maria R.", role: "FE lead", trust: 86, color: "#F4511E", projects: ["luxe-real-estate", "courier-track"], load: 60, top: ["Frontend", "Velocity", "Product"], onboarded: "2y ago" },
  { i: "TS", n: "Tomás S.", role: "FS", trust: 78, color: "#2A6FDB", projects: ["luxe-real-estate", "fintech-jr-v2"], load: 35, top: ["Backend", "Data"], onboarded: "1y ago" },
  { i: "KB", n: "Kira B.", role: "BE", trust: 91, color: "#0F8E5C", projects: ["fintech-jr-v2", "luxe-real-estate"], load: 80, top: ["Data", "DevOps", "Backend"], onboarded: "3y ago" },
  { i: "AS", n: "Alex S.", role: "FS", trust: 64, color: "#7C3AED", projects: ["courier-track"], load: 25, top: ["Frontend", "Backend"], onboarded: "6mo ago" },
  { i: "JL", n: "Juno L.", role: "Mobile", trust: 72, color: "#D97706", projects: ["courier-track", "luxe-real-estate"], load: 90, top: ["Mobile", "Frontend"], onboarded: "1y ago" },
  { i: "NP", n: "Nia P.", role: "FE", trust: 22, color: "var(--ink-mute)", projects: [], load: 10, top: ["Frontend"], onboarded: "3d ago", isNew: true },
];

export function TeamView() {
  const { setActiveDev } = useApp();

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <div className="display" style={{ fontSize: 28, marginBottom: 6 }}>The team.</div>
          <p style={{ color: "var(--ink-soft)", maxWidth: 520, margin: 0, fontSize: 14 }}>
            Live passports. Trust grows with every successful merge. New hires start at <b>Apprentice</b> and earn their way up.
          </p>
        </div>
        <button onClick={() => setActiveDev("new")} className="btn btn-primary btn-sm">+ Onboard a dev</button>
      </div>

      {/* Tier strips */}
      <TierStrip name="Senior" range="75+" devs={TEAM.filter((d) => d.trust >= 75)} color="var(--positive)" />
      <TierStrip name="Trusted" range="35–74" devs={TEAM.filter((d) => d.trust >= 35 && d.trust < 75)} color="var(--info)" />
      <TierStrip name="Apprentice" range="<35" devs={TEAM.filter((d) => d.trust < 35)} color="var(--ink-mute)" />
    </div>
  );
}

function TierStrip({ name, range, devs, color }: { name: string; range: string; devs: Dev[]; color: string }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
        <div className="display" style={{ fontSize: 20 }}>{name}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", fontWeight: 700 }}>trust {range} · {devs.length} {devs.length === 1 ? "dev" : "devs"}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {devs.map((d) => <DevCard key={d.i} d={d} />)}
        {devs.length === 0 && (
          <div className="card-soft" style={{ padding: 20, textAlign: "center", color: "var(--ink-mute)", fontSize: 13, fontStyle: "italic", border: "1.5px dashed var(--line-strong)" }}>
            no devs at this tier
          </div>
        )}
      </div>
    </div>
  );
}

function DevCard({ d }: { d: Dev }) {
  return (
    <div className="card-soft" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%",
          background: d.color, color: "var(--paper)", border: "2px solid var(--ink)",
          display: "grid", placeItems: "center", fontWeight: 800, flexShrink: 0,
        }}>{d.i}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.n}</div>
            {d.isNew && <span className="chip" style={{ fontSize: 9, padding: "1px 6px", background: "var(--orange-soft)", borderColor: "var(--orange)", color: "var(--orange-deep)" }}>NEW</span>}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{d.role} · {d.onboarded}</div>
        </div>
        <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: "var(--orange)" }}>{d.trust}</div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4, color: "var(--ink-mute)", fontWeight: 700 }}>
          <span>BANDWIDTH</span>
          <span>{d.load}%</span>
        </div>
        <div style={{ height: 5, background: "var(--cream-deep)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${d.load}%`, background: d.load > 75 ? "var(--warn)" : "var(--positive)" }} />
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {d.top.map((t) => (
          <span key={t} style={{
            fontSize: 10, padding: "2px 7px", borderRadius: 999,
            background: "var(--cream)", color: "var(--ink-soft)", fontWeight: 600,
            border: "1px solid var(--line)",
          }}>{t}</span>
        ))}
      </div>
    </div>
  );
}
