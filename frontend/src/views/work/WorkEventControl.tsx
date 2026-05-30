import { useState, type CSSProperties, type ReactNode } from "react";
import { api, type Member, type WorkTask, type RescheduleStrategy } from "../../lib/api";

/** "Simulate change" control for the Work hub: post a calendar/work change event, then hand the
 *  re-flowed tasks back so the parent patches them into the cache → the Gantt re-flows instantly. */
type Kind = "sick" | "estimate_change" | "spec_change";

export function WorkEventControl({
  roster,
  tasks,
  onReflow,
}: {
  roster: Member[];
  tasks: WorkTask[];
  onReflow: (moved: WorkTask[], strategy: RescheduleStrategy | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("sick");
  const [user, setUser] = useState("");
  const [taskId, setTaskId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [estimate, setEstimate] = useState("8");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const devs = roster.filter((m) => m.role === "developer");
  const scheduled = tasks.filter((t) => t.scheduled_start && t.assignee);

  const valid =
    kind === "sick" ? Boolean(user && start) : kind === "estimate_change" ? Boolean(taskId) && Number(estimate) > 0 : Boolean(taskId);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body =
        kind === "sick"
          ? { kind, user_id: user, start, end: end || start }
          : kind === "estimate_change"
            ? { kind, task_id: taskId, payload: { new: Number(estimate) } }
            : { kind: "spec_change", task_id: taskId, payload: { note } };
      const res = await api.postEvent(body);
      onReflow(res.reflowed, res.strategy);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "relative", marginLeft: "auto" }}>
      <button
        className="chip"
        style={{ cursor: "pointer", background: "var(--orange-soft)", color: "var(--orange-deep)", borderColor: "var(--orange)", fontWeight: 700 }}
        onClick={() => setOpen((o) => !o)}
        title="Simulate a calendar or work change and watch the schedule re-flow"
      >
        ⚡ Simulate change
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            zIndex: 50,
            width: 320,
            background: "var(--paper)",
            border: "1.5px solid var(--ink)",
            borderRadius: 10,
            padding: 16,
            boxShadow: "0 8px 28px rgba(26,20,16,0.18)",
          }}
        >
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {([["sick", "Sick"], ["estimate_change", "Re-estimate"], ["spec_change", "Spec change"]] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className="chip"
                style={{ fontSize: 11, cursor: "pointer", ...(kind === k ? { background: "var(--ink)", color: "var(--paper)" } : {}) }}
              >
                {label}
              </button>
            ))}
          </div>

          {kind === "sick" ? (
            <>
              <Label>person</Label>
              <Select value={user} onChange={setUser} options={[["", "— pick —"], ...devs.map((d) => [d.username, d.name] as [string, string])]} />
              <Label>from</Label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} />
              <Label>to (optional)</Label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} />
            </>
          ) : (
            <>
              <Label>task</Label>
              <Select
                value={taskId}
                onChange={setTaskId}
                options={[["", "— pick —"], ...scheduled.map((t) => [t.id, `${t.id} · ${t.title.slice(0, 22)}`] as [string, string])]}
              />
              {kind === "estimate_change" ? (
                <>
                  <Label>new estimate (days)</Label>
                  <input type="number" min={1} value={estimate} onChange={(e) => setEstimate(e.target.value)} style={inputStyle} />
                </>
              ) : (
                <>
                  <Label>what changed</Label>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. auth contract → JWT" style={inputStyle} />
                </>
              )}
            </>
          )}

          {err && <div className="mono" style={{ fontSize: 11, color: "var(--orange-deep)", marginTop: 8 }}>{err}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={!valid || busy} style={{ opacity: !valid || busy ? 0.5 : 1 }} onClick={submit}>
              {busy ? "Re-flowing…" : "Apply event"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "6px 9px",
  border: "1.5px solid var(--line-strong)",
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "inherit",
  marginBottom: 8,
  boxSizing: "border-box",
};

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="mono" style={{ fontSize: 10, color: "var(--orange)", fontWeight: 800, textTransform: "uppercase", marginBottom: 4 }}>
      {children}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
