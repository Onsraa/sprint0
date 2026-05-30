import { useState } from "react";
import { useApp } from "../app/AppContext";
import { api } from "../lib/api";
import type { Discipline, FlagIntegrationResult, Gate, IntegrationCandidate, IntegrationSignal } from "../lib/api";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL, planIssues, statusStyle } from "../lib/relayUtils";

/* The ratification relay: {uiux ∥ backend ∥ devops} → frontend → qa.
   Manager sees every gate; a lead sees their own gate highlighted with a
   Ratify action that jumps to the ratify panel. */

const ROW_1: Discipline[] = ["uiux", "backend", "devops"];
const ROW_2: Discipline[] = ["frontend"];
const ROW_3: Discipline[] = ["qa"];

export function RelayBoard() {
  const { relay, plan, discipline, setView } = useApp();
  const mine = discipline;

  if (!relay || !plan) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <EmptyRelay />
      </div>
    );
  }

  const byDiscipline = new Map(relay.gates.map((g) => [g.discipline, g]));
  const baton = new Set(relay.baton);
  // Disciplines whose slice contains a stretched assignment (⚠ on the gate).
  const stretched = new Set(planIssues(plan.epics).filter((i) => i.stretch_flag).map((i) => i.discipline));

  const renderRow = (disc: Discipline[]) =>
    disc
      .map((d) => byDiscipline.get(d))
      .filter((g): g is Gate => Boolean(g))
      .map((g) => (
        <GateCard
          key={g.discipline}
          gate={g}
          holdsBaton={baton.has(g.discipline)}
          isMine={mine === g.discipline}
          isStretched={stretched.has(g.discipline)}
          onRatify={mine === g.discipline ? () => setView("ratify") : undefined}
        />
      ));

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ marginBottom: 22 }}>
        <div className="kicker">Ratification relay</div>
        <div className="display" style={{ fontSize: 28, marginTop: 4 }}>
          {plan.project_name} — pass the baton.
        </div>
        <div style={{ fontSize: 14, color: "var(--ink-soft)", marginTop: 6 }}>
          {"{UI/UX ∥ Backend ∥ DevOps} → Frontend → QA. "}
          {baton.size > 0 ? (
            <>
              Baton held by{" "}
              <b style={{ color: "var(--ink)" }}>
                {relay.baton.map((d) => DISCIPLINE_LABEL[d]).join(", ")}
              </b>
              .
            </>
          ) : (
            <b style={{ color: "var(--positive)" }}>All gates cleared.</b>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${ROW_1.length}, 1fr)`, gap: 12, width: "100%" }}>
          {renderRow(ROW_1)}
        </div>
        <Connector />
        <div style={{ width: "60%", maxWidth: 360 }}>{renderRow(ROW_2)}</div>
        <Connector />
        <div style={{ width: "60%", maxWidth: 360 }}>{renderRow(ROW_3)}</div>
      </div>

      <IntegrationPanel />
    </div>
  );
}

/* The integration gate (B+C+D): a consumer dev reports their API producer failing → the qa gate
   blocks and the producer is pinged; anyone can mark it back ok. Authority is enforced server-side. */
function IntegrationPanel() {
  const { relay, plan, planId, member, setRelay } = useApp();
  const [reporterId, setReporterId] = useState("");
  const [note, setNote] = useState("");
  const [candidates, setCandidates] = useState<IntegrationCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!relay || !plan || !planId) return null;

  const issues = plan.epics.flatMap((e) => e.issues);
  const titleOf = (id: string) => issues.find((i) => i.id === id)?.title ?? id;

  const latest = new Map<string, IntegrationSignal>();
  for (const s of relay.integration_signals ?? []) latest.set(s.target_issue_id, s);
  const failing = [...latest.values()].filter((s) => s.state === "failing");

  // The caller's consumer issues — assigned to me AND depending on an upstream producer.
  const mine = member
    ? issues.filter(
        (i) => (i.assignee === member.username || i.assignee === member.gitlab_username) && i.depends_on.length > 0,
      )
    : [];

  if (failing.length === 0 && mine.length === 0) return null;  // nothing for this user → hide

  const applyResult = (res: FlagIntegrationResult) => {
    if ("gates" in res) {
      setRelay(res);
      setCandidates(null);
      setReporterId("");
      setNote("");
    } else {
      setCandidates(res.candidates);  // >1 producer → ask which one
    }
  };

  const run = async (body: Parameters<typeof api.flagIntegration>[1]) => {
    setBusy(true);
    setErr(null);
    try {
      applyResult(await api.flagIntegration(planId, body));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="card-soft"
      style={{
        padding: 18,
        marginTop: 24,
        borderColor: failing.length ? "var(--orange-soft)" : "var(--line-strong)",
        background: failing.length ? "var(--orange-tint)" : undefined,
      }}
    >
      <div className="kicker" style={{ color: failing.length ? "var(--orange-deep)" : undefined }}>
        API integration
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4, marginBottom: 12 }}>
        A failing API holds the QA gate until the producer fixes it — ratified slices aren't reworked.
      </div>

      {failing.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: mine.length ? 16 : 0 }}>
          {failing.map((s) => (
            <div key={s.target_issue_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="chip" style={{ background: "var(--orange-deep)", color: "var(--paper)", borderColor: "var(--orange-deep)", fontSize: 11 }}>
                failing
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{titleOf(s.target_issue_id)}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", marginLeft: 8 }}>
                  by @{s.by}
                  {s.reporter_issue_id ? ` · ${titleOf(s.reporter_issue_id)}` : ""}
                </span>
                {s.note && <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{s.note}</div>}
              </div>
              <button onClick={() => run({ state: "ok", target_issue_id: s.target_issue_id })} disabled={busy} className="btn btn-ghost btn-sm">
                Mark api-ok ✓
              </button>
            </div>
          ))}
        </div>
      )}

      {mine.length > 0 && (
        <div style={{ borderTop: failing.length ? "1px solid var(--line)" : undefined, paddingTop: failing.length ? 14 : 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Report a failing API on one of your issues</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              value={reporterId}
              onChange={(e) => { setReporterId(e.target.value); setCandidates(null); }}
              style={selectStyle}
            >
              <option value="">Select your issue…</option>
              {mine.map((i) => (
                <option key={i.id} value={i.id}>{i.title}</option>
              ))}
            </select>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="what's broken? (optional)"
              style={{ ...selectStyle, flex: 1, minWidth: 180 }}
            />
            <button
              onClick={() => run({ state: "failing", reporter_issue_id: reporterId, note: note.trim() || undefined })}
              disabled={busy || !reporterId}
              className="btn btn-primary btn-sm"
              style={{ opacity: busy || !reporterId ? 0.6 : 1 }}
            >
              {busy ? "…" : "Report failing →"}
            </button>
          </div>
          {candidates && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>Which API is failing? Pick the producer:</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => run({ state: "failing", reporter_issue_id: reporterId, target_issue_id: c.id, note: note.trim() || undefined })}
                    disabled={busy}
                    className="btn btn-ghost btn-sm"
                  >
                    {c.title}{c.assignee ? ` · @${c.assignee}` : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {err && <div style={{ fontSize: 12, color: "var(--orange-deep)", fontFamily: "var(--font-mono)", marginTop: 8 }}>{err}</div>}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "8px 11px",
  border: "1.5px solid var(--line-strong)",
  borderRadius: 8,
  fontSize: 13,
  background: "var(--paper)",
  fontFamily: "inherit",
};

function Connector() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "var(--ink-faint)" }}>
      <div style={{ width: 2, height: 18, background: "var(--line-strong)" }} />
      <div style={{ fontSize: 14, marginTop: -4 }}>▼</div>
    </div>
  );
}

function GateCard({
  gate,
  holdsBaton,
  isMine,
  isStretched,
  onRatify,
}: {
  gate: Gate;
  holdsBaton: boolean;
  isMine: boolean;
  isStretched: boolean;
  onRatify?: () => void;
}) {
  const st = statusStyle(gate.status);
  const accent = DISCIPLINE_COLOR[gate.discipline];
  const done = gate.status === "ratified" || gate.status === "auto_passed";

  return (
    <div
      className="card-soft"
      style={{
        padding: 16,
        position: "relative",
        borderWidth: isMine || holdsBaton ? 2 : 1,
        borderColor: holdsBaton ? "var(--orange)" : isMine ? accent : "var(--line-strong)",
        boxShadow: holdsBaton ? "4px 4px 0 var(--orange)" : undefined,
      }}
    >
      {holdsBaton && (
        <div
          className="chip chip-orange"
          style={{ position: "absolute", top: -11, right: 12, fontSize: 10, padding: "3px 9px" }}
        >
          🎽 baton
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: accent, border: "1.5px solid var(--ink)" }} />
        <div style={{ fontWeight: 800, fontSize: 15 }}>{DISCIPLINE_LABEL[gate.discipline]}</div>
        {isStretched && (
          <span title="a stretched assignment in this slice" style={{ color: "var(--warn)", fontSize: 13, fontWeight: 800 }}>⚠</span>
        )}
        {isMine && (
          <span className="chip" style={{ fontSize: 9, padding: "1px 7px", marginLeft: "auto" }}>
            you
          </span>
        )}
      </div>

      <div
        className="chip"
        style={{ background: st.bg, color: st.fg, borderColor: st.border, fontSize: 11, padding: "4px 10px" }}
      >
        {done && <span>✓</span>}
        {st.label}
      </div>

      {gate.tier && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          <span
            className={gate.tier === "two_expert" ? "chip chip-orange" : "chip"}
            title={gate.routed_note || "router tier = f(P(error) × blast)"}
            style={{ fontSize: 10, padding: "2px 8px", fontWeight: 800 }}
          >
            {gate.tier === "auto_pass" ? "auto-pass" : gate.tier === "one_expert" ? "1 expert" : "2 experts"}
          </span>
          {gate.blast_radius != null && (
            <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>
              blast {gate.blast_radius}
              {gate.expected_cost != null ? ` · cost ${gate.expected_cost}` : ""}
            </span>
          )}
        </div>
      )}

      {gate.depends_on.length > 0 && (
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 10 }}>
          waits on: {gate.depends_on.map((d) => DISCIPLINE_LABEL[d]).join(" · ")}
        </div>
      )}
      {gate.note && (
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.4 }}>{gate.note}</div>
      )}

      {onRatify && !done && (
        <button
          onClick={onRatify}
          className="btn btn-sm btn-primary"
          style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
        >
          Ratify my slice →
        </button>
      )}
    </div>
  );
}

function EmptyRelay() {
  return (
    <div
      className="card-soft"
      style={{ padding: 40, textAlign: "center", border: "2px dashed var(--line-strong)" }}
    >
      <div className="display" style={{ fontSize: 22, marginBottom: 8 }}>
        No plan in the relay yet.
      </div>
      <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>
        Drop a brief from the manager wizard — a plan draft enters the relay and shows up here.
      </div>
    </div>
  );
}
