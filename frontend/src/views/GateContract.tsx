/* sprint0 — Gate × Contract (one page). A discipline gate and the interface Contract(s) its slice
   produces / consumes, side by side: the slice PICK (the server-supplied solutions + write-your-own —
   the RatifyPanel) next to the API blueprints the lane is party to. A bell notification ("Ratify your
   slice" / "Sign the Contract") deep-links straight here, to the right lane (navPayload.disc / .agr).
   Manager sees every lane; a lead lands on their own.

   Ported from the v6 Claude Design GateContract.jsx, wired to the REAL backend: gates ← useApp (the
   active relay) · Contracts ← useApp().agreements (GET /api/plans/{id}/agreements), filtered to the lane
   by producer/consumer discipline (the mock's `a.lanes` collapses onto our two-discipline shape). */
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../app/useApp";
import { Badge, DiscDot, discLabel } from "../components/ui";
import { Icon } from "../lib/icon";
import { ViewChrome, type Crumb } from "../components/ViewChrome";
import { RatifyPanel, GATE_META } from "./RatifyPanel";
import { AgreementCard } from "./AgreementCard";

const lanesOf = (a: any): string[] => [a.producer_discipline, a.consumer_discipline].filter(Boolean);

export function GateContract() {
  const { gates, navPayload, agreements, me, chrome, personFilter, members, planId, relaySummaries, goTo, ratifyPending }: any = useApp();
  // the disciplines that actually have a gate in this relay, in relay order
  const present = useMemo(() => (gates as any[]).map((g) => g.discipline), [gates]);
  // Scope the lanes to the viewer: the manager sees every lane (oversight); a dev/lead sees only the gate(s)
  // they own (their discipline, or a gate handed to them). Reviewing a watched person shows THEIR lanes.
  const watched = personFilter ? members.find((m: any) => m.username === personFilter) : null;
  const viewerDisc: string | undefined = watched ? watched.discipline : me.discipline;
  const viewerUser: string | undefined = watched ? watched.username : me.username;
  const seesAll = !watched && chrome.seesAllGates;
  const owns = (d: string) => { const g = (gates as any[]).find((x) => x.discipline === d); const ratifier = g?.delegate ?? g?.owner; return ratifier ? ratifier === viewerUser : d === viewerDisc; };
  const lanes = useMemo(() => (seesAll ? present : present.filter(owns)), [present, seesAll, gates, viewerDisc, viewerUser]);
  const pick = (d?: string | null) => (d && lanes.includes(d) ? d : null);
  // a Contract redirect may carry only { agr } — derive its lane from the agreement's two disciplines
  const agrDisc = useMemo(() => {
    if (navPayload?.disc || !navPayload?.agr) return null;
    const a = (agreements as any[]).find((x) => x.id === navPayload.agr);
    return a ? lanesOf(a).find((d) => lanes.includes(d)) ?? null : null;
  }, [navPayload, agreements, lanes]);

  const initial = pick(navPayload?.disc) || pick(agrDisc) || pick(viewerDisc) || lanes[0];
  const [disc, setDisc] = useState<string | undefined>(initial);
  useEffect(() => { const d = pick(navPayload?.disc) || pick(agrDisc); if (d) setDisc(d); }, [navPayload, agrDisc]); // honor a fresh deep-link
  // gates load async — `initial` was undefined while the relay query was in flight; once the viewer's lanes resolve, lock onto one.
  useEffect(() => { if ((!disc || !lanes.includes(disc)) && lanes.length) setDisc(lanes[0]); }, [lanes, disc]);

  const gate = (gates as any[]).find((g) => g.discipline === disc);
  // live only — a regenerate (a changed gate choice) supersedes the old contract; never show both (no dup)
  const contracts = (agreements as any[]).filter((a) => lanesOf(a).includes(disc as string) && a.state !== "superseded" && a.state !== "rejected");
  const pending = contracts.filter((a) => a.state === "proposed").length;
  const ratifiedN = (gates as any[]).filter((g) => g.status === "ratified" || g.status === "auto_passed").length;
  const title = relaySummaries.find((r: any) => r.plan_id === planId)?.project ?? "This relay";
  // breadcrumb: Studio > Relays(click→back) > Project > Feature (project/feature deep-linked from Relays)
  const crumbs: Crumb[] = ["Studio", { label: "Relays", onClick: () => goTo("relays") },
    navPayload?.project ?? title, navPayload?.feature ?? "Gate × Contract"];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={crumbs}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{ratifiedN}/{gates.length} gates ratified</span>
        <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />
        {planId && <Badge tone="outline" mono>{planId}</Badge>}
      </ViewChrome>

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "22px 28px 48px" }}>
          {/* feature frame + lane switcher */}
          <div style={{ marginBottom: 20 }}>
            <span className="kicker">Gate × Contract</span>
            <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px", margin: "6px 0 0" }}>{navPayload?.feature ?? title}</h1>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: "6px 0 0", lineHeight: 1.5, maxWidth: 640, textWrap: "pretty" }}>
              The slice you pick and the API blueprints it produces or consumes — together, on one page.
            </p>
            {/* lane switcher — only when there's a real choice (the manager / multiple owned lanes); a single
                owned lane is already labelled by the gate header, so the lone tab is just noise. */}
            {lanes.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                {lanes.map((d: string) => <LaneTab key={d} d={d} gate={(gates as any[]).find((g) => g.discipline === d)} active={d === disc} onClick={() => setDisc(d)} />)}
              </div>
            )}
          </div>

          {/* the two halves, side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(330px, 400px)", gap: 22, alignItems: "start" }}>
            {/* the gate — slice pick */}
            <div style={{ minWidth: 0 }}>
              <SideLabel icon="ratify" title="The gate" hint="reuse or innovate — pick the slice" />
              {gate ? <RatifyPanel key={disc} g={gate} layout="page" /> : <Empty text={lanes.length ? "No gate for this lane." : "No gate here is yours to ratify."} />}
            </div>

            {/* the lane's Contracts */}
            <div style={{ minWidth: 0, position: "sticky", top: 0 }}>
              <SideLabel icon="relay" title="Its Contracts"
                hint={contracts.length ? `${contracts.length} this slice produces / consumes` : "none on this slice"}
                badge={pending > 0 ? `${pending} to sign` : null} />
              {ratifyPending && (
                <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", marginBottom: 12,
                  border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", background: "var(--bg-secondary)", animation: "s0-fade-in var(--t-reg) both" }}>
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    {[0, 1, 2].map((i) => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-primary)", animation: `s0-dot-pulse 1.1s ${i * 0.16}s infinite` }} />)}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Gemini is drafting this slice's contracts…</span>
                </div>
              )}
              {contracts.length
                ? <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {contracts.map((a) => <AgreementCard key={a.id} a={a} me={me} compact />)}
                  </div>
                : !ratifyPending && <EmptyContracts disc={disc as string} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* a discipline tab — DiscDot · label · the gate's status as a colored dot */
function LaneTab({ d, gate, active, onClick }: { d: string; gate?: any; active: boolean; onClick: () => void }) {
  const [h, setH] = useState(false);
  const meta = gate ? GATE_META[gate.status] : null;
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 34, padding: "0 13px", borderRadius: "var(--r-pill)",
        background: active ? "var(--bg-secondary)" : h ? "var(--bg-hover)" : "var(--bg-elevated)",
        border: `0.5px solid ${active ? "var(--text-primary)" : "var(--border)"}`,
        boxShadow: active ? "0 0 0 1px var(--text-primary)" : "var(--shadow-1)", transition: "border-color var(--t-quick), background var(--t-quick)" }}>
      <DiscDot d={d} size={9} />
      <span style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? "var(--text-primary)" : "var(--text-secondary)" }}>{discLabel(d)}</span>
      {gate?.baton && <Icon name="flag" size={11} style={{ color: "var(--text-primary)" }} />}
      {meta && <span title={meta.label} style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: meta.fg }} />}
    </button>);
}

