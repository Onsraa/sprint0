/* sprint0 — Brief-intake Wizard (§3). The product's front door: brief → clarify →
   architecture → plan → dispatch. Steps map 1:1 to endpoints. Grounded on agency
   memory (§2b), surfaces the staffing gap (§7), and ends in a dispatch dry-run
   preview (§13) — nothing is created in GitLab until the relay clears (create-late).

   Ported pixel-1:1 from the v4 mockup (app/Wizard.jsx). Only the data source changes:
   setView/setToast/members come from useApp; the scripted spec/architectures/plan/
   preview are local constants. TODO(reconcile): the orchestrator wires the real
   brief→clarify→architecture→plan→dispatch flow into these props. */
import { Fragment, useState } from "react";
import { useApp } from "../app/useApp";
import { Icon, ZeroMark, FullLogo } from "../lib/icon";
import { Button, Avatar, Badge, DiscDot, DISC, CapTag } from "../components/ui";

/* ───────── scripted spec/architectures/plan/preview (mockup data2.jsx) ─────────
   TODO(reconcile): real brief→plan flow is wired by the orchestrator; markup reads these verbatim. */
const WIZARD_BRIEF = `Build a tenant portal for a freight client. They need: a saved-search experience over shipments, shareable read-only views with expiring links, a live map with thousands of vehicle pins, and CSV export of any filtered view. Must scaffold a real GitLab project. Tight 8-week window.`;

const WIZARD_SPEC = {
  features: [
    { id: "f1", title: "Saved searches over shipments", lane: "frontend" },
    { id: "f2", title: "Shareable read-only views, expiring links", lane: "backend" },
    { id: "f3", title: "Live map, thousands of vehicle pins", lane: "frontend" },
    { id: "f4", title: "CSV export of any filtered view", lane: "backend" },
    { id: "f5", title: "Scaffold a real GitLab project", lane: "devops" },
  ],
  ambiguities: [
    { id: "a1", question: "Expiring links — what default TTL?", options: ["24 hours", "7 days", "Configurable per share"] },
    { id: "a2", question: "Map — realtime pin updates or polled?", options: ["WebSocket realtime", "Poll every 15s", "Manual refresh"] },
    { id: "a3", question: "CSV export — synchronous or queued?", options: ["Sync (small sets)", "Queued + signed URL", "Both, by size"] },
  ],
  reuse: [
    { tag: "scoped-tokens", from: "Harbor Logistics", who: "rajiv", grade: "retro_validated" },
    { tag: "map-clustering", from: "Harbor Logistics", who: "talia", grade: "prod_survived" },
    { tag: "csv-export", from: "Ledger Pay", who: "rajiv", grade: "shipped" },
  ],
};
const WIZARD_ARCHITECTURES = [
  { id: "arch1", stack: ["Next.js", "FastAPI", "Postgres", "Fly.io"], rationale: "Mirrors Harbor Logistics — maximal reuse of scoped-tokens + map-clustering modules.", tradeoffs: "Two languages to maintain; FastAPI team is at high load.", grounded: ["scoped-tokens", "map-clustering"], recommended: true },
  { id: "arch2", stack: ["Remix", "Go", "Postgres", "AWS"], rationale: "Single fast binary backend; strong for CSV streaming at scale.", tradeoffs: "No prior Go map-clustering reuse — rebuild the pin layer.", grounded: ["csv-export"] },
  { id: "arch3", stack: ["SvelteKit", "Node", "SQLite→Postgres"], rationale: "Lightest footprint, fastest cold start for a small portal.", tradeoffs: "SQLite won't hold thousands of live pins; migration risk mid-build.", grounded: [] },
];
const DISPATCH_PREVIEW = {
  project_name: "Freight Tenant Portal",
  creates: { project: 1, issues: 18 },
  member_invites: [
    { username: "rajiv", discipline: "backend" }, { username: "priya", discipline: "backend" },
    { username: "talia", discipline: "frontend" }, { username: "noah", discipline: "frontend" },
    { username: "dario", discipline: "devops" }, { username: "elena", discipline: "qa" },
  ],
  invite_count: 6, free_tier_cap: 5, exceeds_cap: true, relay_cleared: false, is_delta: false,
};
const STAFFING = {
  plan_HARB_42: {
    coverage: {
      per_discipline: [
        { discipline: "uiux", covered: false, devs: [] as string[], note: "orphan gap" },
        { discipline: "backend", covered: true, devs: ["rajiv", "priya"], note: "rajiv at 91% load" },
        { discipline: "frontend", covered: true, devs: ["talia", "noah"], note: "" },
        { discipline: "qa", covered: true, devs: ["elena"], note: "" },
        { discipline: "devops", covered: true, devs: ["dario"], note: "" },
      ],
      gaps: ["uiux"],
      stretch_candidates: [
        { username: "talia", load: 78, trust: "high", score: 0.74, why: "frontend senior · strongest design-adjacent skill cosine" },
        { username: "noah", load: 54, trust: "medium", score: 0.61, why: "frontend mid · has headroom, weaker on tokens" },
        { username: "mira", load: 62, trust: "high", score: 0.55, why: "manager covering — temporary, not sustainable" },
      ],
    },
  },
};

