import type { WorkTask } from "../../lib/api";

export function WorkList({ tasks, onOpen }: { tasks: WorkTask[]; onOpen: (id: string) => void }) {
  void onOpen;
  return <div className="card-soft" style={{ padding: 20 }}>List — {tasks.length} tasks (stub)</div>;
}
