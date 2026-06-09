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
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "../lib/query";
import { toast } from "sonner";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { Icon, ZeroMark, FullLogo } from "../lib/icon";
import {
  SiReact, SiTypescript, SiJavascript, SiPython, SiFastapi, SiNodedotjs, SiExpress, SiDocker,
  SiPostgresql, SiRedis, SiMongodb, SiTailwindcss, SiNextdotjs, SiVuedotjs, SiGo, SiRust,
  SiGraphql, SiKubernetes, SiGitlab,
} from "@icons-pack/react-simple-icons";
import { Button, Badge, DiscDot, discLabel } from "../components/ui";
import { Stepper, ReActTrace, ConfirmDraft } from "./WizardMotion";
import { api } from "../lib/api";
import type {
  ArchitectureCard,
  ClarifiedSpec,
  MemoryCandidate,
  PlanJSON,
  RelayState,
  StaffingResponse,
  TechStack,
} from "../lib/api";
// DispatchPreview lives in schemas (api.ts consumes it as S.DispatchPreview, does not re-export it).
import type { DispatchPreview } from "../lib/schemas";

const STEPS = [
  { id: "brief", label: "Brief", sub: "Paste or drop" },
  { id: "clarify", label: "Clarify", sub: "Resolve ambiguities" },
  { id: "arch", label: "Architecture", sub: "Pick a stack" },
  { id: "plan", label: "Plan", sub: "The relay" },
  { id: "review", label: "Review", sub: "Create the project" },
];

// hard cap on the pasted brief — a 50kB doc would blow the clarify prompt budget and time out
const BRIEF_MAX = 8000;

const DEFAULT_BRIEF = `Build a tenant portal for a freight client. They need: a saved-search experience over shipments, shareable read-only views with expiring links, a live map with thousands of vehicle pins, and CSV export of any filtered view. Must scaffold a real GitLab project. Tight 8-week window.`;

/* The async loaders shown during each wait. The SequenceLoader animates a fixed line
   sequence; the real API call runs in parallel and `onDone` commits + advances once the
   data has landed (see runLoader). */
