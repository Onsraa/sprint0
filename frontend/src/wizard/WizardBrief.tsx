/* sprint0 — Brief-intake Wizard (§3). The product's front door: brief → clarify →
   architecture → plan → dispatch. Steps map 1:1 to endpoints. Grounded on agency
   memory (§2b), surfaces the staffing gap (§7), ends in a dispatch dry-run (§13) —
   nothing is created in GitLab until the relay clears (create-late).

   Motion: brief→clarify runs an AI "digest" loader; the clarify spec is revealed
   progressively top-to-bottom; the stepper drips + checks as you advance; dispatch
   runs a loader then offers a redirect to Projects. Drafts save to Projects.

   Ported pixel-1:1 from the v5 mockup (app/Wizard.jsx). The v5 visual structure +
   animations are preserved verbatim; only the data source changed: the scripted
   spec/architectures/plan/preview constants are now real async state from the API
   (createBrief→clarify→architectures→plan/staffing→dispatchPreview→dispatch). The
   existing SequenceLoader covers each async wait. */
import { Fragment, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "../lib/query";
import { toast } from "sonner";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { Icon, ZeroMark, FullLogo } from "../lib/icon";
import { Button, Avatar, Badge, DiscDot, DISC, CapTag } from "../components/ui";
import { Stepper, SequenceLoader, ConfirmDraft } from "./WizardMotion";
import { RatifyPanel, GATE_META } from "../views/RatifyPanel";
import { api } from "../lib/api";
import type {
  ArchitectureCard,
  ClarifiedSpec,
  PlanJSON,
  RelayState,
  StaffingResponse,
  TechStack,
} from "../lib/api";
// DispatchPreview lives in schemas (api.ts consumes it as S.DispatchPreview, does not re-export it).
import type { DispatchPreview } from "../lib/schemas";

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
  { id: "contract", label: "Gates", sub: "Ratify the gates" },
  { id: "review", label: "Review", sub: "Dispatch preview" },
];

const DEFAULT_BRIEF = `Build a tenant portal for a freight client. They need: a saved-search experience over shipments, shareable read-only views with expiring links, a live map with thousands of vehicle pins, and CSV export of any filtered view. Must scaffold a real GitLab project. Tight 8-week window.`;

/* The async loaders shown during each wait. The SequenceLoader animates a fixed line
   sequence; the real API call runs in parallel and `onDone` commits + advances once the
   data has landed (see runLoader). */
type LoaderCfg = { kicker: string; headline: React.ReactNode; lines: string[]; stepMs?: number };

