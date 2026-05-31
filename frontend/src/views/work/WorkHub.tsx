import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/AppContext";
import { useUI } from "../../lib/store";
import { qk } from "../../lib/query";
import { type TaskStatus, type WorkTask, type RescheduleStrategy } from "../../lib/api";
import { useWork, useSetTaskStatus, patchTasksInCache } from "../../features/work/useWork";
import { Icon } from "../../lib/icon";
import { WorkBoard } from "./WorkBoard";
import { WorkList } from "./WorkList";
import { WorkTimeline } from "./WorkTimeline";
import { TaskDrawer } from "./TaskDrawer";
import { WorkEventControl } from "./WorkEventControl";

type Mode = "board" | "list" | "timeline";

export function WorkHub() {
  const { role, roster } = useApp();           // role + roster stay on the bridge (not the task cache)
  const qc = useQueryClient();
  const [scope, setScope] = useState("me");
  const [mode, setMode] = useState<Mode>("board");
  const [reflowMsg, setReflowMsg] = useState<string | null>(null);
  const panelTaskId = useUI((s) => s.panelTaskId);
  const openPanel = useUI((s) => s.openPanel);
  const closePanel = useUI((s) => s.closePanel);

  // TanStack Query: stale-while-revalidate by scope (replaces tasksByScope + loadTasks).
  const { data: tasks = [], isLoading, isFetching, error } = useWork(scope);
  const refreshing = isFetching && !isLoading;
  const err = error instanceof Error ? error.message : null;
  const setStatus = useSetTaskStatus();

  // Optimistic drag: cross-scope patch now, sync in the background, revert on failure (in the hook).
  const onMove = (id: string, status: TaskStatus) => setStatus.mutate({ id, status });

  // Reflow result is already persisted server-side — patch it straight into the cache.
  const onReflow = (moved: WorkTask[], strategy: RescheduleStrategy | null) => {
    patchTasksInCache(qc, moved);
    if (moved.length) setMode("timeline");
    setReflowMsg(
      moved.length
        ? `${moved.length} task${moved.length === 1 ? "" : "s"} re-flowed instantly` +
            (strategy ? ` · AI strategist: ${strategy.action}${strategy.action === "right_shift" ? " (auto-applied)" : " (proposed in Inbox)"}` : "")
        : strategy
          ? `No dates moved · AI strategist chose ${strategy.action} (proposed in Inbox)`
          : "No change",
    );
  };

  const isPersonScope = scope.startsWith("user:");
  const personValue = isPersonScope ? scope.slice(5) : "";
  const title = isPersonScope
    ? (roster.find((p) => p.username === personValue)?.name ?? personValue)
    : scope === "team" ? "Team" : "My Work";

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ padding: "28px 0", marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "0.5px solid var(--border)" }}>
        <div>
          <div className="kicker">Work hub{refreshing ? " · refreshing…" : ""}</div>
          <div className="display" style={{ fontSize: 36, marginTop: 6 }}>{title}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["board", "list", "timeline"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className="chip"
              style={{ textTransform: "capitalize", ...(mode === m ? { background: "var(--ink-fill)", color: "var(--bg-elevated)", borderColor: "var(--ink-fill)" } : { cursor: "pointer" }) }}>
              {m === "board" ? "Board" : m === "list" ? "List" : "Timeline"}
            </button>
          ))}
        </div>
      </div>

      {/* Scope control */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        {(["me", "team"] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)} className="chip"
            style={{ textTransform: "capitalize", ...(scope === s ? { background: "var(--ink-fill)", color: "var(--bg-elevated)", borderColor: "var(--ink-fill)" } : { cursor: "pointer" }) }}>
            {s === "me" ? "My work" : "Team"}
          </button>
        ))}
        <button className="chip" style={{ padding: 0, overflow: "hidden", ...(isPersonScope ? { background: "var(--ink-fill)", color: "var(--bg-elevated)", borderColor: "var(--ink-fill)" } : { cursor: "pointer" }) }}>
          <select value={isPersonScope ? personValue : ""} onChange={(e) => { if (e.target.value) setScope(`user:${e.target.value}`); }}
            style={{ appearance: "none", background: "transparent", border: "none", color: isPersonScope ? "var(--bg-elevated)" : "var(--text-primary)", fontSize: 12, fontWeight: 500, fontFamily: "inherit", padding: "4px 10px", cursor: "pointer", outline: "none" }}>
            <option value="" disabled>@person</option>
            {roster.map((m) => (<option key={m.username} value={m.username}>{m.name}</option>))}
          </select>
        </button>
        <WorkEventControl roster={roster} tasks={tasks} onReflow={onReflow} />
      </div>

      {reflowMsg && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, padding: "10px 14px", background: "var(--bg-secondary)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)", fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Icon name="calendar" size={15} /> {reflowMsg}</span>
          <button onClick={() => setReflowMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", display: "inline-flex" }}>
            <Icon name="close" size={15} />
          </button>
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--text-tertiary)", fontSize: 14, padding: 24 }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--border-strong)", borderTopColor: "var(--text-primary)", animation: "spin-slow 0.8s linear infinite" }} />
          loading tasks…
        </div>
      ) : err ? (
        <div className="mono" style={{ fontSize: 12, color: "var(--red)", padding: 8 }}>{err}</div>
      ) : mode === "board" ? (
        <WorkBoard tasks={tasks} scope={scope} role={role} onOpen={openPanel} onMove={onMove} />
      ) : mode === "list" ? (
        <WorkList tasks={tasks} onOpen={openPanel} />
      ) : (
        <WorkTimeline tasks={tasks} onOpen={openPanel} />
      )}

      {panelTaskId != null && (
        <TaskDrawer taskId={panelTaskId} onClose={closePanel} reload={() => qc.invalidateQueries({ queryKey: qk.work(scope) })} />
      )}
    </div>
  );
}
