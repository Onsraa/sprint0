/* sprint0 — Feature-add wizard (Part 2): a manager adds a feature to a LIVE project —
   intake (+ Urgent toggle) -> grounded delta plan -> pre-commit IMPACT PREVIEW -> dispatch.
   Wired to api.addFeature -> api.featurePreview -> api.dispatch. Leads with capacity, not dates;
   propose-and-ratify (an urgent dispatch sends a reschedule for consent). Ported from the v8 design's
   Reflow.jsx (ImpactPreview / CascadePanel / CapacityBar / OldNewStrip). Mounts over the app; shows
   when useUI.featureProjectId is set. */
import { useEffect, useState } from "react";
import { useUI } from "../lib/store";
import { useApp } from "../app/useApp";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Icon, ZeroMark } from "../lib/icon";
import { Button, IconButton, Badge, DiscDot, DISC, Avatar, StatusIcon } from "../components/ui";

type Impact = Awaited<ReturnType<typeof api.featurePreview>>;

function CapacityBar({ name, before, after }: { name: string; before: number; after: number }) {
  const over = after > 100, MAX = 130;
  const pct = (v: number) => `${(Math.min(v, MAX) / MAX) * 100}%`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, width: 96, flexShrink: 0 }}>
        <Avatar name={name} size={20} /><span style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(name || "?").split(" ")[0]}</span>
      </span>
      <div style={{ flex: 1, position: "relative", height: 18 }}>
        <div style={{ position: "absolute", inset: "6px 0", borderRadius: 3, background: "var(--bg-tertiary)", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(before), background: "var(--border-strong)", opacity: 0.6 }} />
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(after), background: over ? "var(--red)" : "var(--text-secondary)", borderRadius: 3, transition: "width 0.5s var(--ease-out)" }} />
        </div>
        <div title="100%" style={{ position: "absolute", left: `${(100 / MAX) * 100}%`, top: 0, bottom: 0, width: 1.5, background: "var(--text-primary)", opacity: 0.35 }} />
      </div>
      <span className="mono" style={{ width: 92, flexShrink: 0, textAlign: "right", fontSize: 11.5, color: "var(--text-quaternary)" }}>
        {before}% → <b style={{ fontWeight: 600, color: over ? "var(--red)" : "var(--text-secondary)" }}>{after}%</b>
      </span>
    </div>
  );
}

function OldNewStrip({ rows }: { rows: Impact["moved"] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {rows.map((t) => (
        <div key={t.task_id} style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 38, padding: "7px 10px", borderRadius: "var(--r-md)", background: "var(--bg-secondary)" }}>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", width: 64, flexShrink: 0 }}>{t.task_id}</span>
          <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", textDecoration: "line-through" }}>{t.old_end ?? "—"}</span>
            <Icon name="arrowRight" size={11} style={{ color: "var(--text-quaternary)" }} />
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontWeight: 600 }}>{t.new_end ?? "—"}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function CascadePanel({ impact }: { impact: Impact }) {
  return (
    <div>
      <div className="kicker" style={{ marginBottom: 10 }}>Per-person capacity · after re-pack</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18, padding: 14, border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", background: "var(--bg-elevated)" }}>
        {impact.capacity.length ? impact.capacity.map((c) => <CapacityBar key={c.username} name={c.name} before={c.before} after={c.after} />)
          : <span style={{ fontSize: 12.5, color: "var(--text-quaternary)" }}>No capacity change.</span>}
      </div>
      {impact.untouched.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Icon name="lock" size={13} style={{ color: "var(--text-tertiary)" }} />
            <span className="kicker" style={{ fontSize: 10 }}>In progress · untouched</span>
            <span style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 16 }}>
            {impact.untouched.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 36, padding: "7px 10px", borderRadius: "var(--r-md)" }}>
                <StatusIcon status={t.status} size={13} />
                <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", width: 64, flexShrink: 0 }}>{t.id}</span>
                <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-secondary)" }}>{t.title}</span>
                <Badge tone="outline" mono>not moved</Badge>
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon name="calendar" size={13} style={{ color: "var(--text-tertiary)" }} />
        <span className="kicker" style={{ fontSize: 10 }}>Planned · re-packed ({impact.pushed})</span>
        <span style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
      </div>
      {impact.moved.length ? <OldNewStrip rows={impact.moved} />
        : <div style={{ padding: 10, fontSize: 12.5, color: "var(--text-quaternary)" }}>Nothing pushed — there's room for this.</div>}
    </div>
  );
}

