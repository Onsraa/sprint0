import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { CoverageRow, StretchCandidate } from "../lib/api";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL } from "../lib/relayUtils";
import { Mascot } from "../components/Mascot";

/* Staffing step (manager, between Plan draft and Dispatch): does the team cover every
   discipline this plan needs? For each gap, sprint0 ranks who to STRETCH (with pros/cons +
   score) and suggests an ONBOARD — weighted by sprint flow. "Onboard" opens the CV wizard;
   "Stretch" just acknowledges (assignment already flagged the issue). */

export function StaffingGap({ planId, onOnboard, next }: { planId: string | null; onOnboard: () => void; next: () => void }) {
  const [coverage, setCoverage] = useState<CoverageRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [acked, setAcked] = useState<Record<string, string>>({}); // discipline → username acknowledged
  const ranFor = useRef<string | null>(null);

  useEffect(() => {
    if (!planId || ranFor.current === planId) return;
    ranFor.current = planId;
    api
      .staffing(planId)
      .then((res) => setCoverage(res.coverage))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [planId]);

  if (err) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Mascot size={64} expression="surprised" />
        <div className="display" style={{ fontSize: 22 }}>Couldn't check staffing.</div>
        <div className="mono" style={{ fontSize: 12, color: "var(--orange-deep)", maxWidth: 520, textAlign: "center" }}>{err}</div>
        <button onClick={next} className="btn btn-ghost btn-sm">Skip → trust</button>
      </div>
    );
  }

  if (!coverage) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid var(--orange)", borderTopColor: "transparent", animation: "spin-slow 0.8s linear infinite" }} />
        <div className="mono" style={{ fontSize: 13, color: "var(--ink-mute)" }}>checking team coverage…</div>
      </div>
    );
  }

  const gaps = coverage.filter((c) => !c.covered);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div className="kicker">Staffing</div>
          <div className="display" style={{ fontSize: 26, marginTop: 4 }}>
            {gaps.length === 0 ? "The team covers every discipline." : `${gaps.length} gap${gaps.length === 1 ? "" : "s"} to fill.`}
          </div>
        </div>
        <Mascot size={48} expression={gaps.length === 0 ? "cheer" : "focused"} />
      </div>

      {/* Coverage strip */}
      <div className="card-soft" style={{ padding: 16, marginBottom: 16 }}>
        <div className="kicker" style={{ marginBottom: 10 }}>Discipline coverage</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {coverage.map((c) => (
            <div
              key={c.discipline}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 10,
                border: `1.5px solid ${c.covered ? "var(--positive)" : "var(--warn)"}`,
                background: c.covered ? "rgba(47,138,78,0.06)" : "var(--orange-tint)",
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 3, background: DISCIPLINE_COLOR[c.discipline], border: "1.5px solid var(--ink)" }} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>{DISCIPLINE_LABEL[c.discipline]}</span>
              {c.covered ? (
                <span style={{ fontSize: 11, color: "var(--positive)", fontWeight: 700 }}>
                  ✓ {c.lead ? `@${c.lead}` : "covered"}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: "var(--warn)", fontWeight: 700 }}>gap</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Gap recommendation cards */}
      {gaps.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {gaps.map((c) => (
            <GapCard
              key={c.discipline}
              row={c}
              ackedFor={acked[c.discipline] ?? null}
              onStretch={(u) => setAcked((a) => ({ ...a, [c.discipline]: u }))}
              onOnboard={onOnboard}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <button onClick={next} className="btn btn-primary btn-sm">
          {gaps.length === 0 ? "Set trust →" : "Continue → trust"}
        </button>
      </div>
    </div>
  );
}

function GapCard({
  row,
  ackedFor,
  onStretch,
  onOnboard,
}: {
  row: CoverageRow;
  ackedFor: string | null;
  onStretch: (username: string) => void;
  onOnboard: () => void;
}) {
  const rec = row.recommendation;
  const accent = DISCIPLINE_COLOR[row.discipline];
  return (
    <div className="card-soft" style={{ padding: 18, borderColor: accent }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: accent, border: "1.5px solid var(--ink)" }} />
        <div style={{ fontWeight: 800, fontSize: 16 }}>{DISCIPLINE_LABEL[row.discipline]} — no available lead</div>
      </div>
      {rec && (
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", marginBottom: 12 }}>
          weighted by: {rec.weighted_by}
        </div>
      )}

      {!rec && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No recommendation returned.</div>}

      {rec && (
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14 }}>
          {/* Stretch candidates */}
          <div>
            <div className="kicker" style={{ marginBottom: 8 }}>Stretch an internal dev</div>
            {rec.stretch_candidates.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>No available candidates — onboarding is the move.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rec.stretch_candidates.map((cand) => (
                  <CandidateRow key={cand.username} cand={cand} acked={ackedFor === cand.username} onStretch={() => onStretch(cand.username)} />
                ))}
              </div>
            )}
          </div>

          {/* Onboard */}
          <div className="card-soft" style={{ padding: 14, background: "var(--cream)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="kicker">Or onboard</div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{rec.onboard.suggestion}</div>
            <ProsCons pros={rec.onboard.pros} cons={rec.onboard.cons} />
            <button onClick={onOnboard} className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start", marginTop: 2 }}>
              Onboard a dev →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateRow({ cand, acked, onStretch }: { cand: StretchCandidate; acked: boolean; onStretch: () => void }) {
  return (
    <div style={{ padding: 12, background: "var(--paper)", borderRadius: 10, border: "1.5px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{cand.name}</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
          @{cand.username}
          {cand.discipline && <> · {DISCIPLINE_LABEL[cand.discipline]}</>}
        </span>
        <span className="chip chip-soft" style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px" }}>score {cand.score}</span>
      </div>
      <ProsCons pros={cand.pros} cons={cand.cons} />
      <button
        onClick={onStretch}
        disabled={acked}
        className={acked ? "btn btn-ghost btn-sm" : "btn btn-dark btn-sm"}
        style={{ marginTop: 8, opacity: acked ? 0.7 : 1 }}
      >
        {acked ? "Stretch acknowledged ✓" : "Stretch this dev"}
      </button>
    </div>
  );
}

function ProsCons({ pros, cons }: { pros: string[]; cons: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {pros.map((p, i) => (
        <div key={`p${i}`} style={{ fontSize: 12, color: "var(--ink-soft)", display: "flex", gap: 6 }}>
          <span style={{ color: "var(--positive)", fontWeight: 800 }}>+</span>
          {p}
        </div>
      ))}
      {cons.map((c, i) => (
        <div key={`c${i}`} style={{ fontSize: 12, color: "var(--ink-soft)", display: "flex", gap: 6 }}>
          <span style={{ color: "var(--warn)", fontWeight: 800 }}>−</span>
          {c}
        </div>
      ))}
    </div>
  );
}
