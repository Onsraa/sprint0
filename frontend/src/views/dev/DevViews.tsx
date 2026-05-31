import { useEffect, useState } from "react";
import { useMe } from "../../features/auth/useAuth";
import { useUI } from "../../lib/store";
import { useView } from "../../features/nav/nav";
import type { Discipline, Member, MyIssue, TrustLevel } from "../../lib/api";
import { api } from "../../lib/api";
import { DISCIPLINE_LABEL, KIND_LABEL, RISK_COLOR } from "../../lib/relayUtils";
import { KindSurface } from "../KindSurface";
import { Mascot } from "../../components/Mascot";

/* sprint0 app — Developer views: Today, Active issue (per-kind), Passport.
   All three are REAL now: Today + Active-issue read /api/me/issues, Passport reads
   /api/me. No mock data — empty states stand in until work is assigned. */

interface Tier {
  t: string;
  c: string;
  ring: string;
  desc: string;
}

/* Trust tier helper, keyed on the member's overall trust level (low/medium/high). */
const TIER: Record<TrustLevel, Tier> = {
  low: { t: "Apprentice", c: "var(--ink-mute)", ring: "var(--ink-faint)", desc: "Low-risk issues. Micro-contexted." },
  medium: { t: "Trusted", c: "var(--info)", ring: "#7AA5E8", desc: "Mid-risk features. Mentored on architecture." },
  high: { t: "Senior", c: "var(--positive)", ring: "#7BC79A", desc: "Full repo access. Reviews juniors." },
};

function tierFor(level: TrustLevel): Tier {
  return TIER[level] ?? TIER.low;
}

const TRUST_RANK: Record<TrustLevel, number> = { low: 33, medium: 66, high: 100 };