/* §12 graded references — local presentation map (mockup data2.jsx GRADE_META). */
const GRADE_META: Record<string, { label: string; step: number; proven: boolean; hint: string }> = {
  proposed: { label: "Proposed", step: 1, proven: false, hint: "not yet proven" },
  shipped: { label: "Shipped", step: 2, proven: false, hint: "merged, not battle-tested" },
  prod_survived: { label: "Prod-survived", step: 3, proven: true, hint: "survived in production" },
  retro_validated: { label: "Retro-validated", step: 4, proven: true, hint: "confirmed in retro" },
};
/* panel-local: compact grade chip used by the grounding strip. */
function GradeChip({ grade, showLabel = true }: { grade: string; showLabel?: boolean }) {
  const m = GRADE_META[grade];
  if (!m) return null;
  return (
    <Badge tone={m.proven ? "ink" : "outline"} mono>
      {m.proven && <Icon name="check" size={10} />}
      {showLabel ? m.label : m.label.split("-")[0]}
    </Badge>
  );
}

const STEPS = [
  { id: "brief", label: "Brief", sub: "Paste or drop" },
  { id: "clarify", label: "Clarify", sub: "Resolve ambiguities" },
  { id: "arch", label: "Architecture", sub: "Pick a stack" },
  { id: "plan", label: "Plan", sub: "Draft relay" },
  { id: "review", label: "Review", sub: "Dispatch preview" },
];

