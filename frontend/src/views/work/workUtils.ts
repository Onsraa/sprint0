import type { TaskStatus, WorkTask } from "../../lib/api";

/** The 4 board columns (spec). `blocked` has no column → shown in Planned with a badge. */
export const STATUS_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "planned", label: "Planned" },
  { status: "in_progress", label: "In progress" },
  { status: "in_review", label: "In review" },
  { status: "done", label: "Done" },
];

/** Which column a task renders in (blocked folds into Planned). */
export function columnOf(status: TaskStatus): TaskStatus {
  return status === "blocked" ? "planned" : status;
}

/** AI vs self vs a named reassigner → short tag. */
export function provenanceTag(assignedBy: string | undefined): string {
  if (!assignedBy || assignedBy === "ai") return "AI";
  if (assignedBy === "self") return "self";
  return `@${assignedBy}`;
}

export function tasksInColumn(tasks: WorkTask[], col: TaskStatus): WorkTask[] {
  return tasks.filter((t) => columnOf(t.status) === col);
}

export function byProject(tasks: WorkTask[]): Map<number, WorkTask[]> {
  const m = new Map<number, WorkTask[]>();
  for (const t of tasks) {
    const arr = m.get(t.project_id) ?? [];
    arr.push(t);
    m.set(t.project_id, arr);
  }
  return m;
}