/** Load my assigned issues once. Shared by Today + Active issue. */
function useMyIssues(): { issues: MyIssue[]; loading: boolean; err: string | null } {
  const [issues, setIssues] = useState<MyIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .myIssues()
      .then((res) => {
        if (!cancelled) setIssues(res.issues);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { issues, loading, err };
}

/* ============================================================
   DEVELOPER · TODAY
   ============================================================ */
export function DevToday() {
  const { member } = useMe();
  const { setView } = useView();
  const setActiveIssue = useUI((s) => s.setActiveIssue);
  const { issues, loading, err } = useMyIssues();
  const m = member as Member;
  const tier = tierFor(m.trust_level);
  const first = issues[0] ?? null;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Greeting */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div className="kicker">{m.discipline ? DISCIPLINE_LABEL[m.discipline] : "Developer"}</div>
          <div className="display" style={{ fontSize: 36, marginTop: 6 }}>
            Morning, {m.name.split(/\s+/)[0]}.
          </div>
          <div style={{ fontSize: 15, color: "var(--ink-soft)", marginTop: 4 }}>
            {issues.length > 0 ? "sprint0 already trimmed the noise. Here's your queue." : "Nothing on your plate yet. sprint0 will route work here."}
          </div>
        </div>
        <div className="wiggle">
          <Mascot size={76} expression={issues.length > 0 ? "happy" : "sleepy"} />
        </div>
      </div>

      {loading && <Loading label="loading your issues…" />}
      {err && <ErrCard err={err} />}

      {!loading && !err && issues.length === 0 && (
        <div className="card-soft" style={{ padding: 40, textAlign: "center", border: "2px dashed var(--line-strong)" }}>
          <div className="display" style={{ fontSize: 24, marginBottom: 8 }}>
            No tasks assigned yet.
          </div>
          <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>
            Once a manager dispatches a plan and assigns you an issue, it shows up here — micro-contexted, ready to ship.
          </div>
        </div>
      )}

      {/* The one focus card */}
      {first && (
        <div className="card" style={{ padding: 28, marginBottom: 20, background: "var(--paper)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
            <div className="chip chip-orange" style={{ fontSize: 11 }}>TODAY'S FOCUS</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
              {first.issue.id} · {first.project}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <div className="display" style={{ fontSize: 30 }}>{first.issue.title}</div>
            {first.issue.stretch_flag && <StretchBadge reason={first.issue.stretch_flag} />}
          </div>
          <p style={{ color: "var(--ink-soft)", fontSize: 15, lineHeight: 1.5, margin: "0 0 18px" }}>{first.issue.description}</p>

          {/* The micro-context preview */}
          <div style={{ padding: 16, background: "var(--cream)", borderRadius: 14, border: "1.5px solid var(--line-strong)", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Mascot size={26} expression="working" />
              <div style={{ fontWeight: 700, fontSize: 13 }}>sprint0 scoped the repo for you</div>
              <div style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-mute)" }}>
                <b style={{ color: "var(--orange)" }}>{first.issue.context_scope.files.length}</b> files
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {first.issue.context_scope.files.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>No files scoped yet.</div>
              )}
              {first.issue.context_scope.files.map((f) => (
                <div
                  key={f}
                  className="mono"
                  style={{ fontSize: 12, padding: "6px 10px", background: "var(--paper)", borderRadius: 6, border: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}
                >
                  <span style={{ color: "var(--orange)" }}>●</span>
                  {f}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button
              onClick={() => {
                setActiveIssue(first.issue.id);
                setView("issue");
              }}
              className="btn btn-primary"
            >
              Open scope →
            </button>
            <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
              est <b style={{ color: "var(--ink)" }}>{first.issue.estimate_days}d</b> · {first.issue.risk} risk
            </div>
          </div>
        </div>
      )}

      {/* Queue + tier */}
      {issues.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
          <div className="card-soft" style={{ padding: 18 }}>
            <div className="kicker" style={{ marginBottom: 8 }}>Your queue</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
              {issues.length} issue{issues.length === 1 ? "" : "s"} assigned to you
            </div>
            {issues.map((mi) => (
              <button
                key={`${mi.project_id}-${mi.issue.id}`}
                onClick={() => {
                  setActiveIssue(mi.issue.id);
                  setView("issue");
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  marginBottom: 6,
                  background: "var(--cream)",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    width: 36,
                    minWidth: 36,
                    height: 28,
                    borderRadius: 6,
                    background: "var(--orange-soft)",
                    color: "var(--orange-deep)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 10,
                    fontWeight: 800,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {mi.issue.estimate_days}d
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mi.issue.title}</span>
                    {mi.issue.stretch_flag && <span title={mi.issue.stretch_flag} style={{ color: "var(--warn)", fontSize: 12 }}>⚠</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>{mi.project}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: RISK_COLOR[mi.issue.risk] }}>{mi.issue.risk}</span>
                <div style={{ color: "var(--ink-mute)", fontSize: 14 }}>→</div>
              </button>
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
      )}
    </div>
  );
}

/* ============================================================
   DEVELOPER · ACTIVE ISSUE
   ============================================================ */
export function DevIssue() {
  const activeIssue = useUI((s) => s.activeIssue);
  const { issues, loading, err } = useMyIssues();

  if (loading) return <Loading label="loading your issue…" />;
  if (err) return <ErrCard err={err} />;

  const active = (activeIssue && issues.find((mi) => mi.issue.id === activeIssue)) || issues[0] || null;

  if (!active) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div className="card-soft" style={{ padding: 40, textAlign: "center", border: "2px dashed var(--line-strong)" }}>
          <div className="display" style={{ fontSize: 24, marginBottom: 8 }}>
            No active issue.
          </div>
          <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>
            No tasks assigned yet. Once you're on an issue, its scope + fetch command land here.
          </div>
        </div>
      </div>
    );
  }
  return <ActiveIssuePanel mine={active} />;
}

/* ============================================================
   ACTIVE ISSUE — per-kind execution surface
   ============================================================ */
function ActiveIssuePanel({ mine }: { mine: MyIssue }) {
  const issue = mine.issue;

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
          {issue.stretch_flag && <StretchBadge reason={issue.stretch_flag} />}
          <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>{mine.project}</div>
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

      {/* kind-specific surface (shared component — also used by RatifyPanel + TaskDrawer) */}
      <KindSurface work={issue} />
    </div>
  );
}

/* ============================================================
   DEVELOPER · MY PASSPORT (per-discipline trust radar, real)
   ============================================================ */
const RADAR_DISCIPLINES: Discipline[] = ["uiux", "frontend", "backend", "devops", "qa"];

export function DevPassport() {
  const { member } = useMe();
  const m = member as Member;

  // Per-discipline trust → 0-100 radar axes (falls back to overall trust_level).
  const skills: Skill[] = RADAR_DISCIPLINES.map((d) => ({
    k: DISCIPLINE_LABEL[d],
    v: TRUST_RANK[m.trust[d] ?? m.trust_level],
  }));

  const history = m.history ?? [];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20, alignItems: "start" }}>
        {/* Radar card */}
        <div className="card-soft" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div className="kicker">Trust profile · by discipline</div>
              <div className="display" style={{ fontSize: 26, marginTop: 4 }}>{m.name}</div>
            </div>
            <TierBadge level={m.trust_level} />
          </div>
          <SkillRadar skills={skills} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16 }}>
            {RADAR_DISCIPLINES.map((d) => {
              const lvl = m.trust[d] ?? m.trust_level;
              return (
                <div key={d} style={{ padding: "8px 10px", background: "var(--cream)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{DISCIPLINE_LABEL[d]}</span>
                  <span
                    className="mono"
                    style={{ fontSize: 11, fontWeight: 800, textTransform: "capitalize", color: lvl === "high" ? "var(--positive)" : lvl === "medium" ? "var(--info)" : "var(--ink-mute)" }}
                  >
                    {lvl}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right column: profile + history */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card-soft" style={{ padding: 18 }}>
            <div className="kicker" style={{ marginBottom: 12 }}>Profile</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px" }}>
              <Stat label="discipline" value={m.discipline ? DISCIPLINE_LABEL[m.discipline] : "—"} />
              <Stat label="seniority" value={m.seniority} />
              <Stat label="load" value={`${m.load}%`} />
              <Stat label="merges" value={history.length} />
            </div>
            {m.skills_text && (
              <div style={{ marginTop: 14, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>{m.skills_text}</div>
            )}
          </div>

          <div className="card-soft" style={{ padding: 18 }}>
            <div className="kicker" style={{ marginBottom: 10 }}>History</div>
            {history.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>No merges yet — trust grows with every successful ship.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {history.slice(0, 8).map((h, i) => (
                  <HistoryRow key={i} entry={h} last={i === Math.min(history.length, 8) - 1} />
                ))}
              </div>
            )}
          </div>

          <div className="card-soft" style={{ padding: 18, background: "var(--cream)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Mascot size={36} expression="happy" />
              <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.45 }}>
                Your passport lives in <b>MongoDB</b>. Per-discipline trust updates on every merge. <span style={{ color: "var(--ink-mute)" }}>Portable across agencies.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
      <span className="mono" style={{ fontWeight: 800, fontSize: 20, color: "var(--ink)", textTransform: "capitalize" }}>{value}</span>
      <span style={{ fontSize: 11, color: "var(--ink-mute)", fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function HistoryRow({ entry, last }: { entry: Record<string, unknown>; last: boolean }) {
  const taskType = typeof entry.task_type === "string" ? entry.task_type : "merge";
  const score = typeof entry.score === "number" ? entry.score : null;
  return (
    <div style={{ padding: "8px 0", display: "flex", alignItems: "center", gap: 10, borderBottom: last ? "none" : "1px solid var(--line)" }}>
      <span className="mono" style={{ fontSize: 12, color: "var(--ink-soft)", flex: 1 }}>{taskType}</span>
      {score != null && (
        <span className="chip" style={{ fontSize: 10, padding: "2px 8px", background: score >= 0.85 ? "var(--positive)" : "var(--info)", color: "var(--paper)", borderColor: "transparent" }}>
          {score.toFixed(2)}
        </span>
      )}
    </div>
  );
}

function TierBadge({ level }: { level: TrustLevel }) {
  const tier = tierFor(level);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        borderRadius: 999,
        background: tier.c,
        color: "var(--paper)",
        border: "2px solid var(--ink)",
        boxShadow: "0 3px 0 var(--ink)",
      }}
    >
      <span style={{ fontSize: 16 }}>★</span>
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{tier.t}</div>
        <div className="mono" style={{ fontSize: 10, opacity: 0.85, textTransform: "capitalize" }}>trust · {level}</div>
      </div>
    </div>
  );
}

/* ── shared bits ── */
interface Skill {
  k: string;
  v: number;
}

export function StretchBadge({ reason }: { reason: string }) {
  return (
    <span
      title={reason}
      className="chip"
      style={{ fontSize: 10, padding: "2px 8px", background: "var(--orange-soft)", borderColor: "var(--orange)", color: "var(--orange-deep)", fontWeight: 700 }}
    >
      ⚠ stretch
    </span>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--ink-mute)", fontSize: 14, padding: 24 }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", border: "2.5px solid var(--orange)", borderTopColor: "transparent", animation: "spin-slow 0.8s linear infinite" }} />
      {label}
    </div>
  );
}

function ErrCard({ err }: { err: string }) {
  return (
    <div className="card-soft" style={{ padding: 16, borderColor: "var(--orange)", color: "var(--orange-deep)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
      {err}
    </div>
  );
}

function SkillRadar({ skills }: { skills: Skill[] }) {
  // hex radar; map N axes
  const cx = 200, cy = 200, R = 150;
  const n = skills.length;
  const angle = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, r: number): [number, number] => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];

  const rings = [0.25, 0.5, 0.75, 1].map((f) => {
    return Array.from({ length: n }, (_, i) => pt(i, R * f).join(",")).join(" ");
  });
  const skillPoly = skills.map((s, i) => pt(i, (R * s.v) / 100).join(",")).join(" ");

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
      <svg viewBox="0 0 400 400" width="380" height="380">
        {rings.map((r, i) => (
          <polygon key={i} points={r} fill="none" stroke="var(--line-strong)" strokeWidth={i === rings.length - 1 ? 2 : 1} />
        ))}
        {skills.map((s, i) => {
          const [x, y] = pt(i, R);
          return <line key={s.k} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line-strong)" strokeWidth="1" />;
        })}
        <polygon points={skillPoly} fill="var(--orange)" fillOpacity="0.25" stroke="var(--orange)" strokeWidth="3" strokeLinejoin="round" />
        {skills.map((s, i) => {
          const [x, y] = pt(i, (R * s.v) / 100);
          return <circle key={s.k} cx={x} cy={y} r="5" fill="var(--orange)" stroke="var(--paper)" strokeWidth="2" />;
        })}
        {skills.map((s, i) => {
          const [x, y] = pt(i, R + 26);
          return (
            <text key={s.k} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontFamily="var(--font-display)" fontSize="13" fontWeight="700" fill="var(--ink)">
              {s.k}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
