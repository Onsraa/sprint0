/* sprint0 — Relays: a per-project accordion. Each project row shows the viewer's counts; clicking it
   expands the relays it holds, grouped open → pending → in-progress:
   - OPEN (green, clickable) — your turn now → opens Gate × Contract for that lane.
   - PENDING (orange, inert) — you hold a not-done gate but the baton is upstream; nothing to do yet.
   - IN PROGRESS (manager only, read-only) — a relay not attributed to the manager (every lane staffed);
     visible so the manager sees what's moving, but not theirs to open.
   A developer sees only the relays they hold (open/pending); the manager sees every relay. The orphan-gap
   logic (a discipline with no seated dev routes its gate to the manager) is derived from the roster. */
import { useMemo, useState, Fragment } from "react";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { ViewChrome } from "../components/ViewChrome";
import { ProjectSwitcher } from "../components/ProjectSwitcher";
import { Avatar, Button, Badge, DiscDot, DISC } from "../components/ui";
import { Icon } from "../lib/icon";
import { GATE_META } from "./RatifyPanel";
import type { RelaySummary, Discipline } from "../lib/api";

type Gate = RelaySummary["gates"][number];
const STATE_ORDER = ["setup", "uiux", "backend", "devops", "frontend", "qa"] as Discipline[];  // setup gate-0 first
const DONE = ["ratified", "auto_passed"];
const projectKey = (r: RelaySummary) => String(r.target_project_id ?? r.project);

type RelayStatus = "open" | "pending" | "shipping" | "inprogress";
type RelayClass = { status: RelayStatus; disc?: Discipline; action: "gate" | "dispatch" | "none" };

/* Classify a relay for the viewer. dev/qa: their lane's gate decides open (their turn) vs pending
   (waiting) vs shipping (your gate's ratified but the relay's still in flight) vs excluded (not on this
   relay). manager: a ready relay is open-to-dispatch; an orphan gate (no seated dev) is the manager's to
   ratify (open if on baton, else pending); otherwise the relay is fully staffed → "in progress". */
function classify(r: RelaySummary, scopeDisc: Discipline | undefined, isManager: boolean, seated: Set<string>, meUser?: string): RelayClass | null {
  if (isManager) {
    if (r.all_ratified) return { status: "open", action: "dispatch" };
    const orphans = r.gates.filter((g) => !seated.has(g.discipline) && !DONE.includes(g.status));
    if (!orphans.length) return { status: "inprogress", action: "gate" };
    const batonOrphan = orphans.find((g) => r.baton.includes(g.discipline));
    return { status: batonOrphan ? "open" : "pending", disc: (batonOrphan ?? orphans[0]).discipline, action: "gate" };
  }
  // dev/qa: a delegated gate belongs to its delegate; otherwise the discipline lead owns it.
  const owns = (g: Gate) => (g.delegate ? (!!meUser && g.delegate === meUser) : g.discipline === scopeDisc);
  const mineGates = r.gates.filter(owns);
  if (!mineGates.length) return null;                       // not on this relay at all
  const notDone = mineGates.filter((g) => !DONE.includes(g.status));
  if (!notDone.length) return { status: "shipping", disc: mineGates[0].discipline, action: "none" };  // your part shipped — relay still in flight
  const batonMine = notDone.find((g) => r.baton.includes(g.discipline));
  return { status: batonMine ? "open" : "pending", disc: (batonMine ?? notDone[0]).discipline, action: "gate" };
}

const STATUS_META: Record<RelayStatus, { label: string; fg: string; bg: string }> = {
  open:       { label: "open",        fg: "var(--green)",          bg: "color-mix(in srgb, var(--green) 12%, transparent)" },
  pending:    { label: "pending",     fg: "var(--amber)",          bg: "color-mix(in srgb, var(--amber) 13%, transparent)" },
  shipping:   { label: "shipping",    fg: "var(--blue)",           bg: "color-mix(in srgb, var(--blue) 11%, transparent)" },
  inprogress: { label: "in progress", fg: "var(--text-tertiary)",  bg: "var(--bg-secondary)" },
};

/* one gate's state dot — discipline mark + status colour, baton flagged in ink. */
function GateDot({ g, baton }: { g: Gate; baton: boolean }) {
  const done = DONE.includes(g.status);
  const dim = g.status === "locked" || g.status === "pending";
  return (
    <span title={`${DISC[g.discipline]?.label} · ${GATE_META[g.status]?.label ?? g.status}`}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 7px",
        borderRadius: "var(--r-pill)", border: `0.5px solid ${baton ? "var(--text-primary)" : "var(--border)"}`,
        background: baton ? "var(--bg-active)" : "var(--bg-secondary)", opacity: dim ? 0.55 : 1 }}>
      <DiscDot d={g.discipline} size={6} />
      {done
        ? <Icon name="check" size={10} style={{ color: g.status === "ratified" ? "var(--green)" : "var(--blue)" }} />
        : g.status === "changes_requested" ? <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--amber)" }} />
        : g.status === "blocked" ? <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--red)" }} />
        : <span style={{ width: 5, height: 5, borderRadius: "50%", border: "1.5px solid var(--border-strong)" }} />}
    </span>
  );
}