export function WizardBrief() {
  const { setView, members, addDraft, gates, actGate, dial } = useApp();
  const setWizardOpen = useUI((s) => s.setWizardOpen);
  const setUiPlanId = useUI((s) => s.setPlanId);
  const removeDraftByName = useUI((s) => s.removeDraftByName);
  const qc = useQueryClient();

  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [mode, setMode] = useState<"supervised" | "autonomous">("supervised");
  const [confirmDraft, setConfirmDraft] = useState(false);

  // real async state (replaces the scripted WIZARD_SPEC/WIZARD_ARCHITECTURES/DISPATCH_PREVIEW/STAFFING)
  const [briefId, setBriefId] = useState<string | null>(null);
  const [spec, setSpec] = useState<ClarifiedSpec | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cards, setCards] = useState<ArchitectureCard[]>([]);
  const [chosenStack, setChosenStack] = useState<TechStack | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanJSON | null>(null);
  const [relay, setRelay] = useState<RelayState | null>(null);
  const [staffing, setStaffing] = useState<StaffingResponse | null>(null);
  const [preview, setPreview] = useState<DispatchPreview | null>(null);

  // generic SequenceLoader driver: the loader animates while the real call runs; we advance
  // only once the call resolved (commitRef holds the "what to do next" set by the resolved call).
  const [loader, setLoader] = useState<LoaderCfg | null>(null);
  const commitRef = useRef<(() => void) | null>(null);
  const loaderDoneRef = useRef(false);

  const [dispatching, setDispatching] = useState(false);
  const [dispatched, setDispatched] = useState(false);

  /** Show `cfg` loader, run `work()`; advance via `onDone` once BOTH the animation and the call finish. */
  const runLoader = (cfg: LoaderCfg, work: () => Promise<void>, errMsg: string) => {
    loaderDoneRef.current = false;
    commitRef.current = null;
    setLoader(cfg);
    work()
      .then(() => {
        // the call landed (commitRef now set by work). If the animation already finished, onDone ran
        // with nothing to do — so advance here; otherwise onDone will run the commit when it finishes.
        if (loaderDoneRef.current && commitRef.current) {
          commitRef.current();
          commitRef.current = null;
          setLoader(null);
        }
      })
      .catch((e) => {
        setLoader(null);
        toast.error(e instanceof Error ? e.message : errMsg);
      });
  };
  // the loader's onDone: if the call already committed its `next`, run it + close; else mark done so the
  // resolved call closes the loader (keeps the loader up for the *entire* async wait, never flickering).
  const onLoaderDone = () => {
    loaderDoneRef.current = true;
    if (commitRef.current) {
      commitRef.current();
      commitRef.current = null;
      setLoader(null);
    }
  };

  const ambiguityCount = spec?.ambiguities.length ?? 0;
  const relayCleared = gates.length > 0 && gates.every((g: any) => g.status === "ratified" || g.status === "auto_passed");
  const canNext =
    step === 0 ? brief.trim().length > 20 :
    step === 1 ? ambiguityCount === 0 || Object.keys(answers).length === ambiguityCount :
    step === 2 ? !!chosenStack :
    step === 4 ? relayCleared :
    true;

  // STEP 0 → 1: createBrief, then clarify (the AI "digest" loader)
  const goClarify = () => {
    runLoader(
      {
        kicker: "sprint0 · clarify",
        headline: "Digesting the brief",
        lines: ["Reading the brief", "Extracting features", "Cross-referencing agency memory", "Flagging ambiguities that need a call"],
      },
      async () => {
        const { brief_id } = await api.createBrief({ text: brief });
        const s = await api.clarify(brief_id);
        setBriefId(brief_id);
        setSpec(s);
        setAnswers({});
        commitRef.current = () => setStep(1);
      },
      "Could not clarify the brief",
    );
  };

  // STEP 1 → 2: resolve ambiguities, then fetch architectures
  const goArch = () => {
    if (!briefId) return;
    runLoader(
      {
        kicker: "sprint0 · architecture",
        headline: "Grounding the stack",
        lines: ["Resolving the ambiguities you answered", "Scanning validated modules in memory", "Drafting grounded architecture options"],
      },
      async () => {
        if (Object.keys(answers).length) {
          const updated = await api.resolveClarify(briefId, answers);
          setSpec(updated);
        }
        const opts = await api.architectures(briefId);
        setCards(opts.cards);
        // default the choice to the first (recommended) card's stack
        setChosenStack(opts.cards[0]?.tech_stack ?? null);
        commitRef.current = () => setStep(2);
      },
      "Could not generate architectures",
    );
  };

  // STEP 2 → 3: plan from the chosen stack, then staffing coverage
  const goPlan = () => {
    if (!briefId || !chosenStack) return;
    runLoader(
      {
        kicker: "sprint0 · plan",
        headline: "Drafting the relay",
        lines: ["Planning epics and issues", "Sequencing the discipline relay", "Checking team coverage for each gate"],
      },
      async () => {
        const res = await api.plan(briefId, { chosen_stack: chosenStack });
        setPlanId(res.plan_id);
        setPlan(res.plan);
        setRelay(res.relay);
        try {
          setStaffing(await api.staffing(res.plan_id));
        } catch {
          setStaffing({ coverage: [] }); // staffing is advisory — never block the plan step
        }
        commitRef.current = () => setStep(3);
      },
      "Could not generate the plan",
    );
  };

  // STEP 3 → 4: apply the Autonomy posture (auto-pass low-risk gates), then the Contract step
  const goContract = () => {
    if (!planId) return;
    setUiPlanId(planId);  // point useApp().gates + the Contract (RatifyPanel) at this plan
    runLoader(
      {
        kicker: "sprint0 · gates",
        headline: "Applying your posture",
        lines: ["Scoring trust × risk per gate", "Auto-passing the low-risk gates", "Surfacing the gates that need your call"],
      },
      async () => {
        await api.relayAuto(planId, dial);
        commitRef.current = () => setStep(4);
      },
      "Could not apply the posture",
    );
  };

  // STEP 4 → 5: dispatch dry-run preview
  const goReview = () => {
    if (!planId) return;
    runLoader(
      {
        kicker: "sprint0 · review",
        headline: "Building the dispatch preview",
        lines: ["Resolving the GitLab project name", "Counting issues to scaffold", "Reconciling member invites against the free-tier cap"],
        stepMs: 640,
      },
      async () => {
        setPreview(await api.dispatchPreview(planId));
        commitRef.current = () => setStep(5);
      },
      "Could not build the dispatch preview",
    );
  };

  const back = () => setStep((s) => Math.max(s - 1, 0));
  const onPrimary = () => {
    if (step === 0) return goClarify();
    if (step === 1) return goArch();
    if (step === 2) return goPlan();
    if (step === 3) return goContract();
    if (step === 4) return goReview();
  };

  const closeToProjects = () => { setView("projects"); setWizardOpen(false); };

  const archStack = chosenStack ? Object.values(chosenStack).filter(Boolean) : [];
  const previewName = preview?.project_name ?? plan?.project_name ?? "New project";
  const saveDraft = () => {
    addDraft({
      name: previewName, code: "FRGT", accent: "var(--disc-frontend)",
      stack: archStack, issues: 0, devs: 0,
      grounded: (spec?.reuse ?? []).map((r) => r.feature),
      summary: "Draft from brief — clarified spec, not yet dispatched.",
      savedAt: STEPS[step].label });
    setConfirmDraft(false);
    toast("Saved as draft", { description: previewName + " · in Projects ▸ Drafts" });
    closeToProjects();
  };

  // run dispatch on confirm; the SequenceLoader plays while the real call runs, then shows the success card
  const onDispatch = () => {
    if (!planId) return;
    loaderDoneRef.current = false; // reset so the dispatch loader always plays through
    commitRef.current = null;
    setDispatching(true);
    api
      .dispatch(planId, mode === "supervised" ? "copilot" : "autonomous")
      .then(() => {
        qc.invalidateQueries({ queryKey: ["work"] });        // the dispatched project's tasks now show
        qc.invalidateQueries({ queryKey: qk.projects() });
        qc.invalidateQueries({ queryKey: qk.allRelays() });
        removeDraftByName(previewName);                       // the real project replaces the stale draft
        commitRef.current = () => { setDispatching(false); setDispatched(true);
          toast("Dispatched to GitLab", { description: previewName + " · " + mode }); };
        // if the dispatch loader already finished animating, advance now; else its onDone will
        if (loaderDoneRef.current) { commitRef.current(); commitRef.current = null; }
      })
      .catch((e) => { setDispatching(false); toast.error(e instanceof Error ? e.message : "Dispatch failed"); });
  };

  const busy = loader != null || dispatching;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-app)" }}>
      {/* top chrome */}
      <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "0 18px" }}>
        <FullLogo size={17} />
        <span style={{ fontSize: 12, color: "var(--text-quaternary)", fontWeight: 500 }}>· New project from brief</span>
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" icon="close" onClick={closeToProjects}>Cancel</Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "0 8px 8px", display: "flex", gap: 8, position: "relative" }}>
        {/* stepper rail (animated) */}
        <Stepper steps={STEPS} step={dispatched ? STEPS.length : step} />

        {/* main pane */}
        <div className="pane" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ flex: 1, overflow: "auto", padding: "32px 0" }}>
            <div style={{ maxWidth: 660, margin: "0 auto", padding: "0 32px" }}>
              {loader ? (
                <SequenceLoader
                  kicker={loader.kicker}
                  headline={loader.headline}
                  lines={loader.lines}
                  stepMs={loader.stepMs}
                  onDone={onLoaderDone} />
              ) : (
                <>
                  {step === 0 && <StepBrief brief={brief} setBrief={setBrief} />}
                  {step === 1 && spec && <StepClarify spec={spec} answers={answers} setAnswers={setAnswers} />}
                  {step === 2 && <StepArch cards={cards} chosenStack={chosenStack} setChosenStack={setChosenStack} />}
                  {step === 3 && plan && <StepPlan plan={plan} relay={relay} staffing={staffing} members={members} />}
                  {step === 4 && <StepContract gates={gates} actGate={actGate} />}
                  {step === 5 && preview && <StepReview mode={mode} setMode={setMode}
                    preview={preview} members={members}
                    dispatching={dispatching} dispatched={dispatched}
                    onDispatch={onDispatch}
                    onDone={onLoaderDone}
                    onGoProjects={closeToProjects} />}
                </>
              )}
            </div>
          </div>

          {/* footer nav — hidden while a loader runs or after dispatch */}
          {!busy && !dispatched && (
            <div style={{ borderTop: "0.5px solid var(--border-subtle)", padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <Button variant="ghost" size="md" icon="chevronLeft" onClick={step === 0 ? closeToProjects : back}>{step === 0 ? "Cancel" : "Back"}</Button>
              <Button variant="secondary" size="md" icon="clock" onClick={() => setConfirmDraft(true)}>Save draft</Button>
              <div style={{ flex: 1 }} />
              {step < STEPS.length - 1 &&
              <Button variant="primary" size="md" iconRight="arrowRight" disabled={!canNext} style={{ opacity: canNext ? 1 : 0.45 }} onClick={onPrimary}>
                  {step === 0 ? "Clarify spec" : step === 1 ? "Generate architectures" : step === 2 ? "Generate plan" : step === 3 ? "Ratify the gates" : "Review & dispatch"}
                </Button>}
            </div>
          )}
        </div>

        {confirmDraft && <ConfirmDraft name={previewName} onConfirm={saveDraft} onCancel={() => setConfirmDraft(false)} />}
      </div>
    </div>);

}

