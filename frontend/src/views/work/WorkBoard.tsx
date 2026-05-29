import type { WorkTask } from "../../lib/api";
import type { Role } from "../../app/types";

export function WorkBoard({ tasks, scope, role, onOpen, reload }: {
  tasks: WorkTask[]; scope: string; role: Role; onOpen: (id: string) => void; reload: () => void;
}) {
  void scope; void role; void reload; void onOpen;
  return <div className="card-soft" style={{ padding: 20 }}>Board — {tasks.length} tasks (stub)</div>;
}
