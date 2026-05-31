/* sprint0 × Linear — My Work. Board (Jira-style drag-tilt) + List + Timeline, with a contextual
   right sub-panel. Ported from the design system's MyWork.jsx; wired to our TanStack Query work hub
   (useWork by scope + optimistic useSetTaskStatus), roster, and the reflow event control. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRoster } from "../../features/roster/useRoster";
import { useUI } from "../../lib/store";
import { qk } from "../../lib/query";
import { type TaskStatus, type WorkTask, type RescheduleStrategy, type Member } from "../../lib/api";
import { useWork, useSetTaskStatus, patchTasksInCache } from "../../features/work/useWork";
import { Icon } from "../../lib/icon";
import { ViewChrome } from "../../components/ViewChrome";
import {
  Avatar, Badge, DiscDot, DISC, IconButton, SectionHeader, StatusIcon, Tab, PRIORITY_META,
} from "../../components/ui";
import { WorkTimeline } from "./WorkTimeline";
import { TaskDrawer } from "./TaskDrawer";
import { WorkEventControl } from "./WorkEventControl";

type Mode = "board" | "list" | "timeline";
const COLS: { status: TaskStatus; label: string }[] = [
  { status: "planned", label: "Planned" },
  { status: "in_progress", label: "In Progress" },
  { status: "in_review", label: "In Review" },
  { status: "done", label: "Done" },
];
const columnOf = (s: string): TaskStatus => (s === "blocked" ? "in_progress" : (s as TaskStatus));

export function WorkHub() {
  const roster = useRoster();
  const qc = useQueryClient();
  const [scope, setScope] = useState("me");
  const [mode, setMode] = useState<Mode>("board");
  const [reflowMsg, setReflowMsg] = useState<string | null>(null);
  const panelTaskId = useUI((s) => s.panelTaskId);
  const openPanel = useUI((s) => s.openPanel);
  const closePanel = useUI((s) => s.closePanel);

  const { data: tasks = [], isLoading, error } = useWork(scope);
  const err = error instanceof Error ? error.message : null;
  const setStatus = useSetTaskStatus();
  const onMove = (id: string, status: TaskStatus) => setStatus.mutate({ id, status });
  const nameOf = (u: string | null) => roster.find((m) => m.username === u)?.name ?? u ?? "?";

  const onReflow = (moved: WorkTask[], strategy: RescheduleStrategy | null) => {
    patchTasksInCache(qc, moved);
    if (moved.length) setMode("timeline");
    setReflowMsg(
      moved.length
        ? `${moved.length} task${moved.length === 1 ? "" : "s"} re-flowed instantly` +
            (strategy ? ` · AI: ${strategy.action}${strategy.action === "right_shift" ? " (applied)" : " (proposed)"}` : "")
        : strategy ? `No dates moved · AI chose ${strategy.action} (proposed)` : "No change",
    );
  };

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
        <WorkEventControl roster={roster} tasks={tasks} onReflow={onReflow} />
      </ViewChrome>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <ScopeBar scope={scope} setScope={setScope} roster={roster} count={tasks.length} />
          {reflowMsg && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "8px 12px 0", padding: "8px 12px", background: "var(--bg-secondary)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)", fontSize: 12.5, color: "var(--text-secondary)", fontWeight: 500 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Icon name="calendar" size={14} /> {reflowMsg}</span>
              <button onClick={() => setReflowMsg(null)} style={{ color: "var(--text-tertiary)", display: "inline-flex" }}><Icon name="close" size={14} /></button>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {isLoading ? (
              <div className="mono" style={{ padding: 16, fontSize: 12, color: "var(--text-tertiary)" }}>loading tasks…</div>
            ) : err ? (
              <div className="mono" style={{ padding: 16, fontSize: 12, color: "var(--red)" }}>{err}</div>
            ) : mode === "board" ? (
              <Board tasks={tasks} onMove={onMove} onOpen={openPanel} selected={panelTaskId} nameOf={nameOf} />
            ) : mode === "list" ? (
              <ListView tasks={tasks} onOpen={openPanel} selected={panelTaskId} nameOf={nameOf} />
            ) : (
              <WorkTimeline tasks={tasks} onOpen={openPanel} />
            )}
          </div>
        </div>
        {panelTaskId != null && (
          <TaskDrawer taskId={panelTaskId} onClose={closePanel} reload={() => qc.invalidateQueries({ queryKey: qk.work(scope) })} />
        )}
      </div>
    </div>
  );
}

function ScopeBar({ scope, setScope, roster, count }: {
  scope: string; setScope: (s: string) => void; roster: Member[]; count: number;
}) {
  const isPerson = scope.startsWith("user:");
  return (
    <div style={{ height: 40, flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "0 12px", borderBottom: "0.5px solid var(--border-subtle)" }}>
      <Tab active={scope === "me"} onClick={() => setScope("me")}>My work</Tab>
      <Tab active={scope === "team"} onClick={() => setScope("team")}>Team</Tab>
      <span style={{ display: "inline-flex", alignItems: "center", height: 28, padding: "0 6px 0 10px", borderRadius: "var(--r-pill)",
        background: isPerson ? "var(--bg-elevated)" : "transparent", border: isPerson ? "0.5px solid var(--border)" : "0.5px solid transparent",
        boxShadow: isPerson ? "var(--shadow-1)" : "none", fontSize: 12, fontWeight: 500, color: isPerson ? "var(--text-primary)" : "var(--text-tertiary)", gap: 5 }}>
        <Icon name="team" size={13} />
        <select value={isPerson ? scope.slice(5) : ""} onChange={(e) => setScope(e.target.value ? `user:${e.target.value}` : "me")}
          style={{ appearance: "none", background: "transparent", border: "none", color: "inherit", fontSize: 12, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", outline: "none" }}>
          <option value="">@person</option>
          {roster.map((m) => <option key={m.username} value={m.username}>{m.name}</option>)}
        </select>
      </span>
      <div style={{ flex: 1 }} />
      <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{count} tasks</span>
    </div>
  );
}

/* ───────────────────────── Board with drag-tilt ───────────────────────── */
type DragState = { id: string; w: number; offX: number; offY: number } | null;
function Board({ tasks, onMove, onOpen, selected, nameOf }: {
  tasks: WorkTask[]; onMove: (id: string, s: TaskStatus) => void; onOpen: (id: string) => void; selected: string | null; nameOf: (u: string | null) => string;
}) {
  const [drag, setDrag] = useState<DragState>(null);
  const [ghost, setGhost] = useState({ x: 0, y: 0, rot: 0 });
  const [overCol, setOverCol] = useState<string | null>(null);
  const raf = useRef(0);
  const st = useRef({ px: 0, py: 0, vx: 0, rot: 0, lastX: 0, over: null as string | null, dragging: false, moved: false, sx: 0, sy: 0, pend: null as null | { id: string; w: number; offX: number; offY: number } });

  const loop = useCallback(() => {
    const s = st.current;
    const target = Math.max(-7, Math.min(7, s.vx * 0.9));
    s.rot += (target - s.rot) * 0.2;
    s.vx *= 0.85;
    setGhost({ x: s.px, y: s.py, rot: s.rot });
    setOverCol((prev) => (prev !== s.over ? s.over : prev));
    raf.current = requestAnimationFrame(loop);
  }, []);

  const onMoveP = useCallback((e: PointerEvent) => {
    const s = st.current;
    if (!s.dragging) {
      if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > 4 && s.pend) {
        s.px = e.clientX; s.py = e.clientY; s.lastX = e.clientX; s.vx = 0; s.rot = 0; s.over = null;
        s.dragging = true; s.moved = true;
        setDrag({ ...s.pend }); setGhost({ x: e.clientX, y: e.clientY, rot: 0 }); loop();
      }
      return;
    }
    s.vx = s.vx * 0.6 + (e.clientX - s.lastX) * 0.4;
    s.lastX = e.clientX; s.px = e.clientX; s.py = e.clientY;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const col = el && (el as HTMLElement).closest("[data-col]");
    s.over = col ? col.getAttribute("data-col") : null;
  }, [loop]);

  const onUpP = useCallback(() => {
    window.removeEventListener("pointermove", onMoveP);
    window.removeEventListener("pointerup", onUpP);
    const s = st.current;
    if (!s.dragging) { s.pend = null; return; }
    cancelAnimationFrame(raf.current);
    s.dragging = false;
    setDrag((d) => {
      if (d && s.over && columnOf(tasks.find((t) => t.id === d.id)?.status ?? "") !== s.over) onMove(d.id, s.over as TaskStatus);
      return null;
    });
    setOverCol(null);
  }, [onMoveP, onMove, tasks]);

  const startDrag = (e: React.PointerEvent, task: WorkTask, el: HTMLElement) => {
    if (e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    const s = st.current;
    s.sx = e.clientX; s.sy = e.clientY; s.moved = false; s.dragging = false;
    s.pend = { id: task.id, w: rect.width, offX: e.clientX - rect.left, offY: e.clientY - rect.top };
    window.addEventListener("pointermove", onMoveP);
    window.addEventListener("pointerup", onUpP);
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
              background: isOver ? "var(--bg-secondary)" : "transparent", outline: isOver ? "1px dashed var(--border-strong)" : "1px solid transparent", transition: "background var(--t-quick)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, height: 28, padding: "0 4px" }}>
              <StatusIcon status={col.status} size={14} />
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{col.label}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{colTasks.length}</span>
              <div style={{ flex: 1 }} />
              <IconButton name="plus" size={20} icon={13} title="Add" />
            </div>
            {colTasks.map((t) => (
              <TaskCard key={t.id} task={t} onOpen={open} selected={selected === t.id} dragging={drag?.id === t.id} onStartDrag={startDrag} nameOf={nameOf} />
            ))}
            {colTasks.length === 0 && (
              <div style={{ height: 52, borderRadius: "var(--r-md)", border: "1px dashed var(--border)", display: "grid", placeItems: "center", color: "var(--text-quaternary)", fontSize: 12 }}>—</div>
            )}
          </div>
        );
      })}
      {dragTask && drag && (
        <div style={{ position: "fixed", left: ghost.x - drag.offX, top: ghost.y - drag.offY, width: drag.w, transform: `rotate(${ghost.rot}deg) scale(1.025)`, zIndex: 80, pointerEvents: "none" }}>
          <TaskCard task={dragTask} floating nameOf={nameOf} />
        </div>
      )}
    </div>
  );
}