function GroundingStrip({ reuse, delay = 0 }: { reuse: ClarifiedSpec["reuse"]; delay?: number }) {
  if (!reuse.length) return null;
  return (
    <div className="s0-stagger" style={{ "--d": `${delay}ms`, border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 14, background: "var(--bg-secondary)" } as React.CSSProperties}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <ZeroMark size={15} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Grounded on agency memory</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>§reuse</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {reuse.map((r, i) =>
        <div key={`${r.from_project}-${r.feature}-${i}`} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <CapTag tag={r.feature} />
            <span style={{ fontSize: 12, color: "var(--text-tertiary)", flex: 1 }}>
              {r.action} from <b style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{r.from_project}</b>
            </span>
            <GradeChip grade={r.action === "reuse" ? "prod_survived" : r.action === "adapt" ? "shipped" : "proposed"} showLabel={false} />
          </div>
        )}
      </div>
    </div>);

}

function StepBrief({ brief, setBrief }: { brief: string; setBrief: (v: string) => void }) {
  const [focus, setFocus] = useState(false);
  const [over, setOver] = useState(false);
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Drop the client brief" sub="Paste the text or drop a PDF. The AI extracts a spec and proposes reuse before you commit anything." />
      <div className="kicker" style={{ marginBottom: 8 }}>Brief</div>
      <textarea value={brief} onChange={(e) => setBrief(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} rows={8}
      style={{ width: "100%", padding: "14px 16px", fontSize: 14, lineHeight: 1.6, resize: "vertical",
        background: "var(--bg-elevated)", borderRadius: "var(--r-lg)",
        border: `0.5px solid ${focus ? "var(--text-primary)" : "var(--border-strong)"}`,
        boxShadow: focus ? "0 0 0 3px var(--bg-active), var(--shadow-inset)" : "var(--shadow-inset)",
        outline: "none", color: "var(--text-primary)", fontFamily: "var(--font-ui)", marginBottom: 12,
        transition: "border-color var(--t-reg), box-shadow var(--t-reg)" }} />
      <button className="s0-press"
        onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 64,
        border: `1.2px dashed ${over ? "var(--text-primary)" : "var(--border-strong)"}`, borderRadius: "var(--r-lg)",
        color: over ? "var(--text-primary)" : "var(--text-tertiary)",
        fontSize: 13, fontWeight: 500, background: over ? "var(--bg-secondary)" : "var(--bg-base)" }}>
        <Icon name="inbox" size={16} /> Drop a PDF, or click to browse
      </button>
    </div>);

}