/* a small labelled header above each half */
function SideLabel({ icon, title, hint, badge }: { icon: any; title: string; hint: string; badge?: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <Icon name={icon} size={14} style={{ color: "var(--text-tertiary)" }} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      <span style={{ fontSize: 12, color: "var(--text-quaternary)" }}>· {hint}</span>
      {badge && <Badge tone="ink" mono>{badge}</Badge>}
    </div>);
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ border: "0.5px dashed var(--border-strong)", borderRadius: "var(--r-lg)", padding: "26px 18px", textAlign: "center", background: "var(--bg-elevated)", fontSize: 12.5, color: "var(--text-tertiary)" }}>{text}</div>);
}

function EmptyContracts({ disc }: { disc: string }) {
  return (
    <div style={{ border: "0.5px dashed var(--border-strong)", borderRadius: "var(--r-lg)", padding: "26px 18px", textAlign: "center", background: "var(--bg-elevated)" }}>
      <Icon name="relay" size={20} style={{ color: "var(--border-strong)" }} />
      <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginTop: 9, lineHeight: 1.5, textWrap: "pretty" }}>
        No contract here yet. A contract is <b style={{ color: "var(--text-secondary)" }}>drafted from your gate choice</b> — ratify the <b style={{ color: "var(--text-secondary)" }}>{discLabel(disc)}</b> gate to generate the API the consumer builds against. If this slice produces no API for another discipline, none is needed.
      </div>
    </div>);
}
