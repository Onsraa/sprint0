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
import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "../lib/query";
import { toast } from "sonner";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { Icon, ZeroMark, FullLogo } from "../lib/icon";
import { Button, Badge, DiscDot, DISC, CapTag } from "../components/ui";
import { Stepper, SequenceLoader, ReActTrace, ConfirmDraft } from "./WizardMotion";
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
  { id: "plan", label: "Plan", sub: "The relay" },
  { id: "review", label: "Review", sub: "Create the project" },
];

const DEFAULT_BRIEF = `Build a tenant portal for a freight client. They need: a saved-search experience over shipments, shareable read-only views with expiring links, a live map with thousands of vehicle pins, and CSV export of any filtered view. Must scaffold a real GitLab project. Tight 8-week window.`;

/* The async loaders shown during each wait. The SequenceLoader animates a fixed line
   sequence; the real API call runs in parallel and `onDone` commits + advances once the
   data has landed (see runLoader). */
type LoaderCfg = { kicker: string; headline: React.ReactNode; lines: string[]; stepMs?: number;
  // when set, the loader renders the live ReActTrace (polling /trace) instead of the scripted SequenceLoader
  phase?: "clarify" | "arch" | "plan" };

export function WizardBrief() {
  const { setView, members, addDraft } = useApp();
  const setWizardOpen = useUI((s) => s.setWizardOpen);
  const removeDraftByName = useUI((s) => s.removeDraftByName);
  const resumeDraft = useUI((s) => s.resumeDraft);
  const setResumeDraft = useUI((s) => s.setResumeDraft);
  const qc = useQueryClient();

  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [confirmDraft, setConfirmDraft] = useState(false);

  // real async state (replaces the scripted WIZARD_SPEC/WIZARD_ARCHITECTURES/DISPATCH_PREVIEW/STAFFING)
  const [briefId, setBriefId] = useState<string | null>(null);
  const [spec, setSpec] = useState<ClarifiedSpec | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cards, setCards] = useState<ArchitectureCard[]>([]);
  const [aiPick, setAiPick] = useState<{ name: string; why: string }>({ name: "", why: "" });
  const [chosenStack, setChosenStack] = useState<TechStack | null>(null);
  const [selectedCardName, setSelectedCardName] = useState<string | null>(null);  // the PICKED card's identity — two cards can share a stack
  const [setupOwner, setSetupOwner] = useState<string | null>(null);  // manager redirected the stack call to a lead → a setup gate
  const [planId, setPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanJSON | null>(null);
  const [relay, setRelay] = useState<RelayState | null>(null);
  const [staffing, setStaffing] = useState<StaffingResponse | null>(null);
  const [preview, setPreview] = useState<DispatchPreview | null>(null);
  const [projectName, setProjectName] = useState("");  // editable; AI auto-fills, the manager validates before create

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
  const canNext =
    step === 0 ? brief.trim().length > 20 :
    step === 1 ? ambiguityCount === 0 || Object.keys(answers).length === ambiguityCount :
    step === 2 ? !!chosenStack :
    true;

  // STEP 0 → 1: createBrief, then clarify (the AI "digest" loader)
  const goClarify = () => {
    runLoader(
      {
        phase: "clarify",
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
        phase: "arch",
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
        setAiPick({ name: opts.ai_pick_name ?? "", why: opts.ai_pick_why ?? "" });
        // default the choice to the AI's own pick (the badged card), else the first
        { const def = opts.cards.find((c) => c.recommended) ?? opts.cards[0];
          setSelectedCardName(def?.name ?? null);
          setChosenStack(def?.tech_stack ?? null); }
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
        phase: "plan",
        kicker: "sprint0 · plan",
        headline: "Drafting the relay",
        lines: ["Planning epics and tasks", "Sequencing the discipline relay", "Checking team coverage for each gate"],
      },
      async () => {
        const res = await api.plan(briefId, { chosen_stack: chosenStack, setup_owner: setupOwner });
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

  // STEP 3 → 4: dispatch dry-run preview (NO ratify/auto-pass step — gates stay open, ratified live after create)
  const goReview = () => {
    if (!planId) return;
    runLoader(
      {
        kicker: "sprint0 · review",
        headline: "Building the create preview",
        lines: ["Resolving the GitLab project name", "Counting the tasks to scaffold", "Readying the relay for its owners"],
        stepMs: 640,
      },
      async () => {
        const pv = await api.dispatchPreview(planId);
        setPreview(pv);
        setProjectName(pv.project_name ?? plan?.project_name ?? "");  // prefill the editable name with the AI's
        commitRef.current = () => setStep(4);
      },
      "Could not build the create preview",
    );
  };

  const back = () => setStep((s) => Math.max(s - 1, 0));
  const onPrimary = () => {
    if (step === 0) return goClarify();
    if (step === 1) return goArch();
    if (step === 2) return goPlan();
    if (step === 3) return goReview();
  };

  // Resume a saved draft: rehydrate per-step state from the server (by briefId/planId) and jump to the saved step.
  useEffect(() => {
    if (!resumeDraft) return;
    const d = resumeDraft;
    setResumeDraft(null);  // consume once
    (async () => {
      try {
        if (d.briefId) {
          setBriefId(d.briefId);
          const b = await api.getBrief(d.briefId).catch(() => null);
          if (b?.text) setBrief(b.text);
          const s = await api.getSpec(d.briefId).catch(() => null);
          if (s) setSpec(s);
          if (d.answers) setAnswers(d.answers);
          if ((d.step ?? 0) >= 2) {
            const opts = await api.getArchitectures(d.briefId).catch(() => null);
            if (opts) {
              setCards(opts.cards);
              setAiPick({ name: opts.ai_pick_name ?? "", why: opts.ai_pick_why ?? "" });
              const pick = (d.selectedCardName && opts.cards.find((c) => c.name === d.selectedCardName))
                || opts.cards.find((c) => c.recommended) || opts.cards[0];
              setSelectedCardName(pick?.name ?? null);
              setChosenStack(pick?.tech_stack ?? null);
            }
          }
        }
        if (d.planId && (d.step ?? 0) >= 3) {
          setPlanId(d.planId);
          const p = await api.getPlan(d.planId).catch(() => null);
          if (p) setPlan(p);
          const r = await api.relay(d.planId).catch(() => null);
          if (r) setRelay(r);
          setStaffing(await api.staffing(d.planId).catch(() => ({ coverage: [] })));
          if ((d.step ?? 0) >= 4) {
            const pv = await api.dispatchPreview(d.planId).catch(() => null);
            if (pv) { setPreview(pv); setProjectName(pv.project_name ?? ""); }
          }
        }
        setStep(Math.min(d.step ?? 0, STEPS.length - 1));
      } catch { /* best-effort restore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeDraft]);

  const closeToProjects = () => { setView("projects"); setWizardOpen(false); };
  const closeToRelays = () => { setView("relays"); setWizardOpen(false); };  // after reserve → the leads ratify here

  const archStack = chosenStack ? Object.values(chosenStack).filter(Boolean) : [];
  const previewName = preview?.project_name ?? plan?.project_name ?? "New project";
  const saveDraft = () => {
    addDraft({
      name: previewName, code: "FRGT", accent: "var(--disc-frontend)",
      stack: archStack, issues: 0, devs: 0,
      grounded: (spec?.reuse ?? []).map((r) => r.feature),
      summary: "Draft from brief — clarified spec, not yet dispatched.",
      savedAt: STEPS[step].label,
      step, briefId, planId, answers, selectedCardName });   // resume context — the wizard rehydrates the rest from the server on reopen
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
    const finalName = projectName.trim() || previewName;
    api
      .reserve(planId, projectName.trim() || undefined)       // PHASE 1: reserve the repo; the relay stays OPEN to ratify
      .then(() => {
        qc.invalidateQueries({ queryKey: qk.projects() });
        qc.invalidateQueries({ queryKey: qk.allRelays() });   // the open relay now shows on the board
        removeDraftByName(previewName);                       // the reserved project replaces the stale draft
        commitRef.current = () => { setDispatching(false); setDispatched(true);
          toast("Project reserved", { description: finalName + " · the relay is open for your leads to ratify" }); };
        // if the loader already finished animating, advance now; else its onDone will
        if (loaderDoneRef.current) { commitRef.current(); commitRef.current = null; }
      })
      .catch((e) => { setDispatching(false); toast.error(e instanceof Error ? e.message : "Reserve failed"); });
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
                loader.phase ? (
                  <ReActTrace
                    runId={briefId}
                    phase={loader.phase}
                    fallback={loader.lines}
                    onDone={onLoaderDone} />
                ) : (
                  <SequenceLoader
                    kicker={loader.kicker}
                    headline={loader.headline}
                    lines={loader.lines}
                    stepMs={loader.stepMs}
                    onDone={onLoaderDone} />
                )
              ) : (
                <>
                  {step === 0 && <StepBrief brief={brief} setBrief={setBrief} />}
                  {step === 1 && spec && <StepClarify spec={spec} answers={answers} setAnswers={setAnswers} />}
                  {step === 2 && <StepArch cards={cards} aiPick={aiPick} selectedCardName={selectedCardName} setSelectedCardName={setSelectedCardName} setChosenStack={setChosenStack} setupOwner={setupOwner} setSetupOwner={setSetupOwner} />}
                  {step === 3 && plan && <StepPlan plan={plan} relay={relay} staffing={staffing} members={members} />}
                  {step === 4 && preview && <StepReview
                    preview={preview} projectName={projectName} setProjectName={setProjectName}
                    dispatching={dispatching} dispatched={dispatched}
                    onDispatch={onDispatch}
                    onDone={onLoaderDone}
                    onGoRelays={closeToRelays} />}
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
                  {step === 0 ? "Clarify spec" : step === 1 ? "Generate architectures" : step === 2 ? "Generate plan" : "Review & create"}
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
              {a.options.filter((o) => o && o.trim()).map((o) => {
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

const TECH_ROWS: { key: keyof TechStack; label: string }[] = [
  { key: "frontend", label: "Frontend" }, { key: "backend", label: "Backend" },
  { key: "db", label: "Database" }, { key: "infra", label: "Infra" },
];

function StepArch({ cards, aiPick, selectedCardName, setSelectedCardName, setChosenStack, setupOwner, setSetupOwner }: {
  cards: ArchitectureCard[]; aiPick: { name: string; why: string }; selectedCardName: string | null; setSelectedCardName: (n: string) => void; setChosenStack: (s: TechStack) => void;
  setupOwner: string | null; setSetupOwner: (u: string | null) => void;
}) {
  const archQ = useQuery({ queryKey: ["architects"], queryFn: () => api.architects() });  // %-match leads for the redirect
  const cols = `96px repeat(${cards.length}, minmax(0, 1fr))`;
  const cell: React.CSSProperties = { padding: "9px 10px", borderTop: "0.5px solid var(--border-subtle)", minWidth: 0 };
  const rowLabel: React.CSSProperties = { ...cell, fontSize: 10.5, color: "var(--text-quaternary)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 };

  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Pick a stack" sub="Compare the options side by side. The AI recommends; you choose." />

      {/* the AI recommends one card; the human chooses */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 12, fontSize: 11.5, color: "var(--text-tertiary)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="bolt" size={12} style={{ color: "var(--amber)" }} /> <b style={{ fontWeight: 600, color: "var(--text-secondary)" }}>AI's pick</b> — the model's own call{aiPick.why ? ` · ${aiPick.why}` : ""}</span>
      </div>

      <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden", background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)" }}>
        {/* selectable card headers */}
        <div style={{ display: "grid", gridTemplateColumns: cols }}>
          <div />
          {cards.map((c) => {
            const on = selectedCardName === c.name;
            return (
              <button key={c.name} className="s0-press" onClick={() => { setSelectedCardName(c.name); setChosenStack(c.tech_stack); setSetupOwner(null); }}
                style={{ textAlign: "left", padding: "11px 10px", borderLeft: "0.5px solid var(--border-subtle)", minWidth: 0,
                  background: on && !setupOwner ? "var(--bg-secondary)" : "transparent", boxShadow: on && !setupOwner ? "inset 0 0 0 1.5px var(--text-primary)" : "none", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <span style={{ width: 15, height: 15, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", border: `1.5px solid ${on ? "var(--text-primary)" : "var(--border-strong)"}`, background: on ? "var(--ink-fill)" : "transparent" }}>{on && <Icon name="check" size={10} style={{ color: "#fff" }} />}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {c.name === aiPick.name && <Badge tone="amber" mono><Icon name="bolt" size={9} /> AI's pick</Badge>}
                </div>
              </button>);
          })}
        </div>

        {/* BLOCK 1 — tech stack, row by row */}
        {TECH_ROWS.map((r) => (
          <div key={r.key} style={{ display: "grid", gridTemplateColumns: cols }}>
            <div style={rowLabel}>{r.label}</div>
            {cards.map((c) => <div key={c.name} className="mono" style={{ ...cell, borderLeft: "0.5px solid var(--border-subtle)", fontSize: 11.5, color: "var(--text-secondary)" }}>{c.tech_stack[r.key]}</div>)}
          </div>
        ))}

        {/* BLOCK 2 — pros / cons */}
        <div style={{ display: "grid", gridTemplateColumns: cols, background: "var(--bg-secondary)" }}>
          <div style={rowLabel}>Trade-offs</div>
          {cards.map((c) => (
            <div key={c.name} style={{ ...cell, borderLeft: "0.5px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 3 }}>
              {(c.pros ?? []).map((p, i) => <span key={"p" + i} style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.35 }}><b style={{ color: "var(--green)" }}>+</b> {p}</span>)}
              {(c.cons ?? []).map((p, i) => <span key={"c" + i} style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.35 }}><b style={{ color: "var(--amber)" }}>−</b> {p}</span>)}
            </div>
          ))}
        </div>

        {/* BLOCK 3 — reuse from memory */}
        <div style={{ display: "grid", gridTemplateColumns: cols }}>
          <div style={rowLabel}>Reuse</div>
          {cards.map((c) => (
            <div key={c.name} style={{ ...cell, borderLeft: "0.5px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 4 }}>
              {(c.reuse ?? []).length ? (c.reuse ?? []).map((r, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.3 }}>{r.feature}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, color: "var(--text-quaternary)" }}><ZeroMark size={9} /> {r.from_project} · {r.action}</span>
                </div>
              )) : <span style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>fresh build — nothing from memory</span>}
            </div>
          ))}
        </div>
      </div>

      {/* or hand the stack call to a lead → becomes a setup gate the lead ratifies before the build starts */}
      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Not sure? Hand the stack call to a lead:</span>
        <select value={setupOwner ?? ""}
          onChange={(e) => { const u = e.target.value || null; setSetupOwner(u); const def = cards.find((c) => c.recommended) ?? cards[0]; if (u && def) { setSelectedCardName(def.name); setChosenStack(def.tech_stack); } }}
          style={{ height: 32, padding: "0 10px", fontSize: 12.5, border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)", background: setupOwner ? "var(--bg-secondary)" : "var(--bg-elevated)", color: "var(--text-primary)", fontFamily: "inherit" }}>
          <option value="">— I'll pick it myself —</option>
          {(archQ.data?.candidates ?? []).map((c: any) => <option key={c.username} value={c.username}>{c.name} · {c.score}% match</option>)}
        </select>
      </div>
      {setupOwner && (
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 7, display: "flex", gap: 7, alignItems: "flex-start" }}>
          <Icon name="merges" size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 1 }} />
          <span>The stack becomes a <b style={{ fontWeight: 600 }}>setup gate</b> — <b style={{ fontWeight: 600 }}>{setupOwner}</b> confirms or overrides it before any discipline gate opens. (The AI's proven pick is the provisional default.)</span>
        </div>
      )}
    </div>);
}

function StepPlan({ plan, relay, staffing, members }: {
  plan: PlanJSON; relay: RelayState | null; staffing: StaffingResponse | null; members: any[];
}) {
  const byUser = (u: string) => members.find((m: any) => m.username === u);
  const taskCount = plan.epics.reduce((n, e) => n + e.issues.length, 0);
  const coverage = staffing?.coverage ?? [];
  const covOf = (disc: string) => coverage.find((c) => c.discipline === disc);
  const allIssues = plan.epics.flatMap((e) => e.issues);
  const leadFor = (disc: string) => allIssues.find((i) => i.discipline === disc && i.assignee)?.assignee as string | undefined;
  // ONE viz from the FULL relay (every gate in DAG order — NOT the baton, which only holds the active ones)
  const gateList = (relay?.gates ?? []).map((g: any) => g.discipline);
  const order = gateList.length ? gateList : coverage.map((c) => c.discipline);
  const gapCount = coverage.filter((c) => !c.covered).length;

  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="The relay" sub={`${taskCount} task${taskCount === 1 ? "" : "s"} across ${order.length} discipline gate${order.length === 1 ? "" : "s"}. Each gate is ratified by its owner — nothing auto-passes.`} />

      <div className="kicker" style={{ marginBottom: 12 }}>Who runs each gate, in order{gapCount > 0 ? ` · ${gapCount} gap${gapCount === 1 ? "" : "s"}` : ""}</div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 0, flexWrap: "wrap", rowGap: 14 }}>
        {order.map((disc: string, i: number) => {
          const cov = covOf(disc);
          const gate = ((relay?.gates ?? []) as any[]).find((g) => g.discipline === disc);
          const isSetup = disc === "setup";  // Architecture: the manager's own gate (or a delegate's), never an orphan
          // owner = the gate's delegate, else an issue-assignee, else the discipline's seated dev (roster).
          const ownerUser = gate?.delegate ?? (isSetup ? undefined : (leadFor(disc) ?? members.find((m: any) => m.role === "developer" && m.discipline === disc)?.username));
          const isGap = isSetup ? false : (cov ? !cov.covered : !ownerUser);
          const leadName = ownerUser ? (byUser(ownerUser)?.name?.split(" ")[0] ?? ownerUser) : (isSetup ? "Manager" : "Routes to you");
          return (
            <Fragment key={disc}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, minWidth: 80 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 8px", borderRadius: "var(--r-lg)", minWidth: 78,
                  background: "var(--bg-elevated)", border: isGap ? "1px dashed var(--text-primary)" : "0.5px solid var(--border)", boxShadow: "var(--shadow-1)" }}>
                  <DiscDot d={disc} size={11} />
                  <span style={{ fontSize: 11.5, fontWeight: 600 }}>{DISC[disc]?.label ?? disc}</span>
                  <span style={{ fontSize: 10, color: isGap ? "var(--text-primary)" : "var(--text-tertiary)", fontWeight: isGap ? 600 : 400, textAlign: "center" }}>{leadName}</span>
                </div>
              </div>
              {i < order.length - 1 && <div style={{ display: "flex", alignItems: "center", alignSelf: "flex-start", height: 60 }}><Icon name="arrowRight" size={13} style={{ color: "var(--border-strong)" }} /></div>}
            </Fragment>
          );
        })}
      </div>
      {gapCount > 0 && (
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 16, lineHeight: 1.5 }}>
          A dashed gate has no dedicated dev — it routes to you (manager) to ratify or hand off, just like any gate.
        </p>
      )}
    </div>);
}

