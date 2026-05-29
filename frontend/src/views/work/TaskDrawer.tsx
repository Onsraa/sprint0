import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../app/AppContext";
import { api, type WorkTask, type TaskStatus } from "../../lib/api";
import { STATUS_COLUMNS, provenanceTag } from "./workUtils";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL, RISK_COLOR } from "../../lib/relayUtils";

export function TaskDrawer({ taskId, onClose, reload }: { taskId: string; onClose: () => void; reload: () => void }) {
  const { member } = useApp();
  const me = member?.username;

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

  const runAction = async (fn: () => Promise<WorkTask>) => {
    setBusy(true);
    setActionErr(null);
    try {
      const updated = await fn();
      setDetail(updated);
      reload();
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
          background: "var(--paper)",
          borderLeft: "2px solid var(--ink)",
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
            color: "var(--ink-mute)",
            fontWeight: 700,
            padding: "2px 6px",
          }}
          title="Close"
        >
          ×
        </button>

        {loading && (
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 40 }}>
            loading…
          </div>
        )}

        {!loading && err && (
          <div className="mono" style={{ fontSize: 12, color: "var(--orange-deep)", marginTop: 40 }}>
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
                <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>
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
                </div>

                {/* Field rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                  <FieldRow label="assignee">
                    <span className="mono" style={{ fontSize: 13 }}>
                      {detail.assignee ? `@${detail.assignee}` : <span style={{ color: "var(--ink-mute)" }}>unassigned</span>}
                    </span>
                  </FieldRow>

                  <FieldRow label="provenance">
                    <span className="mono" style={{ fontSize: 12, color: "var(--ink-soft)" }}>
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
                      <span style={{ color: "var(--ink-mute)", fontSize: 13 }}>—</span>
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
                      <span style={{ color: "var(--ink-mute)", fontSize: 13 }}>—</span>
                    )}
                  </FieldRow>

                  <FieldRow label="start">
                    <span style={{ fontSize: 13, color: detail.scheduled_start ? "var(--ink)" : "var(--ink-mute)" }}>
                      {detail.scheduled_start ?? "—"}
                    </span>
                  </FieldRow>

                  <FieldRow label="end">
                    <span style={{ fontSize: 13, color: detail.scheduled_end ? "var(--ink)" : "var(--ink-mute)" }}>
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
                        color: "var(--orange)",
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
                        color: "var(--ink-soft)",
                        background: "var(--cream)",
                        borderRadius: 8,
                        padding: "10px 12px",
                        border: "1px solid var(--line)",
                      }}
                    >
                      {detail.description}
                    </div>
                  </div>
                )}

                {/* Status control */}
                <div style={{ marginBottom: 20 }}>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--ink-mute)",
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
                            border: active ? "1.5px solid var(--orange)" : "1.5px solid var(--line-strong)",
                            background: active ? "var(--orange-soft)" : "var(--cream)",
                            color: active ? "var(--orange-deep)" : "var(--ink-soft)",
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

                {/* Claim / Release */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                  {me && detail.assignee !== me && (
                    <button
                      onClick={() => runAction(() => api.claimTask(taskId))}
                      disabled={busy}
                      className="btn btn-primary btn-sm"
                      style={{ opacity: busy ? 0.5 : 1 }}
                    >
                      {busy ? "…" : "Claim"}
                    </button>
                  )}
                  {detail.assignee === me && (
                    <button
                      onClick={() => runAction(() => api.releaseTask(taskId))}
                      disabled={busy}
                      className="btn btn-ghost btn-sm"
                      style={{ opacity: busy ? 0.5 : 1 }}
                    >
                      {busy ? "…" : "Release"}
                    </button>
                  )}
                </div>

                {actionErr && (
                  <div className="mono" style={{ fontSize: 11, color: "var(--orange-deep)" }}>
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
    planned:     { bg: "var(--cream-deep)",   fg: "var(--ink-mute)" },
    in_progress: { bg: "var(--info)",          fg: "var(--paper)" },
    in_review:   { bg: "var(--warn)",          fg: "var(--paper)" },
    done:        { bg: "var(--positive)",      fg: "var(--paper)" },
    blocked:     { bg: "var(--orange-deep)",   fg: "var(--paper)" },
  };
  const s = map[status] ?? { bg: "var(--cream-deep)", fg: "var(--ink-mute)" };
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
          color: "var(--orange)",
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