type LoaderCfg = { kicker: string; headline: React.ReactNode; lines: string[]; stepMs?: number;
  // the live ReActTrace phase (polls /trace); every wizard wait is a real phase now
  phase?: "clarify" | "memory" | "arch" | "plan" | "review" | "create" };

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
  const [used, setUsed] = useState<Record<string, boolean>>({});  // memory-candidate Use/Skip → grounds the architecture
  const [cards, setCards] = useState<ArchitectureCard[]>([]);
  const [aiPick, setAiPick] = useState<{ name: string; why: string }>({ name: "", why: "" });
  const [chosenStack, setChosenStack] = useState<TechStack | null>(null);
  const [selectedCardName, setSelectedCardName] = useState<string | null>(null);  // the PICKED card's identity — two cards can share a stack
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
  const cancelledRef = useRef(false);  // user backed out of a wait — a late resolution must NOT advance the step

  const [dispatching, setDispatching] = useState(false);
  const [dispatched, setDispatched] = useState(false);

  /** Show `cfg` loader, run `work()`; advance via `onDone` once BOTH the animation and the call finish. */
  const runLoader = (cfg: LoaderCfg, work: () => Promise<void>, errMsg: string) => {
    loaderDoneRef.current = false;
    commitRef.current = null;
    cancelledRef.current = false;
    setLoader(cfg);
    work()
      .then(() => {
        if (cancelledRef.current) { commitRef.current = null; return; }
        // the call landed (commitRef now set by work). If the animation already finished, onDone ran
        // with nothing to do — so advance here; otherwise onDone will run the commit when it finishes.
        if (loaderDoneRef.current && commitRef.current) {
          commitRef.current();
          commitRef.current = null;
          setLoader(null);
        }
      })
      .catch((e) => {
        if (cancelledRef.current) return;
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
    step === 2 ? (cards.length ? !!chosenStack : true) :  // sub-phase A (memory panel) → always; B (cards) → a card picked
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

  // STEP 1 → 2: resolve the ambiguities, then JUDGE agency memory on the RESOLVED spec (so the answers can
  // shift the grounding). Architectures are NOT generated yet — the human first toggles Use/Skip (step 2, phase A).
  const goJudgeMemory = () => {
    if (!briefId) return;
    runLoader(
      {
        phase: "memory",
        kicker: "sprint0 · memory",
        headline: "Weighing agency memory",
        lines: ["Folding in the calls you made", "Searching agency memory on the resolved spec", "Judging each candidate for reuse fit"],
      },
      async () => {
        const updated = await api.resolveClarify(briefId, answers);  // judges memory on the resolved spec
        setSpec(updated);
        // seed the Use/Skip selection from the AI's verdicts (reuse → pre-selected)
        setUsed(Object.fromEntries((updated.memory_candidates ?? []).map((c) => [memKey(c), c.used ?? false])));
        setCards([]); setSelectedCardName(null); setChosenStack(null);  // cards (re)generate after the human grounds
        commitRef.current = () => setStep(2);
      },
      "Could not weigh the agency memory",
    );
  };

  // STEP 2 phase A → B: ground the architecture on the KEPT memory, then draft the stack options (stays on step 2).
  const goArch = () => {
    if (!briefId) return;
    const grounded = [...new Set((spec?.memory_candidates ?? []).filter((c) => used[memKey(c)]).map((c) => c.ref))];  // unique kept projects; [] = explicit fresh build
    runLoader(
      {
        phase: "arch",
        kicker: "sprint0 · architecture",
        headline: "Grounding the stack",
        lines: ["Locking the kept memory", "Scanning validated modules", "Drafting grounded architecture options"],
      },
      async () => {
        const opts = await api.architectures(briefId, undefined, grounded);
        if (!opts.cards.length) throw new Error("The AI returned no architecture options — try again");
        setCards(opts.cards);
        setAiPick({ name: opts.ai_pick_name ?? "", why: opts.ai_pick_why ?? "" });
        // default the choice to the AI's own pick (the badged card), else the first
        { const def = opts.cards.find((c) => c.recommended) ?? opts.cards[0];
          setSelectedCardName(def?.name ?? null);
          setChosenStack(def?.tech_stack ?? null); }
        commitRef.current = () => {};  // stay on step 2 — the cards now render (phase B)
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

  // STEP 3 → 4: dispatch dry-run preview (NO ratify/auto-pass step — gates stay open, ratified live after create)
  const goReview = () => {
    if (!planId) return;
    runLoader(
      {
        phase: "review",
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
    if (step === 1) return goJudgeMemory();                       // resolve + judge memory → reveal the Memory panel
    if (step === 2) return cards.length ? goPlan() : goArch();    // phase A: ground on kept memory → cards; B: → plan
    if (step === 3) return goReview();
  };

  // Resume a saved draft: rehydrate per-step state from the server (by briefId/planId) and jump to the saved step.
  useEffect(() => {
    if (!resumeDraft) return;
    const d = resumeDraft;
    setResumeDraft(null);  // consume once
    (async () => {
      try {
        // each block raises the resume ceiling only when its state ACTUALLY came back —
        // a deleted/expired brief or plan must land the user on a step that can render,
        // never the saved step with a blank pane.
        let ceiling = 0;
        if (d.briefId) {
          setBriefId(d.briefId);
          const b = await api.getBrief(d.briefId).catch(() => null);
          if (b?.text) setBrief(b.text);
          const s = await api.getSpec(d.briefId).catch(() => null);
          if (s) { setSpec(s); ceiling = 2; }  // steps 1+2 render off the spec
          if (s?.memory_candidates) setUsed(Object.fromEntries(s.memory_candidates.map((c) => [memKey(c), c.used ?? false])));
          if (d.answers) setAnswers(d.answers);
          if (s && (d.step ?? 0) >= 2) {
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
          if (p) { setPlan(p); ceiling = 3; }
          const r = await api.relay(d.planId).catch(() => null);
          if (r) setRelay(r);
          setStaffing(await api.staffing(d.planId).catch(() => ({ coverage: [] })));
          if (p && (d.step ?? 0) >= 4) {
            const pv = await api.dispatchPreview(d.planId).catch(() => null);
            if (pv) { setPreview(pv); setProjectName(pv.project_name ?? ""); ceiling = 4; }
          }
        }
        const target = Math.min(d.step ?? 0, ceiling, STEPS.length - 1);
        if (target < (d.step ?? 0)) toast("Draft partially restored", { description: "Some saved progress expired on the server — picking up from the last recoverable step." });
        setStep(target);
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
    if (!planId || dispatching) return;
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
                <ReActTrace key={loader.phase ?? "plan"} runId={briefId} phase={loader.phase ?? "plan"} onDone={onLoaderDone} />
              ) : (
                <>
                  {step === 0 && <StepBrief brief={brief} setBrief={setBrief} />}
                  {step === 1 && spec && <StepClarify spec={spec} answers={answers} setAnswers={setAnswers} />}
                  {step === 2 && (cards.length
                    ? <StepArch cards={cards} aiPick={aiPick} selectedCardName={selectedCardName} setSelectedCardName={setSelectedCardName} setChosenStack={setChosenStack} />
                    : <StepMemory candidates={spec?.memory_candidates ?? []} used={used} setUsed={setUsed} />)}
                  {step === 3 && plan && <StepPlan plan={plan} relay={relay} staffing={staffing} members={members} />}
                  {step === 4 && preview && <StepReview
                    preview={preview} projectName={projectName} setProjectName={setProjectName}
                    briefId={briefId}
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
                  {step === 0 ? "Clarify spec" : step === 1 ? "Weigh the memory" : step === 2 ? (cards.length ? "Generate plan" : "Generate architectures") : "Review & create"}
                </Button>}
            </div>
          )}
        </div>

        {confirmDraft && <ConfirmDraft name={previewName} onConfirm={saveDraft} onCancel={() => setConfirmDraft(false)} />}
      </div>
    </div>);

}

function StepBrief({ brief, setBrief }: { brief: string; setBrief: (v: string) => void }) {
  const [focus, setFocus] = useState(false);
  const [over, setOver] = useState(false);
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Drop the client brief" sub="Paste the text or drop a PDF. The AI extracts a spec and proposes reuse before you commit anything." />
      <div className="kicker" style={{ marginBottom: 8, display: "flex", alignItems: "baseline" }}>
        <span>Brief</span><span style={{ flex: 1 }} />
        {brief.length > BRIEF_MAX * 0.8 && <span className="mono" style={{ fontSize: 10, color: brief.length >= BRIEF_MAX ? "var(--amber)" : "var(--text-quaternary)", textTransform: "none", letterSpacing: 0 }}>{brief.length.toLocaleString()} / {BRIEF_MAX.toLocaleString()}</span>}
      </div>
      <textarea value={brief} onChange={(e) => setBrief(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} rows={8} maxLength={BRIEF_MAX}
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

    </div>);

}

/* ── Memory candidates — capability-level, human-ratified grounding ──
   Each card is a reusable CAPABILITY the AI found in past work and judged against the resolved spec:
   fit chip (strong|partial|skip) + source project · year + what it does + why it fits, with a Use/Skip
   toggle and an expand for pros·cons. `used` is keyed per-capability (capabilities can share a project);
   the kept refs (projects) ground the architecture. Empty / all-skip → the "fresh build" state. */
const FIT_META: Record<string, { label: string; fg: string; dot: string }> = {
  strong:  { label: "strong fit", fg: "var(--green)", dot: "var(--green)" },
  partial: { label: "partial fit", fg: "var(--amber)", dot: "var(--amber)" },
  skip:    { label: "skip", fg: "var(--text-quaternary)", dot: "var(--text-quaternary)" },
};
const memKey = (c: MemoryCandidate) => `${c.ref}·${c.capability ?? ""}`;

function StepMemory({ candidates, used, setUsed }: {
  candidates: MemoryCandidate[];
  used: Record<string, boolean>;
  setUsed: (fn: (u: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const allSkip = candidates.length > 0 && candidates.every((c) => c.fit === "skip");
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Ground the plan on this past work?" sub="The AI found these reusable capabilities in agency memory and weighed them against your answers. Keep what fits. Your selection grounds the architecture." />
      <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden", background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: "0.5px solid var(--border-subtle)", background: "var(--bg-secondary)" }}>
          <ZeroMark size={14} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Reusable capabilities</span>
          <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>· your selection grounds the architecture</span>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>{candidates.length} found</span>
        </div>
        {candidates.length === 0 || allSkip ? (
          <div style={{ padding: "24px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Fresh build. Nothing in memory fits.</div>
            <div style={{ fontSize: 11.5, color: "var(--text-quaternary)", marginTop: 4 }}>{candidates.length ? "Every capability was considered and skipped." : "No prior work matched this brief."}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {candidates.map((c, i) => {
              const fm = FIT_META[c.fit] || FIT_META.skip;
              const k = memKey(c);
              const isUsed = !!used[k];
              const isSkip = c.fit === "skip";
              const isOpen = !!open[k];
              const hasDetail = (c.pros?.length ?? 0) + (c.cons?.length ?? 0) > 0;
              return (
                <div key={k} style={{ display: "flex", flexDirection: "column", padding: "11px 14px",
                  borderBottom: i < candidates.length - 1 ? "0.5px solid var(--border-subtle)" : "none", opacity: isSkip ? 0.55 : 1 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* fit + capability + source */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", color: fm.fg, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: fm.dot }} />{fm.label}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{c.capability || c.ref}</span>
                        <span style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{c.project || c.ref}{c.year ? ` · ${c.year}` : ""}</span>
                      </div>
                      {c.what && <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45, marginBottom: 2 }}>{c.what}</div>}
                      {c.reason && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", lineHeight: 1.4 }}>{c.reason}</div>}
                      {hasDetail && (
                        <button className="s0-press" onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 11, fontWeight: 500, color: "var(--text-tertiary)", cursor: "pointer", background: "none", border: "none", padding: 0 }}>
                          <Icon name="chevronDown" size={12} style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform var(--t-quick)" }} />
                          {isOpen ? "Less" : "Detail"}
                        </button>
                      )}
                    </div>
                    {!isSkip && (
                      <button className="s0-press" onClick={() => setUsed((u) => ({ ...u, [k]: !u[k] }))}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 10px", borderRadius: "var(--r-md)",
                          fontSize: 11.5, fontWeight: 500, flexShrink: 0, cursor: "pointer", marginTop: 2,
                          background: isUsed ? "var(--text-primary)" : "var(--bg-elevated)", color: isUsed ? "#fff" : "var(--text-secondary)",
                          border: isUsed ? "none" : "0.5px solid var(--border-strong)", transition: "background var(--t-quick), color var(--t-quick)" }}>
                        {isUsed ? <><Icon name="check" size={11} style={{ color: "#fff" }} /> Use</> : "Skip"}
                      </button>
                    )}
                  </div>
                  {isOpen && hasDetail && (
                    <div style={{ display: "flex", gap: 18, marginTop: 9, paddingLeft: 2, animation: "s0-fade-in var(--t-reg) both" }}>
                      {(c.pros?.length ?? 0) > 0 && (
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {(c.pros ?? []).map((p, j) => <div key={j} style={{ display: "flex", gap: 6, fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.5 }}><Icon name="check" size={11} style={{ color: "var(--green)", flexShrink: 0, marginTop: 2 }} />{p}</div>)}
                        </div>
                      )}
                      {(c.cons?.length ?? 0) > 0 && (
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {(c.cons ?? []).map((p, j) => <div key={j} style={{ display: "flex", gap: 6, fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.5 }}><span style={{ width: 9, height: 1.5, background: "var(--amber)", flexShrink: 0, marginTop: 8, borderRadius: 1 }} />{p}</div>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const TECH_ROWS: { key: keyof TechStack; label: string }[] = [
  { key: "frontend", label: "Frontend" }, { key: "backend", label: "Backend" },
  { key: "db", label: "Database" }, { key: "infra", label: "Infra" },
];

/* Brand logos for the common techs the planner emits — unknown ones (MapLibre, Cloud Run, PostGIS…)
   render as a plain pill. Keyed by the tech name normalized to lowercase-alphanumeric. */
const TECH_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  react: SiReact, typescript: SiTypescript, javascript: SiJavascript, python: SiPython,
  fastapi: SiFastapi, nodejs: SiNodedotjs, node: SiNodedotjs, express: SiExpress, docker: SiDocker,
  postgresql: SiPostgresql, postgres: SiPostgresql, redis: SiRedis, mongodb: SiMongodb,
  tailwindcss: SiTailwindcss, tailwind: SiTailwindcss, nextjs: SiNextdotjs, vue: SiVuedotjs,
  go: SiGo, golang: SiGo, rust: SiRust, graphql: SiGraphql, kubernetes: SiKubernetes, gitlab: SiGitlab,
};
const techKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/* one tech as a tag-block pill: [logo] Name. Splits a "A / B / C" stack value into separate pills. */
function TechPill({ tech }: { tech: string }) {
  const Logo = TECH_ICONS[techKey(tech)];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 10px",
      borderRadius: "var(--r-md)", background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)",
      fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", boxShadow: "var(--shadow-1)" }}>
      {Logo ? <Logo size={13} color="var(--text-tertiary)" /> : <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-quaternary)" }} />}
      {tech}
    </span>
  );
}

/* whole-COLUMN selection: insets stack into a continuous accent border down the picked card's column. */
const colSel = (on: boolean, edge: "head" | "mid" | "foot"): React.CSSProperties => on ? {
  background: "var(--bg-active)",
  boxShadow: ["inset 1.5px 0 0 var(--text-primary)", "inset -1.5px 0 0 var(--text-primary)",
    edge === "head" ? "inset 0 1.5px 0 var(--text-primary)" : "",
    edge === "foot" ? "inset 0 -1.5px 0 var(--text-primary)" : ""].filter(Boolean).join(", "),
} : {};

function StepArch({ cards, aiPick, selectedCardName, setSelectedCardName, setChosenStack }: {
  cards: ArchitectureCard[]; aiPick: { name: string; why: string }; selectedCardName: string | null; setSelectedCardName: (n: string) => void; setChosenStack: (s: TechStack) => void;
}) {
  const cols = `104px repeat(${cards.length}, minmax(0, 1fr))`;
  const cell: React.CSSProperties = { padding: "13px 13px", borderTop: "0.5px solid var(--border-subtle)", minWidth: 0 };
  const rowLabel: React.CSSProperties = { ...cell, fontSize: 10.5, color: "var(--text-quaternary)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 };
  const pick = (c: ArchitectureCard) => { setSelectedCardName(c.name); setChosenStack(c.tech_stack); };

  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="Pick a stack" sub="Compare the options side by side. The AI recommends. You choose." />

      {/* the AI recommends one card; the human chooses */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 12, fontSize: 11.5, color: "var(--text-tertiary)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="bolt" size={12} style={{ color: "var(--amber)" }} /> <b style={{ fontWeight: 600, color: "var(--text-secondary)" }}>AI's pick</b> · the model's own call{aiPick.why ? ` · ${aiPick.why}` : ""}</span>
      </div>

      <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden", background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)" }}>
        {/* selectable card headers */}
        <div style={{ display: "grid", gridTemplateColumns: cols }}>
          <div />
          {cards.map((c) => {
            const on = selectedCardName === c.name;
            return (
              <button key={c.name} className="s0-press" onClick={() => pick(c)}
                style={{ textAlign: "left", padding: "15px 14px", borderLeft: "0.5px solid var(--border-subtle)", minWidth: 0,
                  cursor: "pointer", ...colSel(on, "head") }}>
                <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 7 }}>{c.name}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {c.name === aiPick.name && <Badge tone="amber" mono><Icon name="bolt" size={9} /> AI's pick</Badge>}
                </div>
              </button>);
          })}
        </div>

        {/* BLOCK 1 — tech stack, row by row (each value split into logo pills) */}
        {TECH_ROWS.map((r) => (
          <div key={r.key} style={{ display: "grid", gridTemplateColumns: cols }}>
            <div style={rowLabel}>{r.label}</div>
            {cards.map((c) => {
              const on = selectedCardName === c.name;
              return (
                <div key={c.name} onClick={() => pick(c)}
                  style={{ ...cell, borderLeft: "0.5px solid var(--border-subtle)", cursor: "pointer",
                    display: "flex", flexWrap: "wrap", gap: 6, alignContent: "flex-start", ...colSel(on, "mid") }}>
                  {String(c.tech_stack[r.key] ?? "").split("/").map((t) => t.trim()).filter(Boolean).map((t, i) => <TechPill key={i} tech={t} />)}
                </div>
              );
            })}
          </div>
        ))}

        {/* BLOCK 2 — pros / cons */}
        <div style={{ display: "grid", gridTemplateColumns: cols, background: "var(--bg-secondary)" }}>
          <div style={rowLabel}>Trade-offs</div>
          {cards.map((c) => {
            const on = selectedCardName === c.name;
            return (
              <div key={c.name} onClick={() => pick(c)} style={{ ...cell, borderLeft: "0.5px solid var(--border-subtle)", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, ...colSel(on, "mid") }}>
                {(c.pros ?? []).map((p, i) => <span key={"p" + i} style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.35 }}><b style={{ color: "var(--green)" }}>+</b> {p}</span>)}
                {(c.cons ?? []).map((p, i) => <span key={"c" + i} style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.35 }}><b style={{ color: "var(--amber)" }}>−</b> {p}</span>)}
              </div>
            );
          })}
        </div>

        {/* BLOCK 3 — reuse from memory */}
        <div style={{ display: "grid", gridTemplateColumns: cols }}>
          <div style={rowLabel}>Reuse</div>
          {cards.map((c) => {
            const on = selectedCardName === c.name;
            return (
            <div key={c.name} onClick={() => pick(c)} style={{ ...cell, borderLeft: "0.5px solid var(--border-subtle)", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, ...colSel(on, "foot") }}>
              {(c.reuse ?? []).length ? (c.reuse ?? []).map((r, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.3 }}>{r.feature}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, color: "var(--text-quaternary)" }}><ZeroMark size={9} /> {r.from_project} · {r.action}</span>
                </div>
              )) : <span style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>fresh build, nothing from memory</span>}
            </div>
            );
          })}
        </div>
      </div>

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
  // the REAL parallel DAG, not a linear chain: {uiux ∥ backend ∥ devops} → frontend → qa.
  const gateList = (relay?.gates ?? []).map((g: any) => g.discipline);
  const order = gateList.length ? gateList : coverage.map((c) => c.discipline);
  const gapCount = coverage.filter((c) => !c.covered).length;
  const STAGE_OF: Record<string, string> = { setup: "setup", uiux: "build", backend: "build", devops: "build", frontend: "integrate", qa: "accept" };
  const STAGE_SEQ = ["setup", "build", "integrate", "accept"];
  const byStage = STAGE_SEQ
    .map((s) => ({ stage: s, gates: order.filter((d: string) => (STAGE_OF[d] ?? "build") === s) }))
    .filter((g) => g.gates.length);  // gates in the same stage run in parallel; stages run in order

  const gateCard = (disc: string) => {
    const cov = covOf(disc);
    const gate = ((relay?.gates ?? []) as any[]).find((g) => g.discipline === disc);
    const isSetup = disc === "setup";
    // owner = the gate's delegate, else its assigned owner (WS1), else an issue-assignee / seated dev (roster).
    const ownerUser = gate?.delegate ?? gate?.owner ?? (isSetup ? undefined : (leadFor(disc) ?? members.find((m: any) => m.role === "developer" && m.discipline === disc)?.username));
    const isGap = isSetup ? false : (cov ? !cov.covered : !ownerUser);
    const leadName = ownerUser ? (byUser(ownerUser)?.name?.split(" ")[0] ?? ownerUser) : "Tech Lead";  // gap routes to the Tech Lead
    return (
      <div key={disc} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 8px", borderRadius: "var(--r-lg)", minWidth: 96,
        background: "var(--bg-elevated)", border: isGap ? "1px dashed var(--text-primary)" : "0.5px solid var(--border)", boxShadow: "var(--shadow-1)" }}>
        <DiscDot d={disc} size={11} />
        <span style={{ fontSize: 11.5, fontWeight: 600 }}>{discLabel(disc)}</span>
        <span style={{ fontSize: 10, color: isGap ? "var(--text-primary)" : "var(--text-tertiary)", fontWeight: isGap ? 600 : 400, textAlign: "center" }}>{leadName}</span>
      </div>
    );
  };

  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <WizHead title="The relay" sub={`${taskCount} task${taskCount === 1 ? "" : "s"} across ${order.length} discipline gate${order.length === 1 ? "" : "s"}. Each gate is ratified by its owner. Nothing auto-passes.`} />

      <div className="kicker" style={{ marginBottom: 12 }}>Who runs each gate, in order{gapCount > 0 ? ` · ${gapCount} gap${gapCount === 1 ? "" : "s"}` : ""}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap", rowGap: 14 }}>
        {byStage.map((st, si) => (
          <Fragment key={st.stage}>
            {si > 0 && <div style={{ display: "flex", alignItems: "center", alignSelf: "center", padding: "0 6px" }}><Icon name="arrowRight" size={14} style={{ color: "var(--border-strong)" }} /></div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{st.gates.map((d: string) => gateCard(d))}</div>
          </Fragment>
        ))}
      </div>
      {gapCount > 0 && (
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 16, lineHeight: 1.5 }}>
          A dashed gate has no dedicated dev. It routes to the Tech Lead to ratify or hand off, just like any gate.
        </p>
      )}
    </div>);
}

/* The Contract step — sign each open gate's reuse-or-innovate Contract (the posture auto-passed the rest). */
function StepReview({ preview, projectName, setProjectName, briefId, dispatching, dispatched, onDispatch, onDone, onGoRelays }: {
  preview: DispatchPreview; projectName: string; setProjectName: (v: string) => void;
  briefId: string | null; dispatching: boolean; dispatched: boolean;
  onDispatch: () => void; onDone: () => void; onGoRelays: () => void;
}) {
  const p = preview;
  const name = projectName.trim() || p.project_name;
  const taskN = p.creates.issues;

  // the real create — the gateway streams the actual GitLab ops (create project · push tasks · open relay)
  if (dispatching)
    return <ReActTrace key="create" runId={briefId} phase="create" onDone={onDone} />;

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
