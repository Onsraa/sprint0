import React, { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import type { Decision } from "../lib/api";
import { DISCIPLINE_LABEL, DISCIPLINE_COLOR } from "../lib/relayUtils";

// ---- helpers ---------------------------------------------------------------

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

// ---- component -------------------------------------------------------------

export function Portfolio() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [team, setTeam] = useState<Decision[] | null>(null); // surfaced team knowledge (cross-user)

  const load = useCallback(() => {
    setLoading(true);
    api
      .myDecisions()
      .then((r) => {
        setDecisions(r.decisions);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const deprecate = (d: Decision) => {
    const reason = window.prompt(`Why was "${d.recommendation}" wrong? (cautionary note)`);
    if (reason == null) return;
    act(() => api.deprecateDecision(d.id, reason), d.id);
  };
  const toggleVis = (d: Decision) =>
    act(() => api.setDecisionVisibility(d.id, d.visibility === "team" ? "personal" : "team"), d.id);
  const remove = (d: Decision) => {
    if (!window.confirm("Delete this decision? Removes it from the team pool — cannot be undone.")) return;
    act(() => api.deleteDecision(d.id), d.id);
  };

  const loadTeam = () => {
    api
      .surfaceDecisions()
      .then((r) => setTeam(r.team))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <div className="kicker">Decision Portfolio</div>
        <div className="display" style={{ fontSize: 30 }}>
          {decisions.length > 0 ? `Your ${decisions.length} decisions` : "Your decisions"}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>
          Reasoning you captured when passing the baton. Validated once the project ships.
        </div>
      </div>

      {loading && (
        <div className="card-soft" style={{ padding: 24, textAlign: "center", color: "var(--ink-soft)" }}>
          Loading…
        </div>
      )}

      {err && (
        <div
          className="card-soft"
          style={{ padding: 16, color: "var(--orange-deep)", fontFamily: "var(--font-mono)", fontSize: 13 }}
        >
          {err}
        </div>
      )}

      {!loading && !err && decisions.length === 0 && (
        <div className="card-soft" style={{ padding: 24, textAlign: "center", border: "1px dashed var(--line-strong)" }}>
          <div className="display" style={{ fontSize: 18 }}>
            No decisions yet.
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>
            Ratify a relay gate with a note on why, and it lands here.
          </div>
        </div>
      )}

      {!loading && !err && decisions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {decisions.map((d) => (
            <div
              key={d.id}
              className="card-soft"
              style={{ padding: 16, borderColor: DISCIPLINE_COLOR[d.domain], opacity: d.deprecated ? 0.6 : 1 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="chip" style={{ background: DISCIPLINE_COLOR[d.domain], color: "var(--paper)", fontSize: 10 }}>
                  {DISCIPLINE_LABEL[d.domain]}
                </span>
                <span style={{ fontWeight: 600 }}>{d.project_name}</span>
                {d.deprecated && (
                  <span className="chip" style={{ background: "var(--orange-tint)", color: "var(--orange-deep)", fontSize: 10 }}>
                    Deprecated
                  </span>
                )}
                {d.outcome_validated ? (
                  <span className="chip" style={{ marginLeft: "auto", background: "var(--positive-tint)", color: "var(--positive)", fontSize: 10 }}>
                    Validated
                  </span>
                ) : (
                  <span className="chip" style={{ marginLeft: "auto", background: "var(--cream)", color: "var(--ink-mute)", fontSize: 10 }}>
                    Pending
                  </span>
                )}
              </div>

              {d.reasoning ? (
                <div style={{ fontSize: 14, color: "var(--ink)", marginTop: 10 }}>{d.reasoning}</div>
              ) : (
                <div style={{ fontSize: 14, color: "var(--ink-mute)", fontStyle: "italic", marginTop: 10 }}>
                  No reasoning recorded — personal only.
                </div>
              )}

              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 10 }}>
                <span className="kicker">Decided</span>{" "}
                <span style={{ display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
                  {d.recommendation}
                </span>
              </div>

              {d.context_tags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {d.context_tags.map((t, i) => (
                    <span key={i} className="chip chip-soft" style={{ fontSize: 9 }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {d.deprecated && d.deprecation_reason && (
                <div style={{ fontSize: 12, color: "var(--orange-deep)", marginTop: 8, fontStyle: "italic" }}>
                  ⚠ {d.deprecation_reason}
                </div>
              )}

              {/* memory control (Outcome Validation) — minimal wired actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span className="chip chip-soft" style={{ fontSize: 9 }}>
                  {d.visibility === "team" ? "👥 Team" : "🔒 Personal"}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-mute)" }}>
                  {d.project_id} · {formatDate(d.created_at)}
                </span>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px", marginLeft: "auto" }} disabled={busy === d.id} onClick={() => toggleVis(d)}>
                  {d.visibility === "team" ? "Make personal" : "Share to team"}
                </button>
                {!d.deprecated && (
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} disabled={busy === d.id} onClick={() => deprecate(d)}>
                    Deprecate
                  </button>
                )}
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px", color: "var(--orange-deep)" }} disabled={busy === d.id} onClick={() => remove(d)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Team knowledge — cross-user surfacing (validated + team + reasoned, with attribution) */}
      <div style={{ marginTop: 28 }}>
        <div className="kicker" style={{ marginBottom: 8 }}>
          Team knowledge
        </div>
        {team === null ? (
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={loadTeam}>
            Show validated team decisions →
          </button>
        ) : team.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>No validated team decisions to surface yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {team.map((d) => (
              <div key={d.id} className="card-soft" style={{ padding: 12, borderColor: DISCIPLINE_COLOR[d.domain] }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                  <span className="chip" style={{ background: DISCIPLINE_COLOR[d.domain], color: "var(--paper)", fontSize: 9 }}>
                    {DISCIPLINE_LABEL[d.domain]}
                  </span>
                  <b>{d.recommendation}</b>
                  <span style={{ marginLeft: "auto", color: "var(--ink-mute)" }}>
                    @{d.owner_id} · {d.project_name}
                  </span>
                </div>
                {d.reasoning && <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 6 }}>{d.reasoning}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