function ImpactPreview({ impact, urgent, onProceed, onAdjust, onCancel, busy }: { impact: Impact; urgent: boolean; onProceed: () => void; onAdjust: () => void; onCancel: () => void; busy: boolean }) {
  const worst = [...impact.capacity].sort((a, b) => b.after - a.after)[0];
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <div style={{ border: `0.5px solid ${urgent ? "var(--text-primary)" : "var(--border)"}`, borderRadius: "var(--r-xl)", overflow: "hidden", boxShadow: "var(--shadow-2)", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 16px", borderBottom: "0.5px solid var(--border-subtle)", background: "var(--bg-secondary)" }}>
          <span style={{ width: 34, height: 34, borderRadius: "var(--r-md)", display: "grid", placeItems: "center", flexShrink: 0, background: "var(--bg-elevated)", border: "0.5px solid var(--border)" }}><Icon name="bolt" size={17} style={{ color: "var(--text-primary)" }} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.1px" }}>Before you dispatch — here's what changes</div>
            <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
              <Badge tone="neutral" mono>+{impact.feature_tasks} tasks</Badge>
              <Badge tone="neutral" mono>pushes {impact.pushed} slices</Badge>
              {worst && <Badge tone={worst.after > 100 ? "red" : "amber"} mono>@{(worst.name || "").split(" ")[0]} {worst.before}%→{worst.after}%</Badge>}
              <Badge tone={impact.at_risk > 1 ? "red" : "amber"} mono>{impact.at_risk} at risk</Badge>
            </div>
          </div>
          {urgent && <Badge tone="red"><Icon name="bolt" size={10} />urgent</Badge>}
        </div>
        <div style={{ padding: 16 }}><CascadePanel impact={impact} /></div>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-quaternary)", margin: "0 0 14px", lineHeight: 1.5, display: "flex", alignItems: "center", gap: 7 }}>
        <ZeroMark size={13} />Nothing is dispatched yet. sprint0 only re-packs <b style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>unstarted, lower-priority</b> work — in-progress slices are never moved.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="primary" size="lg" icon="check" onClick={onProceed} disabled={busy}>{busy ? "Dispatching…" : "Proceed — dispatch the delta"}</Button>
        <Button variant="secondary" size="lg" icon="sort" onClick={onAdjust} disabled={busy}>Adjust</Button>
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="lg" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

function FeatureIntake({ brief, setBrief, urgent, setUrgent }: { brief: string; setBrief: (s: string) => void; urgent: boolean; setUrgent: (u: boolean) => void }) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.3px", margin: "0 0 6px" }}>What's the feature?</h2>
      <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: "0 0 16px", lineHeight: 1.55 }}>A one-line brief. sprint0 grounds it on agency memory, drafts the delta tasks, and shows the capacity impact before anything is dispatched.</p>
      <div className="kicker" style={{ marginBottom: 8 }}>Feature brief</div>
      <textarea value={brief} onChange={(e) => setBrief(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} rows={3}
        placeholder="e.g. Bulk CSV export with saved filters…"
        style={{ width: "100%", padding: "12px 14px", fontSize: 14, lineHeight: 1.55, resize: "none", marginBottom: 16, background: "var(--bg-elevated)", borderRadius: "var(--r-lg)", border: `0.5px solid ${focus ? "var(--text-primary)" : "var(--border-strong)"}`, boxShadow: "var(--shadow-inset)", outline: "none", color: "var(--text-primary)", fontFamily: "var(--font-ui)" }} />
      <button onClick={() => setUrgent(!urgent)}
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "13px 14px", textAlign: "left", borderRadius: "var(--r-lg)", border: `0.5px solid ${urgent ? "var(--red)" : "var(--border)"}`, background: urgent ? "rgba(212,58,58,0.06)" : "var(--bg-elevated)", boxShadow: "var(--shadow-1)" }}>
        <span style={{ width: 36, height: 22, borderRadius: 11, padding: 2, flexShrink: 0, display: "flex", background: urgent ? "var(--red)" : "var(--bg-tertiary)", justifyContent: urgent ? "flex-end" : "flex-start", transition: "background var(--t-reg)" }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "var(--shadow-1)" }} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600 }}><Icon name="bolt" size={14} style={{ color: urgent ? "var(--red)" : "var(--text-tertiary)" }} />Urgent</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2, lineHeight: 1.45 }}>Re-pack the roadmap now — bump unstarted lower-priority work to make room. In-progress slices are never moved.</div>
        </div>
      </button>
    </div>
  );
}

