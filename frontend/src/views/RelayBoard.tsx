/* sprint0 × Linear — Ratification Relay. Data-driven stages
   {UI/UX ∥ Backend ∥ DevOps} → Frontend → QA. Now carries the routing tier on each
   gate (§10), an inline Trust Dial (§10), a staffing-coverage strip (§7), and the
   deepened failing-API flow (§9). The Decision Card + ratify panel live in RatifyPanel.

   Ported 1:1 from the v4 mockup (Relay.jsx). Mock module constants are replaced by
   the useApp() adapter per the port spec; panel-local helpers (TrustDialMini,
   CoverageStrip, GateCard, FlowConnector, IntegrationStrip) are ported verbatim.
   TierBadge + GATE_META are imported from the sibling RatifyPanel.tsx. */
import { useState, useEffect, Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Availability, Avatar, Badge, DiscDot, DISC, TrustDot, Button } from "../components/ui";
import { Icon } from "../lib/icon";
import { ViewChrome } from "../components/ViewChrome";
import { useApp, AUTONOMY_MODES } from "../app/useApp";
import { useUI } from "../lib/store";
import { api } from "../lib/api";
import { qk } from "../lib/query";
import { RatifyPanel, TierBadge, GATE_META } from "./RatifyPanel";
import { AgreementCard } from "./AgreementCard";

const isDone = (g: any) => g.status === "ratified" || g.status === "auto_passed";

/* Relay stages mirror relay.py's _LANE_STAGE / _STAGE_ORDER: the build wave runs in parallel,
   then integration (frontend), then acceptance (qa). Gates render per stage, only for disciplines
   actually present in this plan — no hardcoded discipline rows, no "not in this plan" fillers. */
const STAGE_OF: Record<string, string> = { uiux: "build", backend: "build", devops: "build", frontend: "integrate", qa: "accept" };
const STAGE_ORDER = ["build", "integrate", "accept"] as const;
const STAGE_CLEAR_LABEL: Record<string, string> = { build: "build wave clears", integrate: "frontend ratified" };

