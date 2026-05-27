import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useApp } from "../app/AppContext";
import { Mascot } from "../components/Mascot";
import { api } from "../lib/api";
import type {
  AmbiguityCard,
  ArchitectureCard,
  ClarifiedSpec,
  DispatchResult,
  PlanJSON,
  RelayState,
  TechStack,
} from "../lib/api";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL, planIssues, RISK_COLOR, statusStyle } from "../lib/relayUtils";
import { StaffingGap } from "../views/StaffingGap";

/* baton — Brief Wizard, wired to the real gateway.
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

export function WizardBrief() {
  const {
    setWizardOpen,
    setWizardKind,
    featureProjectId,
    setFeatureProjectId,
    plan,
    setPlan,
    planId,
    setPlanId,
    relay,
    setRelay,
    setLiveProjectId,
    setLiveCloneUrl,
  } = useApp();

  const isFeature = featureProjectId != null;
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>({
    briefId: null,
    spec: null,
    answers: {},
    arch: [],
    chosenStack: null,
    dial: 70,
  });

  const close = () => {
    setFeatureProjectId(null);
    setWizardOpen(false);
  };
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  // Feature mode skips Drop/Clarify/Architecture: the delta plan comes back directly.
  const firstStep = isFeature ? 3 : 0;
  useEffect(() => {
    if (isFeature) setStep(3);
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
              <div style={{ fontWeight: 800, fontSize: 16 }}>baton is on it</div>
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
          <button
            onClick={close}
            style={{ width: 32, height: 32, borderRadius: 8, background: "var(--cream-deep)", display: "grid", placeItems: "center", fontSize: 18, fontWeight: 700 }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: 32, display: "flex", flexDirection: "column" }}>
          {step === 0 && <StepDrop setState={setState} next={next} />}
          {step === 1 && <StepClarify state={state} setState={setState} next={next} />}
          {step === 2 && <StepArchitecture state={state} setState={setState} next={next} />}
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
            <StepDispatch planId={planId} setRelay={setRelay} setLiveProjectId={setLiveProjectId} setLiveCloneUrl={setLiveCloneUrl} onClose={close} />
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
              <button onClick={close} className="btn btn-ghost btn-sm">
                Save &amp; exit
              </button>
              <StepNext step={step} state={state} planId={planId} next={next} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* The Continue button knows which steps gate on async work vs simple advance. */
function StepNext({ step, state, planId, next }: { step: number; state: WizardState; planId: string | null; next: () => void }) {
  // Steps with their own primary action inside the body (Drop, Plan, Staffing): hide footer Continue.
  if (step === 0 || step === 3 || step === STEP_STAFFING) return null;
  const disabled =
    (step === 1 && !state.spec) || (step === 2 && state.arch.length === 0) || (step === STEP_TRUST && !planId);
  return (
    <button onClick={next} className="btn btn-primary btn-sm" disabled={disabled} style={{ opacity: disabled ? 0.5 : 1 }}>
      {step === STEP_TRUST ? "To dispatch →" : "Continue →"}
    </button>
  );
}

/* ============================================================
   STEP 0 — DROP (upload text or file → /api/briefs)
   ============================================================ */
function StepDrop({ setState, next }: { setState: SetState; next: () => void }) {
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
function StepClarify({ state, setState, next }: { state: WizardState; setState: SetState; next: () => void }) {
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

  const resolveAndNext = async () => {
    if (!state.briefId) return;
    setBusy(true);
    setErr(null);
    try {
      if (Object.keys(state.answers).length > 0) {
        const spec = await api.resolveClarify(state.briefId, state.answers);
        setState((s) => ({ ...s, spec }));
      }
      next();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (busy && !state.spec) return <Loading label="gemini · reading the brief…" />;
  if (!state.spec) return <ErrBox err={err} />;

  const spec = state.spec;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
      {/* Left: extracted spec + reuse */}
      <div>
        <div className="kicker">What baton read</div>
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
        {err && <div style={{ color: "var(--orange-deep)", fontSize: 12, marginTop: 10, fontFamily: "var(--font-mono)" }}>{err}</div>}
        <button onClick={resolveAndNext} className="btn btn-primary btn-sm" style={{ marginTop: 16, opacity: busy ? 0.6 : 1 }} disabled={busy}>
          {busy ? "Saving…" : "Lock answers → architecture"}
        </button>
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
function StepArchitecture({ state, setState, next }: { state: WizardState; setState: SetState; next: () => void }) {
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
            <button
              key={card.name}
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                {Object.entries(card.tech_stack).map(([k, v]) => (
                  <span key={k} className="chip" style={{ fontSize: 10, padding: "2px 8px" }}>
                    <span style={{ color: "var(--ink-mute)" }}>{k}:</span> {v}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.45, marginBottom: 10 }}>
                <b>Why:</b> {card.rationale}
              </div>
              <div style={{ fontSize: 12, color: "var(--positive)", fontWeight: 700 }}>{card.fit_to_constraints}</div>
              {card.grounded_on.length > 0 && (
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 8 }}>
                  ↻ {card.grounded_on.join(" · ")}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={next} className="btn btn-primary btn-sm" disabled={!picked} style={{ opacity: picked ? 1 : 0.5 }}>
          Draft the plan →
        </button>
        <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>{picked ? `Locked: ${picked}` : "Choose one to continue"}</span>
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
  setPlan: Dispatch<SetStateAction<PlanJSON | null>>;
  setPlanId: Dispatch<SetStateAction<string | null>>;
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
            What should baton add?
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
}: {
  planId: string | null;
  setRelay: Dispatch<SetStateAction<RelayState | null>>;
  setLiveProjectId: Dispatch<SetStateAction<number | null>>;
  setLiveCloneUrl: Dispatch<SetStateAction<string | null>>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<DispatchResult | null>(null);

  const dispatch = async (mode: "copilot" | "autonomous") => {
    if (!planId) return;
    setBusy(true);
    setErr(null);
    try {
      // Autonomous force-passes any remaining gates server-side; refresh relay after.
      const res = await api.dispatch(planId, mode);
      setResult(res);
      setLiveProjectId(res.project_id);
      setLiveCloneUrl(res.clone_url || (res.web_url ? res.web_url + ".git" : null));
      try {
        setRelay(await api.relay(planId));
      } catch {
        /* relay refresh is best-effort */
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
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