function FeaturePlan({ tasks }: { tasks: any[] }) {
  return (
    <div style={{ animation: "s0-fade-in var(--t-reg) both" }}>
      <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.3px", margin: "0 0 6px" }}>Grounded delta plan</h2>
      <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: "0 0 16px", lineHeight: 1.55 }}>sprint0 proposes <b style={{ color: "var(--text-secondary)" }}>{tasks.length} tasks</b> across the relay, grounded on agency memory.</p>
      <div className="kicker" style={{ marginBottom: 8 }}>Tasks to add · {tasks.length}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {tasks.map((t, i) => {
          const lane = t.lane ?? t.discipline;
          return (
            <div key={t.id ?? i} style={{ display: "flex", alignItems: "center", gap: 11, minHeight: 40, padding: "8px 10px", borderRadius: "var(--r-md)", background: "var(--bg-secondary)" }}>
              <Icon name="plus" size={13} style={{ color: "var(--text-tertiary)" }} />
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", width: 64, flexShrink: 0 }}>{t.id}</span>
              <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, width: 78, flexShrink: 0 }}><DiscDot d={lane} /><span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{DISC[lane]?.label ?? lane}</span></span>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", width: 24, textAlign: "right" }}>{t.estimate_days ?? 1}d</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FeatureDone({ proj, urgent, onRelay, onInbox }: { proj: any; urgent: boolean; onRelay: () => void; onInbox: () => void }) {
  return (
    <div style={{ maxWidth: 440, margin: "12px auto", textAlign: "center", animation: "s0-rise 0.4s var(--ease-out) both" }}>
      <span style={{ width: 54, height: 54, borderRadius: "50%", background: "var(--text-primary)", display: "grid", placeItems: "center", margin: "0 auto 18px" }}><Icon name="check" size={27} style={{ color: "#fff" }} /></span>
      <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 8px" }}>Delta dispatched</h1>
      <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", lineHeight: 1.55, margin: "0 0 22px" }}>The delta contract opened on <b style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{proj?.name}</b>.{urgent ? " The reschedule was sent to affected members for consent — propose-and-ratify, not a silent move." : " New gates route as the relay clears."}</p>
      <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
        {urgent && <Button variant="secondary" size="lg" icon="calendar" onClick={onInbox}>Review reschedule</Button>}
        <Button variant="primary" size="lg" icon="pool" iconRight="arrowRight" onClick={onRelay}>Open in Relays</Button>
      </div>
    </div>
  );
}

function GenLoader({ urgent }: { urgent: boolean }) {
  const lines = ["Reading the feature brief", "Diffing against the live plan", `Re-packing the roadmap${urgent ? " (urgent)" : ""}`, "Computing capacity impact"];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => x + 1), 600); return () => clearInterval(t); }, []);
  return (
    <div style={{ padding: "20px 0", animation: "s0-fade-in var(--t-reg) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><ZeroMark size={15} /><span className="kicker">sprint0 · delta plan</span></div>
      <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.3px", margin: "0 0 18px" }}>Grounding a delta plan</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {lines.map((l, idx) => (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: idx < i ? "var(--text-secondary)" : "var(--text-quaternary)" }}>
            {idx < i ? <Icon name="check" size={14} style={{ color: "var(--green)" }} /> : <span style={{ width: 14, height: 14, borderRadius: "50%", border: "1.5px solid var(--border-strong)", flexShrink: 0 }} />}
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeatureWizard() {
  const { projects, setView }: any = useApp();
  const featureProjectId = useUI((s) => s.featureProjectId);
  const setFeatureProjectId = useUI((s) => s.setFeatureProjectId);
  const [step, setStep] = useState<"intake" | "gen" | "plan" | "impact" | "done">("intake");
  const [brief, setBrief] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (featureProjectId != null) { setStep("intake"); setBrief(""); setUrgent(false); setPlanId(null); setTasks([]); setImpact(null); }
  }, [featureProjectId]);

  if (featureProjectId == null) return null;
  const proj = (projects as any[]).find((p) => p.project_id === featureProjectId) ?? (projects as any[])[0];
  const close = () => setFeatureProjectId(null);

  const genPlan = async () => {
    if (!proj) return;
    setStep("gen"); setBusy(true);
    try {
      const r = await api.addFeature(proj.project_id, { text: brief.trim(), priority: urgent ? "urgent" : "normal" });
      setPlanId(r.plan_id);
      setTasks((r.plan?.epics ?? []).flatMap((e: any) => e.issues ?? []));
      setStep("plan");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't generate the delta plan"); setStep("intake"); }
    finally { setBusy(false); }
  };
  const seeImpact = async () => {
    if (!planId) return;
    setBusy(true);
    try { setImpact(await api.featurePreview(planId)); setStep("impact"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't compute the impact"); }
    finally { setBusy(false); }
  };
  const dispatch = async () => {
    if (!planId) return;
    setBusy(true);
    try { await api.dispatch(planId, "copilot"); setStep("done"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Dispatch failed"); }
    finally { setBusy(false); }
  };

  const headerSub = { intake: "Describe the feature", gen: "Grounding a delta plan", plan: "Grounded delta plan", impact: "Pre-commit impact", done: "Dispatched" }[step];

  return (
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 95, display: "grid", placeItems: "center", background: "rgba(20,18,16,0.34)", backdropFilter: "blur(2px)", animation: "s0-fade-in var(--t-quick) both", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 680, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--bg-elevated)", borderRadius: "var(--r-xl)", border: "0.5px solid var(--border)", boxShadow: "var(--shadow-3)", overflow: "hidden", animation: "s0-pop-in var(--t-reg) var(--ease-out) both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "14px 16px", borderBottom: "0.5px solid var(--border-subtle)" }}>
          <span style={{ width: 30, height: 30, borderRadius: "var(--r-sm)", background: proj?.accent ?? "var(--ink-fill)", color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11 }}>{String(proj?.code ?? proj?.name ?? "··").slice(0, 2)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.2px" }}>Add a feature · {proj?.name ?? "—"}</div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>live project · delta contract · {headerSub}</div>
          </div>
          {urgent && step !== "intake" && <Badge tone="red"><Icon name="bolt" size={10} />urgent</Badge>}
          <IconButton name="close" title="Close" onClick={close} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 22 }}>
          {step === "intake" && <FeatureIntake brief={brief} setBrief={setBrief} urgent={urgent} setUrgent={setUrgent} />}
          {step === "gen" && <GenLoader urgent={urgent} />}
          {step === "plan" && <FeaturePlan tasks={tasks} />}
          {step === "impact" && impact && <ImpactPreview impact={impact} urgent={urgent} busy={busy} onProceed={dispatch} onAdjust={() => setStep("plan")} onCancel={close} />}
          {step === "done" && <FeatureDone proj={proj} urgent={urgent} onRelay={() => { close(); setView("relays"); }} onInbox={() => { close(); useUI.getState().setBellOpen(true); }} />}
        </div>
        {(step === "intake" || step === "plan") && (
          <div style={{ borderTop: "0.5px solid var(--border-subtle)", padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <Button variant="ghost" size="md" onClick={step === "plan" ? () => setStep("intake") : close}>{step === "plan" ? "Back" : "Cancel"}</Button>
            <div style={{ flex: 1 }} />
            {step === "intake"
              ? <Button variant="primary" size="md" iconRight="arrowRight" disabled={brief.trim().length < 4 || busy} onClick={genPlan}>Generate delta plan</Button>
              : <Button variant="primary" size="md" iconRight="arrowRight" disabled={busy} onClick={seeImpact}>{busy ? "…" : "See impact"}</Button>}
          </div>
        )}
      </div>
    </div>
  );
}
