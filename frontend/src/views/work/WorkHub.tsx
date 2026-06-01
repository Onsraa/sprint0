/* sprint0 × Linear — My Work. Board (with Jira-style drag-tilt) + List + Timeline, and a contextual
   right sub-panel for task detail. Ported pixel-1:1 from the v4 design system's MyWork.jsx; only the
   data source changed (mock TASKS/MEMBERS → the useApp() adapter). NOTE: the mockup MyWork carries no
   "Simulate change" / reflow control, so none is rendered here. */
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { Icon, type IconName } from "../../lib/icon";
import { ZeroMark } from "../../lib/icon";
import { ViewChrome } from "../../components/ViewChrome";
import {
  Avatar, Badge, Button, DiscDot, DISC, IconButton, SectionHeader, StatusIcon, Tab, TrustDot,
  CapTag, PRIORITY_META,
} from "../../components/ui";
import { useApp } from "../../app/useApp";
import { useUI } from "../../lib/store";
import { KindSurface } from "../KindSurface";
import type { Member, WorkTask } from "../../lib/api";

/* ── local presentational maps + helpers (ported from data.jsx / data3.jsx) ─────────────────────── */
const RISK_META: Record<string, { label: string; tone: "red" | "amber" | "neutral" }> = {
  high: { label: "High risk", tone: "red" },
  medium: { label: "Med risk", tone: "amber" },
  low: { label: "Low risk", tone: "neutral" },
};
const trustTier = (v: number) => (v >= 75 ? "Senior" : v >= 45 ? "Trusted" : "Apprentice");
// TODO(reconcile): mock used per-discipline numeric trust (0–100) from PASSPORTS; real Member.trust is
// a Record<discipline, "low"|"medium"|"high">. Map the level → a representative score for the tier badge.
const TRUST_SCORE: Record<string, number> = { high: 80, medium: 55, low: 30 };
const trustScoreFor = (m: Member | undefined, disc: string | null | undefined): number => {
  if (!m || !disc) return 40;
  const lvl = m.trust?.[disc] ?? m.trust_level;
  return TRUST_SCORE[lvl] ?? 40;
};

type AnyTask = WorkTask & {
  est?: number; by?: string; dep?: string[]; score?: number | null; gap_cover?: boolean; project?: number;
};
// real WorkTask uses estimate_days / assigned_by / depends_on / project_id — bridge to the mock field names.
const estOf = (t: AnyTask) => t.est ?? t.estimate_days;
const byOf = (t: AnyTask) => t.by ?? t.assigned_by;
const depOf = (t: AnyTask): string[] => t.dep ?? t.depends_on ?? [];

const COLS = [
  { status: "planned", label: "Planned" },
  { status: "in_progress", label: "In Progress" },
  { status: "in_review", label: "In Review" },
  { status: "done", label: "Done" },
] as const;
const columnOf = (s: string) => (s === "blocked" ? "in_progress" : s);