function GateDots({ r }: { r: RelaySummary }) {
  const ordered = STATE_ORDER.map((d) => r.gates.find((g) => g.discipline === d)).filter(Boolean) as Gate[];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      {ordered.map((g) => <GateDot key={g.discipline} g={g} baton={r.baton.includes(g.discipline)} />)}
    </div>
  );
}

/* one relay (a feature) inside an expanded project. open rows click into Gate × Contract; the rest inert. */
function RelayRow({ r, cls, name, onOpen }: { r: RelaySummary; cls: RelayClass; name: string; onOpen: (r: RelaySummary, cls: RelayClass) => void }) {
  const [h, setH] = useState(false);
  const meta = STATUS_META[cls.status];
  // open = act · shipping = view the read-only review · pending/in-progress = inert
  const clickable = cls.status === "open" || cls.status === "shipping";
  return (
    <div onClick={clickable ? () => onOpen(r, cls) : undefined}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 16px", borderTop: "0.5px solid var(--border-subtle)",
        cursor: clickable ? "pointer" : "default", background: clickable && h ? "var(--bg-hover)" : "transparent",
        opacity: cls.status === "inprogress" ? 0.78 : 1, transition: "background var(--t-quick)" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: meta.fg }} />
      <span style={{ fontSize: 13, fontWeight: 500, minWidth: 96, flexShrink: 0 }}>{name}</span>
      <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 8px", borderRadius: "var(--r-pill)",
        background: meta.bg, color: meta.fg, fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{meta.label}</span>
      <div style={{ flex: 1 }} />
      <GateDots r={r} />
      {clickable && <Icon name={cls.status === "shipping" ? "eye" : cls.action === "dispatch" ? "bolt" : "arrowRight"} size={14} style={{ color: "var(--text-tertiary)", marginLeft: 6 }} />}
    </div>
  );
}

/* a project accordion: a clickable header row with counts + a rotating chevron, then its relays. */
function ProjectAccordion({ name, counts, isManager, expanded, onToggle, children }:
  { name: string; counts: { open: number; pending: number; shipping: number; inprogress: number }; isManager: boolean; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  const [h, setH] = useState(false);
  const seg: React.ReactNode[] = [
    <span key="o" style={{ color: counts.open ? "var(--green)" : "var(--text-quaternary)" }}>{counts.open} open</span>,
    <span key="p" style={{ color: counts.pending ? "var(--amber)" : "var(--text-quaternary)" }}>{counts.pending} pending</span>,
    isManager
      ? <span key="i" style={{ color: "var(--text-quaternary)" }}>{counts.inprogress} in progress</span>
      : <span key="t" style={{ color: "var(--text-quaternary)" }}>{counts.open + counts.pending} total</span>,
    ...(!isManager && counts.shipping ? [<span key="s" style={{ color: "var(--blue)" }}>{counts.shipping} shipping</span>] : []),
  ];
  return (
    <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-xl)", background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)", overflow: "hidden" }}>
      <button onClick={onToggle} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "14px 16px", textAlign: "left",
          background: h ? "var(--bg-hover)" : "transparent", transition: "background var(--t-quick)" }}>
        <Icon name="projects" size={15} style={{ color: "var(--text-tertiary)" }} />
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px" }}>{name}</span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {seg.map((s, i) => <Fragment key={i}>{i > 0 && <span style={{ color: "var(--text-quaternary)" }}>·</span>}{s}</Fragment>)}
        </span>
        <Icon name="chevronDown" size={15} style={{ color: "var(--text-tertiary)", marginLeft: 6,
          transform: expanded ? "rotate(180deg)" : "none", transition: "transform var(--t-reg) var(--ease-out)" }} />
      </button>
      {/* smooth slide-down: animate grid rows 0fr↔1fr (children stay mounted) */}
      <div style={{ display: "grid", gridTemplateRows: expanded ? "1fr" : "0fr", transition: "grid-template-rows var(--t-reg) var(--ease-out)" }}>
        <div style={{ overflow: "hidden", minHeight: 0 }}>{children}</div>
      </div>
    </div>
  );
}

