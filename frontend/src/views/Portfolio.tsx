import React, { useState, useEffect } from "react";
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

  useEffect(() => {
    let cancelled = false;
    api
      .myDecisions()
      .then((r) => {
        if (!cancelled) setDecisions(r.decisions);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        <div
          className="card-soft"
          style={{
            padding: 24,
            textAlign: "center",
            border: "1px dashed var(--line-strong)",
          }}
        >
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
              style={{ padding: 16, borderColor: DISCIPLINE_COLOR[d.domain] }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  className="chip"
                  style={{
                    background: DISCIPLINE_COLOR[d.domain],
                    color: "var(--paper)",
                    fontSize: 10,
                  }}
                >
                  {DISCIPLINE_LABEL[d.domain]}
                </span>
                <span style={{ fontWeight: 600 }}>{d.project_name}</span>
                {d.deprecated && (
                  <span
                    className="chip"
                    style={{ background: "var(--orange-tint)", color: "var(--orange-deep)", fontSize: 10 }}
                  >
                    Deprecated
                  </span>
                )}
                {d.outcome_validated ? (
                  <span
                    className="chip"
                    style={{
                      marginLeft: "auto",
                      background: "var(--positive-tint)",
                      color: "var(--positive)",
                      fontSize: 10,
                    }}
                  >
                    Validated
                  </span>
                ) : (
                  <span
                    className="chip"
                    style={{
                      marginLeft: "auto",
                      background: "var(--cream)",
                      color: "var(--ink-mute)",
                      fontSize: 10,
                    }}
                  >
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
                <span
                  style={{
                    display: "inline-block",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    verticalAlign: "bottom",
                  }}
                >
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

              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--ink-mute)",
                  marginTop: 12,
                }}
              >
                {d.project_id} · {formatDate(d.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
