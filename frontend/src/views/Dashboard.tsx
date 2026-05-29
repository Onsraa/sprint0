import { useState } from "react";
import { useApp } from "../app/AppContext";
import { api, type ProjectSummary } from "../lib/api";
import { planIssues } from "../lib/relayUtils";

/* Manager home: every dispatched project from GET /api/projects (real GitLab scaffolds).
   Honest fields only — counts/match/links are derived from the persisted ProjectRecord;
   no fabricated progress %, sprint #, or match score. */

const ACCENTS = ["#0F8E5C", "#2A6FDB", "#7C3AED", "#D97706", "#F4511E", "#1a1410"];
const accentFor = (id: number) => ACCENTS[Math.abs(id) % ACCENTS.length];

function stats(p: ProjectSummary): { issues: number; devs: number } {
  const issues = planIssues(p.plan?.epics);
  return { issues: issues.length, devs: new Set(issues.map((i) => i.assignee).filter(Boolean)).size };
}

const isClosed = (p: ProjectSummary) => p.status === "closed" || p.status === "shipped";
const fmtDate = (s?: string) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
};

export function Dashboard() {
  const { projects, refreshProjects, role, setWizardOpen, setWizardKind, setFeatureProjectId, liveProjectId } = useApp();
  const isManager = role === "manager";
  const [filter, setFilter] = useState<"all" | "active" | "shipped">("all");
  const [closing, setClosing] = useState<ProjectSummary | null>(null);

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

  const total = projects.length;
  const shipped = projects.filter(isClosed).length;
  const totalIssues = projects.reduce((n, p) => n + planIssues(p.plan?.epics).length, 0);

  const active = projects.filter((p) => p.kind !== "reference");
  const reference = projects.filter((p) => p.kind === "reference");
  const shownActive = active.filter((p) =>
    filter === "all" ? true : filter === "shipped" ? isClosed(p) : !isClosed(p),
  );

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Hero strip — real counts */}
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
          <div className="kicker">Across the agency</div>
          <div className="display" style={{ fontSize: 36, marginTop: 6 }}>
            {total} {total === 1 ? "project" : "projects"} · {shipped} shipped.
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-mute)", marginTop: 6, fontFamily: "var(--font-mono)" }}>
            {totalIssues} issues scaffolded across the relay
          </div>
        </div>
        <button onClick={newProject} className="btn btn-primary" style={{ padding: "16px 24px", fontSize: 15 }}>
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
            Dispatched this session — find it below to add a feature mid-production or close it out.
          </span>
        </div>
      )}

      {/* Project list */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div className="display" style={{ fontSize: 22 }}>Active</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", fontWeight: 700 }}>sprint0-managed</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["all", "active", "shipped"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="chip"
              style={{ textTransform: "capitalize", ...(filter === f ? { background: "var(--ink)", color: "var(--paper)" } : { cursor: "pointer" }) }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <button
          onClick={newProject}
          className="card-soft"
          style={{
            padding: 40, width: "100%", border: "2px dashed var(--line-strong)", background: "transparent",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: "var(--ink-mute)", cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 32 }}>+</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>No projects dispatched yet — drop a brief</div>
          <div style={{ fontSize: 12 }}>sprint0 plans it, the leads ratify, then it scaffolds to GitLab</div>
        </button>
      ) : (
        <>
          {shownActive.length === 0 ? (
            <div className="card-soft" style={{ padding: 24, textAlign: "center", color: "var(--ink-mute)", fontSize: 13 }}>
              No matching active projects.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
              {shownActive.map((p) => (
                <ProjectCard key={p.project_id} p={p} isManager={isManager} onAddFeature={addFeature} onClose={setClosing} />
              ))}
            </div>
          )}

          {reference.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "28px 0 14px" }}>
                <div className="display" style={{ fontSize: 22 }}>Reference</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", fontWeight: 700 }}>
                  agency memory · {reference.length} shipped
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
                {reference.map((p) => (
                  <ProjectCard key={p.project_id} p={p} isManager={isManager} onAddFeature={addFeature} onClose={setClosing} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {closing && <CloseModal project={closing} onClose={() => setClosing(null)} onDone={refreshProjects} />}
    </div>
  );
}

/* One project tile. `reference` (agency-memory past projects) are read-only and lack a plan/
   tech_stack/grounded_on — every optional field is guarded so a bare repo never crashes the grid. */
function ProjectCard({
  p,
  isManager,
  onAddFeature,
  onClose,
}: {
  p: ProjectSummary;
  isManager: boolean;
  onAddFeature: (id: number) => void;
  onClose: (p: ProjectSummary) => void;
}) {
  const accent = accentFor(p.project_id);
  const isRef = p.kind === "reference";
  const st = isClosed(p);
  const s = stats(p);
  const created = fmtDate(p.created_at) ?? fmtDate(p.last_activity_at);
  const stack = p.tech_stack ? Object.values(p.tech_stack).filter(Boolean) : [];
  const grounded = p.grounded_on ?? [];
  const tags = p.tags ?? [];

  return (
    <div className="card-soft card-hover" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 38, height: 38, borderRadius: 10, background: accent, color: "var(--paper)",
              display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, border: "2px solid var(--ink)",
            }}
          >
            {p.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
              #{p.project_id}{created ? ` · ${created}` : ""}
            </div>
          </div>
        </div>
        <div
          className="chip"
          style={{
            background: isRef ? "var(--cream-deep)" : st ? "var(--ink-mute)" : "var(--positive)",
            color: isRef ? "var(--ink-soft)" : "var(--paper)",
            borderColor: isRef ? "var(--line-strong)" : st ? "var(--ink-mute)" : "var(--positive)",
          }}
        >
          {isRef ? "Reference" : st ? "Shipped" : "Active"}
        </div>
      </div>

      {isRef ? (
        <>
          {p.summary && (
            <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.45, marginBottom: 10 }}>{p.summary}</div>
          )}
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--ink-soft)", fontWeight: 600, marginBottom: tags.length > 0 ? 10 : 0 }}>
            <span className="mono" style={{ color: "var(--ink-mute)" }}>agency memory · shipped</span>
            {p.web_url && (
              <a href={p.web_url} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", color: accent, fontWeight: 700 }}>
                Open in GitLab ↗
              </a>
            )}
          </div>
          {tags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {tags.map((t, i) => (
                <span key={`${t}-${i}`} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "var(--cream-deep)", color: "var(--ink-soft)", fontWeight: 600 }}>
                  {t}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--ink-soft)", fontWeight: 600, marginBottom: 12 }}>
            <span><b style={{ color: "var(--ink)" }}>{s.issues}</b> issues</span>
            <span><b style={{ color: "var(--ink)" }}>{s.devs}</b> {s.devs === 1 ? "dev" : "devs"}</span>
            {p.web_url && (
              <a href={p.web_url} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", color: accent, fontWeight: 700 }}>
                Open in GitLab ↗
              </a>
            )}
          </div>

          {grounded.length > 0 && (
            <div
              style={{
                padding: 10, background: "var(--cream)", borderRadius: 10, fontSize: 12,
                display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10,
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-mute)", fontWeight: 700 }}>reused:</span>
              {grounded.map((g) => (
                <span key={g} style={{ fontWeight: 700 }}>{g}</span>
              ))}
            </div>
          )}

          {stack.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: isManager ? 12 : 0 }}>
              {stack.map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "var(--cream-deep)", color: "var(--ink-soft)", fontWeight: 600 }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {isManager && !st && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onAddFeature(p.project_id)} className="btn btn-ghost btn-sm">+ Add feature</button>
              <button onClick={() => onClose(p)} className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}>
                Close project
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* Post-mortem ceremony: write the shipped project into agency memory (POST /api/projects/{id}/close). */
function CloseModal({ project, onClose, onDone }: { project: ProjectSummary; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.closeProject(project.project_id, notes);
      setDone(res.added_to_memory);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(26,20,16,0.45)", display: "grid", placeItems: "center", zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card-soft"
        style={{ padding: 24, width: 480, maxWidth: "90vw", background: "var(--paper)" }}
      >
        <div className="kicker">Close project</div>
        <div className="display" style={{ fontSize: 22, marginTop: 4, marginBottom: 6 }}>{project.name}</div>
        {done ? (
          <>
            <div style={{ fontSize: 14, color: "var(--positive)", fontWeight: 700, margin: "14px 0" }}>
              ✓ Written to agency memory — future briefs will ground on it.
            </div>
            <button onClick={onClose} className="btn btn-primary btn-sm">Done</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>
              The post-mortem writes this project into agency memory (PastProjects) so future plans reuse what shipped.
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              <span className="kicker">Outcome notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="e.g. Shipped in 9 weeks; map + saved-search reused from memory."
                style={{ padding: "9px 12px", border: "1.5px solid var(--line-strong)", borderRadius: 8, fontSize: 14, background: "var(--paper)", fontFamily: "inherit", resize: "vertical" }}
              />
            </label>
            {err && <div className="mono" style={{ fontSize: 12, color: "var(--orange-deep)", marginBottom: 10 }}>{err}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={submit} disabled={busy} className="btn btn-primary btn-sm" style={{ opacity: busy ? 0.5 : 1 }}>
                {busy ? "Closing…" : "Close & write memory"}
              </button>
              <button onClick={onClose} disabled={busy} className="btn btn-ghost btn-sm">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
