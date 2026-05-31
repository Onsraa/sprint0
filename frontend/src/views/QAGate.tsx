import { useState } from "react";
import { useUI } from "../lib/store";
import type { QAItemResult, QAReport, QAVerdict } from "../lib/api";
import { api } from "../lib/api";

/* QA acceptance gate: run the agent-prefilled checklist, then reject failing
   items back to the responsible runner (reopens the GitLab issue + flags re-QA). */

const VERDICT: Record<QAVerdict, { label: string; fg: string; bg: string; icon: string }> = {
  pass: { label: "Pass", fg: "var(--bg-elevated)", bg: "var(--green)", icon: "✓" },
  fail: { label: "Fail", fg: "var(--bg-elevated)", bg: "var(--text-primary)", icon: "✕" },
  needs_human: { label: "Needs human", fg: "var(--bg-elevated)", bg: "var(--amber)", icon: "?" },
};

export function QAGate() {
  const liveProjectId = useUI((s) => s.liveProjectId);
  const [report, setReport] = useState<QAReport | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState<number[]>([]);

  const run = async () => {
    if (liveProjectId == null) return;
    setRunning(true);
    setErr(null);
    try {
      const r = await api.qaRun(liveProjectId);
      setReport(r);
      setAwaiting(r.reopened ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  if (liveProjectId == null) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div className="card-soft" style={{ padding: 40, textAlign: "center", border: "2px dashed var(--border-strong)" }}>
          <div className="display" style={{ fontSize: 22, marginBottom: 8 }}>
            No dispatched project to QA.
          </div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            Once a plan is dispatched to GitLab, the acceptance checklist runs against it here.
          </div>
        </div>
      </div>
    );
  }

  const pass = report?.items.filter((i) => i.verdict === "pass").length ?? 0;
  const total = report?.items.length ?? 0;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div className="kicker">QA gate · project {liveProjectId}</div>
          <div className="display" style={{ fontSize: 28, marginTop: 4 }}>
            {report ? `${pass}/${total} acceptance checks pass.` : "Run the acceptance checklist."}
          </div>
        </div>
        <button onClick={run} disabled={running} className="btn btn-primary btn-sm" style={{ opacity: running ? 0.6 : 1 }}>
          {running ? "Running…" : report ? "Re-run QA" : "Run QA →"}
        </button>
      </div>

      {err && (
        <div className="card-soft" style={{ padding: 14, marginBottom: 14, borderColor: "var(--ink-fill)", color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
          {err}
        </div>
      )}

      {awaiting.length > 0 && (
        <div className="card-soft" style={{ padding: 14, marginBottom: 14, background: "var(--bg-hover)", borderColor: "var(--bg-secondary)" }}>
          <span className="kicker" style={{ color: "var(--text-primary)" }}>Awaiting re-QA</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {awaiting.map((iid) => (
              <span key={iid} className="chip chip-soft" style={{ fontSize: 11 }}>
                #{iid}
              </span>
            ))}
          </div>
        </div>
      )}

      {!report && !running && (
        <div className="card-soft" style={{ padding: 28, textAlign: "center", color: "var(--text-secondary)" }}>
          The QA agent prefills a pass/fail/needs-human verdict per issue. Reject any failing item to reopen it.
        </div>
      )}

      {report && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {report.items.map((item) => (
            <QAItemRow key={item.issue_id} item={item} projectId={liveProjectId} onRejected={setAwaiting} />
          ))}
        </div>
      )}
    </div>
  );
}

function QAItemRow({
  item,
  projectId,
  onRejected,
}: {
  item: QAItemResult;
  projectId: number;
  onRejected: (iids: number[]) => void;
}) {
  const v = VERDICT[item.verdict];
  const [open, setOpen] = useState(false);
  const [iid, setIid] = useState("");
  const [comment, setComment] = useState("");
  const [runner, setRunner] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reject = async () => {
    const n = parseInt(iid, 10);
    if (!n || !comment.trim()) {
      setErr("GitLab issue iid and a comment are required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api.rejectIssue(projectId, n, {
        comment,
        to_runner: runner.trim() || undefined,
      });
      onRejected(res.awaiting_reqa);
      setDone(true);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rejectable = item.verdict !== "pass";

  return (
    <div className="card-soft" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: v.bg,
            color: v.fg,
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          {v.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              {item.issue_id}
            </span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{item.title}</span>
          </div>
          {item.note && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{item.note}</div>}
        </div>
        <span className="chip" style={{ background: v.bg, color: v.fg, borderColor: v.bg, fontSize: 11 }}>
          {v.label}
        </span>
        {rejectable && !done && (
          <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost btn-sm">
            {open ? "Cancel" : "Reject →"}
          </button>
        )}
        {done && (
          <span className="chip" style={{ fontSize: 10, padding: "3px 8px", color: "var(--text-tertiary)" }}>
            rerouted ✓
          </span>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={iid}
              onChange={(e) => setIid(e.target.value)}
              placeholder="GitLab issue iid"
              style={{ ...inputStyle, width: 150 }}
            />
            <input
              value={runner}
              onChange={(e) => setRunner(e.target.value)}
              placeholder="reroute to runner (optional)"
              style={{ ...inputStyle, flex: 1, minWidth: 180 }}
            />
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="What failed? (posted as a GitLab note)"
            style={{ ...inputStyle, resize: "vertical" }}
          />
          {err && <div style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{err}</div>}
          <button onClick={reject} disabled={busy} className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Rejecting…" : "Reopen + reroute"}
          </button>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  border: "1.5px solid var(--border-strong)",
  borderRadius: 8,
  fontSize: 14,
  background: "var(--bg-elevated)",
  fontFamily: "inherit",
};
