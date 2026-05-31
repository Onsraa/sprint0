import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useUI } from "../lib/store";
import { useRefreshProjects } from "../features/projects/useProjects";
import { useInvalidateWork } from "../features/work/useWork";
import { Disclosure } from "../components/Disclosure";
import { Mascot } from "../components/Mascot";
import { api, draft } from "../lib/api";
import type {
  AmbiguityCard,
  ArchitectureCard,
  ClarifiedSpec,
  DispatchResult,
  PlanJSON,
  RelayState,
  TechStack,
  WizardDraft,
} from "../lib/api";
import type { DispatchPreview } from "../lib/schemas";
import { Icon } from "../lib/icon";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL, planIssues, RISK_COLOR, statusStyle } from "../lib/relayUtils";
import { StaffingGap } from "../views/StaffingGap";

/* sprint0 — Brief Wizard, wired to the real gateway.
   Drop → Clarify → Architecture → Plan draft → Trust → Dispatch.
   In feature mode (featureProjectId set) it adds a feature to a live project. */

const STEPS = [
  { id: "drop", label: "Drop" },
  { id: "clarify", label: "Clarify" },
  { id: "arch", label: "Architecture" },
  { id: "plan", label: "Plan" },
  { id: "staffing", label: "Staffing" },
  { id: "trust", label: "Trust" },
  { id: "dispatch", label: "Dispatch" },
];

const STEP_STAFFING = 4;
const STEP_TRUST = 5;
const STEP_DISPATCH = 6;

interface WizardState {
  briefId: string | null;
  spec: ClarifiedSpec | null;
  answers: Record<string, string>;
  arch: ArchitectureCard[];
  chosenStack: TechStack | null;
  dial: number;
}

type SetState = Dispatch<SetStateAction<WizardState>>;

// RHF/Zod schema for the wizard's form state. Server-returned fields (spec/arch) stay loose; the
// user-entered fields (clarify answers, chosen stack, trust dial) carry the real constraints.
const WizardStateZ = z.object({
  briefId: z.string().nullable(),
  spec: z.any().nullable(),
  answers: z.record(z.string(), z.string()),
  arch: z.array(z.any()),
  chosenStack: z.record(z.string(), z.string()).nullable(),
  dial: z.number().min(0).max(100),
});

