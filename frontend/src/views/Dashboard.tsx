import { useApp } from "../app/AppContext";
import type { ProjectStatus } from "../app/types";
import { Mascot } from "../components/Mascot";

const statusMap: Record<ProjectStatus, { t: string; c: string }> = {
  parsing: { t: "Parsing", c: "var(--info)" },
  review: { t: "Awaiting review", c: "var(--warn)" },
  shipping: { t: "Shipping", c: "var(--positive)" },
  shipped: { t: "Shipped", c: "var(--ink-mute)" },
};

export function Dashboard() {
  const { projects, setWizardOpen } = useApp();

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Hero strip */}
      <div
        className="card"
        style={{
          padding: 28,
          marginBottom: 28,
          background: "linear-gradient(110deg, var(--orange) 0%, var(--orange-deep) 100%)",
          color: "var(--paper)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div className="kicker" style={{ color: "rgba(255,255,255,0.7)" }}>
            This week
          </div>
          <div className="display" style={{ fontSize: 32, marginTop: 6 }}>
            Zero shipped 2 sprints + 47 issues.
          </div>
          <div style={{ fontSize: 14, opacity: 0.9, marginTop: 6 }}>avg time brief → scaffold: 53s · 0 escalations</div>
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <div className="wiggle">
            <Mascot size={92} expression="cheer" outline="var(--paper)" color="var(--orange-deep)" />
          </div>
          <button
            onClick={() => setWizardOpen(true)}
            className="btn"
            style={{
              background: "var(--paper)",
              color: "var(--ink)",
              borderColor: "var(--ink)",
              boxShadow: "0 4px 0 var(--ink)",
              padding: "16px 24px",
              fontSize: 15,
            }}
          >
            + New Sprint 0
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 28 }}>
        {[
          { l: "Active sprints", n: "2", c: "var(--orange)" },
          { l: "In review", n: "1", c: "var(--warn)" },
          { l: "Shipped this Q", n: "8", c: "var(--positive)" },
          { l: "Memory size", n: "127", c: "var(--info)" },
        ].map((s, i) => (
          <div key={i} className="card-soft card-hover" style={{ padding: 16 }}>
            <div className="kicker">{s.l}</div>
            <div className="display" style={{ fontSize: 40, color: s.c, marginTop: 4 }}>
              {s.n}
            </div>
          </div>
        ))}
      </div>

      {/* Project list */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <div className="display" style={{ fontSize: 22 }}>
          Projects
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["All", "Active", "Review", "Shipped"].map((f, i) => (
            <button key={f} className="chip" style={i === 0 ? { background: "var(--ink)", color: "var(--paper)" } : {}}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {projects.map((p) => (
          <div key={p.id} className="card-soft card-hover" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: p.color,
                    color: "var(--paper)",
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 800,
                    fontSize: 13,
                    border: "2px solid var(--ink)",
                  }}
                >
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{p.client}</div>
                </div>
              </div>
              <div
                className="chip"
                style={{ background: statusMap[p.status].c, color: "var(--paper)", borderColor: statusMap[p.status].c }}
              >
                <span className="dot" style={{ background: "var(--paper)" }} />
                {statusMap[p.status].t}
              </div>
            </div>

            <div style={{ height: 8, background: "var(--cream-deep)", borderRadius: 999, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ height: "100%", width: `${p.progress}%`, background: p.color, transition: "width 400ms" }} />
            </div>

            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--ink-soft)", fontWeight: 600 }}>
              <span>
                <b style={{ color: "var(--ink)" }}>Sprint {p.sprint}</b>
              </span>
              <span>{p.devs} devs</span>
              <span>{p.issues} issues</span>
              <span style={{ marginLeft: "auto", color: "var(--ink-mute)" }}>{p.created}</span>
            </div>

            <div
              style={{
                marginTop: 12,
                padding: 10,
                background: "var(--cream)",
                borderRadius: 10,
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-mute)", fontWeight: 700 }}>match:</span>
              <span style={{ fontWeight: 700 }}>{p.match.name}</span>
              <span style={{ marginLeft: "auto", color: "var(--positive)", fontWeight: 800 }}>{p.match.pct}%</span>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {p.stack.map((t) => (
                <span
                  key={t}
                  style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "var(--cream-deep)", color: "var(--ink-soft)", fontWeight: 600 }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}

        {/* Empty card */}
        <button
          onClick={() => setWizardOpen(true)}
          className="card-soft"
          style={{
            padding: 32,
            border: "2px dashed var(--line-strong)",
            background: "transparent",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: "var(--ink-mute)",
            cursor: "pointer",
            minHeight: 180,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--orange)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--line-strong)";
          }}
        >
          <div style={{ fontSize: 32 }}>+</div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Drop a brief</div>
          <div style={{ fontSize: 12 }}>Zero will handle the rest</div>
        </button>
      </div>
    </div>
  );
}
