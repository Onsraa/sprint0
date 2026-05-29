export function TaskDrawer({ taskId, onClose, reload }: { taskId: string; onClose: () => void; reload: () => void }) {
  void reload;
  return <div onClick={onClose} style={{ position: "fixed", inset: 0 }}>Drawer {taskId} (stub)</div>;
}
