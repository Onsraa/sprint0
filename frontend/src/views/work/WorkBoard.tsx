import type { WorkTask, TaskStatus } from "../../lib/api";
import type { Role } from "../../app/types";
import { STATUS_COLUMNS, columnOf, provenanceTag, tasksInColumn, byProject } from "./workUtils";
import { DISCIPLINE_COLOR, RISK_COLOR } from "../../lib/relayUtils";

export function WorkBoard({ tasks, scope, role, onOpen, onMove }: {
  tasks: WorkTask[]; scope: string; role: Role; onOpen: (id: string) => void; onMove: (id: string, status: TaskStatus) => void;
}) {
  const onDropTo = (status: TaskStatus, e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    const task = tasks.find((t) => t.id === id);
    if (!task || columnOf(task.status) === status) return;
    onMove(id, status); // optimistic move + background sync + revert handled by WorkHub
  };

  const isManagerTeam = role === "manager" && scope === "team";

  return (
    <div>
      {isManagerTeam ? (
        <ManagerGrid tasks={tasks} onOpen={onOpen} onDropTo={onDropTo} />
      ) : (
        <ColumnBoard tasks={tasks} onOpen={onOpen} onDropTo={onDropTo} />
      )}
    </div>
  );
}

/* ── Standard 4-column board ─────────────────────────────────────────── */

function ColumnBoard({ tasks, onOpen, onDropTo }: {
  tasks: WorkTask[];
  onOpen: (id: string) => void;
  onDropTo: (status: TaskStatus, e: React.DragEvent) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
      {STATUS_COLUMNS.map((col) => (
        <Column
          key={col.status}
          label={col.label}
          status={col.status}
          tasks={tasksInColumn(tasks, col.status)}
          onOpen={onOpen}
          onDropTo={onDropTo}
        />
      ))}
    </div>
  );
}

function Column({ label, status, tasks, onOpen, onDropTo }: {
  label: string;
  status: TaskStatus;
  tasks: WorkTask[];
  onOpen: (id: string) => void;
  onDropTo: (status: TaskStatus, e: React.DragEvent) => void;
}) {
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => onDropTo(status, e)}
      style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span>
        <span
          className="chip"
          style={{ fontSize: 10, padding: "1px 7px", background: "var(--cream-deep)", color: "var(--ink-mute)", borderColor: "var(--line-strong)" }}
        >
          {tasks.length}
        </span>
      </div>
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} onOpen={onOpen} />
      ))}
    </div>
  );
}

/* ── Manager project × status grid ──────────────────────────────────── */

function ManagerGrid({ tasks, onOpen, onDropTo }: {
  tasks: WorkTask[];
  onOpen: (id: string) => void;
  onDropTo: (status: TaskStatus, e: React.DragEvent) => void;
}) {
  const projectMap = byProject(tasks);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px repeat(4, 1fr)", gap: 8 }}>
      {/* Header row */}
      <div />
      {STATUS_COLUMNS.map((col) => (
        <div key={col.status} style={{ fontWeight: 700, fontSize: 13, paddingBottom: 6, borderBottom: "1.5px solid var(--line)" }}>
          {col.label}
        </div>
      ))}

      {/* One row per project */}
      {Array.from(projectMap.entries()).map(([projectId, projectTasks]) => (
        <ProjectRow
          key={projectId}
          projectId={projectId}
          tasks={projectTasks}
          onOpen={onOpen}
          onDropTo={onDropTo}
        />
      ))}
    </div>
  );
}

function ProjectRow({ projectId, tasks, onOpen, onDropTo }: {
  projectId: number;
  tasks: WorkTask[];
  onOpen: (id: string) => void;
  onDropTo: (status: TaskStatus, e: React.DragEvent) => void;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", paddingTop: 6 }}>
        <span
          className="mono"
          style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-mute)", paddingTop: 2 }}
        >
          #{projectId}
        </span>
      </div>
      {STATUS_COLUMNS.map((col) => {
        const cellTasks = tasks.filter((t) => columnOf(t.status) === col.status);
        return (
          <div
            key={col.status}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDropTo(col.status, e)}
            style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 40, padding: "4px 0" }}
          >
            {cellTasks.map((t) => (
              <TaskCard key={t.id} task={t} onOpen={onOpen} />
            ))}
          </div>
        );
      })}
    </>
  );
}

/* ── TaskCard ─────────────────────────────────────────────────────────── */

function TaskCard({ task: t, onOpen }: { task: WorkTask; onOpen: (id: string) => void }) {
  const disciplineColor = DISCIPLINE_COLOR[t.discipline] ?? "var(--ink-mute)";

  if (t.redacted) {
    return (
      <div
        className="card-soft"
        onClick={() => onOpen(t.id)}
        style={{ padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}
      >
        <span
          style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0, background: disciplineColor, display: "inline-block" }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, lineHeight: 1.3 }}>{t.title}</span>
        <span
          className="chip"
          style={{ fontSize: 9, padding: "1px 6px", background: "var(--cream-deep)", color: "var(--ink-mute)", borderColor: "var(--line-strong)", whiteSpace: "nowrap" }}
        >
          {t.status}
        </span>
      </div>
    );
  }

  return (
    <div
      className="card-soft"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
      onClick={() => onOpen(t.id)}
      style={{ padding: "8px 10px", cursor: "pointer" }}
    >
      {/* Top row: discipline dot + title */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 5 }}>
        <span
          style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0, marginTop: 3, background: disciplineColor, display: "inline-block" }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, lineHeight: 1.35 }}>{t.title}</span>
      </div>

      {/* Meta row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", paddingLeft: 14 }}>
        {/* Assignee */}
        {t.assignee ? (
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-soft)" }}>@{t.assignee}</span>
        ) : (
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>unassigned</span>
        )}

        {/* Estimate */}
        {t.estimate_days != null && (
          <span style={{ fontSize: 10, color: "var(--ink-mute)" }}>est {t.estimate_days}d</span>
        )}

        {/* Risk chip */}
        {t.risk && (
          <span
            className="chip"
            style={{
              fontSize: 9,
              padding: "1px 6px",
              background: RISK_COLOR[t.risk],
              borderColor: RISK_COLOR[t.risk],
              color: "var(--paper)",
            }}
          >
            {t.risk}
          </span>
        )}

        {/* Provenance */}
        {t.assigned_by !== undefined && (
          <span
            className="chip"
            style={{ fontSize: 9, padding: "1px 6px", background: "var(--cream-deep)", color: "var(--ink-mute)", borderColor: "var(--line-strong)" }}
          >
            {provenanceTag(t.assigned_by)}
          </span>
        )}

        {/* Blocked chip */}
        {t.status === "blocked" && (
          <span
            className="chip"
            style={{ fontSize: 9, padding: "1px 6px", background: "var(--orange-deep)", borderColor: "var(--orange-deep)", color: "var(--paper)", fontWeight: 700 }}
          >
            blocked
          </span>
        )}
      </div>
    </div>
  );
}
