/* sprint0 — Wizard motion helpers: the animated stepper rail (drip-down connector +
   check-pop), the AI "digest" SequenceLoader (brief → clarify, and the dispatch run),
   and the draft-confirm sheet. Monochrome, subtle, on-brand.

   Ported pixel-1:1 from the v5 mockup (app/WizardMotion.jsx). The s0-* animation
   classes/keyframes are already in styles/tokens.css; usage is verbatim. */
import { useState, useEffect } from "react";
import { Icon, ZeroMark } from "../lib/icon";
import { Button } from "../components/ui";
import { api, type TraceStep } from "../lib/api";

type Step = { id: string; label: string; sub: string };

/* ───────── animated stepper rail ─────────
   When a step completes: the check pops in, then the connector "drips" down to the
   next node. The current node breathes softly. */
export function Stepper({ steps, step }: { steps: Step[]; step: number }) {
  return (
    <div style={{ width: 230, flexShrink: 0, padding: "20px 14px" }}>
      {steps.map((s, i) => {
        const done = i < step, cur = i === step;
        return (
          <div key={s.id} style={{ display: "flex", gap: 11, marginBottom: 4 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0,
                background: done ? "var(--text-primary)" : cur ? "var(--bg-elevated)" : "transparent",
                border: `0.5px solid ${cur || done ? "var(--text-primary)" : "var(--border-strong)"}`,
                color: done ? "#fff" : cur ? "var(--text-primary)" : "var(--text-quaternary)",
                fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                boxShadow: cur ? "0 0 0 4px var(--bg-active)" : "none",
                transition: "background var(--t-slow) var(--ease-out), border-color var(--t-slow), color var(--t-slow), box-shadow var(--t-reg)" }}>
                {done
                  ? <span key="c" style={{ display: "grid", placeItems: "center", animation: "s0-check-pop 0.4s var(--ease-out) both" }}><Icon name="check" size={13} /></span>
                  : <span style={{ animation: cur ? "s0-fade-in var(--t-reg) both" : "none" }}>{i + 1}</span>}
              </span>
              {i < steps.length - 1 && (
                <span style={{ width: 1.5, flex: 1, minHeight: 26, background: "var(--border)", position: "relative", overflow: "hidden", borderRadius: 1 }}>
                  <span style={{ position: "absolute", inset: 0, background: "var(--text-primary)", transformOrigin: "top",
                    transform: done ? "scaleY(1)" : "scaleY(0)",
                    transition: "transform 0.5s var(--ease-out)", transitionDelay: done ? "0.12s" : "0s" }} />
                </span>
              )}
            </div>
            <div style={{ paddingTop: 2 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: cur || done ? "var(--text-primary)" : "var(--text-quaternary)",
                transition: "color var(--t-slow)" }}>{s.label}</div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{s.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────── the AI digest / run loader ─────────
   Cycles a list of status lines: pending → spinner → check, one at a time, then onDone. */
export function SequenceLoader({ kicker, headline, lines, stepMs = 720, onDone }: {
  kicker: string; headline: React.ReactNode; lines: string[]; stepMs?: number; onDone: () => void;
}) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (active >= lines.length) { const t = setTimeout(onDone, 480); return () => clearTimeout(t); }
    const t = setTimeout(() => setActive(a => a + 1), stepMs);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "8px 0", animation: "s0-fade-in var(--t-reg) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 22 }}>
        <span style={{ width: 34, height: 34, borderRadius: "var(--r-md)", background: "var(--bg-secondary)", border: "0.5px solid var(--border)",
          display: "grid", placeItems: "center" }}><ZeroMark size={18} /></span>
        <div style={{ flex: 1 }}>
          <div className="kicker" style={{ marginBottom: 3 }}>{kicker}</div>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px", display: "flex", alignItems: "center", gap: 9 }}>
            {headline}
            <span style={{ display: "inline-flex", gap: 4 }}>
              {[0, 1, 2].map(i => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-primary)", animation: `s0-dot-pulse 1.1s ${i * 0.16}s infinite` }} />)}
            </span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {lines.map((ln, i) => {
          const state = i < active ? "done" : i === active ? "run" : "wait";
          return (
            <div key={ln} style={{ display: "flex", alignItems: "center", gap: 12, height: 40, padding: "0 12px", borderRadius: "var(--r-md)",
              background: state === "run" ? "var(--bg-secondary)" : "transparent", transition: "background var(--t-reg)" }}>
              <span style={{ width: 18, height: 18, flexShrink: 0, display: "grid", placeItems: "center" }}>
                {state === "done" && <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--text-primary)", display: "grid", placeItems: "center", animation: "s0-check-pop 0.34s var(--ease-out) both" }}><Icon name="check" size={11} style={{ color: "#fff" }} /></span>}
                {state === "run" && <span style={{ width: 15, height: 15, borderRadius: "50%", border: "1.6px solid var(--border-strong)", borderTopColor: "var(--text-primary)", animation: "s0-spin 0.7s linear infinite" }} />}
                {state === "wait" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--border-strong)" }} />}
              </span>
              <span style={{ fontSize: 13, fontWeight: state === "wait" ? 400 : 500,
                color: state === "wait" ? "var(--text-quaternary)" : state === "run" ? "var(--text-primary)" : "var(--text-secondary)",
                transition: "color var(--t-reg)" }}>{ln}</span>
              {state === "run" && <span style={{ width: 7, height: 14, borderLeft: "1.5px solid var(--text-primary)", marginLeft: 2, animation: "s0-caret 1s steps(1) infinite" }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────── ReAct trace (live agent reasoning) ─────────
   Polls GET /api/briefs/{id}/trace and renders the REAL Gemini · MongoDB · GitLab steps the
   gateway emits during a phase (clarify/arch/plan). Visual is the v5 mockup's ReActTrace ported
   1:1; the data is live (no canned REACT_STEPS). `onDone` fires after a minimum dwell so even a
   fast (cached) phase shows a beat of reasoning — runLoader keeps the loader up until the real
   call ALSO resolves, so a slow phase streams its whole trace. */
const ACTOR_META: Record<string, { label: string; bg: string; fg: string }> = {
  gemini:  { label: "Gemini",  bg: "oklch(0.28 0.09 265)", fg: "#fff" },
  mongodb: { label: "MongoDB", bg: "oklch(0.28 0.13 148)", fg: "#fff" },
  gitlab:  { label: "GitLab",  bg: "oklch(0.28 0.10 22)",  fg: "#fff" },
  voyage:  { label: "Voyage",  bg: "oklch(0.28 0.10 290)", fg: "#fff" },
  server:  { label: "server",  bg: "var(--bg-active)",     fg: "var(--text-secondary)" },
};
const KIND_DOT: Record<string, string> = {
  thought: "var(--text-quaternary)",
  action:  "var(--blue)",
  result:  "var(--green)",
};
const PHASE_LABEL: Record<string, string> = { clarify: "clarify", memory: "memory", arch: "architecture", plan: "plan" };

export function ReActTrace({ runId, phase, fallback, onDone, minDwellMs = 1500 }: {
  runId: string | null; phase: string; fallback: string[]; onDone: () => void; minDwellMs?: number;
}) {
  const [steps, setSteps] = useState<TraceStep[]>([]);

  // poll the live trace while the phase runs (runId = briefId; set early for clarify, already set for arch/plan)
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const poll = async () => {
      try { const r = await api.trace(runId); if (alive && r.steps?.length) setSteps(r.steps); } catch { /* trace is best-effort */ }
    };
    poll();
    const id = setInterval(poll, 800);
    return () => { alive = false; clearInterval(id); };
  }, [runId]);

  // fire onDone after a minimum dwell — runLoader holds the loader until the real call also resolves
  useEffect(() => {
    const t = setTimeout(onDone, minDwellMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // before any real step lands, show the phase's fallback lines as ghost thoughts so the pane is never empty
  const shown: TraceStep[] = steps.length
    ? steps
    : fallback.map((l, i) => ({ seq: i, actor: "server", kind: "thought" as const, label: l }));
  const lastIdx = shown.length - 1;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "6px 0", animation: "s0-fade-in var(--t-reg) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <span style={{ width: 36, height: 36, borderRadius: "var(--r-md)", background: "var(--bg-secondary)",
          border: "0.5px solid var(--border)", display: "grid", placeItems: "center" }}>
          <ZeroMark size={19} />
        </span>
        <div>
          <div className="kicker" style={{ marginBottom: 3 }}>sprint0 · {PHASE_LABEL[phase] || phase}</div>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px", display: "flex", alignItems: "center", gap: 9 }}>
            Reasoning
            <span style={{ display: "inline-flex", gap: 4 }}>
              {[0, 1, 2].map(i => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-primary)",
                animation: `s0-dot-pulse 1.1s ${i * 0.16}s infinite` }} />)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {shown.map((step, i) => {
          const actor = ACTOR_META[step.actor] || ACTOR_META.server;
          const kindDot = KIND_DOT[step.kind] || KIND_DOT.thought;
          const isCurrent = i === lastIdx;
          const isLast = i === shown.length - 1;
          return (
            <div key={step.seq} style={{ display: "flex", gap: 10, animation: "s0-pop-in var(--t-reg) var(--ease-out) both" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 10, flexShrink: 0 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: kindDot, flexShrink: 0,
                  boxShadow: isCurrent ? `0 0 0 3px color-mix(in srgb, ${kindDot} 20%, transparent)` : "none",
                  transition: "box-shadow var(--t-reg)" }} />
                {!isLast && <span style={{ width: 1.5, flex: 1, minHeight: 22, background: "var(--border)", marginTop: 3 }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: "5px 0 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: step.detail ? 6 : 0 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", height: 17, padding: "0 7px",
                    borderRadius: "var(--r-xs)", background: actor.bg, color: actor.fg,
                    fontSize: 9.5, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.05em", flexShrink: 0 }}>
                    {actor.label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: isCurrent ? 600 : 500,
                    color: isCurrent ? "var(--text-primary)" : "var(--text-secondary)",
                    transition: "color var(--t-reg)" }}>
                    {step.label}
                  </span>
                  {isCurrent && <span style={{ width: 6, height: 13, borderLeft: "1.5px solid var(--text-primary)",
                    animation: "s0-caret 1s steps(1) infinite", marginLeft: 1 }} />}
                </div>
                {step.detail && (
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", lineHeight: 1.5,
                    background: "var(--bg-secondary)", padding: "5px 9px", borderRadius: "var(--r-sm)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    animation: "s0-fade-in var(--t-reg) 0.06s both" }}>
                    {step.detail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────── draft confirm sheet ───────── */
export function ConfirmDraft({ name, onConfirm, onCancel }: { name: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div onClick={onCancel} style={{ position: "absolute", inset: 0, zIndex: 40, display: "grid", placeItems: "center",
      background: "rgba(20,18,16,0.32)", backdropFilter: "blur(2px)", animation: "s0-scrim-in var(--t-reg) both" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 380, background: "var(--bg-elevated)", borderRadius: "var(--r-xl)",
        border: "0.5px solid var(--border)", boxShadow: "var(--shadow-3)", padding: 20, animation: "s0-sheet-in var(--t-reg) var(--ease-out) both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ width: 30, height: 30, borderRadius: "var(--r-md)", background: "var(--bg-secondary)", border: "0.5px solid var(--border)", display: "grid", placeItems: "center" }}>
            <Icon name="clock" size={15} style={{ color: "var(--text-tertiary)" }} />
          </span>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px" }}>Save as a draft?</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.55, margin: "0 0 18px" }}>
          <b style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{name}</b> will be saved to Projects under <b style={{ color: "var(--text-secondary)", fontWeight: 500 }}>Drafts</b>. Nothing is created in GitLab — you can pick it back up and dispatch any time.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" size="md" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" size="md" icon="clock" onClick={onConfirm}>Save draft</Button>
        </div>
      </div>
    </div>
  );
}
