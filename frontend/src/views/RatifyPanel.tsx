import { useMemo, useState } from "react";
import { useApp } from "../app/AppContext";
import type { Role } from "../app/types";
import type { Discipline, Issue, Risk } from "../lib/api";
import { api } from "../lib/api";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL, planIssues, RISK_COLOR, statusStyle } from "../lib/relayUtils";

/* A discipline lead's slice of the plan. Edit issue fields inline, then pass
   the baton (approve) or request changes → POST /ratify/{discipline}. */

const ROLE_DISCIPLINE: Partial<Record<Role, Discipline>> = {
  uiux: "uiux",
  backend: "backend",
  frontend: "frontend",
  qa: "qa",
};

const RISKS: Risk[] = ["low", "medium", "high"];

export function RatifyPanel() {
  const { role, plan, planId, relay, setRelay } = useApp();
  const discipline = ROLE_DISCIPLINE[role];

  const slice = useMemo(
    () => (discipline ? planIssues(plan?.epics).filter((i) => i.discipline === discipline) : []),
    [plan, discipline],
  );

  // Local editable copy keyed by issue id.
  const [edits, setEdits] = useState<Record<string, Issue>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "changes" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!discipline || !plan || !planId) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div className="card-soft" style={{ padding: 40, textAlign: "center", border: "2px dashed var(--line-strong)" }}>
          <div className="display" style={{ fontSize: 22, marginBottom: 8 }}>
            Nothing to ratify yet.
          </div>
          <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>
            A plan draft enters the relay once a manager drops a brief. Your discipline's slice shows up here.
          </div>
        </div>
      </div>
    );
  }

  const gate = relay?.gates.find((g) => g.discipline === discipline);
  const accent = DISCIPLINE_COLOR[discipline];
  const cleared = gate?.status === "ratified" || gate?.status === "auto_passed";

  const editOf = (i: Issue): Issue => edits[i.id] ?? i;
  const patch = (i: Issue, p: Partial<Issue>) =>
    setEdits((e) => ({ ...e, [i.id]: { ...editOf(i), ...p } }));

  const submit = async (approve: boolean) => {
    setBusy(approve ? "approve" : "changes");
    setErr(null);
    try {
      const payload = slice.map(editOf);
      const next = await api.ratify(planId, discipline, { edits: payload, note, approve });
      setRelay(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div className="kicker">Ratify · {DISCIPLINE_LABEL[discipline]}</div>
          <div className="display" style={{ fontSize: 28, marginTop: 4 }}>
            Your {slice.length} {slice.length === 1 ? "issue" : "issues"}. Tune, then pass the baton.
          </div>
        </div>
        {gate && (
          <div
            className="chip"
            style={{
              background: statusStyle(gate.status).bg,
              color: statusStyle(gate.status).fg,
              borderColor: statusStyle(gate.status).border,
            }}
          >
            {statusStyle(gate.status).label}
          </div>
        )}
      </div>

      {slice.length === 0 ? (
        <div className="card-soft" style={{ padding: 28, textAlign: "center", color: "var(--ink-soft)" }}>
          No {DISCIPLINE_LABEL[discipline]} issues in this plan. Nothing to ratify — your gate auto-clears.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {slice.map((issue) => (
            <IssueEditor key={issue.id} value={editOf(issue)} accent={accent} onPatch={(p) => patch(issue, p)} />
          ))}
        </div>
      )}

      {/* Footer: note + actions */}
      <div className="card-soft" style={{ padding: 18, marginTop: 18, background: "var(--cream)" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          <span className="kicker">Note to the next runner (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. locked the auth contract, FE can mock against it"
            style={inputStyle}
          />
        </label>
        {err && (
          <div style={{ fontSize: 12, color: "var(--orange-deep)", marginBottom: 10, fontFamily: "var(--font-mono)" }}>
            {err}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={() => submit(true)}
            disabled={busy !== null || cleared}
            className="btn btn-primary btn-sm"
            style={{ opacity: busy !== null || cleared ? 0.5 : 1 }}
          >
            {busy === "approve" ? "Passing…" : cleared ? "Baton passed ✓" : "Pass the baton →"}
          </button>
          <button
            onClick={() => submit(false)}
            disabled={busy !== null}
            className="btn btn-ghost btn-sm"
            style={{ opacity: busy !== null ? 0.5 : 1 }}
          >
            {busy === "changes" ? "Sending…" : "Request changes"}
          </button>
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-mute)" }}>
            edits go to <span className="mono">/ratify/{discipline}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function IssueEditor({
  value,
  accent,
  onPatch,
}: {
  value: Issue;
  accent: string;
  onPatch: (p: Partial<Issue>) => void;
}) {
  const isBackend = value.discipline === "backend";
  return (
    <div className="card-soft" style={{ padding: 16, borderLeft: `4px solid ${accent}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span className="mono" style={{ fontSize: 12, color: "var(--ink-mute)" }}>
          {value.id}
        </span>
        <span className="chip chip-soft" style={{ fontSize: 9, padding: "1px 7px" }}>
          {value.type}
        </span>
        {value.assignee && (
          <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-mute)" }}>
            @{value.assignee}
          </span>
        )}
      </div>

      <input
        value={value.title}
        onChange={(e) => onPatch({ title: e.target.value })}
        style={{ ...inputStyle, fontWeight: 700, fontSize: 15, marginBottom: 8 }}
      />
      <textarea
        value={value.description}
        onChange={(e) => onPatch({ description: e.target.value })}
        rows={2}
        style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }}
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">Estimate (days)</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={value.estimate_days}
            onChange={(e) => onPatch({ estimate_days: parseFloat(e.target.value) || 0 })}
            style={{ ...inputStyle, width: 110 }}
          />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">Risk</span>
          <div style={{ display: "flex", gap: 4 }}>
            {RISKS.map((r) => (
              <button
                key={r}
                onClick={() => onPatch({ risk: r })}
                style={{
                  padding: "7px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "capitalize",
                  border: value.risk === r ? `1.5px solid ${RISK_COLOR[r]}` : "1.5px solid var(--line)",
                  background: value.risk === r ? RISK_COLOR[r] : "var(--cream)",
                  color: value.risk === r ? "var(--paper)" : "var(--ink-soft)",
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: isBackend ? 10 : 0 }}>
        <span className="kicker">File scope (comma-separated)</span>
        <input
          value={value.context_scope.files.join(", ")}
          onChange={(e) =>
            onPatch({
              context_scope: {
                ...value.context_scope,
                files: e.target.value
                  .split(",")
                  .map((f) => f.trim())
                  .filter(Boolean),
              },
            })
          }
          style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 12 }}
        />
      </label>

      {isBackend && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="kicker">API contract</span>
          <textarea
            value={value.api_contract ?? ""}
            onChange={(e) => onPatch({ api_contract: e.target.value || null })}
            rows={3}
            placeholder='e.g. POST /api/sessions → {token, expires_at}'
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 12, resize: "vertical" }}
          />
        </label>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  border: "1.5px solid var(--line-strong)",
  borderRadius: 8,
  fontSize: 14,
  background: "var(--paper)",
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
};
