/* sprint0 — §25 the developer "code focus" execution surface. THE headline gap.
   One surface, rendered by the work's `kind`: code/infra (scoped files + git
   focus-branch + api-contract), design (brief + Figma + frames), audit (target
   pages + rubric), content/runbook (brief). This is where "the AI micro-scopes
   the repo so a junior ships safely" becomes visible. Opened from My Work.
   Ported pixel-1:1 from the v4 design's KindSurface.jsx; only the data source changed
   (mock EXEC/TASKS/PASSPORTS → the real WorkTask carried in `work` + the useApp() adapter). */
import { useState } from "react";
import { Icon, type IconName, ZeroMark } from "../lib/icon";
import { Avatar, Badge, Button, DiscDot, DISC, CapTag, StatusIcon, TrustDot } from "../components/ui";
import { BellPanel } from "../features/notify/BellPanel";
import { useApp } from "../app/useApp";
import type { Member, WorkTask } from "../lib/api";

/* ── local presentational maps + helpers (ported from data*.jsx) ─────────────────────────────────── */
const RISK_META: Record<string, { label: string; tone: "red" | "amber" | "neutral" }> = {
  high: { label: "High risk", tone: "red" },
  medium: { label: "Med risk", tone: "amber" },
  low: { label: "Low risk", tone: "neutral" },
};
const KIND_META: Record<string, { label: string; icon: IconName; blurb: string }> = {
  code: { label: "Code", icon: "merges", blurb: "scoped files · focus-branch · API contract" },
  infra: { label: "Infra", icon: "settings", blurb: "scoped files · focus-branch · pipeline" },
  design: { label: "Design", icon: "portfolio", blurb: "brief · Figma · frames" },
  audit: { label: "Audit", icon: "ratify", blurb: "target pages · rubric" },
  content: { label: "Content", icon: "list", blurb: "brief" },
  runbook: { label: "Runbook", icon: "list", blurb: "brief" },
};
const trustTier = (v: number) => (v >= 75 ? "Senior" : v >= 45 ? "Trusted" : "Apprentice");
// TODO(reconcile): mock read a per-discipline numeric trust (0–100) from PASSPORTS; real Member.trust is
// a Record<discipline, "low"|"medium"|"high">. Map the level → a representative score for the tier badge.
const TRUST_SCORE: Record<string, number> = { high: 80, medium: 55, low: 30 };
const trustScoreFor = (m: Member | undefined, disc: string | null | undefined): number => {
  if (!m || !disc) return 40;
  const lvl = m.trust?.[disc] ?? m.trust_level;
  return TRUST_SCORE[lvl] ?? 40;
};

const REPO_CLONE = "git@gitlab.com:harbor/harbor-portal.git";
const focusCommand = (id: string) => `git checkout sprint0/${id} && bash .sprint0/focus.sh && code .`;

/* the real WorkTask already carries { kind, context_scope, api_contract, context }, so the "exec view"
   is the work itself — with the same generic fallback the mock's execFor used for un-scoped slices. */
type Exec = {
  kind?: string; branch?: string; repo?: string; estimate_days?: number;
  context_scope?: { files?: string[]; note?: string }; api_contract?: string | null;
  context?: Record<string, unknown>;
};
const execFor = (t: AnyTask): Exec => ({
  kind: t.kind ?? (t.discipline === "uiux" ? "design" : t.discipline === "qa" ? "audit" : "code"),
  branch: `sprint0/${t.id}`,
  repo: undefined,
  context_scope: t.context_scope ?? { files: [], note: "Scoped context not yet computed for this slice." },
  api_contract: (t.api_contract as string | null | undefined) ?? null,
  context: (t.context as Record<string, unknown> | undefined) ?? {},
  estimate_days: t.estimate_days ?? t.est,
});

type Prov =
  | { kind: "stretch"; text: string }
  | { kind: "ai"; text: string; score?: number | null }
  | { kind: "claimed"; text: string }
  | { kind: "manager"; text: string };
const provenanceOf = (t: AnyTask): Prov => {
  if (t.stretch_flag) return { kind: "stretch", text: t.stretch_flag };
  if ((t.by ?? t.assigned_by) === "ai") return { kind: "ai", text: "assigned by sprint0", score: t.score };
  if ((t.by ?? t.assigned_by) === "self") return { kind: "claimed", text: "claimed" };
  return { kind: "manager", text: "@manager" };
};

type AnyTask = WorkTask & {
  est?: number; by?: string; dep?: string[]; score?: number | null;
};
const depOf = (t: AnyTask): string[] => t.dep ?? t.depends_on ?? [];