export function WorkHub() {
  const { me, role, members, tasks: allTasks } = useApp();
  const byUser = (u: string | null | undefined) => members.find((m) => m.username === u);
  const [tasks, setTasks] = useState<AnyTask[]>(() => allTasks.map((t) => ({ ...t })));
  const [scope, setScope] = useState(role === "manager" ? "team" : "me"); // me | team
  const [mode, setMode] = useState<"board" | "list" | "timeline">("board");
  const [selected, setSelected] = useState<string | null>(null);
  const [exec, setExec] = useState<string | null>(null); // §25 open the code-focus execution surface

  // keep local board state in sync if the adapter's task list changes
  useEffect(() => { setTasks(allTasks.map((t) => ({ ...t }))); }, [allTasks]);

  // Today "Open scope" deep-link: open the code-focus surface for the requested issue, then clear it.
  const activeIssue = useUI((s) => s.activeIssue);
  const setActiveIssue = useUI((s) => s.setActiveIssue);
  useEffect(() => { if (activeIssue) { setExec(activeIssue); setActiveIssue(null); } }, [activeIssue, setActiveIssue]);

  const move = useCallback((id: string, status: string) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: status as WorkTask["status"] } : t)));
  }, []);

  const shown = scope === "me" ? tasks.filter((t) => t.assignee === me.username) : tasks;
  const sel = tasks.find((t) => t.id === selected) || null;
  const execTask = tasks.find((t) => t.id === exec) || null;
  // developers/qa open their card straight into the execution surface
  const openCard = (id: string) => { if (role === "manager") setSelected(id); else setExec(id); };

  if (execTask) return <KindSurface work={execTask} onBack={() => setExec(null)} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "My Work"]}>
        <div style={{ display: "flex", gap: 6, marginRight: 6 }}>
          <Tab active={mode === "board"} onClick={() => setMode("board")}>Board</Tab>
          <Tab active={mode === "list"} onClick={() => setMode("list")}>List</Tab>
          <Tab active={mode === "timeline"} onClick={() => setMode("timeline")}>Timeline</Tab>
        </div>
        <IconButton name="filter" title="Filter" />
        <IconButton name="sort" title="Sort" />
        <Button variant="primary" size="sm" icon="plus">New</Button>
      </ViewChrome>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <ScopeBar scope={scope} setScope={setScope} count={shown.length} />
          {role !== "manager" && <FocusBanner tasks={tasks} onOpen={setExec} />}
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {mode === "board" && <Board tasks={shown} onMove={move} onOpen={openCard} selected={selected} byUser={byUser} />}
            {mode === "list" && <ListView tasks={shown} onOpen={openCard} selected={selected} byUser={byUser} />}
            {mode === "timeline" && <Timeline tasks={shown} onOpen={openCard} members={members} />}
          </div>
        </div>
        {sel && <TaskPanel task={sel} onClose={() => setSelected(null)} onScope={() => { setSelected(null); setExec(sel.id); }} tasks={tasks} byUser={byUser} />}
      </div>
    </div>
  );
}

/* §2.2 the developer landing — "Today's focus": trust tier + first scoped slice. */
function FocusBanner({ tasks, onOpen }: { tasks: AnyTask[]; onOpen: (id: string) => void }) {
  const { me } = useApp();
  const mine = tasks.filter((t) => t.assignee === me.username && t.status !== "done");
  const first = mine.find((t) => t.status === "in_progress" || t.status === "blocked") || mine[0];
  if (!first) return null;
  const tierVal = trustScoreFor(me, me.discipline); // TODO(reconcile): was passportFor(me.username).trust[disc]
  return (
    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 13, padding: "11px 14px", margin: "10px 12px 0",
      borderRadius: "var(--r-lg)", border: "0.5px solid var(--border)", background: "var(--bg-secondary)", boxShadow: "var(--shadow-1)" }}>
      <span style={{ width: 30, height: 30, borderRadius: "var(--r-md)", display: "grid", placeItems: "center", background: "var(--bg-elevated)", border: "0.5px solid var(--border)" }}>
        <DiscDot d={me.discipline || "backend"} size={10} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="kicker" style={{ fontSize: 10 }}>Today's focus</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-tertiary)" }}>
            <TrustDot level={tierVal >= 75 ? "high" : tierVal >= 45 ? "medium" : "low"} />{me.discipline ? `${trustTier(tierVal)} · ${DISC[me.discipline]?.label}` : "Manager"}
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", marginRight: 7 }}>{first.id}</span>{first.title}
        </div>
      </div>
      <Button variant="primary" size="sm" iconRight="arrowRight" onClick={() => onOpen(first.id)}>Open scope</Button>
    </div>
  );
}

function ScopeBar({ scope, setScope, count }: { scope: string; setScope: (s: string) => void; count: number }) {
  return (
    <div style={{ height: 40, flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "0 12px",
      borderBottom: "0.5px solid var(--border-subtle)" }}>
      <Tab active={scope === "me"} onClick={() => setScope("me")}>My work</Tab>
      <Tab active={scope === "team"} onClick={() => setScope("team")}>Team</Tab>
      <button style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px",
        borderRadius: "var(--r-pill)", fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)" }}>
        <Icon name="team" size={13} /> @person <Icon name="chevronDown" size={12} />
      </button>
      <div style={{ flex: 1 }} />
      <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{count} tasks</span>
    </div>
  );
}

