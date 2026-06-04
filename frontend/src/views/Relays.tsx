/* sprint0 — Relays: the cross-project pool, grouped by PROJECT with a manager STATE-MAP + JIT.
   Ported from the v6 design (Relays.jsx): a project's relays sit under one header with a sibling-relay
   switcher (the initial plan + each feature-add delta); the manager sees a state-map of EVERY relay plus a
   detailed "On your baton" section for the gates they personally hold; a lead sees ONLY the relays they're
   on (JIT). The mock relaysFor/relaysByProject/ownedBatonGate are derived from useApp().relaySummaries +
   the roster (a discipline with no seated dev = an orphan gap). GATE_META reused from RatifyPanel.

   The "On your baton" detailed section is MANAGER-ONLY — that's what kills the duplicate a dev used to see
   (their relay rendered both there and in the project groups). A dev sees each relay once, in its group. */
import { useState, Fragment } from "react";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { ViewChrome } from "../components/ViewChrome";
import { ProjectSwitcher } from "../components/ProjectSwitcher";
import { Avatar, Button, Badge, DiscDot, DISC } from "../components/ui";
import { Icon } from "../lib/icon";
import { GATE_META } from "./RatifyPanel";
import { blocksForGate } from "../features/today/rank";
import type { RelaySummary, Discipline } from "../lib/api";

type Gate = RelaySummary["gates"][number];
const STATE_ORDER: Discipline[] = ["uiux", "backend", "devops", "frontend", "qa"];
const DONE = ["ratified", "auto_passed"];
const initials = (s: string) => (s || "?").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 3).join("").toUpperCase();
const relayBlocks = (r: RelaySummary) => r.gates.reduce((n, g) => n + (DONE.includes(g.status) ? 0 : blocksForGate(g.discipline, r)), 0);
const relayScore = (r: RelaySummary) => (r.baton.length ? 1000 : 0) + relayBlocks(r) * 100;

/* the baton gate THIS viewer owns — an orphan gap (no seated dev) routes to the manager, otherwise the
   viewer's own discipline. */
function ownedBatonGate(r: RelaySummary, disc: Discipline | undefined, isManager: boolean, seated: Set<string>): Gate | null {
  return r.gates.find((g) => r.baton.includes(g.discipline)
    && ((!seated.has(g.discipline) && isManager) || g.discipline === disc)) ?? null;
}
/* the project key (deltas group with their initial plan) + a per-relay display name within the group. */
const projectKey = (r: RelaySummary) => String(r.target_project_id ?? r.project);

function DagLegend() {
  const items = [
    { label: "ratified / auto-passed", node: <Icon name="check" size={13} style={{ color: "var(--green)" }} /> },
    { label: "needs a call", node: <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--amber)", display: "inline-block" }} /> },
    { label: "baton here", node: <Icon name="flag" size={11} style={{ color: "var(--text-primary)" }} /> },
    { label: "locked / pending", node: <span style={{ width: 9, height: 9, borderRadius: "50%", border: "1.5px solid var(--border-strong)", display: "inline-block" }} /> },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14, padding: "8px 12px", borderRadius: "var(--r-md)",
      background: "var(--bg-secondary)", border: "0.5px solid var(--border-subtle)", flexWrap: "wrap" }}>
      <span className="kicker" style={{ fontSize: 10 }}>Legend</span>
      {items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-tertiary)" }}>
          {it.node}{it.label}
        </span>
      ))}
    </div>
  );
}