export function KindSurface({ work, onBack }: { work: AnyTask; onBack?: () => void }) {
  // spec mandates the prop be named `work`; the mockup called it `task`. Bridge once.
  const task = work;
  const { setToast, members } = useApp();
  const byUser = (u: string | null | undefined) => members.find((m) => m.username === u);
  const ex = execFor(task);
  const kind = ex.kind || "code";
  const km = KIND_META[kind] || KIND_META.code;
  const prov = provenanceOf(task);
  const a = byUser(task.assignee);
  const tierVal = trustScoreFor(byUser(task.assignee), task.discipline); // TODO(reconcile): was passportFor(assignee).trust[disc]

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0,
      animation: "s0-fade-in var(--t-reg) both" }}>
      {/* chrome */}
      <div style={{ height: "var(--topbar-h)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
        padding: "0 12px 0 10px", borderBottom: "0.5px solid var(--border-subtle)" }}>
        <button onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px 0 7px",
          borderRadius: "var(--r-md)", color: "var(--text-tertiary)", fontSize: 12.5, fontWeight: 500 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          <Icon name="chevronLeft" size={15} /> My Work
        </button>
        <Icon name="chevronRight" size={13} style={{ color: "var(--text-quaternary)" }} />
        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{task.id}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 19, padding: "0 8px", borderRadius: "var(--r-sm)",
          background: "var(--bg-secondary)", fontSize: 11, fontWeight: 500, color: "var(--text-secondary)" }}>
          <Icon name={km.icon} size={12} />{km.label}
        </span>
        <div style={{ flex: 1 }} />
        {/* TODO(reconcile): mockup used a bare <BellButton/>; the real live bell is <BellPanel/>. */}
        <BellPanel />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "26px 28px 56px" }}>
          {/* title + provenance */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-tertiary)" }}>
              <DiscDot d={task.discipline} />{DISC[task.discipline]?.label}
            </span>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>· {km.blurb}</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px", lineHeight: 1.25, margin: "0 0 14px" }}>{task.title}</h1>

          <Provenance prov={prov} assignee={a} />

          {/* meta strip */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, padding: "14px 0", margin: "16px 0 4px",
            borderTop: "0.5px solid var(--border-subtle)", borderBottom: "0.5px solid var(--border-subtle)" }}>
            <Meta label="Risk" value={<Badge tone={RISK_META[task.risk ?? "low"].tone}>{RISK_META[task.risk ?? "low"].label}</Badge>} />
            <Meta label="Estimate" value={<span className="mono" style={{ fontSize: 12.5 }}>{ex.estimate_days ?? task.est} days</span>} />
            <Meta label="Trust tier" value={<span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 500 }}><TrustDot level={tierVal >= 75 ? "high" : tierVal >= 45 ? "medium" : "low"} />{trustTier(tierVal)} <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>· {DISC[task.discipline]?.label.toLowerCase()}</span></span>} />
            {task.capability_tags && (
              <Meta label="Capabilities" value={<span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{task.capability_tags.map((t) => <CapTag key={t} tag={t} />)}</span>} />
            )}
          </div>

          {/* kind-specific body */}
          <div style={{ marginTop: 22 }}>
            {(kind === "code" || kind === "infra") && <CodeFocus task={task} ex={ex} onCopy={(c) => copy(c, setToast)} />}
            {kind === "design" && <DesignFocus ex={ex} />}
            {kind === "audit" && <AuditFocus ex={ex} />}
            {(kind === "content" || kind === "runbook") && <BriefFocus ex={ex} />}
          </div>

          {depOf(task).length > 0 && <DependsOn dep={depOf(task)} />}
        </div>
      </div>
    </div>
  );
}