/* ───────────────────────── Board with drag-tilt ───────────────────────── */
type Drag = { id: string; w: number; offX: number; offY: number } | null;
function Board({ tasks, onMove, onOpen, selected, byUser }: {
  tasks: AnyTask[]; onMove: (id: string, status: string) => void; onOpen: (id: string) => void;
  selected: string | null; byUser: (u: string | null | undefined) => Member | undefined;
}) {
  const [drag, setDrag] = useState<Drag>(null); // { id, w, offX, offY }
  const [ghost, setGhost] = useState({ x: 0, y: 0, rot: 0 });
  const [overCol, setOverCol] = useState<string | null>(null);
  const raf = useRef(0);
  const st = useRef<{ px: number; py: number; vx: number; rot: number; lastX: number; over: string | null; dragging: boolean; moved: boolean; sx: number; sy: number; pend: { id: string; w: number; offX: number; offY: number; left: number; top: number } | null }>({ px: 0, py: 0, vx: 0, rot: 0, lastX: 0, over: null, dragging: false, moved: false, sx: 0, sy: 0, pend: null });

  const startDrag = (e: RPointerEvent, task: AnyTask, el: HTMLElement) => {
    if (e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    const s = st.current;
    s.sx = e.clientX; s.sy = e.clientY; s.moved = false; s.dragging = false;
    s.pend = { id: task.id, w: rect.width, offX: e.clientX - rect.left, offY: e.clientY - rect.top, left: rect.left, top: rect.top };
    window.addEventListener("pointermove", onMoveP);
    window.addEventListener("pointerup", onUpP);
  };
  const begin = (e: PointerEvent) => {
    const s = st.current, p = s.pend!;
    s.px = e.clientX; s.py = e.clientY; s.lastX = e.clientX; s.vx = 0; s.rot = 0; s.over = null;
    s.dragging = true; s.moved = true;
    setDrag({ id: p.id, w: p.w, offX: p.offX, offY: p.offY });
    setGhost({ x: e.clientX, y: e.clientY, rot: 0 });
    loop();
  };
  const onMoveP = (e: PointerEvent) => {
    const s = st.current;
    if (!s.dragging) {
      if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > 4) begin(e);
      return;
    }
    s.vx = s.vx * 0.6 + (e.clientX - s.lastX) * 0.4;
    s.lastX = e.clientX; s.px = e.clientX; s.py = e.clientY;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const col = el && (el as HTMLElement).closest("[data-col]");
    s.over = col ? col.getAttribute("data-col") : null;
  };
  const loop = () => {
    const s = st.current;
    const target = Math.max(-7, Math.min(7, s.vx * 0.9));
    s.rot += (target - s.rot) * 0.2;
    s.vx *= 0.85;
    setGhost(() => ({ x: s.px, y: s.py, rot: s.rot }));
    setOverCol((prev) => (prev !== s.over ? s.over : prev));
    raf.current = requestAnimationFrame(loop);
  };
  const onUpP = () => {
    window.removeEventListener("pointermove", onMoveP);
    window.removeEventListener("pointerup", onUpP);
    const s = st.current;
    if (!s.dragging) { s.pend = null; return; }
    cancelAnimationFrame(raf.current);
    s.dragging = false;
    setDrag((d) => {
      if (d && s.over && columnOf(tasks.find((t) => t.id === d.id)?.status ?? "") !== s.over) onMove(d.id, s.over);
      return null;
    });
    setOverCol(null);
  };
  const open = (id: string) => { if (!st.current.moved) onOpen(id); };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const dragTask = drag && tasks.find((t) => t.id === drag.id);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(158px, 1fr))", gap: 10, padding: 12, minHeight: "100%" }}>
      {COLS.map((col) => {
        const colTasks = tasks.filter((t) => columnOf(t.status) === col.status);
        const isOver = overCol === col.status;
        return (
          <div key={col.status} data-col={col.status}
            style={{ display: "flex", flexDirection: "column", gap: 8, padding: 6, borderRadius: "var(--r-lg)",
              background: isOver ? "var(--bg-secondary)" : "transparent",
              outline: isOver ? "1px dashed var(--border-strong)" : "1px solid transparent",
              transition: "background var(--t-quick)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, height: 28, padding: "0 4px" }}>
              <StatusIcon status={col.status} size={14} />
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{col.label}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{colTasks.length}</span>
              <div style={{ flex: 1 }} />
              <IconButton name="plus" size={20} icon={13} title="Add" />
            </div>
            {colTasks.map((t) => (
              <TaskCard key={t.id} task={t} onOpen={open} selected={selected === t.id}
                dragging={drag?.id === t.id} onStartDrag={startDrag} byUser={byUser} />
            ))}
            {colTasks.length === 0 && (
              <div style={{ height: 52, borderRadius: "var(--r-md)", border: "1px dashed var(--border)",
                display: "grid", placeItems: "center", color: "var(--text-quaternary)", fontSize: 12 }}>—</div>
            )}
          </div>
        );
      })}

      {dragTask && drag && (
        <div style={{ position: "fixed", left: ghost.x - drag.offX, top: ghost.y - drag.offY, width: drag.w,
          transform: `rotate(${ghost.rot}deg) scale(1.025)`, zIndex: 80, pointerEvents: "none",
          filter: "saturate(1.02)" }}>
          <TaskCard task={dragTask} floating byUser={byUser} />
        </div>
      )}
    </div>
  );
}