/* one gate's state dot — discipline mark + status colour, baton flagged in ink, orphan gap marked. */
function GateDot({ g, baton, gap }: { g: Gate; baton: boolean; gap: boolean }) {
  const done = DONE.includes(g.status);
  const dim = g.status === "locked" || g.status === "pending";
  return (
    <span title={`${DISC[g.discipline]?.label} · ${GATE_META[g.status]?.label ?? g.status}${gap ? " · orphan gap" : ""}`}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 8px",
        borderRadius: "var(--r-pill)", border: `0.5px solid ${baton ? "var(--text-primary)" : "var(--border)"}`,
        background: baton ? "var(--bg-active)" : "var(--bg-secondary)", opacity: dim ? 0.55 : 1 }}>
      {baton && <span style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", color: "var(--text-primary)" }}><Icon name="flag" size={10} /></span>}
      <DiscDot d={g.discipline} size={7} />
      {done
        ? <Icon name="check" size={11} style={{ color: g.status === "ratified" ? "var(--green)" : "var(--blue)" }} />
        : g.status === "changes_requested" ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber)" }} />
        : g.status === "blocked" ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--red)" }} />
        : <span style={{ width: 6, height: 6, borderRadius: "50%", border: "1.5px solid var(--border-strong)" }} />}
      {gap && <span title="orphan gap" style={{ fontSize: 9, color: "var(--text-primary)" }}>▲</span>}
    </span>
  );
}

function GateDots({ r, seated }: { r: RelaySummary; seated: Set<string> }) {
  const ordered = STATE_ORDER.map((d) => r.gates.find((g) => g.discipline === d)).filter(Boolean) as Gate[];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {ordered.map((g) => (
        <Fragment key={g.discipline}>
          {(g.discipline === "frontend" || g.discipline === "qa") && <Icon name="chevronRight" size={12} style={{ color: "var(--text-quaternary)" }} />}
          <GateDot g={g} baton={r.baton.includes(g.discipline)} gap={!seated.has(g.discipline)} />
        </Fragment>
      ))}
    </div>
  );
}

/* the selected relay's state-map (dots only — no choice detail) + the JIT open action. */
function RelayStrip({ r, disc, isManager, seated, watchUser, onOpen }:
  { r: RelaySummary; disc: Discipline | undefined; isManager: boolean; seated: Set<string>; watchUser: string | null; onOpen: (r: RelaySummary, g?: Discipline) => void }) {
  const batonDisc = r.baton[0];
  const mine = ownedBatonGate(r, disc, isManager, seated);
  const blocks = relayBlocks(r);
  return (
    <div style={{ padding: "12px 16px 15px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: "var(--text-tertiary)", flex: 1, minWidth: 0 }}>
          {r.all_ratified ? "All gates ratified — ready to dispatch." : batonDisc ? `${DISC[batonDisc]?.label} holds the baton.` : "Waiting on upstream gates."}
        </span>
        {batonDisc
          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 22, padding: "0 9px", flexShrink: 0, borderRadius: "var(--r-pill)",
              background: mine ? "var(--ink-fill)" : "var(--bg-secondary)", color: mine ? "#fff" : "var(--text-secondary)",
              border: mine ? "none" : "0.5px solid var(--border)", fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
              <Icon name="flag" size={10} /> {mine ? "your call" : `baton · ${DISC[batonDisc]?.label}`}
            </span>
          : <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", flexShrink: 0 }}>{blocks === 0 ? "no blocks" : `blocks ${blocks}`}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <GateDots r={r} seated={seated} />
        <div style={{ flex: 1 }} />
        {r.all_ratified
          ? (watchUser
              ? <Button variant="secondary" size="sm" icon="eye" onClick={() => onOpen(r, r.gates[0]?.discipline)}>View relay</Button>
              : <Button variant="primary" size="sm" icon="bolt" onClick={() => onOpen(r)}>Dispatch</Button>)
          : mine
              ? <Button variant="primary" size="sm" icon="ratify" onClick={() => onOpen(r, mine.discipline)}>Open your gate</Button>
              : <Button variant="secondary" size="sm" iconRight="arrowRight" onClick={() => onOpen(r, batonDisc)}>{watchUser ? "Open relay" : isManager ? "Open relay" : "View relay"}</Button>}
      </div>
    </div>
  );
}

/* a sibling-relay chip in the switcher (initial plan + each feature-add delta). */
function RelayTab({ r, name, active, onClick }: { r: RelaySummary; name: string; active: boolean; onClick: () => void }) {
  const [h, setH] = useState(false);
  const baton = r.baton.length > 0;
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 28, padding: "0 11px", borderRadius: "var(--r-pill)",
        fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
        background: active ? "var(--bg-active)" : h ? "var(--bg-hover)" : "var(--bg-secondary)",
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        border: `0.5px solid ${active ? "var(--text-primary)" : "var(--border)"}`, transition: "background var(--t-quick)" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: r.is_delta ? "var(--blue)" : "var(--text-quaternary)" }} />
      {name}
      {baton && <Icon name="flag" size={10} style={{ color: "var(--text-primary)" }} />}
      {r.all_ratified && <Icon name="check" size={11} style={{ color: "var(--green)" }} />}
    </button>
  );
}