function copy(text: string, setToast?: (n: unknown) => void) {
  try { navigator.clipboard.writeText(text); } catch { /* ignore */ }
  setToast && setToast({ kind: "ratify", title: "Copied to clipboard", body: "Paste in your terminal", who: "ai", time: "now" });
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="kicker" style={{ fontSize: 10 }}>{label}</span>
      <span style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

/* §15 provenance / scored attribution */
function Provenance({ prov, assignee }: { prov: Prov; assignee: Member | undefined }) {
  if (prov.kind === "stretch") {
    return (
      <div style={{ display: "flex", gap: 9, padding: "11px 13px", borderRadius: "var(--r-md)",
        background: "var(--bg-active)", border: "0.5px solid var(--text-primary)" }}>
        <span style={{ color: "var(--text-primary)", marginTop: 1 }}>▲</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>Stretch assignment — out of lane, scored in</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45, marginTop: 2 }}>{prov.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 13px", borderRadius: "var(--r-md)", background: "var(--bg-secondary)" }}>
      {prov.kind === "ai"
        ? <><ZeroMark size={16} /><span style={{ fontSize: 12.5, color: "var(--text-secondary)", flex: 1 }}>Assigned by <b style={{ fontWeight: 600 }}>sprint0</b> — discipline is one signal, not a gate.</span>{prov.score != null && <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>match {prov.score}</span>}</>
        : <><Avatar name={assignee?.name} size={18} /><span style={{ fontSize: 12.5, color: "var(--text-secondary)", flex: 1 }}>{prov.kind === "claimed" ? `Self-claimed by ${assignee?.name?.split(" ")[0]}` : "Assigned by the manager"}</span></>}
    </div>
  );
}

/* ───────── code / infra: the dev's real workspace ───────── */
function CodeFocus({ task, ex, onCopy }: { task: AnyTask; ex: Exec; onCopy: (c: string) => void }) {
  const cs = ex.context_scope || {};
  const files = cs.files || [];
  const cmd = focusCommand(task.id);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* scoped files */}
      <section>
        <SecHead icon="board" title="Scoped files" hint={`${files.length} files · the API boundary for this slice`} />
        {cs.note && <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55, margin: "0 0 12px" }}>{cs.note}</p>}
        <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
          {files.length === 0 && <div style={{ padding: "16px", fontSize: 12.5, color: "var(--text-quaternary)" }}>No scoped files computed yet.</div>}
          {files.map((f, i) => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, height: 38, padding: "0 13px",
              borderTop: i ? "0.5px solid var(--border-subtle)" : "none" }}>
              <Icon name="merges" size={14} style={{ color: "var(--text-quaternary)" }} />
              <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)", flex: 1 }}>{f}</span>
              <Badge tone="neutral" mono>in scope</Badge>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 13px",
            borderTop: "0.5px solid var(--border-subtle)", background: "var(--bg-secondary)" }}>
            <Icon name="eye" size={13} style={{ color: "var(--text-quaternary)" }} />
            <span style={{ fontSize: 11.5, color: "var(--text-quaternary)" }}>Everything else in the worktree is hidden by the focus branch.</span>
          </div>
        </div>
      </section>

      {/* git focus-branch */}
      <section>
        <SecHead icon="merges" title="Git focus-branch" hint="a sparse checkout collapses the worktree to just your slice" />
        <div style={{ borderRadius: "var(--r-lg)", overflow: "hidden", border: "0.5px solid var(--border-strong)", background: "#1A1714" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "0.5px solid rgba(255,255,255,0.08)" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#57514A" }} />
            <span className="mono" style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)", flex: 1 }}>terminal · {(ex.repo || REPO_CLONE).split(":")[1] || "harbor-portal"}</span>
            <span className="mono" style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>{ex.branch}</span>
          </div>
          <div style={{ padding: "13px 14px" }}>
            <code className="mono" style={{ fontSize: 12.5, color: "#EDEAE4", lineHeight: 1.6, display: "block", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: "#7E776D" }}>$ </span>{cmd}
            </code>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Button variant="primary" size="sm" icon="merges" onClick={() => onCopy(cmd)}>Copy command</Button>
          <Button variant="secondary" size="sm" icon="gitlab" onClick={() => onCopy(cmd)}>Open in VS Code</Button>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", alignSelf: "center" }}>writes .sprint0/focus.json + .vscode/settings.json</span>
        </div>
      </section>

      {/* api contract */}
      {ex.api_contract && (
        <section>
          <SecHead icon="relay" title="API contract" hint="the boundary this slice produces or consumes" />
          <pre className="mono" style={{ margin: 0, padding: "14px 16px", fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)",
            background: "var(--bg-secondary)", border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "auto",
            whiteSpace: "pre" }}>{ex.api_contract}</pre>
        </section>
      )}
    </div>
  );
}