function TaskCard({ task: t, onOpen, selected, dragging, floating, onStartDrag, byUser }: {
  task: AnyTask; onOpen?: (id: string) => void; selected?: boolean; dragging?: boolean; floating?: boolean;
  onStartDrag?: (e: RPointerEvent, t: AnyTask, el: HTMLElement) => void; byUser: (u: string | null | undefined) => Member | undefined;
}) {
  const [h, setH] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pr = PRIORITY_META[t.priority ?? "normal"];
  return (
    <div ref={ref}
      onPointerDown={(e) => { if ((e.target as HTMLElement).closest("[data-no-drag]")) return; onStartDrag && onStartDrag(e, t, ref.current!); }}
      onClick={() => !floating && onOpen && onOpen(t.id)}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: "var(--bg-elevated)", border: "0.5px solid var(--border)", borderRadius: "var(--r-md)",
        padding: "9px 10px 8px", cursor: floating ? "grabbing" : "pointer", userSelect: "none",
        boxShadow: floating ? "var(--shadow-drag)" : selected ? "0 0 0 1.5px var(--text-primary)" : "var(--shadow-1)",
        opacity: dragging ? 0.35 : 1,
        outline: selected && !floating ? "none" : "none",
        transition: floating ? "none" : "box-shadow var(--t-quick), opacity var(--t-quick), transform var(--t-quick)",
        transform: h && !floating && !dragging ? "translateY(-1px)" : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <StatusIcon status={t.status} size={13} />
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", fontWeight: 500 }}>{t.id}</span>
        <div style={{ flex: 1 }} />
        {t.status === "blocked" && <Badge tone="red">blocked</Badge>}
        {t.priority === "urgent" && t.status !== "blocked" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: pr.color }} title="Urgent" />}
      </div>
      <div style={{ fontSize: 13, fontWeight: 450, lineHeight: 1.35, color: "var(--text-primary)",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginBottom: 9 }}>
        {t.title}
      </div>
      {t.capability_tags && t.capability_tags.length > 0 && (
        <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
          {t.capability_tags.slice(0, 2).map((tag) => <CapTag key={tag} tag={tag} />)}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <DiscDot d={t.discipline} /><span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{DISC[t.discipline]?.label}</span>
        </span>
        <div style={{ flex: 1 }} />
        {byOf(t) === "ai" && <Badge tone="neutral" mono><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />ai</Badge>}
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{estOf(t)}d</span>
        <Avatar name={byUser(t.assignee)?.name || "?"} size={18} />
      </div>
    </div>
  );
}

