/* sprint0 — the live ReAct trace for ANY plan-scoped backend process ({runId}:{phase}). Gemini · MongoDB ·
   GCP (Vertex/ADK) · GitLab steps, concise + icon-chipped, replays on load. Renders nothing until a step
   lands, so it's safe to mount anywhere a wait happens (dispatch). Visual matches the brief wizard's
   ReActTrace: a left rail with a dot per step + a vertical connector line, NO grey box. */
import { useEffect, useState } from "react";
import { api } from "../lib/api";

const TRACE_ACTOR: Record<string, { label: string; bg: string; fg: string }> = {
  gemini:  { label: "Gemini",  bg: "oklch(0.28 0.09 265)", fg: "#fff" },
  mongodb: { label: "MongoDB", bg: "oklch(0.28 0.13 148)", fg: "#fff" },
  gitlab:  { label: "GitLab",  bg: "oklch(0.28 0.10 22)",  fg: "#fff" },
  voyage:  { label: "Voyage",  bg: "oklch(0.28 0.10 290)", fg: "#fff" },
  gcp:     { label: "GCP",     bg: "oklch(0.30 0.13 250)", fg: "#fff" },  // Vertex / ADK runtime
  server:  { label: "sprint0", bg: "var(--bg-active)",     fg: "var(--text-secondary)" },
};
const TRACE_DOT: Record<string, string> = { thought: "var(--text-quaternary)", action: "var(--blue)", result: "var(--green)" };

export function LiveTrace({ runId, phase, title }: { runId: string | null; phase: string; title: string }) {
  const [steps, setSteps] = useState<any[]>([]);
  useEffect(() => {
    setSteps([]);
    if (!runId) return;
    let alive = true, inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try { const r = await api.trace(runId, phase); if (alive && r.steps?.length) setSteps((p) => (r.steps.length >= p.length ? r.steps : p)); }
      catch { /* trace is best-effort */ } finally { inFlight = false; }
    };
    poll();
    const id = setInterval(poll, 1200);
    return () => { alive = false; clearInterval(id); };
  }, [runId, phase]);
  if (!steps.length) return null;
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <div className="mono" style={{ fontSize: 9.5, color: "var(--text-quaternary)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {steps.map((s: any, i: number) => {
          const a = TRACE_ACTOR[s.actor] || TRACE_ACTOR.server;
          const dot = TRACE_DOT[s.kind] || TRACE_DOT.thought;
          const isLast = i === steps.length - 1;
          return (
            <div key={s.seq ?? i} style={{ display: "flex", gap: 10, animation: "s0-fade-in var(--t-reg) both" }}>
              {/* left rail: a dot per step + a vertical connector line down to the next */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 6, flexShrink: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                {!isLast && <span style={{ width: 1.5, flex: 1, minHeight: 16, background: "var(--border)", marginTop: 3 }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: "2px 0 11px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", height: 15, padding: "0 6px", borderRadius: "var(--r-xs)", background: a.bg, color: a.fg, fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)", flexShrink: 0, marginTop: 1 }}>{a.label}</span>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4, minWidth: 0 }}>
                    {s.label}{s.detail ? <span style={{ color: "var(--text-quaternary)" }}> · {s.detail}</span> : null}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
