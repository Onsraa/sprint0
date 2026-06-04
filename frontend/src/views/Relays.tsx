/* sprint0 — Relays: the cross-project pool board (§35). Wires GET /api/relays (the `relays` route).
   One ranked row per active relay — project · a DAG mini (which gates ratified / active / blocked) ·
   where the baton sits · is_delta · all_ratified. Ranked by baton + blocks aggregated per relay, so
   the hottest front floats to the top. Ported 1:1 from the v6 design (Relays.jsx); the mock relaysFor()
   is replaced by useApp().relaySummaries, GATE_META is reused from RatifyPanel, and live dispatch is
   deferred — a ready relay's button deep-links into the relay board. */
import { useState } from "react";
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
const BUILD = ["uiux", "backend", "devops"] as const;
const DONE = ["ratified", "auto_passed"];
const initials = (s: string) => (s || "?").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 3).join("").toUpperCase();
const relayBlocks = (r: RelaySummary) => r.gates.reduce((n, g) => n + (DONE.includes(g.status) ? 0 : blocksForGate(g.discipline, r)), 0);
const relayScore = (r: RelaySummary) => (r.baton.length ? 1000 : 0) + relayBlocks(r) * 100;
const noteFor = (r: RelaySummary) =>
  r.all_ratified ? "All gates ratified — ready to dispatch."
    : r.baton.length ? `${r.baton.map((d) => DISC[d]?.label ?? d).join(" · ")} ${r.baton.length === 1 ? "holds" : "hold"} the baton.`
    : "Waiting on upstream gates.";

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

/* one gate in the DAG mini — discipline dot + status glyph, baton flagged in ink */
function GateNode({ g, baton }: { g?: Gate; baton: boolean }) {
  if (!g) return null;
  const done = DONE.includes(g.status);
  const dim = g.status === "locked" || g.status === "pending";
  return (
    <span title={`${DISC[g.discipline]?.label} · ${GATE_META[g.status]?.label ?? g.status}`}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 9px",
        borderRadius: "var(--r-pill)", border: `0.5px solid ${baton ? "var(--text-primary)" : "var(--border)"}`,
        background: baton ? "var(--bg-active)" : "var(--bg-elevated)", opacity: dim ? 0.55 : 1 }}>
      {baton && <span style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", color: "var(--text-primary)" }}><Icon name="flag" size={11} /></span>}
      <DiscDot d={g.discipline} size={8} />
      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)" }}>{DISC[g.discipline]?.label}</span>
      {done
        ? <Icon name="check" size={12} style={{ color: g.status === "ratified" ? "var(--green)" : "var(--blue)" }} />
        : g.status === "changes_requested" ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--amber)" }} />
        : g.status === "blocked" ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--red)" }} />
        : <span style={{ width: 7, height: 7, borderRadius: "50%", border: "1.5px solid var(--border-strong)" }} />}
    </span>
  );
}

function FlowArrow() {
  return <Icon name="chevronRight" size={14} style={{ color: "var(--text-quaternary)", flexShrink: 0 }} />;
}