export function Relays() {
  const { relaySummaries, role, me, setView, projects, members, personFilter, setPersonFilter, goTo }: any = useApp();
  const setPlanId = useUI((s) => s.setPlanId);
  const setActiveGate = useUI((s) => s.setActiveGate);
  const projectFilter = useUI((s) => s.projectFilter);
  const selName = (projects as any[]).find((p) => p.project_id === projectFilter)?.name ?? null;
  const all: RelaySummary[] = relaySummaries ?? [];
  const seated = new Set<string>((members ?? []).filter((m: any) => m.discipline).map((m: any) => m.discipline));
  const watched = personFilter ? members.find((m: any) => m.username === personFilter) : null;
  const isManager = role === "manager" && !watched;
  const scopeDisc: Discipline | undefined = watched ? watched.discipline : me?.discipline;
  const scopeUser: string | undefined = watched ? watched.username : me?.username;
  const firstName = watched ? String(watched.name).split(" ")[0] : "";

  // per-relay feature name (Initial plan / Feature N), stable per project regardless of status sorting
  const featureName = useMemo(() => {
    const m: Record<string, string> = {};
    const byProj: Record<string, RelaySummary[]> = {};
    all.forEach((r) => { (byProj[projectKey(r)] ||= []).push(r); });
    Object.values(byProj).forEach((rs) => { let di = 0; rs.forEach((r) => { m[r.plan_id] = r.is_delta ? `Feature${(++di) > 1 ? " " + di : ""}` : "Initial plan"; }); });
    return m;
  }, [all]);

  // classify each relay for the viewer, drop the ones that aren't theirs (dev: done / not-on-relay)
  const scoped = selName ? all.filter((r) => r.project === selName) : all;
  const classified = scoped.map((r) => ({ r, cls: classify(r, scopeDisc, isManager, seated, scopeUser) }))
    .filter((x): x is { r: RelaySummary; cls: RelayClass } => !!x.cls);

  // group by project, count + sort items open → pending → shipping → in-progress
  const ORDER: Record<RelayStatus, number> = { open: 0, pending: 1, shipping: 2, inprogress: 3 };
  const groupMap = new Map<string, { r: RelaySummary; cls: RelayClass }[]>();
  classified.forEach((it) => { const k = projectKey(it.r); const arr = groupMap.get(k) ?? []; arr.push(it); groupMap.set(k, arr); });
  const projGroups = [...groupMap.entries()].map(([key, items]) => {
    items.sort((a, b) => ORDER[a.cls.status] - ORDER[b.cls.status]);
    const count = (s: RelayStatus) => items.filter((i) => i.cls.status === s).length;
    return { key, name: items[0].r.project, counts: { open: count("open"), pending: count("pending"), shipping: count("shipping"), inprogress: count("inprogress") }, items };
  });
  const prio = (c: { open: number; pending: number }) => (c.open > 0 ? 2 : c.pending > 0 ? 1 : 0);
  projGroups.sort((a, b) => prio(b.counts) - prio(a.counts) || a.name.localeCompare(b.name));

  const totalOpen = projGroups.reduce((n, g) => n + g.counts.open, 0);
  const totalPending = projGroups.reduce((n, g) => n + g.counts.pending, 0);

  // accordion expansion: default-open any project with an open relay; the user can override per project.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isExp = (key: string, openN: number) => (key in overrides ? overrides[key] : openN > 0);
  const toggle = (key: string, cur: boolean) => setOverrides((o) => ({ ...o, [key]: !cur }));

  const openRelay = (r: RelaySummary, cls: RelayClass) => {
    setPlanId(r.plan_id);
    if (cls.action === "dispatch") { setView("relay"); return; }   // manager: ready relay → RelayBoard to dispatch
    if (cls.disc) setActiveGate(cls.disc);
    goTo("gatecontract", { disc: cls.disc, plan_id: r.plan_id, project: r.project, feature: featureName[r.plan_id] });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Relays"]}>
        <ProjectSwitcher />
        <PersonSwitcher />
      </ViewChrome>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "26px 28px 56px" }}>
          <div style={{ marginBottom: 14 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: 0 }}>
              {watched ? `${firstName}'s relays` : isManager ? "Studio state-map" : "Your relays"}
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "5px 0 0", lineHeight: 1.5 }}>
              {isManager
                ? <>Every relay, grouped by project. <b style={{ color: "var(--green)" }}>{totalOpen} open</b> · {totalPending} pending now.</>
                : watched
                ? <>Read-only via a granted Watch — their relays, grouped by project.</>
                : <><b style={{ color: "var(--green)" }}>{totalOpen} open</b> for you · {totalPending} pending. Open one to ratify its gate.</>}
            </p>
          </div>

          {watched && <PeerReviewBanner m={watched} onClear={() => setPersonFilter(null)} />}

          {/* legend */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "12px 0 18px", padding: "8px 12px", borderRadius: "var(--r-md)",
            background: "var(--bg-secondary)", border: "0.5px solid var(--border-subtle)", flexWrap: "wrap" }}>
            <span className="kicker" style={{ fontSize: 10 }}>Legend</span>
            {(["open", "pending", ...(isManager ? ["inprogress" as const] : ["shipping" as const])] as RelayStatus[]).map((s) => (
              <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-tertiary)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_META[s].fg }} />
                {STATUS_META[s].label} · {{ open: "your call", pending: "waiting", shipping: "shipped your part", inprogress: "observe" }[s]}
              </span>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {projGroups.map((g) => {
              const exp = isExp(g.key, g.counts.open);
              return (
                <ProjectAccordion key={g.key} name={g.name} counts={g.counts} isManager={isManager} expanded={exp} onToggle={() => toggle(g.key, exp)}>
                  {g.items.map(({ r, cls }) => <RelayRow key={r.plan_id} r={r} cls={cls} name={featureName[r.plan_id]} onOpen={openRelay} />)}
                </ProjectAccordion>
              );
            })}
            {projGroups.length === 0 && (
              <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-quaternary)", fontSize: 13 }}>
                {watched ? `No active relay ${firstName} is on.` : selName ? "No active relay for this project." : "No relays need you right now."}
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
