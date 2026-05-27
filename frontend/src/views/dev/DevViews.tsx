import { useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import type { Role } from "../../app/types";
import type { Discipline, Issue } from "../../lib/api";
import { KIND_LABEL, planIssues, RISK_COLOR } from "../../lib/relayUtils";
import { Mascot } from "../../components/Mascot";

/* baton app — Developer views: Today, Active issue (per-kind), Passport */

const ROLE_DISCIPLINE: Partial<Record<Role, Discipline>> = {
  uiux: "uiux",
  backend: "backend",
  frontend: "frontend",
  qa: "qa",
};

interface Tier {
  t: string;
  c: string;
  ring: string;
  desc: string;
}

/* Trust tier helper */
function tierFor(t: number): Tier {
  if (t < 35) return { t: "Apprentice", c: "var(--ink-mute)", ring: "var(--ink-faint)", desc: "Low-risk issues. Micro-contexted." };
  if (t < 75) return { t: "Trusted", c: "var(--info)", ring: "#7AA5E8", desc: "Mid-risk features. Mentored on architecture." };
  return { t: "Senior", c: "var(--positive)", ring: "#7BC79A", desc: "Full repo access. Reviews juniors." };
}

/* ============================================================
   DEVELOPER · TODAY
   ============================================================ */
export function DevToday() {
  const { devTrust, setView } = useApp();
  const tier = tierFor(devTrust);
  const focusFiles: string[] = ["src/auth/login.tsx", "src/api/sessions.ts", "src/db/users.schema.ts"];

  const idleTasks: { t: string; repo: string; min: number }[] = [
    { t: "Update Stripe webhook copy", repo: "luxe-real-estate", min: 22 },
    { t: "Tighten Postgres index on listings", repo: "courier-track", min: 35 },
  ];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Greeting */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div className="kicker">Tuesday, 9:14 AM</div>
          <div className="display" style={{ fontSize: 36, marginTop: 6 }}>Morning, Maria.</div>
          <div style={{ fontSize: 15, color: "var(--ink-soft)", marginTop: 4 }}>
            One thing to ship today. baton already trimmed the noise.
          </div>
        </div>
        <div className="wiggle"><Mascot size={76} expression="happy" /></div>
      </div>

      {/* The one focus card */}
      <div className="card" style={{ padding: 28, marginBottom: 20, background: "var(--paper)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <div className="chip chip-orange" style={{ fontSize: 11 }}>TODAY'S FOCUS</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>#142 · luxe-real-estate</div>
        </div>
        <div className="display" style={{ fontSize: 32, marginBottom: 8 }}>Fix the auth-flow timeout</div>
        <p style={{ color: "var(--ink-soft)", fontSize: 15, lineHeight: 1.5, margin: "0 0 18px" }}>
          Sessions die after 5 min on iPad. Should be 30. Probably in the session middleware.
        </p>

        {/* The micro-context preview */}
        <div style={{
          padding: 16, background: "var(--cream)", borderRadius: 14,
          border: "1.5px solid var(--line-strong)", marginBottom: 18,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Mascot size={26} expression="working" />
            <div style={{ fontWeight: 700, fontSize: 13 }}>baton pruned the repo for you</div>
            <div style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-mute)" }}>
              <b style={{ color: "var(--orange)" }}>3</b> / 187 files
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {focusFiles.map((f) => (
              <div key={f} className="mono" style={{
                fontSize: 12, padding: "6px 10px", background: "var(--paper)",
                borderRadius: 6, border: "1px solid var(--line)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ color: "var(--orange)" }}>●</span>
                {f}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={() => setView("issue")} className="btn btn-primary">Open scope →</button>
          <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
            est <b style={{ color: "var(--ink)" }}>2h</b> · trust gain: <b style={{ color: "var(--positive)" }}>+3</b>
          </div>
        </div>
      </div>

      {/* Idle slots */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <div className="card-soft" style={{ padding: 18 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>While CI runs</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>2 micro-tasks ready (~30m each)</div>
          {idleTasks.map((s, i) => (
            <div key={i} style={{
              padding: "10px 12px", marginBottom: 6,
              background: "var(--cream)", borderRadius: 10,
              display: "flex", alignItems: "center", gap: 10,
              fontSize: 13,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 6,
                background: "var(--orange-soft)", color: "var(--orange-deep)",
                display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800,
                fontFamily: "var(--font-mono)",
              }}>{s.min}m</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{s.t}</div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>{s.repo}</div>
              </div>
              <div style={{ color: "var(--ink-mute)", fontSize: 14 }}>→</div>
            </div>
          ))}
        </div>

        <div className="card-soft" style={{ padding: 18, background: "var(--cream)" }}>
          <div className="kicker">Your tier</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0" }}>
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: tier.c, boxShadow: `0 0 0 4px ${tier.ring}` }} />
            <span className="display" style={{ fontSize: 22, color: tier.c }}>{tier.t}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 10 }}>{tier.desc}</div>
          <button onClick={() => setView("passport")} style={{ fontSize: 12, fontWeight: 700, color: "var(--orange)", textDecoration: "underline", textUnderlineOffset: 3 }}>
            See passport →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   DEVELOPER · ISSUE (HERO — micro-context file tree)
   ============================================================ */
interface TreeNode {
  id: string;
  t: string;
  k: "dir" | "file";
  depth: number;
  focus?: boolean;
  why?: string;
  ghost?: boolean;
}

/* Live: pick the active issue for this role's discipline and render a per-kind
   surface. Falls back to the scripted demo issue when no plan is loaded. */
export function DevIssue() {
  const { role, plan, activeIssue } = useApp();
  const discipline = ROLE_DISCIPLINE[role];
  const issues = planIssues(plan?.epics);
  const mine = discipline ? issues.filter((i) => i.discipline === discipline) : issues;
  const active = (activeIssue && issues.find((i) => i.id === activeIssue)) || mine[0] || null;

  if (!active) return <DevIssueMock />;
  return <ActiveIssuePanel issue={active} />;
}

function DevIssueMock() {
  const { devTrust } = useApp();
  const tier = tierFor(devTrust);
  const [showAll, setShowAll] = useState(false);
  const [activeFile, setActiveFile] = useState("src/api/sessions.ts");

  // A faux repo tree
  const tree = useMemo<TreeNode[]>(() => ([
    { id: "src", t: "src/", k: "dir", depth: 0 },
    { id: "src/api", t: "api/", k: "dir", depth: 1 },
    { id: "src/api/sessions.ts", t: "sessions.ts", k: "file", depth: 2, focus: true, why: "session TTL constant lives here" },
    { id: "src/api/auth.ts", t: "auth.ts", k: "file", depth: 2 },
    { id: "src/api/listings.ts", t: "listings.ts", k: "file", depth: 2 },
    { id: "src/api/users.ts", t: "users.ts", k: "file", depth: 2 },
    { id: "src/auth", t: "auth/", k: "dir", depth: 1 },
    { id: "src/auth/login.tsx", t: "login.tsx", k: "file", depth: 2, focus: true, why: "client-side session refresh" },
    { id: "src/auth/signup.tsx", t: "signup.tsx", k: "file", depth: 2 },
    { id: "src/auth/forgot.tsx", t: "forgot.tsx", k: "file", depth: 2 },
    { id: "src/db", t: "db/", k: "dir", depth: 1 },
    { id: "src/db/users.schema.ts", t: "users.schema.ts", k: "file", depth: 2, focus: true, why: "schema has session_expires_at" },
    { id: "src/db/listings.schema.ts", t: "listings.schema.ts", k: "file", depth: 2 },
    { id: "src/db/agents.schema.ts", t: "agents.schema.ts", k: "file", depth: 2 },
    { id: "src/components", t: "components/", k: "dir", depth: 1 },
    { id: "src/components/MapView.tsx", t: "MapView.tsx", k: "file", depth: 2 },
    { id: "src/components/ListingCard.tsx", t: "ListingCard.tsx", k: "file", depth: 2 },
    { id: "src/components/Header.tsx", t: "Header.tsx", k: "file", depth: 2 },
    { id: "src/components/...184 more", t: "…184 more", k: "file", depth: 2, ghost: true },
  ]), []);

  const whyFiles: { f: string; w: string }[] = [
    { f: "src/api/sessions.ts", w: "Session TTL constant (look for SESSION_TTL_MS)" },
    { f: "src/auth/login.tsx", w: "Triggers refresh on focus — check the visibilitychange handler" },
    { f: "src/db/users.schema.ts", w: "session_expires_at column · drop the default if you change TTL" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
      {/* File tree pane */}
      <div className="card-soft" style={{ padding: 14, height: "fit-content", position: "sticky", top: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
          <div>
            <div className="kicker">Context scope</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, whiteSpace: "nowrap" }}>
              <span style={{ color: "var(--orange)" }}>3</span> / 187 files
            </div>
          </div>
          <button onClick={() => setShowAll(!showAll)} style={{
            fontSize: 10, fontWeight: 700, padding: "4px 8px",
            borderRadius: 999, background: showAll ? "var(--orange-soft)" : "var(--cream-deep)",
            color: showAll ? "var(--orange-deep)" : "var(--ink-mute)",
            whiteSpace: "nowrap",
          }}>{showAll ? "hide noise" : "show all"}</button>
        </div>

        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 12, maxHeight: 480, overflow: "auto",
          padding: 8, background: "var(--cream)", borderRadius: 10,
        }}>
          {tree.map((node) => {
            const dimmed = !showAll && !node.focus && node.k === "file";
            const isActive = activeFile === node.id;
            if (node.ghost && !showAll) return (
              <div key={node.id} style={{
                paddingLeft: node.depth * 12, padding: "3px 8px",
                color: "var(--ink-faint)", fontSize: 11, fontStyle: "italic",
              }}>
                {node.t}
              </div>
            );
            if (node.k === "dir") return (
              <div key={node.id} style={{
                paddingLeft: node.depth * 12 + 8, padding: "4px 8px",
                fontWeight: 700, color: "var(--ink-soft)",
              }}>
                <span style={{ color: "var(--ink-faint)", marginRight: 4 }}>▸</span>{node.t}
              </div>
            );
            return (
              <button key={node.id} onClick={() => setActiveFile(node.id)} style={{
                display: "block", width: "100%", textAlign: "left",
                paddingLeft: node.depth * 12 + 8, padding: "4px 8px",
                color: dimmed ? "var(--ink-faint)" : node.focus ? "var(--orange-deep)" : "var(--ink)",
                fontWeight: node.focus ? 700 : 500,
                background: isActive ? "var(--orange-soft)" : "transparent",
                borderRadius: 4,
                opacity: dimmed ? 0.45 : 1,
                transition: "all 200ms",
                fontSize: 12,
              }}>
                {node.focus && <span style={{ color: "var(--orange)", marginRight: 4 }}>●</span>}
                {!node.focus && <span style={{ marginRight: 4, color: "var(--ink-faint)" }}>○</span>}
                {node.t}
              </button>
            );
          })}
        </div>

        <div style={{ padding: 12, marginTop: 12, background: "var(--orange-tint)", borderRadius: 10, fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          <b style={{ color: "var(--orange-deep)" }}>Why these 3?</b><br />
          baton traced the bug from the GitLab issue → session middleware → DB schema. Everything else is noise.
        </div>
      </div>

      {/* Issue detail pane */}
      <div>
        <div className="card-soft" style={{ padding: 24, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <div className="mono" style={{ fontSize: 13, color: "var(--ink-mute)" }}>#142</div>
            <div className="chip chip-soft" style={{ fontSize: 10, padding: "3px 8px", whiteSpace: "nowrap" }}>{tier.t} tier</div>
            <div className="chip" style={{ fontSize: 10, padding: "3px 8px" }}>est 2h</div>
            <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>luxe-real-estate</div>
          </div>
          <div className="display" style={{ fontSize: 30, marginBottom: 10 }}>auth-flow timeout on iPad</div>
          <p style={{ color: "var(--ink-soft)", fontSize: 14, lineHeight: 1.55, margin: "0 0 18px" }}>
            Sessions die after 5 min when the agent app is open on iPad in the field. Should be 30 min, same as desktop.
            Probably a hardcoded TTL in session middleware. Check users schema for <code style={{ background: "var(--cream)", padding: "2px 6px", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 12 }}>session_expires_at</code>.
          </p>

          {/* Why-each-file explanations */}
          <div style={{ display: "flex", flexDirection: "column", marginBottom: 18 }}>
            <div className="kicker" style={{ marginBottom: 10 }}>Why these files</div>
            {whyFiles.map((x, i) => (
              <div key={x.f} style={{
                padding: "10px 0", display: "flex", gap: 12, alignItems: "flex-start",
                borderBottom: i < whyFiles.length - 1 ? "1px solid var(--line)" : "none",
              }}>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 11, color: "var(--orange)", minWidth: 18, paddingTop: 1 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <div className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{x.f}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>{x.w}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn btn-primary">Start work →</button>
            <button className="btn btn-ghost btn-sm">Open in IDE</button>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, fontSize: 12, color: "var(--ink-mute)" }}>
              <span>assigned by baton · trust-matched</span>
            </div>
          </div>
        </div>

        {/* Linked context */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="card-soft" style={{ padding: 14 }}>
            <div className="kicker" style={{ marginBottom: 6 }}>Recent commit</div>
            <div className="mono" style={{ fontSize: 12, fontWeight: 700 }}>a1f4e2 · zillow-clone-2024</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>"fix(auth): bump session TTL to 30min" — solved this exact bug. Pattern matched from memory.</div>
          </div>
          <div className="card-soft" style={{ padding: 14 }}>
            <div className="kicker" style={{ marginBottom: 6 }}>If you get stuck</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Ping <b style={{ color: "var(--ink)" }}>@tomas</b> · they shipped this on Redfin-tools last quarter.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ACTIVE ISSUE — per-kind execution surface
   ============================================================ */
function ActiveIssuePanel({ issue }: { issue: Issue }) {
  const { plan } = useApp();
  const files = issue.context_scope.files;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <div className="card-soft" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <div className="mono" style={{ fontSize: 13, color: "var(--ink-mute)" }}>{issue.id}</div>
          <div className="chip chip-soft" style={{ fontSize: 10, padding: "3px 8px" }}>{KIND_LABEL[issue.kind]}</div>
          <div className="chip" style={{ fontSize: 10, padding: "3px 8px" }}>est {issue.estimate_days}d</div>
          <div className="chip" style={{ fontSize: 10, padding: "3px 8px", borderColor: RISK_COLOR[issue.risk], color: RISK_COLOR[issue.risk] }}>
            {issue.risk} risk
          </div>
          {plan && (
            <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>
              {plan.project_name}
            </div>
          )}
        </div>
        <div className="display" style={{ fontSize: 28, marginBottom: 10 }}>{issue.title}</div>
        <p style={{ color: "var(--ink-soft)", fontSize: 14, lineHeight: 1.55, margin: "0 0 8px" }}>{issue.description}</p>
        {issue.required_skill && (
          <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
            skill: <b style={{ color: "var(--ink)" }}>{issue.required_skill}</b>
            {issue.assignee && <> · assigned <b style={{ color: "var(--ink)" }}>@{issue.assignee}</b></>}
          </div>
        )}
        {issue.depends_on.length > 0 && (
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 8 }}>
            depends on: {issue.depends_on.join(" · ")}
          </div>
        )}
      </div>

      {/* kind-specific surface */}
      {(issue.kind === "code" || issue.kind === "infra") && <CodeSurface issue={issue} files={files} />}
      {issue.kind === "design" && <DesignSurface issue={issue} />}
      {issue.kind === "audit" && <AuditSurface issue={issue} />}
      {(issue.kind === "content" || issue.kind === "runbook") && <GenericSurface issue={issue} />}
    </div>
  );
}

function CodeSurface({ issue, files }: { issue: Issue; files: string[] }) {
  const { liveCloneUrl } = useApp();
  const bid = issue.id.toLowerCase();
  const dir = liveCloneUrl ? (liveCloneUrl.replace(/\/+$/, "").split("/").pop() || "repo").replace(/\.git$/, "") : "<project>";
  const cmd = liveCloneUrl
    ? `git clone ${liveCloneUrl} && cd ${dir} && git checkout baton/${bid} && bash .baton/focus.sh && code .`
    : `git checkout baton/${bid} && bash .baton/focus.sh && code .`;
  return (
    <>
      <div className="card-soft" style={{ padding: 18, marginBottom: 12 }}>
        <div className="kicker" style={{ marginBottom: 10 }}>
          Context scope · {files.length} {files.length === 1 ? "file" : "files"}
        </div>
        {issue.context_scope.note && (
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 10 }}>{issue.context_scope.note}</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {files.length === 0 && <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>No files scoped yet.</div>}
          {files.map((f) => (
            <div
              key={f}
              className="mono"
              style={{ fontSize: 12, padding: "6px 10px", background: "var(--cream)", borderRadius: 6, border: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}
            >
              <span style={{ color: "var(--orange)" }}>●</span>
              {f}
            </div>
          ))}
        </div>
      </div>

      <div
        className="mono"
        style={{ background: "var(--ink)", color: "var(--paper)", borderRadius: 12, padding: 16, fontSize: 13, marginBottom: 12, boxShadow: "4px 4px 0 var(--orange)" }}
      >
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>fetch → focus → open (VSCode; swap `code .` for your editor)</div>
        <div style={{ color: "var(--orange)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>$ {cmd}</div>
      </div>

      {issue.api_contract && (
        <div className="card-soft" style={{ padding: 18 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>API contract</div>
          <pre className="mono" style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {issue.api_contract}
          </pre>
        </div>
      )}
    </>
  );
}

function DesignSurface({ issue }: { issue: Issue }) {
  const figma = typeof issue.context.figma_file === "string" ? (issue.context.figma_file as string) : null;
  return (
    <>
      <div className="card-soft" style={{ padding: 18, marginBottom: 12 }}>
        <div className="kicker" style={{ marginBottom: 8 }}>Design brief</div>
        <div style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          {issue.context_scope.note || issue.description}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="card-soft" style={{ padding: 18 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Figma</div>
          {figma ? (
            <a href={figma} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 13, color: "var(--info)", textDecoration: "underline", textUnderlineOffset: 3, wordBreak: "break-all" }}>
              {figma}
            </a>
          ) : (
            <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>No Figma file linked yet.</div>
          )}
        </div>
        <div className="card-soft" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="kicker">Deliverable</div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Attach the frames you ship for this issue.</div>
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>+ Attach frames</button>
        </div>
      </div>
    </>
  );
}

function AuditSurface({ issue }: { issue: Issue }) {
  const pages = Array.isArray(issue.context.target_pages) ? (issue.context.target_pages as string[]) : issue.context_scope.files;
  const rubric = Array.isArray(issue.context.rubric)
    ? (issue.context.rubric as string[])
    : typeof issue.context.rubric === "string"
      ? [issue.context.rubric as string]
      : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div className="card-soft" style={{ padding: 18 }}>
        <div className="kicker" style={{ marginBottom: 10 }}>Target pages</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {pages.length === 0 && <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>No pages specified.</div>}
          {pages.map((p) => (
            <div key={p} className="mono" style={{ fontSize: 12, padding: "6px 10px", background: "var(--cream)", borderRadius: 6, border: "1px solid var(--line)" }}>
              {p}
            </div>
          ))}
        </div>
      </div>
      <div className="card-soft" style={{ padding: 18 }}>
        <div className="kicker" style={{ marginBottom: 10 }}>Rubric</div>
        {rubric.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>{issue.context_scope.note || "Use the standard accessibility + UX rubric."}</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.6 }}>
            {rubric.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function GenericSurface({ issue }: { issue: Issue }) {
  return (
    <div className="card-soft" style={{ padding: 18 }}>
      <div className="kicker" style={{ marginBottom: 8 }}>{KIND_LABEL[issue.kind]} brief</div>
      <div style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.5 }}>
        {issue.context_scope.note || issue.description}
      </div>
      {issue.context_scope.files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
          {issue.context_scope.files.map((f) => (
            <div key={f} className="mono" style={{ fontSize: 12, padding: "6px 10px", background: "var(--cream)", borderRadius: 6, border: "1px solid var(--line)" }}>
              {f}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   DEVELOPER · MY PASSPORT (radar chart, D&D style)
   ============================================================ */
interface Skill {
  k: string;
  v: number;
}

export function DevPassport() {
  const { devTrust } = useApp();

  // skill scores 0–100
  const skills: Skill[] = [
    { k: "Frontend", v: 88 },
    { k: "Backend", v: 72 },
    { k: "Data / DB", v: 64 },
    { k: "DevOps", v: 41 },
    { k: "Product", v: 78 },
    { k: "Velocity", v: 92 },
  ];

  const lifetime: { l: string; n: number }[] = [
    { l: "merges", n: 184 },
    { l: "projects", n: 7 },
    { l: "epics led", n: 23 },
    { l: "post-mortems", n: 5 },
  ];

  const gains: { t: string; d: string; c: string }[] = [
    { t: "+5 Backend", d: "shipped auth refresh on zillow-clone", c: "var(--info)" },
    { t: "+2 Velocity", d: "closed 3 micro-tasks in idle time", c: "var(--orange)" },
    { t: "+3 Product", d: "client report praised by Bolt Delivery", c: "var(--positive)" },
  ];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20, alignItems: "start" }}>
        {/* Radar card */}
        <div className="card-soft" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div className="kicker">Skill profile</div>
              <div className="display" style={{ fontSize: 26, marginTop: 4 }}>Vector you</div>
            </div>
            <TierBadge devTrust={devTrust} />
          </div>
          <SkillRadar skills={skills} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16 }}>
            {skills.map((s) => (
              <div key={s.k} style={{
                padding: "8px 10px", background: "var(--cream)", borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{s.k}</span>
                <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: s.v >= 70 ? "var(--positive)" : s.v >= 50 ? "var(--warn)" : "var(--ink-mute)" }}>{s.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right column: stats + history */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card-soft" style={{ padding: 18 }}>
            <div className="kicker" style={{ marginBottom: 12 }}>Lifetime</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px" }}>
              {lifetime.map((s) => (
                <div key={s.l} style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span className="mono" style={{ fontWeight: 800, fontSize: 20, color: "var(--ink)" }}>{s.n}</span>
                  <span style={{ fontSize: 11, color: "var(--ink-mute)", fontWeight: 600 }}>{s.l}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card-soft" style={{ padding: 18 }}>
            <div className="kicker" style={{ marginBottom: 10 }}>Recent gains</div>
            {gains.map((g, i) => (
              <div key={i} style={{
                padding: "8px 0", display: "flex", alignItems: "center", gap: 10,
                borderBottom: i < 2 ? "1px solid var(--line)" : "none",
              }}>
                <div style={{
                  padding: "3px 8px", borderRadius: 999, background: g.c, color: "var(--paper)",
                  fontSize: 11, fontWeight: 800,
                }}>{g.t}</div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{g.d}</div>
              </div>
            ))}
          </div>

          <div className="card-soft" style={{ padding: 18, background: "var(--cream)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Mascot size={36} expression="happy" />
              <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.45 }}>
                Your passport is stored in <b>MongoDB</b>. Updated every successful merge. <span style={{ color: "var(--ink-mute)" }}>Portable across agencies.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TierBadge({ devTrust }: { devTrust: number }) {
  const tier = tierFor(devTrust);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 14px", borderRadius: 999,
      background: tier.c, color: "var(--paper)",
      border: "2px solid var(--ink)", boxShadow: "0 3px 0 var(--ink)",
    }}>
      <span style={{ fontSize: 16 }}>★</span>
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{tier.t}</div>
        <div className="mono" style={{ fontSize: 10, opacity: 0.85 }}>trust · {devTrust}/100</div>
      </div>
    </div>
  );
}

function SkillRadar({ skills }: { skills: Skill[] }) {
  // hex radar; map 6 axes
  const cx = 200, cy = 200, R = 150;
  const n = skills.length;
  const angle = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI / n);
  const pt = (i: number, r: number): [number, number] => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];

  const rings = [0.25, 0.5, 0.75, 1].map((f) => {
    return Array.from({ length: n }, (_, i) => pt(i, R * f).join(",")).join(" ");
  });
  const skillPoly = skills.map((s, i) => pt(i, R * s.v / 100).join(",")).join(" ");

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
      <svg viewBox="0 0 400 400" width="380" height="380">
        {/* rings */}
        {rings.map((r, i) => (
          <polygon key={i} points={r} fill="none" stroke="var(--line-strong)" strokeWidth={i === rings.length - 1 ? 2 : 1} />
        ))}
        {/* axes */}
        {skills.map((s, i) => {
          const [x, y] = pt(i, R);
          return <line key={s.k} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line-strong)" strokeWidth="1" />;
        })}
        {/* skill area */}
        <polygon points={skillPoly} fill="var(--orange)" fillOpacity="0.25" stroke="var(--orange)" strokeWidth="3" strokeLinejoin="round" />
        {/* skill dots */}
        {skills.map((s, i) => {
          const [x, y] = pt(i, R * s.v / 100);
          return <circle key={s.k} cx={x} cy={y} r="5" fill="var(--orange)" stroke="var(--paper)" strokeWidth="2" />;
        })}
        {/* labels */}
        {skills.map((s, i) => {
          const [x, y] = pt(i, R + 26);
          return <text key={s.k} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fontFamily="var(--font-display)" fontSize="14" fontWeight="700" fill="var(--ink)">{s.k}</text>;
        })}
        {/* center label */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontFamily="var(--font-display)" fontSize="24" fontWeight="800" fill="var(--orange)">{Math.round(skills.reduce((a, s) => a + s.v, 0) / skills.length)}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--ink-mute)">AVG</text>
      </svg>
    </div>
  );
}