/* ───────────────────────── List view ───────────────────────── */
function ListView({ tasks, onOpen, selected, byUser }: {
  tasks: AnyTask[]; onOpen: (id: string) => void; selected: string | null; byUser: (u: string | null | undefined) => Member | undefined;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ planned: true, in_progress: true, in_review: true, done: true });
  return (
    <div style={{ padding: "4px 0" }}>
      {COLS.map((col) => {
        const rows = tasks.filter((t) => columnOf(t.status) === col.status);
        return (
          <div key={col.status}>
            <div style={{ position: "sticky", top: 0, background: "var(--bg-elevated)", zIndex: 1 }}>
              <SectionHeader open={open[col.status]} onToggle={() => setOpen((o) => ({ ...o, [col.status]: !o[col.status] }))}
                glyph={<StatusIcon status={col.status} size={14} />} label={col.label} count={rows.length}
                right={<IconButton name="plus" size={22} icon={13} />} />
            </div>
            {open[col.status] && rows.map((t) => <ListRow key={t.id} t={t} onOpen={onOpen} selected={selected === t.id} byUser={byUser} />)}
          </div>
        );
      })}
    </div>
  );
}
function ListRow({ t, onOpen, selected, byUser }: { t: AnyTask; onOpen: (id: string) => void; selected: boolean; byUser: (u: string | null | undefined) => Member | undefined }) {
  const [h, setH] = useState(false);
  return (
    <div onClick={() => onOpen(t.id)} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 16px", cursor: "pointer",
        background: selected ? "var(--bg-hover)" : h ? "var(--bg-hover)" : "transparent" }}>
      <span style={{ color: "var(--text-quaternary)", opacity: h ? 1 : 0 }}><Icon name="grip" size={14} /></span>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", width: 64, flexShrink: 0 }}>{t.id}</span>
      <StatusIcon status={t.status} size={14} />
      <span style={{ fontSize: 13.5, fontWeight: 450, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
      {t.status === "blocked" && <Badge tone="red">blocked</Badge>}
      {byOf(t) === "ai" && <Badge tone="neutral" mono><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />ai</Badge>}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, width: 84 }}>
        <DiscDot d={t.discipline} /><span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{DISC[t.discipline]?.label}</span>
      </span>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", width: 26, textAlign: "right" }}>{estOf(t)}d</span>
      <Avatar name={byUser(t.assignee)?.name || "?"} size={18} />
    </div>
  );
}