/* ───────── design: brief + figma + frames ───────── */
function DesignFocus({ ex }: { ex: Exec }) {
  const c = (ex.context || {}) as { figma_url?: string; figma_file?: string; frames?: string[] };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <section>
        <SecHead icon="list" title="Brief" />
        <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>{ex.context_scope?.note}</p>
      </section>
      <section>
        <SecHead icon="portfolio" title="Figma" hint="read-only repo — no git branch on a design slice" />
        <a href={"https://" + (c.figma_url || "figma.com")} target="_blank" rel="noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 14px", borderRadius: "var(--r-lg)",
            border: "0.5px solid var(--border)", boxShadow: "var(--shadow-1)", background: "var(--bg-elevated)" }}>
          <span style={{ width: 30, height: 30, borderRadius: "var(--r-md)", display: "grid", placeItems: "center", background: "var(--bg-secondary)" }}>
            <Icon name="portfolio" size={16} style={{ color: "var(--text-tertiary)" }} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{c.figma_file || "Figma file"}</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{c.figma_url}</div>
          </div>
          <Icon name="arrowRight" size={15} style={{ color: "var(--text-quaternary)" }} />
        </a>
      </section>
      {c.frames && (
        <section>
          <SecHead icon="board" title="Frames" hint="attach exported frames to the slice" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {c.frames.map((f) => (
              <div key={f} style={{ borderRadius: "var(--r-lg)", border: "0.5px solid var(--border)", overflow: "hidden", background: "var(--bg-elevated)" }}>
                <div style={{ height: 84, background: "repeating-linear-gradient(135deg, var(--bg-secondary) 0 8px, var(--bg-tertiary) 8px 16px)" }} />
                <div style={{ padding: "8px 10px", fontSize: 11.5, color: "var(--text-secondary)", borderTop: "0.5px solid var(--border-subtle)" }}>{f}</div>
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" icon="plus" style={{ marginTop: 10 }}>Attach frames</Button>
        </section>
      )}
    </div>
  );
}

/* ───────── audit: target pages + rubric ───────── */
function AuditFocus({ ex }: { ex: Exec }) {
  const c = (ex.context || {}) as { target_pages?: string[]; rubric?: string[] };
  const [done, setDone] = useState<Record<number, boolean>>({});
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <section>
        <SecHead icon="eye" title="Target pages" hint="what this audit covers" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {(c.target_pages || []).map((p) => (
            <span key={p} className="mono" style={{ display: "inline-flex", alignItems: "center", height: 26, padding: "0 11px",
              borderRadius: "var(--r-pill)", border: "0.5px solid var(--border)", fontSize: 12, color: "var(--text-secondary)", background: "var(--bg-elevated)" }}>{p}</span>
          ))}
        </div>
      </section>
      <section>
        <SecHead icon="ratify" title="Rubric" hint="check each before passing the gate" />
        <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
          {(c.rubric || []).map((r, i) => (
            <button key={i} onClick={() => setDone((d) => ({ ...d, [i]: !d[i] }))}
              style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", minHeight: 42, padding: "9px 13px",
                borderTop: i ? "0.5px solid var(--border-subtle)" : "none", background: "transparent" }}>
              <span style={{ width: 18, height: 18, borderRadius: "var(--r-xs)", flexShrink: 0, display: "grid", placeItems: "center",
                border: done[i] ? "none" : "1.5px solid var(--border-strong)", background: done[i] ? "var(--green)" : "transparent" }}>
                {done[i] && <Icon name="check" size={12} style={{ color: "#fff" }} />}
              </span>
              <span style={{ fontSize: 12.5, color: done[i] ? "var(--text-tertiary)" : "var(--text-secondary)", lineHeight: 1.4,
                textDecoration: done[i] ? "line-through" : "none" }}>{r}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function BriefFocus({ ex }: { ex: Exec }) {
  return (
    <section>
      <SecHead icon="list" title="Brief" />
      <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>{ex.context_scope?.note}</p>
    </section>
  );
}

function DependsOn({ dep }: { dep: string[] }) {
  const { tasks } = useApp();
  return (
    <section style={{ marginTop: 22 }}>
      <SecHead icon="relay" title="Depends on" />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {dep.map((d) => {
          const dt = tasks.find((x) => x.id === d) as AnyTask | undefined;
          return (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 9, height: 36, padding: "0 12px",
              borderRadius: "var(--r-md)", border: "0.5px solid var(--border)" }}>
              <StatusIcon status={dt?.status || "planned"} size={13} />
              <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{d}</span>
              <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dt?.title || "—"}</span>
              {dt && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-tertiary)" }}><DiscDot d={dt.discipline} />{DISC[dt.discipline]?.label}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SecHead({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <Icon name={icon} size={15} style={{ color: "var(--text-tertiary)" }} />
      <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.2px" }}>{title}</span>
      {hint && <span style={{ fontSize: 11.5, color: "var(--text-quaternary)" }}>· {hint}</span>}
    </div>
  );
}
