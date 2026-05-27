import { useApp } from "../app/AppContext";
import type { ProjectStatus } from "../app/types";

const statusMap: Record<ProjectStatus, { t: string; c: string }> = {
  parsing: { t: "Parsing", c: "var(--info)" },
  review: { t: "Awaiting review", c: "var(--warn)" },
  shipping: { t: "Shipping", c: "var(--positive)" },
  shipped: { t: "Shipped", c: "var(--ink-mute)" },
};

export function Dashboard() {
  const { projects, setWizardOpen, setWizardKind, setFeatureProjectId, liveProjectId } = useApp();

  const newProject = () => {
    setFeatureProjectId(null);
    setWizardKind("brief");
    setWizardOpen(true);
  };
  const addFeature = (projectId: number) => {
    setFeatureProjectId(projectId);
    setWizardKind("brief");
    setWizardOpen(true);
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Hero strip */}
      <div
        style={{
          padding: "28px 0",
          marginBottom: 28,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          borderBottom: "1.5px solid var(--line)",
        }}
      >
        <div>
          <div className="kicker">This week</div>
          <div className="display" style={{ fontSize: 36, marginTop: 6 }}>
            2 sprints shipped. 47 issues closed.
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-mute)", marginTop: 6, fontFamily: "var(--font-mono)" }}>
            avg brief → scaffold: 53s · 0 escalations
          </div>
        </div>
        <button
          onClick={newProject}
          className="btn btn-primary"
          style={{ padding: "16px 24px", fontSize: 15 }}
        >
          + New project
        </button>
      </div>

      {liveProjectId != null && (
        <div
          className="card-soft"
          style={{ padding: 16, marginBottom: 20, display: "flex", alignItems: "center", gap: 12, background: "var(--orange-tint)", borderColor: "var(--orange-soft)" }}
        >
          <span className="kicker" style={{ color: "var(--orange-deep)" }}>Live project {liveProjectId}</span>
          <span style={{ fontSize: 13, color: "var(--ink-soft)", flex: 1 }}>
            Dispatched this session. Add a feature mid-production — sprint0 drafts a delta plan and runs it through the relay.
          </span>
          <button onClick={() => addFeature(liveProjectId)} className="btn btn-primary btn-sm">
            + Add feature
          </button>
        </div>
      )}

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
          onClick={newProject}
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
          <div style={{ fontSize: 12 }}>sprint0 will handle the rest</div>
        </button>
      </div>
    </div>
  );
}