/* a project's relays: header ("FinTrack · 3 relays") + sibling switcher + the selected relay's strip. */
function ProjectGroup({ relays, disc, isManager, seated, watchUser, onOpen }:
  { relays: RelaySummary[]; disc: Discipline | undefined; isManager: boolean; seated: Set<string>; watchUser: string | null; onOpen: (r: RelaySummary, g?: Discipline) => void }) {
  const [sel, setSel] = useState(0);
  const r = relays[sel] || relays[0];
  // per-relay names: the initial plan, then Feature / Feature 2 / … for each delta in the project
  let di = 0;
  const names = relays.map((rr) => rr.is_delta ? `Feature${(++di) > 1 ? " " + di : ""}` : "Initial plan");
  return (
    <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-xl)", background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px 11px", borderBottom: "0.5px solid var(--border-subtle)" }}>
        <Icon name="projects" size={15} style={{ color: "var(--text-tertiary)" }} />
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px" }}>{r.project}</span>
        <Badge tone="outline" mono>{initials(r.project)}</Badge>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{relays.length} {relays.length === 1 ? "relay" : "relays"}</span>
      </div>
      {relays.length > 1 && (
        <div style={{ display: "flex", gap: 6, padding: "10px 16px 4px", flexWrap: "wrap" }}>
          {relays.map((rr, i) => <RelayTab key={rr.plan_id} r={rr} name={names[i]} active={i === sel} onClick={() => setSel(i)} />)}
        </div>
      )}
      <RelayStrip r={r} disc={disc} isManager={isManager} seated={seated} watchUser={watchUser} onOpen={onOpen} />
    </div>
  );
}

/* manager-only: a relay they personally hold a gate on (orphan gap or their own) — detailed, act here. */
function MyBatonCard({ r, g, gap, onOpen }: { r: RelaySummary; g: Gate; gap: boolean; onOpen: (r: RelaySummary, d?: Discipline) => void }) {
  const [h, setH] = useState(false);
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 16px", borderRadius: "var(--r-xl)",
        background: "var(--bg-elevated)", border: "0.5px solid var(--text-primary)",
        boxShadow: h ? "var(--shadow-2)" : "var(--shadow-1)", transition: "box-shadow var(--t-quick)" }}>
      <span style={{ width: 34, height: 34, borderRadius: "var(--r-md)", flexShrink: 0, display: "grid", placeItems: "center",
        background: "var(--bg-secondary)", border: gap ? "1px dashed var(--text-primary)" : "0.5px solid var(--border)" }}>
        <DiscDot d={g.discipline} size={10} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{r.project}</span>
          {gap && <Badge tone="outline" mono style={{ height: 16 }}>orphan gap</Badge>}
          {r.is_delta && <Badge tone="neutral" mono><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--blue)", display: "inline-block" }} />delta</Badge>}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
          {gap ? `No ${DISC[g.discipline]?.label} dev — the gate routes to you.` : `${DISC[g.discipline]?.label} gate waits on your call.`}
        </div>
      </div>
      <Button variant="primary" size="sm" icon="ratify" onClick={() => onOpen(r, g.discipline)}>Ratify the gate</Button>
    </div>
  );
}