export function WizardBrief() {
  const setWizardOpen = useUI((s) => s.setWizardOpen);
  const setWizardKind = useUI((s) => s.setWizardKind);
  const featureProjectId = useUI((s) => s.featureProjectId);
  const setFeatureProjectId = useUI((s) => s.setFeatureProjectId);
  const plan = useUI((s) => s.plan);
  const setPlan = useUI((s) => s.setPlan);
  const planId = useUI((s) => s.planId);
  const setPlanId = useUI((s) => s.setPlanId);
  const setLiveProjectId = useUI((s) => s.setLiveProjectId);
  const setLiveCloneUrl = useUI((s) => s.setLiveCloneUrl);
  // Relay is wizard-local during planning; the ratify surfaces refetch it via useRelay(planId).
  const [relay, setRelay] = useState<RelayState | null>(null);

  const isFeature = featureProjectId != null;
  const [step, setStep] = useState(0);
  // Form state lives in React Hook Form (Zod-validated via WizardStateZ). The wizard advances with
  // imperative per-step API calls rather than one handleSubmit, so RHF is used as the validated
  // store: `state` mirrors watch(); `setState` shims setValue per key — this keeps the useState-
  // shaped API every step component already uses, and keeps plain controlled inputs focused (the
  // inputs read from watch(), so no RHF field remounts on change).
  const form = useForm<WizardState>({
    resolver: zodResolver(WizardStateZ),
    defaultValues: { briefId: null, spec: null, answers: {}, arch: [], chosenStack: null, dial: 70 },
  });
  const state = form.watch();
  const setState = useCallback<SetState>(
    (updater) => {
      const nextVal = typeof updater === "function" ? updater(form.getValues()) : updater;
      (Object.keys(nextVal) as (keyof WizardState)[]).forEach((k) =>
        form.setValue(k, nextVal[k] as never, { shouldDirty: true }),
      );
    },
    [form],
  );
  // A draft saved from a previous (closed) session — offered as Resume on Step 0.
  const [offer, setOffer] = useState<WizardDraft | null>(() => (featureProjectId == null ? draft.get() : null));
  const [resuming, setResuming] = useState(false);
  // Leaving the Clarify step resolves the answered ambiguities (footer Continue is the sole advance).
  const [advancing, setAdvancing] = useState(false);
  const [advanceErr, setAdvanceErr] = useState<string | null>(null);
  const [done, setDone] = useState(false); // dispatched → stop persisting a draft

  // Persist progress so closing never loses work. Skips an untouched wizard and a finished one.
  // Gate on briefId/isFeature only — a stale context planId from a prior dispatch must not count.
  const persistDraft = () => {
    if (done || (!state.briefId && !isFeature)) return;
    draft.set({
      briefId: state.briefId,
      planId,
      step,
      isFeature,
      featureProjectId,
      chosenStack: state.chosenStack,
      dial: state.dial,
      projectName: plan?.project_name ?? state.spec?.goal ?? (isFeature ? `Feature · #${featureProjectId}` : "Untitled brief"),
      savedAt: Date.now(),
    });
  };
  // Save on every step / key-state change (and on close, below).
  useEffect(() => {
    persistDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, state.briefId, state.chosenStack, state.dial, planId, isFeature, featureProjectId]);

  const close = () => {
    persistDraft();
    setFeatureProjectId(null);
    setWizardOpen(false);
  };
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  // Footer Continue advances; leaving Clarify it first resolves the answered ambiguities.
  const advanceFrom = async (s: number) => {
    if (s === 1 && state.briefId && Object.keys(state.answers).length > 0) {
      setAdvancing(true);
      setAdvanceErr(null);
      try {
        const spec = await api.resolveClarify(state.briefId, state.answers);
        setState((p) => ({ ...p, spec }));
      } catch (e) {
        setAdvanceErr(e instanceof Error ? e.message : String(e));
        setAdvancing(false);
        return;
      }
      setAdvancing(false);
    }
    next();
  };

  // Resume a saved draft: refetch the cached spec/architectures (no Gemini re-run) and the
  // plan/relay if a reload wiped context, then jump to the saved step.
  const doResume = async (d: WizardDraft) => {
    setOffer(null);
    setResuming(true);
    if (d.isFeature) setFeatureProjectId(d.featureProjectId);
    let spec: ClarifiedSpec | null = null;
    let arch: ArchitectureCard[] = [];
    if (d.briefId) {
      try {
        spec = await api.getSpec(d.briefId);
      } catch {
        /* not clarified yet */
      }
      try {
        arch = (await api.getArchitectures(d.briefId)).cards;
      } catch {
        /* not proposed yet */
      }
    }
    setState({ briefId: d.briefId, spec, answers: {}, arch, chosenStack: d.chosenStack, dial: d.dial });
    if (d.planId) {
      // Reload the plan/relay if a reload wiped context; otherwise keep what's already live.
      if (!plan) {
        try {
          const [p, r] = await Promise.all([api.getPlan(d.planId), api.getRelay(d.planId)]);
          setPlan(p);
          setPlanId(d.planId);
          setRelay(r);
        } catch {
          /* plan expired server-side */
        }
      } else if (planId == null) {
        setPlanId(d.planId);
      }
    } else {
      // Draft predates planning → drop any stale plan left in context from a prior project.
      setPlan(null);
      setPlanId(null);
      setRelay(null);
    }
    setStep(d.step);
    setResuming(false);
  };

  // Discard the draft and start clean (also clears any stale plan left in context).
  const startFresh = () => {
    draft.clear();
    setOffer(null);
    setPlan(null);
    setPlanId(null);
    setRelay(null);
    setState({ briefId: null, spec: null, answers: {}, arch: [], chosenStack: null, dial: 70 });
    setStep(0);
  };

  // Feature mode enters at the plan step; don't stomp a resume that landed deeper.
  const firstStep = isFeature ? 3 : 0;
  useEffect(() => {
    if (isFeature) setStep((s) => (s < 3 ? 3 : s));
  }, [isFeature]);

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,20,16,0.5)",
        backdropFilter: "blur(6px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        animation: "pop-in 240ms",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 1100,
          height: "calc(100vh - 48px)",
          maxHeight: 820,
          background: "var(--cream)",
          borderRadius: 24,
          border: "2px solid var(--ink)",
          boxShadow: "10px 10px 0 var(--ink)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1.5px solid var(--line)",
            background: "var(--paper)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Mascot size={36} expression={step === 1 ? "focused" : step === STEP_DISPATCH ? "cheer" : "happy"} />
            <div>
              <div className="kicker">{isFeature ? "Add a feature" : "New project"}</div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>sprint0 is on it</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => i >= firstStep && i <= step && setStep(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: i === step ? "var(--orange)" : i < step ? "var(--orange-soft)" : "transparent",
                  color: i === step ? "var(--paper)" : i < step ? "var(--orange-deep)" : "var(--ink-mute)",
                  fontWeight: 700,
                  fontSize: 13,
                  opacity: i > step || i < firstStep ? 0.45 : 1,
                  cursor: i >= firstStep && i <= step ? "pointer" : "default",
                  transition: "all 200ms",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: i === step ? "var(--paper)" : i < step ? "var(--orange)" : "var(--cream-deep)",
                    color: i === step ? "var(--orange)" : "var(--paper)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  {i < step ? "✓" : i + 1}
                </span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: 32, display: "flex", flexDirection: "column" }}>
          {step === 0 &&
            (offer ? (
              <ResumeOffer draft={offer} busy={resuming} onResume={() => doResume(offer)} onDiscard={startFresh} />
            ) : (
              <StepDrop
                setState={setState}
                next={next}
                onReset={() => {
                  setPlan(null);
                  setPlanId(null);
                  setRelay(null);
                }}
              />
            ))}
          {step === 1 && <StepClarify state={state} setState={setState} />}
          {step === 2 && <StepArchitecture state={state} setState={setState} />}
          {step === 3 && (
            <StepPlan
              state={state}
              isFeature={isFeature}
              featureProjectId={featureProjectId}
              plan={plan}
              relay={relay}
              setPlan={setPlan}
              setPlanId={setPlanId}
              setRelay={setRelay}
              next={next}
            />
          )}
          {step === STEP_STAFFING && (
            <StaffingGap planId={planId} onOnboard={() => setWizardKind("hire")} next={next} />
          )}
          {step === STEP_TRUST && <StepTrust state={state} setState={setState} planId={planId} relay={relay} setRelay={setRelay} />}
          {step === STEP_DISPATCH && (
            <StepDispatch planId={planId} setRelay={setRelay} setLiveProjectId={setLiveProjectId} setLiveCloneUrl={setLiveCloneUrl} onClose={close} onDone={() => setDone(true)} />
          )}
        </div>

        {/* Footer nav (dispatch step has its own controls) */}
        {step !== STEP_DISPATCH && (
          <div
            style={{
              padding: "16px 24px",
              borderTop: "1.5px solid var(--line)",
              background: "var(--paper)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <button
              onClick={prev}
              disabled={step <= firstStep}
              className="btn btn-ghost btn-sm"
              style={{ opacity: step <= firstStep ? 0.4 : 1 }}
            >
              ← Back
            </button>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {advanceErr && <span className="mono" style={{ fontSize: 11, color: "var(--orange-deep)" }}>{advanceErr}</span>}
              <button onClick={close} className="btn btn-ghost btn-sm">
                Save &amp; close
              </button>
              <StepNext step={step} state={state} planId={planId} busy={advancing} onNext={() => advanceFrom(step)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* The sole advance control. Gates each step on its completion; for Clarify the click
   also resolves the answers (via onNext → advanceFrom), showing "Saving…" while it runs. */
function StepNext({ step, state, planId, busy, onNext }: { step: number; state: WizardState; planId: string | null; busy: boolean; onNext: () => void }) {
  // Steps with their own primary action inside the body (Drop, Plan, Staffing): hide footer Continue.
  if (step === 0 || step === 3 || step === STEP_STAFFING) return null;
  const clarifyIncomplete =
    step === 1 &&
    (!state.spec || state.spec.ambiguities.some((a) => !((state.answers[a.id] ?? "").trim() || (a.resolution ?? "").trim())));
  const disabled = busy || clarifyIncomplete || (step === 2 && !state.chosenStack) || (step === STEP_TRUST && !planId);
  return (
    <button onClick={onNext} className="btn btn-primary btn-sm" disabled={disabled} style={{ opacity: disabled ? 0.5 : 1 }}>
      {busy ? "Saving…" : step === STEP_TRUST ? "To dispatch →" : "Continue →"}
    </button>
  );
}

/* ============================================================
   RESUME — offered on Step 0 when a saved draft exists
   ============================================================ */
function ResumeOffer({ draft: d, busy, onResume, onDiscard }: { draft: WizardDraft; busy: boolean; onResume: () => void; onDiscard: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22 }}>
      <Mascot size={64} expression="happy" />
      <div style={{ textAlign: "center" }}>
        <div className="kicker">Welcome back</div>
        <div className="display" style={{ fontSize: 32, margin: "6px 0 8px" }}>
          Pick up where you left off?
        </div>
        <div style={{ fontSize: 15, color: "var(--ink-soft)" }}>
          <b>{d.projectName}</b> · {STEPS[d.step]?.label ?? "in progress"} (step {d.step + 1}/{STEPS.length})
        </div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onResume} disabled={busy} className="btn btn-primary" style={{ opacity: busy ? 0.5 : 1 }}>
          {busy ? "Restoring…" : "Resume →"}
        </button>
        <button onClick={onDiscard} disabled={busy} className="btn btn-ghost">
          Start fresh
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   STEP 0 — DROP (upload text or file → /api/briefs)
   ============================================================ */
function StepDrop({ setState, next, onReset }: { setState: SetState; next: () => void; onReset: () => void }) {
  const [drag, setDrag] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file && !text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { brief_id } = await api.createBrief(file ? { file } : { text });
      onReset(); // a brand-new brief — drop any stale plan from a prior project
      setState((s) => ({ ...s, briefId: brief_id }));
      next();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22 }}>
      <div style={{ textAlign: "center" }}>
        <div className="display" style={{ fontSize: 44, marginBottom: 10 }}>
          Drop the brief.
        </div>
        <div style={{ fontSize: 16, color: "var(--ink-soft)" }}>Upload a file, or paste the brief text below.</div>
      </div>

      <input
        ref={fileRef}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) setFile(f);
        }}
        onClick={() => fileRef.current?.click()}
        style={{
          width: "100%",
          maxWidth: 640,
          border: `3px dashed ${drag ? "var(--orange)" : file ? "var(--positive)" : "var(--ink-faint)"}`,
          borderRadius: 24,
          padding: 28,
          background: drag ? "var(--orange-tint)" : file ? "rgba(47,138,78,0.06)" : "var(--paper)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          transition: "all 200ms",
        }}
      >
        <div style={{ fontSize: 34, color: file ? "var(--positive)" : "var(--ink-mute)" }}>{file ? "📄" : "⬇"}</div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{file ? file.name : "Drag a file or click to browse"}</div>
        <div style={{ color: "var(--ink-mute)", fontSize: 12 }}>PDF · txt · md</div>
      </div>

      <div style={{ width: "100%", maxWidth: 640 }}>
        <div className="kicker" style={{ marginBottom: 6 }}>
          …or paste text
        </div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) setFile(null);
          }}
          rows={4}
          placeholder="Real-estate listings + agent CRM. iPad-friendly. ~200 agents. 8 weeks."
          style={{
            width: "100%",
            padding: "12px 14px",
            border: "1.5px solid var(--line-strong)",
            borderRadius: 12,
            fontSize: 14,
            background: "var(--paper)",
            outline: "none",
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
      </div>

      {err && <div style={{ color: "var(--orange-deep)", fontSize: 13, fontFamily: "var(--font-mono)" }}>{err}</div>}

      <button onClick={submit} className="btn btn-primary" disabled={busy || (!file && !text.trim())} style={{ opacity: busy || (!file && !text.trim()) ? 0.5 : 1 }}>
        {busy ? "Reading…" : "Read it →"}
      </button>
    </div>
  );
}