export function RelayBoard() {
  const { gates, autonomy, setAutonomy, me, role, chrome, planId, relaySummaries, personFilter, setView }: any = useApp();
  const activeGate = useUI((s) => s.activeGate);
  const setActiveGate = useUI((s) => s.setActiveGate);
  const gateOf = (d: string) => gates.find((g: any) => g.discipline === d);
  // developer/qa land focused on their own gate; a Today deep-link can target a specific discipline
  const [sel, setSel] = useState<string>(() => {
    if (activeGate && gates.some((g: any) => g.discipline === activeGate)) return activeGate;
    if (me.discipline && gates.some((g: any) => g.discipline === me.discipline)) return me.discipline;
    return gates[0]?.discipline ?? "backend";
  });
  useEffect(() => { if (activeGate) { setSel(activeGate); setActiveGate(null); } }, [activeGate, setActiveGate]);
  const selGate = gateOf(sel) ?? gates[0];
  const autoCount = gates.filter((g: any) => g.tier === "auto_pass").length;
  // feature name + the present stages — both derived from the live plan, nothing hardcoded
  const planName = relaySummaries?.find((r: any) => r.plan_id === planId)?.project ?? "Relay";
  const byStage = STAGE_ORDER
    .map((stage) => ({ stage, gates: gates.filter((g: any) => STAGE_OF[g.discipline] === stage) }))
    .filter((s) => s.gates.length > 0);
  const stageFlow = byStage
    .map((s) => { const names = s.gates.map((g: any) => DISC[g.discipline]?.label ?? g.discipline);
      return s.stage === "build" && names.length > 1 ? `{${names.join(" ∥ ")}}` : names.join(" · "); })
    .join(" → ");
  const rolePhrase = role === "manager" ? "Pass the baton" : role === "qa" ? "Acceptance & integration" : "Ratify your slice";
  // gate-ratified tally + the ready-to-dispatch state (all gates ratified/auto-passed)
  const ratified = gates.filter(isDone).length;
  const allClear = gates.length > 0 && gates.every(isDone);
  const qc = useQueryClient();
  const dispatch = useMutation({
    mutationFn: () => api.dispatch(planId as string, "copilot"),
    onSuccess: (res) => {
      toast.success("Dispatched to GitLab", { description: `${planName} · ${res.issues_created} issues` });
      qc.invalidateQueries({ queryKey: qk.allRelays() });  // the finished relay leaves the board
      qc.invalidateQueries({ queryKey: ["work"] });         // the new tasks land
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Dispatch failed"),
  });

  // §privacy — a lead sees ONLY their own gate (own); a manager sees the full tree (full); a granted
  // Watch reviews the full tree read-only (peer). This is the design's core JIT/own-gate model.
  const watchUser = personFilter && personFilter !== me.username ? personFilter : null;
  const mode: "own" | "full" | "peer" = watchUser ? "peer" : chrome?.seesAllGates ? "full" : "own";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Relay"]}>
        {mode === "own" && <Badge tone="outline" mono><Icon name="lock" size={10} /> your slice only</Badge>}
        {mode === "peer" && <Badge tone="outline" mono><Icon name="eye" size={10} /> reviewing</Badge>}
        <AutonomyControl mode={autonomy} onChange={setAutonomy} editable={role === "manager" && mode === "full"} />
        {planId && <Badge tone="outline" mono>{planId}</Badge>}
      </ViewChrome>

      {mode === "own" ? (
        <OwnContract me={me} gates={gates} setView={setView} />
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "22px 28px 28px" }}>
            <div style={{ maxWidth: 780, minWidth: 520, margin: "0 auto" }}>
              <div style={{ marginBottom: 18, display: "flex", alignItems: "flex-start", gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="kicker" style={{ marginBottom: 6 }}>{rolePhrase}</div>
                  <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: 0 }}>{planName}</h1>
                  <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "6px 0 0", lineHeight: 1.5 }}>
                    <span className="mono" style={{ color: "var(--text-secondary)" }}>{stageFlow}</span> ·
                    expert attention is a budget — <b style={{ color: "var(--text-primary)" }}>{autoCount}</b> gates auto-pass.
                  </p>
                </div>
                <div style={{ flexShrink: 0, textAlign: "right", paddingTop: 2 }}>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-1px" }}>
                    {ratified}<span style={{ color: "var(--text-quaternary)", fontWeight: 400 }}>/{gates.length}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 9.5, color: "var(--text-quaternary)", letterSpacing: "0.06em" }}>GATES RATIFIED</div>
                </div>
              </div>

              {allClear && <DispatchBanner gates={gates} canDispatch={role === "manager"} pending={dispatch.isPending} onDispatch={() => dispatch.mutate()} />}

              <CoverageStrip />

              <InterfaceContracts planId={planId} me={me} />

              {byStage.map((s, i) => (
                <Fragment key={s.stage}>
                  {i > 0 && <FlowConnector label={STAGE_CLEAR_LABEL[byStage[i - 1].stage] ?? "clears"} />}
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(s.gates.length, 3)}, minmax(150px, 1fr))`, gap: 12, justifyContent: "center" }}>
                    {s.gates.map((g: any) => <GateCard key={g.discipline} g={g} active={sel === g.discipline} onClick={() => setSel(g.discipline)} mine={me.discipline === g.discipline} />)}
                  </div>
                </Fragment>
              ))}

              <IntegrationStrip />
            </div>
          </div>

          {selGate && <RatifyPanel g={selGate} />}
        </div>
      )}
    </div>
  );
}

/* §Contracts are private + just-in-time — a lead sees ONLY their own gate, surfaced when the baton reaches
   them (no full tree, no sibling gates, no other people's contracts). Tickets stay open. Three states:
   waiting · open (their gate's RatifyPanel, which folds only THEIR contracts) · cleared. Ported from Relay.jsx. */
function OwnContract({ me, gates, setView }: { me: any; gates: any[]; setView: (v: string) => void }) {
  const myGate = gates.find((g) => g.discipline === me.discipline) ?? gates[0];
  if (!myGate) return <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-tertiary)", fontSize: 13, background: "var(--bg-base)" }}>No gate is assigned to you on this relay.</div>;
  const done = isDone(myGate);
  const open = myGate.baton && !done;
  const state = done ? "done" : open ? "open" : "waiting";
  const disc = DISC[myGate.discipline];
  const ups = (myGate.depends ?? []).filter((d: string) => gates.some((g) => g.discipline === d));
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "22px 28px 40px", background: "var(--bg-base)" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <DiscDot d={myGate.discipline} size={9} />
            <span className="kicker" style={{ marginBottom: 0 }}>Your {disc?.label} gate</span>
            {state === "open" && <Badge tone="ink"><Icon name="flag" size={10} />baton · on you</Badge>}
            {state === "waiting" && <Badge tone="outline" mono><Icon name="lock" size={10} />closed</Badge>}
            {state === "done" && <Badge tone="green"><Icon name="check" size={10} />cleared</Badge>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--text-quaternary)" }}>
            <Icon name="eye" size={12} />
            <span>You see only your slice — sibling gates and the full tree stay private. Your gate surfaces just-in-time, when the baton reaches you.</span>
          </div>
        </div>
        {state === "open" && <RatifyPanel g={myGate} layout="page" />}
        {state === "waiting" && <OwnWaiting ups={ups} disc={disc} setView={setView} />}
        {state === "done" && <OwnCleared myGate={myGate} disc={disc} setView={setView} />}
      </div>
    </div>
  );
}

function OwnWaiting({ ups, disc, setView }: { ups: string[]; disc: any; setView: (v: string) => void }) {
  const locked = ups.length > 0;
  return (
    <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-xl)", background: "var(--bg-elevated)",
      boxShadow: "var(--shadow-1)", overflow: "hidden", animation: "s0-pop-in var(--t-reg) var(--ease-out) both" }}>
      <div style={{ padding: "34px 28px 30px", textAlign: "center", borderBottom: "0.5px solid var(--border-subtle)" }}>
        <span style={{ width: 48, height: 48, borderRadius: "var(--r-lg)", margin: "0 auto 16px", display: "grid", placeItems: "center",
          background: "var(--bg-secondary)", border: "0.5px solid var(--border)" }}>
          <Icon name={locked ? "lock" : "relay"} size={22} style={{ color: "var(--text-tertiary)" }} />
        </span>
        <div className="kicker" style={{ marginBottom: 8 }}>Waiting for the baton</div>
        <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 8px" }}>Your {disc?.label} gate is closed</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "0 auto", maxWidth: 440, lineHeight: 1.55 }}>
          {locked
            ? <>sprint0 routes the baton to you the moment <b style={{ color: "var(--text-secondary)" }}>{ups.map((d) => DISC[d]?.label).join(" & ")}</b> ratifies. It'll surface here with the feature, a short brief, and your options — nothing before then.</>
            : <>sprint0 will hand you the baton when this slice is up. Your gate surfaces here just-in-time — the feature, a short brief, and your options.</>}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px" }}>
        <Icon name="board" size={15} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.45 }}>
          Your tickets stay open the whole time — only the <b style={{ color: "var(--text-secondary)" }}>gate</b> waits for the baton.
        </span>
        <Button variant="secondary" size="sm" iconRight="arrowRight" onClick={() => setView("mywork")}>Open your tickets</Button>
      </div>
    </div>
  );
}

function OwnCleared({ myGate, disc, setView }: { myGate: any; disc: any; setView: (v: string) => void }) {
  const auto = myGate.status === "auto_passed";
  return (
    <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-xl)", background: "var(--bg-elevated)",
      boxShadow: "var(--shadow-1)", overflow: "hidden", animation: "s0-pop-in var(--t-reg) var(--ease-out) both" }}>
      <div style={{ padding: "34px 28px 30px", textAlign: "center", borderBottom: "0.5px solid var(--border-subtle)" }}>
        <span style={{ width: 48, height: 48, borderRadius: "var(--r-lg)", margin: "0 auto 16px", display: "grid", placeItems: "center",
          background: "var(--bg-secondary)", border: "0.5px solid var(--border)" }}>
          <Icon name="ratify" size={22} style={{ color: auto ? "var(--blue)" : "var(--green)" }} />
        </span>
        <div className="kicker" style={{ marginBottom: 8 }}>{auto ? "Auto-passed" : "Ratified"}</div>
        <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 8px" }}>Your {disc?.label} slice is cleared</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "0 auto", maxWidth: 440, lineHeight: 1.55 }}>
          {auto
            ? <>Autonomy cleared this — high confidence, low blast. The baton moved on; nothing else on this gate is yours to see.</>
            : <>You made the call and passed the baton. The rest of the tree stays with its owners — your slice is done.</>}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px" }}>
        <Icon name="board" size={15} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.45 }}>Your tickets stay open for the work itself.</span>
        <Button variant="secondary" size="sm" iconRight="arrowRight" onClick={() => setView("mywork")}>Open your tickets</Button>
      </div>
    </div>
  );
}

/* §CDD — the plan's interface contracts (the Agreement engine): each is the API two disciplines build
   to. A `proposed` one shows ratify (if you're a lead); a `compounded`/`ratified` one is read-only —
   this is where the auto-passed (compounded-from-a-past-project) contracts become visible. */
function InterfaceContracts({ planId, me }: { planId: string | null; me: any }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["planAgreements", planId], queryFn: () => api.planAgreements(planId as string), enabled: !!planId });
  const ags = (data?.agreements ?? []).filter((a: any) => a.type === "interface");
  const ratify = useMutation({
    mutationFn: ({ id, d }: { id: string; d: "ratified" | "rejected" }) => api.ratifyAgreement(id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["planAgreements", planId] }); qc.invalidateQueries({ queryKey: ["myAgreements"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  if (!ags.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="kicker" style={{ marginBottom: 8 }}>Interface contracts · CDD</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ags.map((a: any) => {
          const canSign = a.state === "proposed" && (a.ratifiers ?? []).includes(me.username);
          return <AgreementCard key={a.id} a={a} busy={ratify.isPending}
            onRatify={canSign ? () => ratify.mutate({ id: a.id, d: "ratified" }) : undefined}
            onReject={canSign ? () => ratify.mutate({ id: a.id, d: "rejected" }) : undefined} />;
        })}
      </div>
    </div>
  );
}

/* All gates cleared → the manager can scaffold the project. Dispatch pops the relay off the board
   (the useApp planId guard handles the now-stale pin) and the new tasks land in the work store. */
function DispatchBanner({ gates, canDispatch, onDispatch, pending }: { gates: any[]; canDispatch: boolean; onDispatch: () => void; pending?: boolean }) {
  const autoCount = gates.filter((g) => g.status === "auto_passed").length;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 16px", marginBottom: 18,
      borderRadius: "var(--r-lg)", border: "0.5px solid var(--text-primary)", background: "var(--bg-secondary)", boxShadow: "var(--shadow-1)" }}>
      <span style={{ width: 34, height: 34, borderRadius: "var(--r-md)", flexShrink: 0, display: "grid", placeItems: "center",
        background: "var(--ink-fill)", color: "#fff" }}>
        <Icon name="ratify" size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.2px" }}>Ready to dispatch</span>
          <Badge tone="green"><Icon name="check" size={10} />{gates.length}/{gates.length} cleared</Badge>
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4, lineHeight: 1.5 }}>
          {autoCount > 0 ? `${autoCount} auto-passed · ` : ""}every slice ratified — sprint0 can scaffold the merge train to GitLab.
        </div>
      </div>
      {canDispatch
        ? <Button variant="primary" size="md" icon="bolt" disabled={pending} onClick={onDispatch}>{pending ? "Dispatching…" : "Dispatch"}</Button>
        : <span style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 32, padding: "0 10px", fontSize: 12, color: "var(--text-quaternary)" }}>
            <Icon name="lock" size={13} />Manager dispatches</span>}
    </div>
  );
}

/* §10 Autonomy — a discrete named posture (manager-only); read-only for leads. Replaces the old 0–100
   "Trust Dial" — the 3 modes map to the backend dial (~30/60/85). Frees "trust" to mean only the passport. */
function AutonomyControl({ mode, onChange, editable }: { mode: string; onChange: (m: string) => void; editable: boolean }) {
  return (
    <div title="Autonomy — how aggressively sprint0 auto-ratifies low-risk gates"
      style={{ display: "flex", alignItems: "center", gap: 8, height: 28 }}>
      <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Autonomy</span>
      <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: "var(--r-md)", background: "var(--bg-secondary)", border: "0.5px solid var(--border)" }}>
        {AUTONOMY_MODES.map((m) => {
          const active = m.id === mode;
          return (
            <button key={m.id} title={editable ? m.hint : `${m.hint} · manager sets this`} disabled={!editable}
              onClick={() => editable && onChange(m.id)}
              style={{ height: 22, padding: "0 9px", borderRadius: "var(--r-sm)", fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap",
                background: active ? "var(--bg-elevated)" : "transparent", color: active ? "var(--text-primary)" : "var(--text-quaternary)",
                boxShadow: active ? "var(--shadow-1)" : "none", cursor: editable ? "pointer" : "default", transition: "color var(--t-quick)" }}>
              {m.label}
            </button>
          );
        })}
      </div>
      {!editable && <Icon name="lock" size={12} style={{ color: "var(--text-quaternary)" }} />}
    </div>
  );
}

/* §7 staffing coverage strip — real GET /api/plans/{id}/staffing (useApp().staffing). Shows the first
   uncovered discipline + the AI's scored stretch candidates; load/trust come from the live roster. */
function CoverageStrip() {
  const { chrome, setView, members, staffing }: any = useApp();
  const byUser = (u: string) => members?.find((m: any) => m.username === u);
  const coverage: any[] = staffing?.coverage ?? [];
  const gapRow = coverage.find((c) => !c.covered);
  if (!gapRow) return null;
  const gap = gapRow.discipline;
  const candidates: any[] = gapRow.recommendation?.stretch_candidates ?? [];
  return (
    <div style={{ border: "0.5px solid var(--text-primary)", borderRadius: "var(--r-lg)", padding: 14, marginBottom: 18,
      background: "var(--bg-secondary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon name="team" size={15} style={{ color: "var(--text-primary)" }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Coverage gap</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
          <DiscDot d={gap} />{DISC[gap]?.label} has no dev
        </span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>routes to manager</span>
      </div>
      {candidates.length > 0 && <>
        <div className="kicker" style={{ marginBottom: 8 }}>Scored stretch candidates</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {candidates.map((c) => {
            const m = byUser(c.username);
            const why = c.pros?.[0] ?? "";
            return (
              <div key={c.username} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: "var(--r-md)",
                background: "var(--bg-elevated)", border: "0.5px solid var(--border)" }}>
                <Avatar name={c.name ?? m?.name} size={22} tone={m?.role === "manager" ? "ink" : undefined} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{c.name ?? m?.name} <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>· match {typeof c.score === "number" ? c.score.toFixed(2) : c.score}</span></div>
                  <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{why}</div>
                </div>
                {m && <Availability a={m.availability} compact />}
                {m && <TrustDot level={m.trust} />}
              </div>
            );
          })}
        </div>
      </>}
      {chrome.canOnboard && (
        <Button variant="secondary" size="sm" icon="plus" style={{ marginTop: 10 }} onClick={() => setView("team")}>Onboard a {DISC[gap]?.label} dev</Button>
      )}
    </div>
  );
}

function GateCard({ g, active, onClick, mine }: {
  g: any; active: boolean; onClick: () => void; mine: boolean;
}) {
  const [h, setH] = useState(false);
  if (!g) return null;
  const meta = GATE_META[g.status];
  const done = g.status === "ratified" || g.status === "auto_passed";
  const spark = g.baton || g.tier === "two_expert";
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ position: "relative", textAlign: "left", background: "var(--bg-elevated)", width: "100%",
        border: `0.5px solid ${active ? "var(--text-primary)" : spark ? "var(--text-primary)" : "var(--border)"}`,
        borderRadius: "var(--r-lg)", padding: 14,
        boxShadow: active ? "var(--shadow-2)" : h ? "var(--shadow-2)" : "var(--shadow-1)",
        transition: "box-shadow var(--t-quick), border-color var(--t-quick), transform var(--t-quick)",
        transform: h && !active ? "translateY(-1px)" : "none" }}>
      {g.baton && (
        <span style={{ position: "absolute", top: -9, right: 12, display: "inline-flex", alignItems: "center", gap: 4,
          height: 18, padding: "0 7px", borderRadius: "var(--r-pill)", background: "var(--text-primary)", color: "#fff",
          fontSize: 10.5, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
          <Icon name="flag" size={11} /> BATON
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <DiscDot d={g.discipline} size={10} />
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.2px" }}>{DISC[g.discipline].label}</span>
        {mine && <Badge tone="ink" style={{ height: 15 }}>you</Badge>}
        {g.stretched && <span title="stretched assignment — staffing gap" style={{ color: "var(--text-primary)", fontSize: 12 }}>▲</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, marginBottom: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 20, padding: "0 8px",
          borderRadius: "var(--r-sm)", fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap",
          background: meta.tone === "neutral" || meta.tone === "outline" ? "var(--bg-secondary)" : `color-mix(in srgb, ${meta.fg} 12%, transparent)`,
          color: meta.fg }}>
          {done && <Icon name="ratify" size={12} />}{meta.label}
        </span>
        <TierBadge tier={g.tier} size="sm" />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.45, marginBottom: 8 }}>{g.note}</div>
      {(g.blast_radius != null || g.expected_cost != null) && (
        <div className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>
          blast {g.blast_radius ?? "—"} · cost {g.expected_cost ?? "—"} · {g.routed_note}
        </div>
      )}
      {g.depends.length > 0 && (
        <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", marginTop: 6 }}>
          waits on {g.depends.map((d: string) => DISC[d].label).join(" · ")}
        </div>
      )}
    </button>
  );
}

function FlowConnector({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0", gap: 4 }}>
      <span style={{ width: 1, height: 16, background: "var(--border-strong)" }} />
      <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)", letterSpacing: "0.04em" }}>{label}</span>
      <Icon name="chevronDown" size={14} style={{ color: "var(--text-quaternary)", marginTop: -2 }} />
    </div>
  );
}

/* §9 failing-API gate — real relay integration_signals (useApp().integration), read-only. A failing
   producer contract holds the QA gate. The report/resolve interaction (wired to POST …/integration/flag)
   is a Claude-Design item — see docs/UI-NEEDS.md — so the board never shows a fabricated signal. */
function IntegrationStrip() {
  const { integration }: any = useApp();
  const sig: any[] = (integration ?? []).filter((s: any) => s.state === "failing");
  return (
    <div style={{ marginTop: 28, border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--bg-secondary)",
        borderBottom: "0.5px solid var(--border-subtle)" }}>
        <Icon name="bolt" size={14} style={{ color: "var(--text-primary)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>API integration</span>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>— a failing API holds the QA gate until the producer fixes it.</span>
      </div>

      {sig.length === 0 ? (
        <div style={{ padding: "14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} />
          <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>All contracts green.</span>
        </div>
      ) : sig.map((s, i) => (
        <div key={s.target_issue_id + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
          <Badge tone="red">failing</Badge>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}><span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", fontWeight: 400 }}>{s.target_issue_id}</span></div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>reported by @{s.by} · {s.note} · qa gate <b style={{ color: "var(--text-primary)" }}>blocked</b></div>
          </div>
          <Badge tone="outline" mono>acceptance held</Badge>
        </div>
      ))}
    </div>
  );
}