function TaskCard({ task: t, onOpen, selected, dragging, floating, onStartDrag, nameOf }: {
  task: WorkTask; onOpen?: (id: string) => void; selected?: boolean; dragging?: boolean; floating?: boolean;
  onStartDrag?: (e: React.PointerEvent, t: WorkTask, el: HTMLElement) => void; nameOf: (u: string | null) => string;
}) {
  const [h, setH] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isAi = t.assigned_by === "ai";
  return (
    <div ref={ref}
      onPointerDown={(e) => { if ((e.target as HTMLElement).closest("[data-no-drag]")) return; onStartDrag?.(e, t, ref.current!); }}
      onClick={() => !floating && onOpen?.(t.id)}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: "var(--bg-elevated)", border: "0.5px solid var(--border)", borderRadius: "var(--r-md)",
        padding: "9px 10px 8px", cursor: floating ? "grabbing" : "pointer", userSelect: "none",
        boxShadow: floating ? "var(--shadow-drag)" : selected ? "0 0 0 1.5px var(--text-primary)" : "var(--shadow-1)",
        opacity: dragging ? 0.35 : 1, transition: floating ? "none" : "box-shadow var(--t-quick), opacity var(--t-quick), transform var(--t-quick)",
        transform: h && !floating && !dragging ? "translateY(-1px)" : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <StatusIcon status={t.status} size={13} />
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", fontWeight: 500 }}>{t.id}</span>
        <div style={{ flex: 1 }} />
        {t.status === "blocked" && <Badge tone="red">blocked</Badge>}
        {t.priority === "urgent" && t.status !== "blocked" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: PRIORITY_META.urgent.color }} title="Urgent" />}
      </div>
      <div style={{ fontSize: 13, fontWeight: 450, lineHeight: 1.35, color: "var(--text-primary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginBottom: 9 }}>
        {t.title}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <DiscDot d={t.discipline} /><span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{DISC[t.discipline]?.label}</span>
        </span>
        <div style={{ flex: 1 }} />
        {isAi && <Badge tone="neutral" mono><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />ai</Badge>}
        {t.estimate_days != null && <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{t.estimate_days}d</span>}
        <Avatar name={nameOf(t.assignee)} size={18} />
      </div>
    </div>
  );
}