export function WizardBrief() {
  const { setView, setToast } = useApp();
  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState(WIZARD_BRIEF);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [arch, setArch] = useState("arch1");
  const [mode, setMode] = useState("supervised");
  const [dispatched, setDispatched] = useState(false);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const canNext = step === 0 ? brief.trim().length > 20
    : step === 1 ? Object.keys(answers).length === WIZARD_SPEC.ambiguities.length
    : true;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-app)" }}>
      {/* top chrome */}
      <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "0 18px" }}>
        <FullLogo size={17} />
        <span style={{ fontSize: 12, color: "var(--text-quaternary)", fontWeight: 500 }}>· New project from brief</span>
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" icon="close" onClick={() => setView("projects")}>Cancel</Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "0 8px 8px", display: "flex", gap: 8 }}>
        {/* stepper rail */}
        <div style={{ width: 230, flexShrink: 0, padding: "20px 14px" }}>
          {STEPS.map((s, i) => {
            const done = i < step, cur = i === step;
            return (
              <div key={s.id} style={{ display: "flex", gap: 11, marginBottom: 4 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0,
                    background: done ? "var(--text-primary)" : cur ? "var(--bg-elevated)" : "transparent",
                    border: `0.5px solid ${cur ? "var(--text-primary)" : done ? "var(--text-primary)" : "var(--border-strong)"}`,
                    color: done ? "#fff" : cur ? "var(--text-primary)" : "var(--text-quaternary)",
                    fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600 }}>
                    {done ? <Icon name="check" size={13} /> : i + 1}
                  </span>
                  {i < STEPS.length - 1 && <span style={{ width: 1, flex: 1, minHeight: 26, background: done ? "var(--text-primary)" : "var(--border)" }} />}
                </div>
                <div style={{ paddingTop: 2 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: cur || done ? "var(--text-primary)" : "var(--text-quaternary)" }}>{s.label}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{s.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* main pane */}
        <div className="pane" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ flex: 1, overflow: "auto", padding: "32px 0" }}>
            <div style={{ maxWidth: 660, margin: "0 auto", padding: "0 32px" }}>
              {step === 0 && <StepBrief brief={brief} setBrief={setBrief} />}
              {step === 1 && <StepClarify answers={answers} setAnswers={setAnswers} />}
              {step === 2 && <StepArch arch={arch} setArch={setArch} />}
              {step === 3 && <StepPlan arch={arch} />}
              {step === 4 && <StepReview mode={mode} setMode={setMode} dispatched={dispatched}
                onDispatch={() => { setDispatched(true); setToast({ title: "Dispatched to GitLab", body: DISPATCH_PREVIEW.project_name + " · supervised" }); }} />}
            </div>
          </div>
          {/* footer nav */}
          <div style={{ borderTop: "0.5px solid var(--border-subtle)", padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <Button variant="ghost" size="md" icon="chevronLeft" onClick={step === 0 ? () => setView("projects") : back}>{step === 0 ? "Cancel" : "Back"}</Button>
            <div style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>step {step + 1} / {STEPS.length}</span>
            {step < STEPS.length - 1
              ? <Button variant="primary" size="md" iconRight="arrowRight" disabled={!canNext} style={{ opacity: canNext ? 1 : 0.45 }} onClick={next}>
                  {step === 0 ? "Clarify spec" : step === 1 ? "Generate architectures" : step === 2 ? "Generate plan" : "Review & dispatch"}
                </Button>
              : <Button variant="primary" size="md" icon="gitlab" disabled={dispatched} onClick={() => { /* handled in StepReview */ }} style={{ opacity: dispatched ? 0.5 : 1 }}>{dispatched ? "Dispatched" : "Done"}</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroundingStrip() {
  return (
    <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 14, background: "var(--bg-secondary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <ZeroMark size={15} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Grounded on agency memory</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>§reuse</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {WIZARD_SPEC.reuse.map((r) => (
          <div key={r.tag} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <CapTag tag={r.tag} />
            <span style={{ fontSize: 12, color: "var(--text-tertiary)", flex: 1 }}>
              @{r.who} made this call on <b style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{r.from}</b>
            </span>
            <GradeChip grade={r.grade} showLabel={false} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StepBrief({ brief, setBrief }: { brief: string; setBrief: (v: string) => void }) {
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Drop the client brief" sub="Paste the text or drop a PDF. The AI extracts a spec and proposes reuse before you commit anything." />
      <div className="kicker" style={{ marginBottom: 8 }}>Brief</div>
      <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={8}
        style={{ width: "100%", padding: "14px 16px", fontSize: 14, lineHeight: 1.6, resize: "vertical",
          background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-lg)",
          outline: "none", color: "var(--text-primary)", boxShadow: "var(--shadow-inset)", fontFamily: "var(--font-ui)", marginBottom: 12 }} />
      <button style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 64,
        border: "1.2px dashed var(--border-strong)", borderRadius: "var(--r-lg)", color: "var(--text-tertiary)",
        fontSize: 13, fontWeight: 500, background: "var(--bg-base)" }}>
        <Icon name="inbox" size={16} /> Drop a PDF, or click to browse
      </button>
    </div>
  );
}

function StepClarify({ answers, setAnswers }: {
  answers: Record<string, string>; setAnswers: (fn: (ans: Record<string, string>) => Record<string, string>) => void;
}) {
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Clarify the spec" sub="The AI pulled these features and flagged a few ambiguities. Answer them so the plan is grounded, not guessed." />

      <div className="kicker" style={{ marginBottom: 8 }}>Extracted features · {WIZARD_SPEC.features.length}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 22 }}>
        {WIZARD_SPEC.features.map((f) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 10px", borderRadius: "var(--r-md)" }}>
            <Icon name="check" size={14} style={{ color: "var(--green)" }} />
            <span style={{ fontSize: 13, flex: 1 }}>{f.title}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-tertiary)" }}><DiscDot d={f.lane} />{DISC[f.lane].label}</span>
          </div>
        ))}
      </div>

      <div className="kicker" style={{ marginBottom: 8 }}>Ambiguities · {WIZARD_SPEC.ambiguities.length} need a call</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
        {WIZARD_SPEC.ambiguities.map((a) => (
          <div key={a.id} style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 14, boxShadow: "var(--shadow-1)" }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>{a.question}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {a.options.map((o) => {
                const on = answers[a.id] === o;
                return (
                  <button key={o} onClick={() => setAnswers((ans) => ({ ...ans, [a.id]: o }))}
                    style={{ height: 30, padding: "0 12px", borderRadius: "var(--r-md)", fontSize: 12.5, fontWeight: 500,
                      background: on ? "var(--text-primary)" : "var(--bg-elevated)", color: on ? "#fff" : "var(--text-secondary)",
                      border: `0.5px solid ${on ? "var(--text-primary)" : "var(--border-strong)"}`, boxShadow: on ? "none" : "var(--shadow-1)" }}>
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <GroundingStrip />
    </div>
  );
}

function StepArch({ arch, setArch }: { arch: string; setArch: (v: string) => void }) {
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Pick a stack" sub="Grounded architecture options — the recommended one reuses the most validated modules from memory." />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {WIZARD_ARCHITECTURES.map((o) => {
          const on = arch === o.id;
          return (
            <button key={o.id} onClick={() => setArch(o.id)} style={{ textAlign: "left", width: "100%",
              border: `0.5px solid ${on ? "var(--text-primary)" : "var(--border)"}`, borderRadius: "var(--r-lg)", padding: 16,
              background: "var(--bg-elevated)", boxShadow: on ? "var(--shadow-2)" : "var(--shadow-1)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${on ? "var(--text-primary)" : "var(--border-strong)"}`,
                  display: "grid", placeItems: "center" }}>{on && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--text-primary)" }} />}</span>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", flex: 1 }}>{o.stack.map((s) => <Badge key={s} tone="outline">{s}</Badge>)}</div>
                {o.recommended && <Badge tone="ink">recommended</Badge>}
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 6px", lineHeight: 1.5 }}>{o.rationale}</p>
              <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "0 0 10px", lineHeight: 1.5 }}><b style={{ fontWeight: 500 }}>Trade-off:</b> {o.tradeoffs}</p>
              {o.grounded.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <ZeroMark size={13} /><span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>reuses</span>
                  {o.grounded.map((g) => <CapTag key={g} tag={g} />)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepPlan({ arch: _arch }: { arch: string }) {
  const { members } = useApp();
  const byUser = (u: string) => members.find((m) => m.username === u);
  const cov = STAFFING.plan_HARB_42.coverage;
  const order = ["uiux", "backend", "devops", "frontend", "qa"];
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Plan & draft relay" sub="18 issues planned across the relay. The plan enters as a draft — nothing ships until the gates clear." />

      <div className="kicker" style={{ marginBottom: 10 }}>Draft relay</div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 4px 20px" }}>
        {order.map((d, i) => (
          <Fragment key={d}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span style={{ width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center",
                background: cov.gaps.includes(d) ? "var(--bg-elevated)" : "var(--bg-secondary)",
                border: cov.gaps.includes(d) ? "1px dashed var(--text-primary)" : "0.5px solid var(--border)" }}>
                <DiscDot d={d} size={9} />
              </span>
              <span style={{ fontSize: 9.5, color: cov.gaps.includes(d) ? "var(--text-primary)" : "var(--text-quaternary)", fontWeight: cov.gaps.includes(d) ? 600 : 400 }}>{DISC[d].label}</span>
            </div>
            {i < order.length - 1 && <span style={{ flex: 1, height: 1, background: "var(--border-strong)", marginTop: -16 }} />}
          </Fragment>
        ))}
      </div>

      {/* §7 staffing in review */}
      <div style={{ border: "0.5px solid var(--text-primary)", borderRadius: "var(--r-lg)", padding: 14, background: "var(--bg-secondary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Icon name="team" size={15} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Coverage</span>
          <div style={{ flex: 1 }} />
          <Badge tone="outline" mono>1 gap</Badge>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "0 0 10px", lineHeight: 1.5 }}>
          <b style={{ color: "var(--text-primary)", fontWeight: 500 }}>{DISC[cov.gaps[0]].label}</b> has no dedicated dev — its gate routes to you (manager). Strongest stretch: <b style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{byUser(cov.stretch_candidates[0].username)?.name}</b> (match {cov.stretch_candidates[0].score}).
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
          {cov.per_discipline.map((p) => (
            <div key={p.discipline} style={{ textAlign: "center", padding: "8px 4px", borderRadius: "var(--r-md)",
              background: p.covered ? "var(--bg-elevated)" : "transparent", border: p.covered ? "0.5px solid var(--border)" : "1px dashed var(--text-primary)" }}>
              <DiscDot d={p.discipline} size={8} />
              <div style={{ fontSize: 10, marginTop: 5, color: "var(--text-tertiary)" }}>{DISC[p.discipline].label}</div>
              <div className="mono" style={{ fontSize: 9, color: p.covered ? "var(--green)" : "var(--text-primary)", marginTop: 2, fontWeight: 600 }}>{p.covered ? `${p.devs.length} dev` : "gap"}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepReview({ mode, setMode, dispatched, onDispatch }: {
  mode: string; setMode: (v: string) => void; dispatched: boolean; onDispatch: () => void;
}) {
  const { members } = useApp();
  const byUser = (u: string) => members.find((m) => m.username === u);
  const p = DISPATCH_PREVIEW;
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Dispatch preview" sub="The router can clear a relay with no human in the loop — so creating the real GitLab project is a separate, explicit commit. Review the irreversible side-effects." />

      <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden", marginBottom: 16, boxShadow: "var(--shadow-1)" }}>
        <div style={{ padding: 16, borderBottom: "0.5px solid var(--border-subtle)" }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Creates</div>
          <div style={{ display: "flex", gap: 22 }}>
            <Stat n={p.creates.project} l="GitLab project" mono={p.project_name} />
            <Stat n={p.creates.issues} l="issues" />
            <Stat n={p.invite_count} l="member invites" />
          </div>
        </div>
        <div style={{ padding: 16 }}>
          <div className="kicker" style={{ marginBottom: 10 }}>Member invites · free tier cap {p.free_tier_cap}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: p.exceeds_cap ? 12 : 0 }}>
            {p.member_invites.map((m, i) => (
              <span key={m.username} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 9px 0 5px",
                borderRadius: "var(--r-pill)", background: i >= p.free_tier_cap ? "var(--bg-active)" : "var(--bg-secondary)",
                border: i >= p.free_tier_cap ? "0.5px solid var(--text-primary)" : "0.5px solid transparent" }}>
                <Avatar name={byUser(m.username)?.name ?? m.username} size={18} />
                <span style={{ fontSize: 11.5, fontWeight: 500 }}>{(byUser(m.username)?.name ?? m.username).split(" ")[0]}</span>
                {i >= p.free_tier_cap && <span className="mono" style={{ fontSize: 9.5, color: "var(--text-primary)", fontWeight: 600 }}>over</span>}
              </span>
            ))}
          </div>
          {p.exceeds_cap && (
            <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: "var(--r-md)", background: "rgba(212,58,58,0.08)", border: "0.5px solid var(--red)" }}>
              <Icon name="flag" size={14} style={{ color: "var(--red)", flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: "var(--red)", lineHeight: 1.45 }}>
                {p.invite_count} invites exceeds the {p.free_tier_cap}-member free-tier cap. Drop {p.invite_count - p.free_tier_cap} member or upgrade before dispatch.
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="kicker" style={{ marginBottom: 8 }}>Dispatch mode</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {([["supervised", "Supervised", "You ratify every expert gate"], ["autonomous", "Autonomous", "Auto-pass clears with no human"]] as const).map(([id, label, desc]) => {
          const on = mode === id;
          return (
            <button key={id} onClick={() => setMode(id)} style={{ flex: 1, textAlign: "left", padding: 13, borderRadius: "var(--r-lg)",
              border: `0.5px solid ${on ? "var(--text-primary)" : "var(--border)"}`, background: "var(--bg-elevated)", boxShadow: on ? "var(--shadow-2)" : "var(--shadow-1)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                <span style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${on ? "var(--text-primary)" : "var(--border-strong)"}`, display: "grid", placeItems: "center" }}>
                  {on && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--text-primary)" }} />}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", paddingLeft: 22 }}>{desc}</div>
            </button>
          );
        })}
      </div>

      <Button variant="primary" size="lg" icon="gitlab" style={{ width: "100%", opacity: dispatched ? 0.5 : 1 }} disabled={dispatched} onClick={onDispatch}>
        {dispatched ? "Dispatched to GitLab" : `Dispatch — create ${DISPATCH_PREVIEW.project_name}`}
      </Button>
      <p style={{ fontSize: 11.5, color: "var(--text-quaternary)", textAlign: "center", margin: "10px 0 0", lineHeight: 1.5 }}>
        Irreversible. Scaffolds the real GitLab project, issues, and invites.
      </p>
    </div>
  );
}

function Stat({ n, l, mono }: { n: number; l: string; mono?: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.5px" }}>{n}</div>
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 2 }}>{l}</div>
      {mono && <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", marginTop: 1 }}>{mono}</div>}
    </div>
  );
}
function WizHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px", margin: 0 }}>{title}</h1>
      <p style={{ fontSize: 14, color: "var(--text-tertiary)", margin: "8px 0 0", lineHeight: 1.55, maxWidth: 520 }}>{sub}</p>
    </div>
  );
}