function StepClarify({ spec, answers, setAnswers }: {
  spec: ClarifiedSpec;
  answers: Record<string, string>; setAnswers: (fn: (ans: Record<string, string>) => Record<string, string>) => void;
}) {
  // progressive reveal: assign an increasing delay to each row, top → bottom
  let d = 0;
  return (
    <div>
      <div className="s0-stagger" style={{ "--d": "0ms" } as React.CSSProperties}><WizHead title="Clarify the spec" sub="The AI pulled these features and flagged a few ambiguities. Answer them so the plan is grounded, not guessed." /></div>

      <div className="s0-stagger kicker" style={{ "--d": `${(d = 90)}ms`, marginBottom: 8 } as React.CSSProperties}>Extracted features · {spec.must_haves.length}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 22 }}>
        {spec.must_haves.map((title, i) =>
        <div key={i} className="s0-stagger" style={{ "--d": `${(d += 55)}ms`, display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 10px", borderRadius: "var(--r-md)" } as React.CSSProperties}>
            <Icon name="check" size={14} style={{ color: "var(--green)" }} />
            <span style={{ fontSize: 13, flex: 1 }}>{title}</span>
          </div>
        )}
      </div>

      <div className="s0-stagger kicker" style={{ "--d": `${(d += 70)}ms`, marginBottom: 8 } as React.CSSProperties}>Ambiguities · {spec.ambiguities.length} need a call</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
        {spec.ambiguities.map((a) =>
        <div key={a.id} className="s0-stagger" style={{ "--d": `${(d += 75)}ms`, border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 14, boxShadow: "var(--shadow-1)" } as React.CSSProperties}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>{a.question}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {a.options.map((o) => {
              const on = answers[a.id] === o;
              return (
                <button key={o} className="s0-press" onClick={() => setAnswers((ans) => ({ ...ans, [a.id]: o }))}
                style={{ height: 30, padding: "0 12px", borderRadius: "var(--r-md)", fontSize: 12.5, fontWeight: 500,
                  background: on ? "var(--text-primary)" : "var(--bg-elevated)", color: on ? "#fff" : "var(--text-secondary)",
                  border: `0.5px solid ${on ? "var(--text-primary)" : "var(--border-strong)"}`, boxShadow: on ? "none" : "var(--shadow-1)" }}>
                    {o}
                  </button>);

            })}
            </div>
          </div>
        )}
      </div>

      <GroundingStrip reuse={spec.reuse} delay={d += 80} />
    </div>);

}