/* The Contract step — sign each open gate's reuse-or-innovate Contract (the posture auto-passed the rest). */
function StepReview({ preview, projectName, setProjectName, dispatching, dispatched, onDispatch, onDone, onGoRelays }: {
  preview: DispatchPreview; projectName: string; setProjectName: (v: string) => void;
  dispatching: boolean; dispatched: boolean;
  onDispatch: () => void; onDone: () => void; onGoRelays: () => void;
}) {
  const p = preview;
  const name = projectName.trim() || p.project_name;
  const taskN = p.creates.issues;

  if (dispatching)
    return (
      <SequenceLoader
        kicker="sprint0 · create"
        headline={`Reserving ${name}`}
        lines={["Reserving the GitLab project", "Opening the relay for its owners", "Each gate is the lead's to ratify"]}
        stepMs={780}
        onDone={onDone} />);

  if (dispatched)
    return (
      <div style={{ maxWidth: 480, margin: "12px auto", textAlign: "center", animation: "s0-rise 0.4s var(--ease-out) both" }}>
        <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--text-primary)", display: "grid", placeItems: "center", margin: "0 auto 18px", animation: "s0-check-pop 0.45s var(--ease-out) both" }}>
          <Icon name="check" size={28} style={{ color: "#fff" }} />
        </span>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 8px" }}>Project reserved</h1>
        <p style={{ fontSize: 14, color: "var(--text-tertiary)", lineHeight: 1.55, margin: "0 0 22px" }}>
          <b style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{name}</b> is reserved and the relay is <b style={{ color: "var(--text-secondary)", fontWeight: 500 }}>open for your leads to ratify</b>. The {taskN} task{taskN === 1 ? "" : "s"} + branches scaffold to GitLab automatically once every gate is signed.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <Button variant="primary" size="lg" iconRight="arrowRight" onClick={onGoRelays}>Go to the relay</Button>
        </div>
      </div>);

  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both", maxWidth: 520 }}>
      <WizHead title="Create the project" sub="Name it, then create. The AI drafted the plan and assigned the work — the gates open for each owner to ratify live." />

      {/* editable, AI-filled name */}
      <div style={{ marginBottom: 16 }}>
        <div className="kicker" style={{ marginBottom: 7 }}>Project name</div>
        <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder={p.project_name}
          style={{ width: "100%", height: 40, padding: "0 12px", fontSize: 15, fontWeight: 500, border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)", background: "var(--bg-elevated)", fontFamily: "inherit" }} />
        <div style={{ fontSize: 11, color: "var(--text-quaternary)", marginTop: 6 }}>sprint0 suggested this from the brief — edit it if you like.</div>
      </div>

      {/* what it creates — quiet, with icons */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: "var(--r-lg)", border: "0.5px solid var(--border)", background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)" }}>
          <Icon name="gitlab" size={18} style={{ color: "var(--text-tertiary)" }} />
          <div><div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>1</div><div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>GitLab project</div></div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: "var(--r-lg)", border: "0.5px solid var(--border)", background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)" }}>
          <Icon name="list" size={18} style={{ color: "var(--text-tertiary)" }} />
          <div><div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{taskN}</div><div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>task{taskN === 1 ? "" : "s"} scaffolded</div></div>
        </div>
      </div>

      <Button variant="primary" size="lg" icon="gitlab" className="s0-press" style={{ width: "100%" }} onClick={onDispatch}>
        {`Create ${name}`}
      </Button>
      <p style={{ fontSize: 11.5, color: "var(--text-quaternary)", textAlign: "center", margin: "10px 0 0", lineHeight: 1.5 }}>
        Reserves the GitLab project + opens the relay. The {taskN} task{taskN === 1 ? "" : "s"} + branches scaffold automatically once every lead ratifies their gate.
      </p>
    </div>);
}

function WizHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px", margin: 0 }}>{title}</h1>
      <p style={{ fontSize: 14, color: "var(--text-tertiary)", margin: "8px 0 0", lineHeight: 1.55, maxWidth: 520 }}>{sub}</p>
    </div>);

}