function RelayRow({ r, rank, onOpen }: { r: RelaySummary; rank: number; onOpen: (r: RelaySummary, g?: Discipline) => void }) {
  const [h, setH] = useState(false);
  const batonDisc = r.baton[0];
  const gateOf = (d: string) => r.gates.find((g) => g.discipline === d);
  const blocks = relayBlocks(r);
  const fe = gateOf("frontend"); const qa = gateOf("qa");
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ borderRadius: "var(--r-xl)", background: "var(--bg-elevated)",
        border: `0.5px solid ${batonDisc ? "var(--text-primary)" : "var(--border)"}`,
        boxShadow: h ? "var(--shadow-2)" : "var(--shadow-1)", transition: "box-shadow var(--t-quick)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 16px 13px" }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", width: 16, textAlign: "center", flexShrink: 0 }}>{rank}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px" }}>{r.project}</span>
            <Badge tone="outline" mono>{initials(r.project)}</Badge>
            {r.is_delta && <Badge tone="neutral" mono><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--blue)", display: "inline-block" }} />delta</Badge>}
            {r.all_ratified && <Badge tone="green"><Icon name="check" size={10} />all ratified</Badge>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 3 }}>{noteFor(r)}</div>
        </div>
        {batonDisc ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: "var(--r-pill)",
            background: "var(--ink-fill)", color: "#fff", fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
            <Icon name="flag" size={11} /> baton · {DISC[batonDisc]?.label}
          </span>
        ) : (
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{blocks === 0 ? "no blocks" : `blocks ${blocks}`}</span>
        )}
      </div>

      {/* DAG mini */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 16px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {BUILD.map((d) => { const g = gateOf(d); return g ? <GateNode key={d} g={g} baton={r.baton.includes(d)} /> : null; })}
        </div>
        {fe && <><FlowArrow /><GateNode g={fe} baton={r.baton.includes("frontend")} /></>}
        {qa && <><FlowArrow /><GateNode g={qa} baton={r.baton.includes("qa")} /></>}
        <div style={{ flex: 1 }} />
        {r.all_ratified
          ? <Button variant="primary" size="sm" icon="bolt" onClick={() => onOpen(r)}>Dispatch</Button>
          : <Button variant="secondary" size="sm" iconRight="arrowRight" onClick={() => onOpen(r, batonDisc)}>Open relay</Button>}
      </div>
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
  // a granted Watch lets you review a teammate's relays — scope to their lane (the backend has no per-gate
  // assignee; one dev per discipline in the demo makes the lane filter exact). Else your own role filter.
  const watched = personFilter ? members.find((m: any) => m.username === personFilter) : null;
  const onLane = (r: RelaySummary, d?: Discipline) => !!d && (r.gates.some((g) => g.discipline === d) || r.baton.includes(d));
  const base = watched
    ? all.filter((r) => onLane(r, watched.discipline))
    : role === "manager" ? all : all.filter((r) => onLane(r, me?.discipline));
  const mine = selName ? base.filter((r) => r.project === selName) : base;
  const relays = [...mine].sort((a, b) => relayScore(b) - relayScore(a));
  const awaiting = relays.filter((r) => r.baton.length > 0).length;
  const firstName = watched ? String(watched.name).split(" ")[0] : "";

  // "On your baton" — relays where a gate personally waits on you (manager-as-dev or dev), shown detailed.
  const myDisc: Discipline | undefined = me?.discipline;
  const onBaton = myDisc ? relays.filter((r) => r.baton.includes(myDisc)) : [];
  // The state-map: group relays under their project (a project's deltas sit with its initial plan),
  // groups ordered by their hottest relay. JIT — the upstream filter already scopes a dev to their relays.
  const groupMap = new Map<string, RelaySummary[]>();
  relays.forEach((r) => { const arr = groupMap.get(r.project) ?? []; arr.push(r); groupMap.set(r.project, arr); });
  const groups = [...groupMap.entries()].sort((a, b) => Math.max(...b[1].map(relayScore)) - Math.max(...a[1].map(relayScore)));

  // Peer-review: when scoped to a watched person, open the board on THEIR gate read-only (the granted Watch
  // un-gates that Contract). Otherwise managers open the full RelayBoard; devs land on their ratify queue.
  const openRelay = (r: RelaySummary, gate?: Discipline) => {
    setPlanId(r.plan_id);
    if (watched?.discipline) {
      setActiveGate(watched.discipline);
      setView("relay");
      return;
    }
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
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "26px 28px 56px" }}>
          <div style={{ marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: 0 }}>
              {watched ? `${firstName}'s relays, ranked` : role === "manager" ? "Every relay, ranked" : "Your relays, ranked"}
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "5px 0 0", lineHeight: 1.5 }}>
              Hottest front first — <b style={{ color: "var(--text-primary)" }}>{awaiting}</b> await a call.
            </p>
          </div>

          {watched && <PeerReviewBanner m={watched} onClear={() => setPersonFilter(null)} />}

          <DagLegend />

          {relays.length === 0 && (
            <div style={{ padding: 28, textAlign: "center", color: "var(--text-quaternary)", fontSize: 13, marginTop: 18 }}>
              {watched ? `No active relay ${firstName} is on.` : "No active relays."}
            </div>
          )}

          {/* On your baton — the gates that personally wait on you, detailed */}
          {onBaton.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div className="kicker" style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-primary)" }} />On your baton · {onBaton.length}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {onBaton.map((r, i) => <RelayRow key={"b-" + r.plan_id} r={r} rank={i + 1} onOpen={openRelay} />)}
              </div>
            </div>
          )}

          {/* By project — the state-map: a project's relays (initial plan + each feature-add) grouped together */}
          {groups.map(([proj, rs]) => (
            <div key={proj} style={{ marginTop: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{proj}</span>
                <Badge tone="outline" mono>{initials(proj)}</Badge>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{rs.length} relay{rs.length === 1 ? "" : "s"}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rs.map((r, i) => <RelayRow key={r.plan_id} r={r} rank={i + 1} onOpen={openRelay} />)}
              </div>
            </div>
          ))}
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