function StepArch({ cards, chosenStack, setChosenStack }: {
  cards: ArchitectureCard[]; chosenStack: TechStack | null; setChosenStack: (s: TechStack) => void;
}) {
  const sameStack = (a: TechStack | null, b: TechStack) =>
    !!a && a.frontend === b.frontend && a.backend === b.backend && a.db === b.db && a.infra === b.infra;
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Pick a stack" sub="Grounded architecture options — the recommended one reuses the most validated modules from memory." />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {cards.map((o, idx) => {
          const stack = Object.values(o.tech_stack).filter(Boolean);
          const grounded = o.grounded_on ?? [];
          const on = sameStack(chosenStack, o.tech_stack);
          return (
            <button key={o.name + idx} className="s0-press" onClick={() => setChosenStack(o.tech_stack)} style={{ textAlign: "left", width: "100%",
              border: `0.5px solid ${on ? "var(--text-primary)" : "var(--border)"}`, borderRadius: "var(--r-lg)", padding: 16,
              background: "var(--bg-elevated)", boxShadow: on ? "var(--shadow-2)" : "var(--shadow-1)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${on ? "var(--text-primary)" : "var(--border-strong)"}`,
                  display: "grid", placeItems: "center", transition: "border-color var(--t-reg)" }}>{on && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--text-primary)", animation: "s0-check-pop 0.3s var(--ease-out) both" }} />}</span>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", flex: 1 }}>{stack.map((s) => <Badge key={s} tone="outline">{s}</Badge>)}</div>
                {idx === 0 && <Badge tone="ink">recommended</Badge>}
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 6px", lineHeight: 1.5 }}>{o.rationale}</p>
              <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "0 0 10px", lineHeight: 1.5 }}><b style={{ fontWeight: 500 }}>Trade-off:</b> {o.fit_to_constraints}</p>
              {grounded.length > 0 &&
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <ZeroMark size={13} /><span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>reuses</span>
                  {grounded.map((g) => <CapTag key={g} tag={g} />)}
                </div>
              }
            </button>);

        })}
      </div>
    </div>);

}

