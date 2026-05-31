import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "../../features/auth/useAuth";
import { useRoster } from "../../features/roster/useRoster";
import { patchTaskInCache } from "../../features/work/useWork";
import { api, type WorkTask, type TaskStatus } from "../../lib/api";
import { STATUS_COLUMNS, provenanceTag } from "./workUtils";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL, RISK_COLOR } from "../../lib/relayUtils";
import { KindSurface } from "../KindSurface";

export function TaskDrawer({ taskId, onClose, reload }: { taskId: string; onClose: () => void; reload: () => void }) {
  const { member } = useMe();
  const roster = useRoster();
  const qc = useQueryClient();
  const me = member?.username;
  const isManager = member?.role === "manager";

  const [detail, setDetail] = useState<WorkTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setErr(null);
    api
      .task(taskId)
      .then((t) => setDetail(t))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => {
    setDetail(null);
    setActionErr(null);
    refetch();
  }, [taskId, refetch]);

  const runAction = async (fn: () => Promise<WorkTask>, reschedules = false) => {
    setBusy(true);
    setActionErr(null);
    try {
      const updated = await fn();
      setDetail(updated);
      // Update the board behind in place — no cache clear, no blank.
      patchTaskInCache(qc, updated.id, { status: updated.status, assignee: updated.assignee, assigned_by: updated.assigned_by });
      if (reschedules) reload(); // assignment changed → re-pack the calendar (silent SWR refetch)
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
      refetch();
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = (status: TaskStatus) => {
    if (busy || detail?.status === status) return;
    runAction(() => api.setTaskStatus(taskId, status));
  };

  const togglePin = async () => {
    if (busy || !detail) return;
    setBusy(true);
    setActionErr(null);
    try {
      const updated = await api.pinTask(taskId, !detail.pinned);
      setDetail(updated);
      patchTaskInCache(qc, updated.id, { pinned: updated.pinned }); // board/timeline reflect the lock instantly
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
      refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(26,20,16,0.4)", zIndex: 200 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          height: "100vh",
          width: 420,
          maxWidth: "92vw",
          background: "var(--bg-elevated)",
          borderLeft: "2px solid var(--text-primary)",
          overflow: "auto",
          padding: 24,
        }}
      >
        {/* × close */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "none",
            border: "none",
            fontSize: 20,
            lineHeight: 1,
            cursor: "pointer",
            color: "var(--text-tertiary)",
            fontWeight: 700,
            padding: "2px 6px",
          }}
          title="Close"
        >
          ×
        </button>

        {loading && (
          <div className="mono" style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 40 }}>
            loading…
          </div>
        )}

        {!loading && err && (
          <div className="mono" style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 40 }}>
            {err}
          </div>
        )}

        {!loading && !err && detail && (
          <>
            {/* Title */}
            <div style={{ paddingRight: 32, marginBottom: 16, marginTop: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.35 }}>{detail.title}</div>
            </div>

            {detail.redacted ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <StatusChip status={detail.status} />
                </div>
                <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
                  You don't have access to this task's detail.
                </div>
              </>
            ) : (
              <>
                {/* Status chip + discipline */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
                  <StatusChip status={detail.status} />
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      fontWeight: 700,
                      color: DISCIPLINE_COLOR[detail.discipline],
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: DISCIPLINE_COLOR[detail.discipline],
                        display: "inline-block",
                      }}
                    />
                    {DISCIPLINE_LABEL[detail.discipline]}
                  </span>
                  {detail.pinned && (
                    <span
                      className="chip"
                      style={{ fontSize: 11, padding: "2px 9px", background: "var(--bg-secondary)", color: "var(--text-primary)", borderColor: "var(--ink-fill)" }}
                      title="Locked — the reflow engine will not move this task"
                    >
                      📌 pinned
                    </span>
                  )}
                </div>

                {/* Field rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                  <FieldRow label="assignee">
                    <span className="mono" style={{ fontSize: 13 }}>
                      {detail.assignee ? `@${detail.assignee}` : <span style={{ color: "var(--text-tertiary)" }}>unassigned</span>}
                    </span>
                  </FieldRow>

                  <FieldRow label="provenance">
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {provenanceTag(detail.assigned_by)}
                    </span>
                  </FieldRow>

                  {detail.estimate_days != null && (
                    <FieldRow label="estimate">
                      <span style={{ fontSize: 13 }}>{detail.estimate_days}d</span>
                    </FieldRow>
                  )}

                  {detail.risk && (
                    <FieldRow label="risk">
                      <span
                        className="chip"
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          color: RISK_COLOR[detail.risk],
                          borderColor: RISK_COLOR[detail.risk],
                        }}
                      >
                        {detail.risk}
                      </span>
                    </FieldRow>
                  )}

                  <FieldRow label="depends on">
                    {detail.depends_on && detail.depends_on.length > 0 ? (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {detail.depends_on.map((d) => (
                          <span key={d} className="chip mono" style={{ fontSize: 10, padding: "2px 7px" }}>
                            {d}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>—</span>
                    )}
                  </FieldRow>

                  <FieldRow label="files">
                    {detail.context_scope?.files && detail.context_scope.files.length > 0 ? (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {detail.context_scope.files.map((f) => (
                          <span key={f} className="chip mono" style={{ fontSize: 10, padding: "2px 7px" }}>
                            {f}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>—</span>
                    )}
                  </FieldRow>

                  <FieldRow label="start">
                    <span style={{ fontSize: 13, color: detail.scheduled_start ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                      {detail.scheduled_start ?? "—"}
                    </span>
                  </FieldRow>

                  <FieldRow label="end">
                    <span style={{ fontSize: 13, color: detail.scheduled_end ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                      {detail.scheduled_end ?? "—"}
                    </span>
                  </FieldRow>
                </div>

                {/* Description */}
                {detail.description && (
                  <div style={{ marginBottom: 20 }}>
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: "var(--ink-fill)",
                        fontWeight: 800,
                        textTransform: "uppercase",
                        marginBottom: 6,
                      }}
                    >
                      description
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        lineHeight: 1.55,
                        color: "var(--text-secondary)",
                        background: "var(--bg-app)",
                        borderRadius: 8,
                        padding: "10px 12px",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {detail.description}
                    </div>
                  </div>
                )}

                {/* Kind-specific execution surface (shared component — same as dev view + ratify panel) */}
                {!detail.redacted && (
                  <div style={{ marginBottom: 20 }}>
                    <KindSurface work={detail} />
                  </div>
                )}

                {/* Status control */}
                <div style={{ marginBottom: 20 }}>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--text-tertiary)",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    set status
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {STATUS_COLUMNS.map(({ status, label }) => {
                      const active = detail.status === status;
                      return (
                        <button
                          key={status}
                          onClick={() => handleStatusChange(status)}
                          disabled={busy}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            border: active ? "1.5px solid var(--ink-fill)" : "1.5px solid var(--border-strong)",
                            background: active ? "var(--bg-secondary)" : "var(--bg-app)",
                            color: active ? "var(--text-primary)" : "var(--text-secondary)",
                            cursor: busy ? "not-allowed" : "pointer",
                            opacity: busy && !active ? 0.5 : 1,
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Assignment — dev claims unassigned in-discipline; owner releases; mgr/lead reassign */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                  {detail.assignee == null && !isManager && member?.discipline === detail.discipline && (
                    <button
                      onClick={() => runAction(() => api.claimTask(taskId), true)}
                      disabled={busy}
                      className="btn btn-primary btn-sm"
                      style={{ opacity: busy ? 0.5 : 1 }}
                    >
                      {busy ? "…" : "Claim"}
                    </button>
                  )}
                  {detail.assignee === me && (
                    <button
                      onClick={() => runAction(() => api.releaseTask(taskId), true)}
                      disabled={busy}
                      className="btn btn-ghost btn-sm"
                      style={{ opacity: busy ? 0.5 : 1 }}
                    >
                      {busy ? "…" : "Release"}
                    </button>
                  )}
                  {(isManager || member?.discipline === detail.discipline) && (
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="mono" style={{ fontSize: 10, color: "var(--text-tertiary)", fontWeight: 800, textTransform: "uppercase" }}>
                        reassign
                      </span>
                      <select
                        value={detail.assignee ?? ""}
                        disabled={busy}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === (detail.assignee ?? "")) return;
                          if (
                            (detail.status === "in_progress" || detail.status === "in_review") &&
                            !window.confirm(`${detail.assignee ?? "Someone"} is mid-work on this — reassign anyway?`)
                          ) {
                            return; // controlled select reverts on the next render
                          }
                          runAction(() => api.reassignTask(taskId, v), true);
                        }}
                        style={{
                          padding: "5px 9px",
                          border: "1.5px solid var(--border-strong)",
                          borderRadius: 8,
                          fontSize: 12,
                          background: "var(--bg-elevated)",
                          fontFamily: "inherit",
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        <option value="">— Unassign —</option>
                        {roster.filter((m) => m.role === "developer").map((m) => (
                          <option key={m.username} value={m.username}>{m.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {(isManager || detail.assignee === me) && (
                    <button
                      onClick={togglePin}
                      disabled={busy}
                      title={detail.pinned ? "Unlock — let the reflow engine reschedule this" : "Lock these dates — the reflow engine never moves this task"}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                        border: detail.pinned ? "1.5px solid var(--ink-fill)" : "1.5px solid var(--border-strong)",
                        background: detail.pinned ? "var(--bg-secondary)" : "var(--bg-app)",
                        color: detail.pinned ? "var(--text-primary)" : "var(--text-secondary)",
                        cursor: busy ? "not-allowed" : "pointer",
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      {detail.pinned ? "📌 Pinned" : "📌 Pin dates"}
                    </button>
                  )}
                </div>

                {actionErr && (
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-primary)" }}>
                    {actionErr}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    planned:     { bg: "var(--bg-secondary)",   fg: "var(--text-tertiary)" },
    in_progress: { bg: "var(--blue)",          fg: "var(--bg-elevated)" },
    in_review:   { bg: "var(--amber)",          fg: "var(--bg-elevated)" },
    done:        { bg: "var(--green)",      fg: "var(--bg-elevated)" },
    blocked:     { bg: "var(--text-primary)",   fg: "var(--bg-elevated)" },
  };
  const s = map[status] ?? { bg: "var(--bg-secondary)", fg: "var(--text-tertiary)" };
  return (
    <span
      className="chip"
      style={{ fontSize: 11, padding: "2px 9px", background: s.bg, color: s.fg, borderColor: s.bg }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--ink-fill)",
          fontWeight: 800,
          textTransform: "uppercase",
          minWidth: 80,
          paddingTop: 2,
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