export function Relays() {
  const { relaySummaries, role, me, setView, projects, members, personFilter, setPersonFilter }: any = useApp();
  const setPlanId = useUI((s) => s.setPlanId);
  const setActiveGate = useUI((s) => s.setActiveGate);
  const projectFilter = useUI((s) => s.projectFilter);
  const selName = (projects as any[]).find((p) => p.project_id === projectFilter)?.name ?? null;
  const all: RelaySummary[] = relaySummaries ?? [];
  // orphan gap = a discipline with no seated dev (derived from the roster — the relay summary has no gap flag)
  const seated = new Set<string>((members ?? []).filter((m: any) => m.discipline).map((m: any) => m.discipline));
  const watched = personFilter ? members.find((m: any) => m.username === personFilter) : null;
  const isManager = role === "manager" && !watched;
  const scopeDisc: Discipline | undefined = watched ? watched.discipline : me?.discipline;
  // JIT scope: a lead/watcher sees only the relays they're ON (their lane has a gate); the manager sees all.
  const onLane = (r: RelaySummary, d?: Discipline) => !!d && (r.gates.some((g) => g.discipline === d) || r.baton.includes(d));
  const base = isManager ? all : all.filter((r) => onLane(r, scopeDisc));
  const scoped = selName ? base.filter((r) => r.project === selName) : base;
  const relays = [...scoped].sort((a, b) => relayScore(b) - relayScore(a));
  const awaiting = relays.filter((r) => r.baton.length > 0).length;
  const firstName = watched ? String(watched.name).split(" ")[0] : "";

  // manager-only "On your baton" — the gates the manager personally holds (orphan gap or their own).
  const myBaton = isManager
    ? relays.map((r) => ({ r, g: ownedBatonGate(r, me?.discipline, true, seated) })).filter((x): x is { r: RelaySummary; g: Gate } => !!x.g)
    : [];

  // group by project (deltas sit with their initial plan); groups ordered by their hottest relay
  const groupMap = new Map<string, RelaySummary[]>();
  relays.forEach((r) => { const k = projectKey(r); const arr = groupMap.get(k) ?? []; arr.push(r); groupMap.set(k, arr); });
  const groups = [...groupMap.values()].sort((a, b) => Math.max(...b.map(relayScore)) - Math.max(...a.map(relayScore)));

  const openRelay = (r: RelaySummary, gate?: Discipline) => {
    setPlanId(r.plan_id);
    if (watched?.discipline) { setActiveGate(watched.discipline); setView("relay"); return; }
    if (gate) setActiveGate(gate);
    setView(role === "manager" ? "relay" : "ratify");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Relays"]}>
        <ProjectSwitcher />
        <PersonSwitcher />
      </ViewChrome>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "26px 28px 56px" }}>
          <div style={{ marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: 0 }}>
              {watched ? `${firstName}'s relays` : isManager ? "Studio state-map" : "Your relays"}
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "5px 0 0", lineHeight: 1.5 }}>
              {isManager
                ? <>Every relay, grouped by project. <b style={{ color: "var(--text-primary)" }}>{awaiting}</b> await a call · {myBaton.length} on your baton.</>
                : watched
                ? <>Read-only via a granted Watch — their relays, grouped by project.</>
                : <>The relays you're on, grouped by project — your gate opens when the baton reaches you.</>}
            </p>
          </div>

          {watched && <PeerReviewBanner m={watched} onClear={() => setPersonFilter(null)} />}

          {/* manager-only: relays they personally hold a gate on — detailed, act here */}
          {isManager && myBaton.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div className="kicker" style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-primary)" }} />On your baton · {myBaton.length}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {myBaton.map(({ r, g }) => <MyBatonCard key={r.plan_id} r={r} g={g} gap={!seated.has(g.discipline)} onOpen={openRelay} />)}
              </div>
            </div>
          )}

          <DagLegend />

          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 18 }}>
            {groups.map((rs) => (
              <ProjectGroup key={projectKey(rs[0])} relays={rs} disc={scopeDisc} isManager={isManager} seated={seated} watchUser={watched ? personFilter : null} onOpen={openRelay} />
            ))}
            {groups.length === 0 && (
              <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-quaternary)", fontSize: 13 }}>
                {watched ? `No active relay ${firstName} is on.` : selName ? "No active relay for this project." : "No active relays you're on."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Person picker beside the project picker — review a WATCHED person's relays. Populated from the people
   who granted you a Watch (the access key); selecting one scopes the board to their relays read-only. */
function PersonSwitcher() {
  const { me, personFilter, setPersonFilter, watchedPeople, members }: any = useApp();
  const byUser = (u: string) => members.find((m: any) => m.username === u);
  const [open, setOpen] = useState(false);
  const sel = personFilter ? byUser(personFilter) : null;
  const any = (watchedPeople ?? []).length > 0;
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => any && setOpen((o) => !o)} title={any ? "Review a watched person's relays" : "No granted Watches yet"}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 28, padding: "0 8px 0 7px", borderRadius: "var(--r-md)", fontSize: 12.5, fontWeight: 500,
          background: sel ? "var(--bg-active)" : "var(--bg-elevated)", border: `0.5px solid ${sel ? "var(--text-primary)" : "var(--border)"}`,
          color: any ? "var(--text-secondary)" : "var(--text-quaternary)", boxShadow: "var(--shadow-1)", cursor: any ? "pointer" : "default", opacity: any ? 1 : 0.7 }}>
        {sel
          ? <><Avatar name={sel.name} size={17} />{String(sel.name).split(" ")[0]}<Badge tone="outline" mono><Icon name="eye" size={9} />watch</Badge></>
          : <><Icon name="eye" size={14} style={{ color: "var(--text-tertiary)" }} />Anyone you watch</>}
        <Icon name="chevronDown" size={13} style={{ color: "var(--text-quaternary)" }} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
          <div style={{ position: "absolute", top: 34, left: 0, width: 264, zIndex: 51, background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-3)", overflow: "hidden" }}>
            <div className="kicker" style={{ padding: "10px 12px 6px" }}>Review via a granted Watch</div>
            <div style={{ padding: 6, paddingTop: 0 }}>
              <PersonRow active={!sel} onClick={() => { setPersonFilter(null); setOpen(false); }} glyph={<Avatar name={me.name} size={22} tone={me.role === "manager" ? "ink" : undefined} />} title="Your own scope" sub="relays you're on" />
              {(watchedPeople ?? []).map((u: string) => { const m = byUser(u); return (
                <PersonRow key={u} active={sel?.username === u} onClick={() => { setPersonFilter(u); setOpen(false); }} glyph={<Avatar name={m?.name} size={22} />} title={m?.name ?? u} sub={m?.discipline ? `${DISC[m.discipline as keyof typeof DISC]?.label} · read-only` : "read-only"} />
              ); })}
            </div>
            <div style={{ padding: "8px 12px", borderTop: "0.5px solid var(--border-subtle)" }}>
              <span style={{ fontSize: 11, color: "var(--text-quaternary)", lineHeight: 1.45 }}>Only people who granted you a Watch appear here.</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PersonRow({ active, onClick, glyph, title, sub }: { active: boolean; onClick: () => void; glyph: any; title: string; sub: string }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "7px 8px", borderRadius: "var(--r-md)", background: active || h ? "var(--bg-hover)" : "transparent", textAlign: "left" }}>
      {glyph}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>{sub}</div>
      </div>
      {active && <Icon name="check" size={15} style={{ color: "var(--text-primary)" }} />}
    </button>
  );
}

/* Context strip when reviewing someone else's board (read-only, via a granted Watch). */
function PeerReviewBanner({ m, onClear }: { m: any; onClear: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 14, padding: "11px 13px", borderRadius: "var(--r-lg)", background: "var(--bg-secondary)", border: "0.5px solid var(--text-primary)" }}>
      <Avatar name={m.name} size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
          Reviewing {String(m.name).split(" ")[0]}'s relays
          <Badge tone="outline" mono><Icon name="eye" size={10} />read-only · Watch</Badge>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 1 }}>Their gates open read-only — you review the call, not make it.</div>
      </div>
      <Button variant="secondary" size="sm" icon="close" onClick={onClear}>Back to yours</Button>
    </div>
  );
}