/* ───────────────────────── List view ───────────────────────── */
function ListView({ tasks, onOpen, selected, nameOf }: {
  tasks: WorkTask[]; onOpen: (id: string) => void; selected: string | null; nameOf: (u: string | null) => string;
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
            {open[col.status] && rows.map((t) => <ListRow key={t.id} t={t} onOpen={onOpen} selected={selected === t.id} nameOf={nameOf} />)}
          </div>
        );
      })}
    </div>
  );
}
function ListRow({ t, onOpen, selected, nameOf }: { t: WorkTask; onOpen: (id: string) => void; selected: boolean; nameOf: (u: string | null) => string }) {
  const [h, setH] = useState(false);
  return (
    <div onClick={() => onOpen(t.id)} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 16px", cursor: "pointer", background: selected || h ? "var(--bg-hover)" : "transparent" }}>
      <span style={{ color: "var(--text-quaternary)", opacity: h ? 1 : 0 }}><Icon name="grip" size={14} /></span>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", width: 64, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.id}</span>
      <StatusIcon status={t.status} size={14} />
      <span style={{ fontSize: 13.5, fontWeight: 450, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
      {t.status === "blocked" && <Badge tone="red">blocked</Badge>}
      {t.assigned_by === "ai" && <Badge tone="neutral" mono><span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />ai</Badge>}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, width: 84 }}>
        <DiscDot d={t.discipline} /><span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{DISC[t.discipline]?.label}</span>
      </span>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", width: 26, textAlign: "right" }}>{t.estimate_days ?? "—"}d</span>
      <Avatar name={nameOf(t.assignee)} size={18} />
    </div>
  );
}
