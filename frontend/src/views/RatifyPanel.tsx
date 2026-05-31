import { useMemo, useState } from "react";
import { useMe } from "../features/auth/useAuth";
import { useUI } from "../lib/store";
import { useView } from "../features/nav/nav";
import { useProjects } from "../features/projects/useProjects";
import type { Issue, Risk } from "../lib/api";
import { useRelay, useDecisionCard, useRatifyGate } from "../features/relay/useRelay";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL, planIssues, RISK_COLOR, statusStyle } from "../lib/relayUtils";
import { KindSurface } from "./KindSurface";

/* A discipline lead's slice of the plan. Edit issue fields inline, then pass
   the baton (approve) or request changes → POST /ratify/{discipline}.
   The server returns 403 unless the caller is this discipline's lead or the
   manager — that error surfaces in the footer. */

const RISKS: Risk[] = ["low", "medium", "high"];

const SIGNAL_COLOR: Record<string, string> = { green: "var(--green)", orange: "var(--amber)", grey: "var(--border-strong)" };

/** A scoped file is "existing" if it's already in the target repo's module manifest, else "new". */
const fileStatus = (file: string, manifest: string[]): "existing" | "new" =>
  manifest.includes(file) ? "existing" : "new";

export function RatifyPanel() {
  const { discipline } = useMe();
  const activeGate = useUI((s) => s.activeGate);
  const plan = useUI((s) => s.plan);
  const planId = useUI((s) => s.planId);
  const featureProjectId = useUI((s) => s.featureProjectId);
  const { setView } = useView();
  const { projects } = useProjects();

  // The gate being ratified. A lead ratifies their own discipline; a manager
  // opens an orphan gate from the queue, which sets `activeGate`.
  const target = activeGate ?? discipline;
  const { data: relay } = useRelay(planId);
  const { data: card } = useDecisionCard(planId, target); // System 2 — cached query (best-effort)
  const ratifyGate = useRatifyGate(planId ?? "");

  const slice = useMemo(
    () => (target ? planIssues(plan?.epics).filter((i) => i.discipline === target) : []),
    [plan, target],
  );

  // Local editable copy keyed by issue id.
  const [edits, setEdits] = useState<Record<string, Issue>>({});
  const [note, setNote] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [busy, setBusy] = useState<"approve" | "changes" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deviated, setDeviated] = useState(false);

  if (!target || !plan || !planId) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div className="card-soft" style={{ padding: 40, textAlign: "center", border: "2px dashed var(--border-strong)" }}>
          <div className="display" style={{ fontSize: 22, marginBottom: 8 }}>
            Nothing to ratify yet.
          </div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            A plan draft enters the relay once a manager drops a brief. Your discipline's slice shows up here.
          </div>
        </div>
      </div>
    );
  }

  const gate = relay?.gates.find((g) => g.discipline === target);
  const accent = DISCIPLINE_COLOR[target];
  const cleared = gate?.status === "ratified" || gate?.status === "auto_passed";

  // Files already in the delta target's repo (feature mode); a fresh project has no repo → all new.
  const manifest =
    (featureProjectId != null ? projects.find((p) => p.project_id === featureProjectId)?.module_manifest : undefined) ?? [];

  const editOf = (i: Issue): Issue => edits[i.id] ?? i;
  const patch = (i: Issue, p: Partial<Issue>) =>
    setEdits((e) => ({ ...e, [i.id]: { ...editOf(i), ...p } }));

  const submit = async (approve: boolean) => {
    setBusy(approve ? "approve" : "changes");
    setErr(null);
    try {
      await ratifyGate.mutateAsync({
        discipline: target,
        body: {
          edits: slice.map(editOf), note, approve, reasoning,
          ai_recommendation: card?.card?.recommendation ?? "",
          ai_confidence: card?.card?.confidence ?? null,
          deviated, deviation_reason: deviated ? reasoning : "",
        },
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <button
        onClick={() => setView("queue")}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 12 }}
      >
        ← Back to queue
      </button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div className="kicker">Ratify · {DISCIPLINE_LABEL[target]}</div>
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

      {/* Decision Card — two-pass adversarial AI evaluation (System 2) */}
      {card?.card && (
        <div className="card-soft" style={{ padding: 14, marginBottom: 14, borderColor: SIGNAL_COLOR[card.signal] }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: SIGNAL_COLOR[card.signal], display: "inline-block" }} />
            <span className="kicker">AI evaluation</span>
            <span style={{ color: "var(--text-tertiary)" }}>{card.card.confidence}% confidence</span>
            {card.low_confidence && (
              <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>⚠ AI uncertain — your judgment is primary</span>
            )}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, marginTop: 6 }}>{card.card.recommendation}</div>
          <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap", fontSize: 12 }}>
            {card.card.pros.length > 0 && <div><b style={{ color: "var(--green)" }}>+ </b>{card.card.pros.join(" · ")}</div>}
            {card.card.cons.length > 0 && <div><b style={{ color: "var(--text-primary)" }}>− </b>{card.card.cons.join(" · ")}</div>}
          </div>
          {card.signal === "orange" && card.card.conflict_reason && (
            <div style={{ marginTop: 8, padding: "6px 10px", background: "var(--bg-secondary)", borderRadius: 8, fontSize: 12, color: "var(--text-primary)" }}>
              ⚠ Conflicts with a past decision: {card.card.conflict_reason}
            </div>
          )}
          {[...card.past.own, ...card.past.team].length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
              <span className="kicker">Past decisions</span>
              {[...card.past.own, ...card.past.team].slice(0, 3).map((d) => (
                <div key={d.id} style={{ marginTop: 2 }}>
                  <b>@{d.owner_id}</b> ({d.project_name}): {d.recommendation} — {d.reasoning}
                </div>
              ))}
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12 }}>
            <input type="checkbox" checked={deviated} onChange={(e) => setDeviated(e.target.checked)} />
            I'm overriding the AI recommendation{deviated ? " — say why in the reasoning field below" : ""}
          </label>
        </div>
      )}

      {slice.length === 0 ? (
        <div className="card-soft" style={{ padding: 28, textAlign: "center", color: "var(--text-secondary)" }}>
          No {DISCIPLINE_LABEL[target]} issues in this plan. Nothing to ratify — your gate auto-clears.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {slice.map((issue) => (
            <div key={issue.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <IssueEditor value={editOf(issue)} accent={accent} manifest={manifest} onPatch={(p) => patch(issue, p)} />
              <KindSurface work={editOf(issue)} />
            </div>
          ))}
        </div>
      )}

      {/* Footer: note + actions */}
      <div className="card-soft" style={{ padding: 18, marginTop: 18, background: "var(--bg-app)" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          <span className="kicker">Note to the next runner (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. locked the auth contract, FE can mock against it"
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          <span className="kicker">Why this call? (optional · saved to your Decision portfolio)</span>
          <input
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            placeholder="e.g. chose JWT over sessions — stateless, fits the mobile client"
            style={inputStyle}
          />
        </label>
        {err && (
          <div style={{ fontSize: 12, color: "var(--text-primary)", marginBottom: 10, fontFamily: "var(--font-mono)" }}>
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
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary)" }}>
            edits go to <span className="mono">/ratify/{target}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function IssueEditor({
  value,
  accent,
  manifest,
  onPatch,
}: {
  value: Issue;
  accent: string;
  manifest: string[];
  onPatch: (p: Partial<Issue>) => void;
}) {
  const isBackend = value.discipline === "backend";
  const [newFile, setNewFile] = useState("");
  const addFile = () => {
    const f = newFile.trim();
    if (f && !value.context_scope.files.includes(f)) {
      onPatch({ context_scope: { ...value.context_scope, files: [...value.context_scope.files, f] } });
    }
    setNewFile("");
  };
  const removeFile = (f: string) =>
    onPatch({ context_scope: { ...value.context_scope, files: value.context_scope.files.filter((x) => x !== f) } });
  return (
    <div className="card-soft" style={{ padding: 16, borderColor: accent }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span className="mono" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          {value.id}
        </span>
        <span className="chip chip-soft" style={{ fontSize: 9, padding: "1px 7px" }}>
          {value.type}
        </span>
        {value.stretch_flag && (
          <span
            title={value.stretch_flag}
            className="chip"
            style={{ fontSize: 9, padding: "1px 7px", background: "var(--bg-secondary)", borderColor: "var(--ink-fill)", color: "var(--text-primary)", fontWeight: 700 }}
          >
            ⚠ stretch
          </span>
        )}
        {value.assignee && (
          <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-tertiary)" }}>
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
                  border: value.risk === r ? `1.5px solid ${RISK_COLOR[r]}` : "1.5px solid var(--border)",
                  background: value.risk === r ? RISK_COLOR[r] : "var(--bg-app)",
                  color: value.risk === r ? "var(--bg-elevated)" : "var(--text-secondary)",
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: isBackend ? 10 : 0 }}>
        <span className="kicker">File scope</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {value.context_scope.files.map((f) => {
            const existing = fileStatus(f, manifest) === "existing";
            return (
              <span
                key={f}
                className="chip"
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: existing ? "var(--bg-secondary)" : "var(--bg-secondary)",
                  borderColor: existing ? "var(--border-strong)" : "var(--ink-fill)",
                  color: existing ? "var(--text-secondary)" : "var(--text-primary)",
                }}
              >
                <span style={{ fontWeight: 800 }}>{existing ? "✓" : "＋"}</span>
                <span className="mono">{f}</span>
                <button
                  onClick={() => removeFile(f)}
                  title="remove file"
                  style={{ background: "none", border: "none", padding: 0, fontSize: 13, lineHeight: 1, color: "inherit", cursor: "pointer" }}
                >
                  ×
                </button>
              </span>
            );
          })}
          <input
            value={newFile}
            onChange={(e) => setNewFile(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFile();
              }
            }}
            placeholder="+ add file"
            style={{ ...inputStyle, width: 150, fontFamily: "var(--font-mono)", fontSize: 12, padding: "5px 9px" }}
          />
        </div>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
          <b style={{ color: "var(--text-secondary)" }}>✓</b> existing · <b style={{ color: "var(--text-primary)" }}>＋</b> new — Enter to add
        </span>
      </div>

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
  border: "1.5px solid var(--border-strong)",
  borderRadius: 8,
  fontSize: 14,
  background: "var(--bg-elevated)",
  fontFamily: "inherit",
  width: "100%",
};
