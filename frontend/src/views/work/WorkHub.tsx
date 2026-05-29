import { useEffect, useState } from "react";
import { useApp } from "../../app/AppContext";
import { api, type TaskStatus } from "../../lib/api";
import { WorkBoard } from "./WorkBoard";
import { WorkList } from "./WorkList";
import { WorkTimeline } from "./WorkTimeline";
import { TaskDrawer } from "./TaskDrawer";

type Mode = "board" | "list" | "timeline";

export function WorkHub() {
  const { role, tasksByScope, taskFetching, taskErr, loadTasks, invalidateTasks, patchTask, roster } = useApp();
  const [scope, setScope] = useState("me");
  const [mode, setMode] = useState<Mode>("board");
  const [selected, setSelected] = useState<string | null>(null);

  // Stale-while-revalidate: render the cached board instantly, refresh in the background each visit.
  useEffect(() => { loadTasks(scope); }, [scope, loadTasks]);

  const cached = tasksByScope[scope];
  const tasks = cached ?? [];
  const loading = cached === undefined && taskFetching === scope; // big spinner only on the first, uncached load
  const refreshing = cached !== undefined && taskFetching === scope; // subtle indicator on background refresh
  const err = taskErr;

  // Optimistic drag: move the card instantly, sync in the background, revert on failure.
  const onMove = async (id: string, status: TaskStatus) => {
    patchTask(id, { status });
    try {
      await api.setTaskStatus(id, status);
    } catch {
      invalidateTasks(scope); // server unchanged (e.g. 403) → snap back to truth
    }
  };

  const isPersonScope = scope.startsWith("user:");
  const personValue = isPersonScope ? scope.slice(5) : "";
  const title = isPersonScope
    ? (roster.find((p) => p.username === personValue)?.name ?? personValue)
    : scope === "team"
      ? "Team"
      : "My Work";

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          padding: "28px 0",
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          borderBottom: "1.5px solid var(--line)",
        }}
      >
        <div>
          <div className="kicker">Work hub{refreshing ? " · refreshing…" : ""}</div>
          <div className="display" style={{ fontSize: 36, marginTop: 6 }}>{title}</div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {(["board", "list", "timeline"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="chip"
              style={{
                textTransform: "capitalize",
                ...(mode === m
                  ? { background: "var(--ink)", color: "var(--paper)" }
                  : { cursor: "pointer" }),
              }}
            >
              {m === "board" ? "Board" : m === "list" ? "List" : "Timeline"}
            </button>
          ))}
        </div>
      </div>

      {/* Scope control */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        {(["me", "team"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className="chip"
            style={{
              textTransform: "capitalize",
              ...(scope === s
                ? { background: "var(--ink)", color: "var(--paper)" }
                : { cursor: "pointer" }),
            }}
          >
            {s === "me" ? "My work" : "Team"}
          </button>
        ))}

        {/* @person select */}
        <button
          className="chip"
          style={{
            padding: 0,
            overflow: "hidden",
            ...(isPersonScope
              ? { background: "var(--ink)", color: "var(--paper)" }
              : { cursor: "pointer" }),
          }}
        >
          <select
            value={isPersonScope ? personValue : ""}
            onChange={(e) => {
              if (e.target.value) setScope(`user:${e.target.value}`);
            }}
            style={{
              appearance: "none",
              background: "transparent",
              border: "none",
              color: isPersonScope ? "var(--paper)" : "var(--ink)",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "inherit",
              padding: "4px 10px",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value="" disabled>@person</option>
            {roster.map((m) => (
              <option key={m.username} value={m.username}>{m.name}</option>
            ))}
          </select>
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--ink-mute)", fontSize: 14, padding: 24 }}>
          <span style={{ width: 20, height: 20, borderRadius: "50%", border: "2.5px solid var(--orange)", borderTopColor: "transparent", animation: "spin-slow 0.8s linear infinite" }} />
          loading tasks…
        </div>
      ) : err ? (
        <div className="mono" style={{ fontSize: 12, color: "var(--orange-deep)", padding: 8 }}>{err}</div>
      ) : mode === "board" ? (
        <WorkBoard tasks={tasks} scope={scope} role={role} onOpen={setSelected} onMove={onMove} />
      ) : mode === "list" ? (
        <WorkList tasks={tasks} onOpen={setSelected} />
      ) : (
        <WorkTimeline tasks={tasks} onOpen={setSelected} />
      )}

      {selected != null && (
        <TaskDrawer taskId={selected} onClose={() => setSelected(null)} reload={() => loadTasks(scope)} />
      )}
    </div>
  );
}