/* ============================================================
   STEP 1 — CLARIFY (ambiguity cards + reuse + extracted spec)
   ============================================================ */
function StepClarify({ state, setState }: { state: WizardState; setState: SetState }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ranFor = useRef<string | null>(null);

  useEffect(() => {
    if (!state.briefId || state.spec || ranFor.current === state.briefId) return;
    ranFor.current = state.briefId;
    setBusy(true);
    api
      .clarify(state.briefId, null)
      .then((spec) => setState((s) => ({ ...s, spec })))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [state.briefId, state.spec, setState]);

  const setAnswer = (id: string, val: string) => setState((s) => ({ ...s, answers: { ...s.answers, [id]: val } }));

  if (busy && !state.spec) return <Loading label="gemini · reading the brief…" />;
  if (!state.spec) return <ErrBox err={err} />;

  const spec = state.spec;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
      {/* Left: extracted spec + reuse */}
      <div>
        <div className="kicker">What sprint0 read</div>
        <div className="display" style={{ fontSize: 26, margin: "6px 0 16px" }}>
          The spec.
        </div>
        <div className="card-soft" style={{ padding: 16, marginBottom: 12 }}>
          <Field label="goal">{spec.goal}</Field>
          {spec.users.length > 0 && <ChipRow label="users" items={spec.users} />}
          {spec.must_haves.length > 0 && <ChipRow label="must-haves" items={spec.must_haves} />}
          {spec.constraints.length > 0 && <ChipRow label="constraints" items={spec.constraints} />}
        </div>

        {spec.reuse.length > 0 && (
          <div className="card-soft" style={{ padding: 16 }}>
            <div className="kicker" style={{ marginBottom: 8 }}>
              Reuse from memory
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {spec.reuse.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span
                    className="chip"
                    style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      background: r.action === "drop" ? "var(--cream-deep)" : "var(--orange-soft)",
                      borderColor: r.action === "drop" ? "var(--line-strong)" : "var(--orange)",
                      color: r.action === "drop" ? "var(--ink-mute)" : "var(--orange-deep)",
                    }}
                  >
                    {r.action}
                  </span>
                  <b>{r.feature}</b>
                  <span style={{ color: "var(--ink-mute)" }}>← {r.from_project}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: ambiguity clarification cards */}
      <div>
        <div className="kicker">Needs a decision</div>
        <div className="display" style={{ fontSize: 26, margin: "6px 0 16px" }}>
          {spec.ambiguities.length} {spec.ambiguities.length === 1 ? "question" : "questions"}.
        </div>
        {spec.ambiguities.length === 0 ? (
          <div className="card-soft" style={{ padding: 20, color: "var(--ink-soft)", fontSize: 14 }}>
            Nothing ambiguous — the brief was clear. Continue to architecture.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {spec.ambiguities.map((amb) => (
              <ClarifyCard key={amb.id} amb={amb} answer={state.answers[amb.id] ?? amb.resolution ?? ""} onAnswer={(v) => setAnswer(amb.id, v)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClarifyCard({ amb, answer, onAnswer }: { amb: AmbiguityCard; answer: string; onAnswer: (v: string) => void }) {
  const onPreset = amb.options.includes(answer);
  return (
    <div className="card-soft" style={{ padding: 14 }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--orange)", fontWeight: 800, textTransform: "uppercase" }}>
        {amb.feature}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, margin: "6px 0 10px" }}>{amb.question}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {amb.options.map((opt) => (
          <button
            key={opt}
            onClick={() => onAnswer(opt)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              border: answer === opt ? "1.5px solid var(--orange)" : "1.5px solid var(--line-strong)",
              background: answer === opt ? "var(--orange-soft)" : "var(--cream)",
              color: answer === opt ? "var(--orange-deep)" : "var(--ink-soft)",
            }}
          >
            {opt}
          </button>
        ))}
      </div>
      <input
        value={onPreset ? "" : answer}
        onChange={(e) => onAnswer(e.target.value)}
        placeholder="…or specify your own"
        style={{
          width: "100%",
          padding: "7px 10px",
          border: "1.5px solid var(--line-strong)",
          borderRadius: 8,
          fontSize: 12,
          background: "var(--paper)",
          outline: "none",
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}

/* ============================================================
   STEP 2 — ARCHITECTURE CARDS (pick one → locks the stack)
   ============================================================ */
function StepArchitecture({ state, setState }: { state: WizardState; setState: SetState }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const ranFor = useRef<string | null>(null);

  useEffect(() => {
    if (!state.briefId || state.arch.length > 0 || ranFor.current === state.briefId) return;
    ranFor.current = state.briefId;
    setBusy(true);
    api
      .architectures(state.briefId, null)
      .then((res) => setState((s) => ({ ...s, arch: res.cards })))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [state.briefId, state.arch.length, setState]);

  if (busy && state.arch.length === 0) return <Loading label="gemini · proposing architectures…" />;
  if (state.arch.length === 0) return <ErrBox err={err} />;

  const pick = (card: ArchitectureCard) => {
    setPicked(card.name);
    setState((s) => ({ ...s, chosenStack: card.tech_stack }));
  };

  return (
    <div>
      <div className="kicker">Architecture options</div>
      <div className="display" style={{ fontSize: 28, marginTop: 4, marginBottom: 18 }}>
        Pick a stack. {state.arch.length} grounded options.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(state.arch.length, 3)}, 1fr)`, gap: 14 }}>
        {state.arch.map((card) => {
          const active = picked === card.name;
          return (
            <div
              key={card.name}
              role="button"
              tabIndex={0}
              onClick={() => pick(card)}
              className="card-soft card-hover"
              style={{
                padding: 18,
                textAlign: "left",
                cursor: "pointer",
                borderWidth: active ? 2 : 1,
                borderColor: active ? "var(--orange)" : "var(--line-strong)",
                background: active ? "var(--orange-tint)" : "var(--paper)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div className="display" style={{ fontSize: 18 }}>
                  {card.name}
                </div>
                {active && <span className="chip chip-orange" style={{ fontSize: 10, padding: "2px 8px" }}>chosen</span>}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12, lineHeight: 1.45 }}>{card.summary}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                {Object.entries(card.tech_stack).map(([k, v]) => (
                  <span key={k} className="chip" style={{ fontSize: 10, padding: "2px 8px" }}>
                    <span style={{ color: "var(--ink-mute)" }}>{k}:</span> {v}
                  </span>
                ))}
              </div>
              {card.grounded_on.length > 0 && (
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", marginBottom: 2 }}>
                  ↻ {card.grounded_on.join(" · ")}
                </div>
              )}
              {/* Defer the rationale — expanding must not pick the card. */}
              <div onClick={(e) => e.stopPropagation()}>
                <Disclosure summary="Why this?">
                  <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.45, marginBottom: 8 }}>
                    <b>Why:</b> {card.rationale}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--positive)", fontWeight: 700 }}>{card.fit_to_constraints}</div>
                </Disclosure>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14, fontSize: 12, color: "var(--ink-mute)" }}>
        {picked ? `Locked: ${picked} — Continue below.` : "Choose a stack to continue."}
      </div>
    </div>
  );
}

/* ============================================================
   STEP 3 — PLAN DRAFT (epics/issues board + relay DAG preview)
   ============================================================ */
function StepPlan({
  state,
  isFeature,
  featureProjectId,
  plan,
  relay,
  setPlan,
  setPlanId,
  setRelay,
  next,
}: {
  state: WizardState;
  isFeature: boolean;
  featureProjectId: number | null;
  plan: PlanJSON | null;
  relay: RelayState | null;
  setPlan: (plan: PlanJSON | null) => void;
  setPlanId: (id: string | null) => void;
  setRelay: Dispatch<SetStateAction<RelayState | null>>;
  next: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [featureText, setFeatureText] = useState("");
  const ran = useRef(false);

  // Non-feature: auto-draft from brief + chosen stack.
  useEffect(() => {
    if (isFeature || plan || ran.current || !state.briefId) return;
    ran.current = true;
    setBusy(true);
    api
      .plan(state.briefId, { constraints: null, chosen_stack: state.chosenStack })
      .then((res) => {
        setPlan(res.plan);
        setPlanId(res.plan_id);
        setRelay(res.relay);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [isFeature, plan, state.briefId, state.chosenStack, setPlan, setPlanId, setRelay]);

  const draftFeature = async () => {
    if (featureProjectId == null || !featureText.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.addFeature(featureProjectId, { text: featureText });
      setPlan(res.plan);
      setPlanId(res.plan_id);
      setRelay(res.relay);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Feature mode: ask for the feature text first.
  if (isFeature && !plan) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16, justifyContent: "center", flex: 1 }}>
        <div>
          <div className="kicker">Mid-prod feature</div>
          <div className="display" style={{ fontSize: 30, marginTop: 4 }}>
            What should sprint0 add?
          </div>
          <div style={{ fontSize: 14, color: "var(--ink-soft)", marginTop: 6 }}>
            Grounded on the live project (#{featureProjectId}). Produces a delta plan + its own relay.
          </div>
        </div>
        <textarea
          value={featureText}
          onChange={(e) => setFeatureText(e.target.value)}
          rows={4}
          placeholder="Add saved-search alerts: agents subscribe to a filter and get notified on new matching listings."
          style={{
            padding: "12px 14px",
            border: "1.5px solid var(--line-strong)",
            borderRadius: 12,
            fontSize: 14,
            background: "var(--paper)",
            outline: "none",
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
        {err && <div style={{ color: "var(--orange-deep)", fontSize: 13, fontFamily: "var(--font-mono)" }}>{err}</div>}
        <button onClick={draftFeature} className="btn btn-primary" disabled={busy || !featureText.trim()} style={{ alignSelf: "flex-start", opacity: busy || !featureText.trim() ? 0.5 : 1 }}>
          {busy ? "Drafting…" : "Draft delta plan →"}
        </button>
      </div>
    );
  }

  if (busy && !plan) return <Loading label="gemini · drafting the plan…" />;
  if (!plan) return <ErrBox err={err} />;

  const issues = planIssues(plan.epics);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div className="kicker">Plan draft</div>
          <div className="display" style={{ fontSize: 26, marginTop: 4 }}>
            {plan.epics.length} epics · {issues.length} issues · {plan.timeline_weeks}w
          </div>
        </div>
        {plan.grounded_on.length > 0 && (
          <div className="mono" style={{ fontSize: 11, color: "var(--positive)" }}>↻ {plan.grounded_on.join(" · ")}</div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18 }}>
        {/* Epic / issue board */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {plan.epics.map((epic) => (
            <div key={epic.id} className="card-soft" style={{ padding: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>{epic.title}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {epic.issues.map((issue) => (
                  <div
                    key={issue.id}
                    style={{
                      padding: "8px 10px",
                      background: "var(--cream)",
                      borderRadius: 8,
                      borderLeft: `3px solid ${DISCIPLINE_COLOR[issue.discipline]}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>
                      {issue.id}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{issue.title}</span>
                    {issue.stretch_flag && (
                      <span title={issue.stretch_flag} style={{ color: "var(--warn)", fontSize: 12, fontWeight: 800 }}>⚠</span>
                    )}
                    <span style={{ fontSize: 10, fontWeight: 700, color: RISK_COLOR[issue.risk] }}>{issue.risk}</span>
                    <span className="chip" style={{ fontSize: 9, padding: "1px 7px" }}>{DISCIPLINE_LABEL[issue.discipline]}</span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{issue.estimate_days}d</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Relay DAG preview */}
        <div>
          <div className="kicker" style={{ marginBottom: 10 }}>
            Enters the relay
          </div>
          {relay && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {relay.gates.map((g) => {
                const st = statusStyle(g.status);
                return (
                  <div
                    key={g.discipline}
                    className="card-soft"
                    style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: DISCIPLINE_COLOR[g.discipline], border: "1.5px solid var(--ink)" }} />
                    <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{DISCIPLINE_LABEL[g.discipline]}</span>
                    <span className="chip" style={{ fontSize: 10, padding: "2px 8px", background: st.bg, color: st.fg, borderColor: st.border }}>
                      {st.label}
                    </span>
                  </div>
                );
              })}
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 4 }}>
                baton: {relay.baton.map((d) => DISCIPLINE_LABEL[d]).join(", ") || "—"}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <button onClick={next} className="btn btn-primary btn-sm">
          Check staffing →
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   STEP 4 — TRUST DIAL (0–100 → /relay/auto)
   ============================================================ */
function StepTrust({
  state,
  setState,
  planId,
  relay,
  setRelay,
}: {
  state: WizardState;
  setState: SetState;
  planId: string | null;
  relay: RelayState | null;
  setRelay: Dispatch<SetStateAction<RelayState | null>>;
}) {
  const dial = state.dial;
  const setDial = (v: number) => setState((s) => ({ ...s, dial: v }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounce = useRef<number | null>(null);

  const level = dial < 25 ? "Advisor" : dial < 55 ? "Co-pilot" : dial < 85 ? "Navigator" : "Autonomous";
  const presets: [string, number][] = [
    ["Advisor", 10],
    ["Co-pilot", 40],
    ["Navigator", 70],
    ["Autonomous", 95],
  ];

  // Debounced call to /relay/auto on dial change.
  const apply = (v: number) => {
    setDial(v);
    if (!planId) return;
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      setBusy(true);
      setErr(null);
      api
        .relayAuto(planId, v)
        .then((r) => setRelay(r))
        .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false));
    }, 350);
  };

  // Run once on mount with the default dial.
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !planId) return;
    ran.current = true;
    apply(dial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const autoCount = relay?.gates.filter((g) => g.status === "auto_passed").length ?? 0;
  const humanCount = relay ? relay.gates.length - autoCount : 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, height: "100%" }}>
      <div>
        <div className="kicker">Trust dial</div>
        <div className="display" style={{ fontSize: 28, marginTop: 4, marginBottom: 24 }}>
          How much auto-passes?
        </div>

        <div style={{ padding: 20, background: "var(--paper)", borderRadius: 16, border: "1.5px solid var(--line-strong)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", fontWeight: 700 }}>
              {level.toUpperCase()}
            </div>
            <div className="display" style={{ fontSize: 28, color: "var(--orange)" }}>
              {dial}%
            </div>
          </div>

          <div style={{ position: "relative", padding: "12px 0" }}>
            <input
              type="range"
              min="0"
              max="100"
              value={dial}
              onChange={(e) => apply(parseInt(e.target.value))}
              className="trust-slider"
              style={{ width: "100%", height: 16, appearance: "none", background: "transparent", position: "relative", zIndex: 2 }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "50%",
                transform: "translateY(-50%)",
                height: 16,
                borderRadius: 999,
                background: "var(--cream-deep)",
                border: "2px solid var(--ink)",
                pointerEvents: "none",
                overflow: "hidden",
              }}
            >
              <div style={{ height: "100%", width: `${dial}%`, background: "var(--orange)" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 14 }}>
            {presets.map(([n, v]) => (
              <button
                key={n}
                onClick={() => apply(v)}
                style={{
                  padding: "8px 4px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  background: level === n ? "var(--orange-soft)" : "var(--cream)",
                  color: level === n ? "var(--orange-deep)" : "var(--ink-soft)",
                  border: level === n ? "1.5px solid var(--orange)" : "1.5px solid var(--line)",
                }}
              >
                {n}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 18, padding: 14, background: "var(--cream)", borderRadius: 10, display: "flex", gap: 10, alignItems: "center" }}>
            <Mascot size={40} expression={level === "Autonomous" ? "cheer" : level === "Navigator" ? "working" : "happy"} />
            <div style={{ fontSize: 13 }}>
              <b>{level}.</b> {busy ? "recomputing gates…" : `${autoCount} gate${autoCount === 1 ? "" : "s"} auto-pass, ${humanCount} need a human.`}
            </div>
          </div>
          {err && <div style={{ color: "var(--orange-deep)", fontSize: 12, marginTop: 10, fontFamily: "var(--font-mono)" }}>{err}</div>}
        </div>
      </div>

      <div>
        <div className="kicker">Gate disposition</div>
        <div className="display" style={{ fontSize: 28, marginTop: 4, marginBottom: 24 }}>
          Who clears at {dial}.
        </div>
        <div className="card-soft" style={{ padding: 18 }}>
          {relay?.gates.map((g, i, arr) => {
            const auto = g.status === "auto_passed";
            return (
              <div
                key={g.discipline}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 0",
                  borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : "none",
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 3, background: DISCIPLINE_COLOR[g.discipline], border: "1.5px solid var(--ink)" }} />
                <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{DISCIPLINE_LABEL[g.discipline]}</div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    fontFamily: "var(--font-mono)",
                    color: auto ? "var(--info)" : "var(--warn)",
                  }}
                >
                  {auto ? "AUTO" : "HUMAN"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   STEP 5 — DISPATCH (/dispatch → real GitLab result)
   ============================================================ */
function StepDispatch({
  planId,
  setRelay,
  setLiveProjectId,
  setLiveCloneUrl,
  onClose,
  onDone,
}: {
  planId: string | null;
  setRelay: Dispatch<SetStateAction<RelayState | null>>;
  setLiveProjectId: (id: number | null) => void;
  setLiveCloneUrl: (url: string | null) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const refreshProjects = useRefreshProjects();
  const invalidateTasks = useInvalidateWork();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [steps, setSteps] = useState<{ step: number; of: number; message: string }[]>([]);
  // Dry-run the irreversible GitLab creation: what it makes, who it invites, free-tier cap, relay state.
  const [preview, setPreview] = useState<DispatchPreview | null>(null);
  useEffect(() => {
    if (!planId) return;
    api.dispatchPreview(planId).then(setPreview).catch(() => setPreview(null));
  }, [planId]);

  const dispatch = async (mode: "copilot" | "autonomous") => {
    if (!planId) return;
    setBusy(true);
    setErr(null);
    setSteps([]);
    // Cosmetic scaffold-progress stream (unauthenticated WS; canned step sequence).
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(api.planEventsUrl(planId));
      ws.onmessage = (ev) => {
        try {
          setSteps((s) => [...s, JSON.parse(ev.data)]);
        } catch {
          /* ignore malformed frame */
        }
      };
    } catch {
      /* progress stream is optional */
    }
    try {
      // Autonomous force-passes any remaining gates server-side; refresh relay after.
      const res = await api.dispatch(planId, mode);
      setResult(res);
      setLiveProjectId(res.project_id);
      setLiveCloneUrl(res.clone_url || (res.web_url ? res.web_url + ".git" : null));
      draft.clear(); // shipped → the saved draft is spent
      onDone();
      refreshProjects(); // the new project now appears on the manager Dashboard
      invalidateTasks(); // the dispatched project's Tasks now appear in the Work hub
      try {
        setRelay(await api.relay(planId));
      } catch {
        /* relay refresh is best-effort */
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      ws?.close();
      setBusy(false);
    }
  };

  if (result) {
    const stats: [string, string | number][] = [
      ["issues created", result.issues_created],
      ["context branches", result.context_branches ?? "—"],
      ["QA issue", result.qa_issue_iid != null ? `#${result.qa_issue_iid}` : "—"],
      ["default branch", result.default_branch],
    ];
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="kicker">Dispatched</div>
            <div className="display" style={{ fontSize: 30, marginTop: 4 }}>
              Live on GitLab.
            </div>
          </div>
          <Mascot size={72} expression="cheer" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {stats.map(([l, v]) => (
            <div key={l} className="card-soft" style={{ padding: 16 }}>
              <div className="display" style={{ fontSize: 28, color: "var(--orange)" }}>
                {v}
              </div>
              <div className="kicker" style={{ marginTop: 4 }}>
                {l}
              </div>
            </div>
          ))}
        </div>

        <div className="card-soft" style={{ padding: 18, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="kicker">Project {result.project_id}</div>
            <a href={result.web_url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 13, color: "var(--info)", textDecoration: "underline", textUnderlineOffset: 3, wordBreak: "break-all" }}>
              {result.web_url}
            </a>
          </div>
          <button onClick={onClose} className="btn btn-primary btn-sm">
            Done
          </button>
        </div>
        {result.persist_warning && (
          <div style={{ fontSize: 11, color: "var(--warn)", fontFamily: "var(--font-mono)" }}>
            persist warning: {result.persist_warning}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22 }}>
      <Mascot size={88} expression={busy ? "working" : "happy"} className={busy ? "wiggle" : undefined} />
      <div style={{ textAlign: "center" }}>
        <div className="display" style={{ fontSize: 32, marginBottom: 8 }}>
          {busy ? "Scaffolding GitLab…" : "Ready to dispatch."}
        </div>
        <div style={{ fontSize: 15, color: "var(--ink-soft)", maxWidth: 460 }}>
          Copilot dispatches once every gate is cleared. Autonomous force-passes the relay, then scaffolds.
        </div>
      </div>
      {!busy && preview && (
        <div className="card-soft" style={{ padding: 16, width: 460, maxWidth: "92%", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="kicker">Dry run · what dispatch creates</span>
            {preview.is_delta && <span className="chip" style={{ fontSize: 9 }}>delta</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <PreviewStat n={preview.creates.project} label={preview.is_delta ? "extends" : "project"} />
            <PreviewStat n={preview.creates.issues} label="issues" />
            <PreviewStat n={preview.invite_count} label={`of ${preview.free_tier_cap} seats`} warn={preview.exceeds_cap} />
          </div>
          {preview.member_invites.length > 0 && (
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", wordBreak: "break-word" }}>
              invites: {preview.member_invites.map((m) => "@" + m).join(" · ")}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-soft)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: preview.relay_cleared ? "var(--positive)" : "var(--warn)", flexShrink: 0 }} />
            {preview.relay_cleared ? "Relay cleared — copilot can dispatch now." : "Relay not cleared — copilot will block; autonomous force-passes it."}
          </div>
          {preview.exceeds_cap && (
            <div className="mono" style={{ fontSize: 11, color: "var(--red)", display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="warn" size={13} /> {preview.invite_count} invites exceed the {preview.free_tier_cap}-seat free-tier cap.
            </div>
          )}
        </div>
      )}
      {busy && steps.length > 0 && (
        <div className="card-soft" style={{ padding: 16, width: 420, maxWidth: "90%", display: "flex", flexDirection: "column", gap: 8 }}>
          {steps.map((s, i) => (
            <div key={i} className="mono" style={{ fontSize: 12, color: i === steps.length - 1 ? "var(--ink)" : "var(--ink-mute)", display: "flex", gap: 8 }}>
              <span style={{ color: "var(--orange)", fontWeight: 700 }}>{s.step}/{s.of}</span>
              {s.message}
            </div>
          ))}
        </div>
      )}
      {err && (
        <div className="card-soft" style={{ padding: 14, borderColor: "var(--orange)", color: "var(--orange-deep)", fontFamily: "var(--font-mono)", fontSize: 12, maxWidth: 560 }}>
          {err}
        </div>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={() => dispatch("copilot")} disabled={busy} className="btn btn-primary" style={{ opacity: busy ? 0.5 : 1 }}>
          {busy ? "Working…" : "Dispatch (copilot) →"}
        </button>
        <button onClick={() => dispatch("autonomous")} disabled={busy} className="btn btn-dark" style={{ opacity: busy ? 0.5 : 1 }}>
          Autonomous ⚡
        </button>
      </div>
    </div>
  );
}

/* ── small shared bits ── */
function PreviewStat({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <div style={{ textAlign: "center", padding: "8px 4px", background: "var(--cream)", borderRadius: 8 }}>
      <div className="display" style={{ fontSize: 22, color: warn ? "var(--red)" : "var(--ink)" }}>{n}</div>
      <div className="kicker" style={{ marginTop: 2, fontSize: 9 }}>{label}</div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid var(--orange)", borderTopColor: "transparent", animation: "spin-slow 0.8s linear infinite" }} />
      <div className="mono" style={{ fontSize: 13, color: "var(--ink-mute)" }}>
        {label}
      </div>
    </div>
  );
}

function ErrBox({ err }: { err: string | null }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <Mascot size={64} expression="surprised" />
      <div className="display" style={{ fontSize: 22 }}>
        Something tripped.
      </div>
      <div className="mono" style={{ fontSize: 12, color: "var(--orange-deep)", maxWidth: 520, textAlign: "center" }}>
        {err ?? "No data returned."}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "6px 0" }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--orange)", fontWeight: 800, textTransform: "uppercase", minWidth: 80 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{children}</div>
    </div>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "6px 0", borderTop: "1px solid var(--line)" }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 800, textTransform: "uppercase", minWidth: 80, paddingTop: 4 }}>
        {label}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {items.map((it, i) => (
          <span key={i} className="chip" style={{ fontSize: 11, padding: "3px 9px" }}>
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