/* ───────────────────────── Timeline (compact gantt) ───────────────────────── */
function Timeline({ tasks, onOpen, members }: { tasks: AnyTask[]; onOpen: (id: string) => void; members: Member[] }) {
  const lanes = members.filter((m) => m.role === "developer");
  const DAYS = 14;
  const seed = (id: string) => [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: `140px repeat(${DAYS}, 1fr)`, alignItems: "center",
        marginBottom: 6, paddingLeft: 4 }}>
        <span />
        {Array.from({ length: DAYS }).map((_, i) => (
          <span key={i} className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)", textAlign: "center" }}>
            {i % 2 === 0 ? `${12 + i}` : ""}
          </span>
        ))}
      </div>
      {lanes.map((m) => {
        const mine = tasks.filter((t) => t.assignee === m.username);
        return (
          <div key={m.username} style={{ display: "grid", gridTemplateColumns: `140px 1fr`, alignItems: "center",
            height: 38, borderTop: "0.5px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Avatar name={m.name} size={18} /><span style={{ fontSize: 12.5, fontWeight: 500 }}>{m.name.split(" ")[0]}</span>
            </div>
            <div style={{ position: "relative", height: "100%" }}>
              {mine.map((t, i) => {
                const est = estOf(t) ?? 1;
                const start = seed(t.id) % (DAYS - est - 1);
                const left = (start / DAYS) * 100, width = (est / DAYS) * 100;
                const c = DISC[t.discipline]?.color;
                return (
                  <button key={t.id} onClick={() => onOpen(t.id)} title={t.title}
                    style={{ position: "absolute", top: 7 + (i % 2) * 0, left: `${left}%`, width: `calc(${width}% - 4px)`,
                      height: 22, borderRadius: "var(--r-sm)", background: "var(--bg-elevated)",
                      border: `0.5px solid var(--border)`, borderLeft: `2.5px solid ${c}`, boxShadow: "var(--shadow-1)",
                      display: "flex", alignItems: "center", padding: "0 7px", gap: 5, overflow: "hidden" }}>
                    <span style={{ fontSize: 11, fontWeight: 450, color: "var(--text-secondary)", whiteSpace: "nowrap",
                      overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Task sub-panel ───────────────────────── */
function TaskPanel({ task: t, onClose, onScope, tasks, byUser }: {
  task: AnyTask; onClose: () => void; onScope: () => void; tasks: AnyTask[]; byUser: (u: string | null | undefined) => Member | undefined;
}) {
  const { projects } = useApp();
  const a = byUser(t.assignee);
  const dep = depOf(t);
  return (
    <div style={{ width: "var(--panel-w)", flexShrink: 0, borderLeft: "0.5px solid var(--border)",
      display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg-elevated)",
      animation: "s0-panel-in var(--t-reg) var(--ease-out) both" }}>
      <div style={{ height: "var(--topbar-h)", display: "flex", alignItems: "center", gap: 8, padding: "0 8px 0 14px",
        borderBottom: "0.5px solid var(--border-subtle)" }}>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{t.id}</span>
        <div style={{ flex: 1 }} />
        <IconButton name="link" title="Copy link" />
        <IconButton name="more" title="More" />
        <IconButton name="close" title="Close" onClick={onClose} />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <StatusIcon status={t.status} size={16} />
          <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)" }}>
            {COLS.find((c) => c.status === columnOf(t.status))?.label}{t.status === "blocked" ? " · blocked" : ""}
          </span>
        </div>
        <h2 style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3, letterSpacing: "-0.3px", margin: "0 0 16px" }}>{t.title}</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 16 }}>
          <PanelRow icon="team" label="Assignee" value={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Avatar name={a?.name} size={18} />{a?.name}</span>} />
          <PanelRow icon="board" label="Discipline" value={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><DiscDot d={t.discipline} />{DISC[t.discipline]?.label}</span>} />
          <PanelRow icon="flag" label="Priority" value={<span style={{ color: PRIORITY_META[t.priority ?? "normal"].color, fontWeight: 500 }}>{PRIORITY_META[t.priority ?? "normal"].label}</span>} />
          <PanelRow icon="load" label="Risk" value={<Badge tone={RISK_META[t.risk ?? "low"].tone}>{RISK_META[t.risk ?? "low"].label}</Badge>} />
          <PanelRow icon="clock" label="Estimate" value={<span className="mono" style={{ fontSize: 12.5 }}>{estOf(t)} days</span>} />
          <PanelRow icon="projects" label="Project" value={projects.find((p) => p.project_id === (t.project ?? t.project_id))?.name} />
        </div>

        <div style={{ height: 1, background: "var(--border-subtle)", margin: "4px 0 16px" }} />

        {t.capability_tags && t.capability_tags.length > 0 && (
          <>
            <div className="kicker" style={{ marginBottom: 8 }}>Capabilities</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
              {t.capability_tags.map((tag) => <CapTag key={tag} tag={tag} />)}
            </div>
          </>
        )}

        <div className="kicker" style={{ marginBottom: 8 }}>Provenance</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: "var(--r-md)",
          background: "var(--bg-secondary)", marginBottom: 16 }}>
          {byOf(t) === "ai"
            ? <><ZeroMark size={16} /><span style={{ fontSize: 12.5, color: "var(--text-secondary)", flex: 1 }}>Assigned by sprint0{t.gap_cover ? " — covering the orphan gap" : ""}</span>{t.score != null && <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>match {t.score}</span>}</>
            : <><Avatar name={a?.name} size={18} /><span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Self-claimed by {a?.name?.split(" ")[0]}</span></>}
        </div>

        {dep.length > 0 && (
          <>
            <div className="kicker" style={{ marginBottom: 8 }}>Depends on</div>
            {dep.map((d) => {
              const dt = tasks.find((x) => x.id === d);
              return (
                <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 10px",
                  borderRadius: "var(--r-md)", border: "0.5px solid var(--border)", marginBottom: 6 }}>
                  <StatusIcon status={dt?.status || "planned"} size={13} />
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{d}</span>
                  <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dt?.title}</span>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div style={{ borderTop: "0.5px solid var(--border-subtle)", padding: 10, display: "flex", gap: 8 }}>
        <Button variant="primary" size="md" iconRight="arrowRight" style={{ flex: 1 }} onClick={onScope}>Open scope</Button>
        <Button variant="secondary" size="md" icon="gitlab">Open</Button>
      </div>
    </div>
  );
}
function PanelRow({ icon, label, value }: { icon: IconName; label: string; value: ReactNode }) {
  const [h, setH] = useState(false);
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 32, padding: "0 8px", borderRadius: "var(--r-md)",
        background: h ? "var(--bg-hover)" : "transparent", cursor: "default" }}>
      <Icon name={icon} size={15} style={{ color: "var(--text-quaternary)" }} />
      <span style={{ fontSize: 12.5, color: "var(--text-tertiary)", width: 78, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: "var(--text-primary)", fontWeight: 450 }}>{value}</span>
    </div>
  );
}