function StepPlan({ plan, relay, staffing, members }: {
  plan: PlanJSON; relay: RelayState | null; staffing: StaffingResponse | null; members: any[];
}) {
  const byUser = (u: string) => members.find((m: any) => m.username === u);
  const issueCount = plan.epics.reduce((n, e) => n + e.issues.length, 0);

  // coverage from the real staffing response; derive gaps + per-discipline devs from plan assignees
  const coverage = staffing?.coverage ?? [];
  const gaps = coverage.filter((c) => !c.covered).map((c) => c.discipline);
  const allIssues = plan.epics.flatMap((e) => e.issues);
  const devsFor = (disc: string) =>
    Array.from(new Set(allIssues.filter((i) => i.discipline === disc && i.assignee).map((i) => i.assignee as string)));

  // relay order: prefer the real baton sequence, fall back to the canonical relay order
  const order = relay?.baton?.length ? relay.baton : ["uiux", "backend", "devops", "frontend", "qa"];
  // top stretch candidate for the first gap (advisory copy)
  const firstGap = coverage.find((c) => !c.covered);
  const topStretch = firstGap?.recommendation?.stretch_candidates?.[0] ?? null;

  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Plan & draft relay" sub={`${issueCount} issues planned across the relay. The plan enters as a draft — nothing ships until the gates clear.`} />

      <div className="kicker" style={{ marginBottom: 10 }}>Draft relay</div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 4px 20px" }}>
        {order.map((dd, i) =>
        <Fragment key={dd}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span style={{ width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center",
              background: gaps.includes(dd as never) ? "var(--bg-elevated)" : "var(--bg-secondary)",
              border: gaps.includes(dd as never) ? "1px dashed var(--text-primary)" : "0.5px solid var(--border)" }}>
                <DiscDot d={dd} size={9} />
              </span>
              <span style={{ fontSize: 9.5, color: gaps.includes(dd as never) ? "var(--text-primary)" : "var(--text-quaternary)", fontWeight: gaps.includes(dd as never) ? 600 : 400 }}>{DISC[dd]?.label ?? dd}</span>
            </div>
            {i < order.length - 1 && <span style={{ flex: 1, height: 1, background: "var(--border-strong)", marginTop: -16 }} />}
          </Fragment>
        )}
      </div>

      {/* §7 staffing in review */}
      {coverage.length > 0 &&
      <div style={{ border: "0.5px solid var(--text-primary)", borderRadius: "var(--r-lg)", padding: 14, background: "var(--bg-secondary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Icon name="team" size={15} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Coverage</span>
          <div style={{ flex: 1 }} />
          <Badge tone="outline" mono>{gaps.length} gap{gaps.length === 1 ? "" : "s"}</Badge>
        </div>
        {gaps.length > 0 ?
        <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "0 0 10px", lineHeight: 1.5 }}>
          <b style={{ color: "var(--text-primary)", fontWeight: 500 }}>{DISC[gaps[0]]?.label ?? gaps[0]}</b> has no dedicated dev — its gate routes to you (manager).{topStretch && <> Strongest stretch: <b style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{byUser(topStretch.username)?.name ?? topStretch.username}</b> (match {topStretch.score}).</>}
        </p> :
        <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "0 0 10px", lineHeight: 1.5 }}>Every discipline in the relay has a dedicated lead — no orphan gates.</p>}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${coverage.length},1fr)`, gap: 6 }}>
          {coverage.map((p) => {
            const devs = devsFor(p.discipline);
            return (
            <div key={p.discipline} style={{ textAlign: "center", padding: "8px 4px", borderRadius: "var(--r-md)",
              background: p.covered ? "var(--bg-elevated)" : "transparent", border: p.covered ? "0.5px solid var(--border)" : "1px dashed var(--text-primary)" }}>
              <DiscDot d={p.discipline} size={8} />
              <div style={{ fontSize: 10, marginTop: 5, color: "var(--text-tertiary)" }}>{DISC[p.discipline]?.label ?? p.discipline}</div>
              <div className="mono" style={{ fontSize: 9, color: p.covered ? "var(--green)" : "var(--text-primary)", marginTop: 2, fontWeight: 600 }}>{p.covered ? `${devs.length} dev` : "gap"}</div>
            </div>);
          })}
        </div>
      </div>}
    </div>);

}

/* The Contract step — sign each open gate's reuse-or-innovate Contract (the posture auto-passed the rest). */
function StepContract({ gates, actGate }: { gates: any[]; actGate: (d: string, s: string) => void }) {
  const isDone = (g: any) => g.status === "ratified" || g.status === "auto_passed";
  const isOpen = (g: any) => !isDone(g) && g.status !== "locked";
  const open = gates.filter(isOpen);
  const [focus, setFocus] = useState<string | null>(null);
  const focused = gates.find((g) => g.discipline === focus && isOpen(g)) ?? open[0] ?? null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 5px" }}>Ratify the gates</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.55 }}>
          Your Autonomy posture auto-passed the low-risk gates. Sign the rest — reuse from agency memory, take a fresh option, or write your own — to clear the relay before dispatch.
        </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {gates.map((g: any) => {
          const d = isDone(g); const o = isOpen(g); const meta = GATE_META[g.status];
          return (
            <button key={g.discipline} disabled={!o} onClick={() => o && setFocus(g.discipline)}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: "var(--r-md)",
                border: focused?.discipline === g.discipline ? "0.5px solid var(--text-primary)" : "0.5px solid var(--border)",
                background: "var(--bg-elevated)", cursor: o ? "pointer" : "default", opacity: g.status === "locked" ? 0.5 : 1 }}>
              {d ? <Icon name="check" size={12} style={{ color: "var(--green)" }} /> : <DiscDot d={g.discipline} size={8} />}
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{DISC[g.discipline]?.label ?? g.discipline}</span>
              <span style={{ fontSize: 10.5, color: meta?.fg }}>{meta?.label}</span>
            </button>
          );
        })}
      </div>
      {open.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{open.length} gate{open.length > 1 ? "s" : ""} need your call.</span>
          <Button variant="secondary" size="sm" onClick={() => open.forEach((g) => actGate(g.discipline, "ratified"))}>Ratify all remaining (accept drafts)</Button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 12, background: "var(--bg-secondary)", borderRadius: "var(--r-md)", fontSize: 13, color: "var(--text-secondary)" }}>
          <Icon name="check" size={15} style={{ color: "var(--green)" }} />Relay cleared — continue to the dispatch preview.
        </div>
      )}
      {focused && (
        <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden", display: "flex", minHeight: 380, maxHeight: 560 }}>
          <RatifyPanel g={focused} />
        </div>
      )}
    </div>
  );
}

function StepReview({ mode, setMode, preview, members, dispatching, dispatched, onDispatch, onDone, onGoProjects }: {
  mode: "supervised" | "autonomous"; setMode: (v: "supervised" | "autonomous") => void;
  preview: DispatchPreview; members: any[];
  dispatching: boolean; dispatched: boolean;
  onDispatch: () => void; onDone: () => void; onGoProjects: () => void;
}) {
  const byUser = (u: string) => members.find((m: any) => m.username === u);
  const p = preview;

  if (dispatching)
    return (
      <SequenceLoader
        kicker="sprint0 · dispatch"
        headline={`Creating ${p.project_name}`}
        lines={["Creating the GitLab project", `Scaffolding ${p.creates.issues} issues across the relay`, `Sending ${p.invite_count} member invites`, "Opening the supervised relay"]}
        stepMs={780}
        onDone={onDone} />);

  if (dispatched)
    return (
      <div style={{ maxWidth: 480, margin: "12px auto", textAlign: "center", animation: "s0-rise 0.4s var(--ease-out) both" }}>
        <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--text-primary)", display: "grid", placeItems: "center", margin: "0 auto 18px", animation: "s0-check-pop 0.45s var(--ease-out) both" }}>
          <Icon name="check" size={28} style={{ color: "#fff" }} />
        </span>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 8px" }}>Dispatched to GitLab</h1>
        <p style={{ fontSize: 14, color: "var(--text-tertiary)", lineHeight: 1.55, margin: "0 0 22px" }}>
          <b style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{p.project_name}</b> is live — {p.creates.issues} issues scaffolded across the relay in <b style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{mode}</b> mode.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <Button variant="primary" size="lg" iconRight="arrowRight" onClick={onGoProjects}>Go to Projects</Button>
        </div>
      </div>);

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
            {p.member_invites.map((username, i) =>
            <span key={username} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 9px 0 5px",
              borderRadius: "var(--r-pill)", background: i >= p.free_tier_cap ? "var(--bg-active)" : "var(--bg-secondary)",
              border: i >= p.free_tier_cap ? "0.5px solid var(--text-primary)" : "0.5px solid transparent" }}>
                <Avatar name={byUser(username)?.name ?? username} size={18} />
                <span style={{ fontSize: 11.5, fontWeight: 500 }}>{(byUser(username)?.name ?? username).split(" ")[0]}</span>
                {i >= p.free_tier_cap && <span className="mono" style={{ fontSize: 9.5, color: "var(--text-primary)", fontWeight: 600 }}>over</span>}
              </span>
            )}
          </div>
          {p.exceeds_cap &&
          <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: "var(--r-md)", background: "rgba(212,58,58,0.08)", border: "0.5px solid var(--red)" }}>
              <Icon name="flag" size={14} style={{ color: "var(--red)", flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: "var(--red)", lineHeight: 1.45 }}>
                {p.invite_count} invites exceeds the {p.free_tier_cap}-member free-tier cap. Drop {p.invite_count - p.free_tier_cap} member or upgrade before dispatch.
              </span>
            </div>
          }
        </div>
      </div>

      <div className="kicker" style={{ marginBottom: 8 }}>Dispatch mode</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {([["supervised", "Supervised", "You ratify every expert gate"], ["autonomous", "Autonomous", "Auto-pass clears with no human"]] as const).map(([id, label, desc]) => {
          const on = mode === id;
          return (
            <button key={id} className="s0-press" onClick={() => setMode(id)} style={{ flex: 1, textAlign: "left", padding: 13, borderRadius: "var(--r-lg)",
              border: `0.5px solid ${on ? "var(--text-primary)" : "var(--border)"}`, background: "var(--bg-elevated)", boxShadow: on ? "var(--shadow-2)" : "var(--shadow-1)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                <span style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${on ? "var(--text-primary)" : "var(--border-strong)"}`, display: "grid", placeItems: "center" }}>
                  {on && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--text-primary)" }} />}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", paddingLeft: 22 }}>{desc}</div>
            </button>);

        })}
      </div>

      <Button variant="primary" size="lg" icon="gitlab" className="s0-press" style={{ width: "100%" }} onClick={onDispatch}>
        {`Dispatch — create ${p.project_name}`}
      </Button>
      <p style={{ fontSize: 11.5, color: "var(--text-quaternary)", textAlign: "center", margin: "10px 0 0", lineHeight: 1.5 }}>
        Irreversible. Scaffolds the real GitLab project, issues, and invites.
      </p>
    </div>);

}

function Stat({ n, l, mono }: { n: number; l: string; mono?: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.5px" }}>{n}</div>
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 2 }}>{l}</div>
      {mono && <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", marginTop: 1 }}>{mono}</div>}
    </div>);

}
function WizHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px", margin: 0 }}>{title}</h1>
      <p style={{ fontSize: 14, color: "var(--text-tertiary)", margin: "8px 0 0", lineHeight: 1.55, maxWidth: 520 }}>{sub}</p>
    </div>);

}
