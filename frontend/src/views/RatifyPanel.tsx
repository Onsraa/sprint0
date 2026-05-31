/* sprint0 — the signature moment (§1): the Decision Card at ratify. A two-pass
   adversarial AI eval surfaced on top of the slice. Carries the routing tier (§10)
   and a graded "what we did before" expander (§2b/§12). Monochrome: the orange
   "conflict" signal renders as the ink spark, never a hue.

   Ported 1:1 from the v4 mockup (RatifyCard.jsx). The right ratify sub-panel +
   Decision Card + the TierBadge/GradeChip helpers (verbatim from the mockup's
   Bell.jsx). Mock module constants are replaced by the useApp() adapter; the
   panel-local SLICE / SIGNAL / GATE_META / TIER_META / GRADE_META are ported
   verbatim. TierBadge + GATE_META are exported so RelayBoard composes them. */
import { useState } from "react";
import {
  Avatar, Badge, DiscDot, DISC, StatusIcon, CapTag, Button,
} from "../components/ui";
import { Icon } from "../lib/icon";
import { ZeroMark } from "../lib/icon";
import { useApp } from "../app/useApp";

/* ───────── routing-tier presentation (§10) — TIER_META (was data.jsx) ─────────
   Monochrome: the two_expert tier is the ink "spark" (the most-scrutinised gate). */
const TIER_META: Record<string, { label: string; experts: number; fg: string; bg: string }> = {
  auto_pass:  { label: "auto-pass", experts: 0, fg: "var(--text-tertiary)",  bg: "var(--bg-secondary)" },
  one_expert: { label: "1 expert",  experts: 1, fg: "var(--text-secondary)", bg: "var(--bg-secondary)" },
  two_expert: { label: "2 experts", experts: 2, fg: "var(--text-primary)",   bg: "var(--bg-active)" },
};

/* gate status → presentation (was data.jsx GATE_META) */
export const GATE_META: Record<string, { label: string; tone: string; fg: string }> = {
  ratified:          { label: "Ratified",          tone: "green",   fg: "var(--green)" },
  auto_passed:       { label: "Auto-passed",       tone: "blue",    fg: "var(--blue)" },
  changes_requested: { label: "Changes requested", tone: "amber",   fg: "var(--amber)" },
  blocked:           { label: "Blocked",           tone: "red",     fg: "var(--red)" },
  locked:            { label: "Locked",            tone: "neutral", fg: "var(--text-quaternary)" },
  pending:           { label: "Pending",           tone: "outline", fg: "var(--text-tertiary)" },
};

/* ───────── §12 graded references — earned strength (was data2.jsx GRADE_META) ───────── */
const GRADE_META: Record<string, { label: string; step: number; proven: boolean; hint: string }> = {
  proposed:        { label: "Proposed",        step: 1, proven: false, hint: "not yet proven" },
  shipped:         { label: "Shipped",         step: 2, proven: false, hint: "merged, not battle-tested" },
  prod_survived:   { label: "Prod-survived",   step: 3, proven: true,  hint: "survived in production" },
  retro_validated: { label: "Retro-validated", step: 4, proven: true,  hint: "confirmed in retro" },
};

/* ───────── §12 grade chip — 4-step earned-strength meter (verbatim, Bell.jsx) ───────── */
export function GradeChip({ grade, showLabel = true }: { grade?: string; showLabel?: boolean }) {
  const m = GRADE_META[grade ?? ""] || GRADE_META.proposed;
  return (
    <span title={`${m.label} · ${m.hint}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 18,
      padding: "0 7px 0 6px", borderRadius: "var(--r-sm)", background: "var(--bg-secondary)",
      border: "0.5px solid var(--border)" }}>
      <span style={{ display: "inline-flex", gap: 2 }}>
        {[1, 2, 3, 4].map(i => (
          <span key={i} style={{ width: 4, height: 9, borderRadius: 1,
            background: i <= m.step ? (m.proven ? "var(--text-primary)" : "var(--text-quaternary)") : "var(--bg-tertiary)" }} />
        ))}
      </span>
      {showLabel && <span style={{ fontSize: 10.5, fontWeight: 500, color: m.proven ? "var(--text-secondary)" : "var(--text-tertiary)" }}>{m.label}</span>}
    </span>
  );
}

/* ───────── §10 tier badge — auto-pass / 1 expert / 2 experts (verbatim, Bell.jsx) ───────── */
export function TierBadge({ tier, size = "md" }: { tier?: string | null; size?: "sm" | "md" }) {
  const m = TIER_META[tier ?? ""] || TIER_META.one_expert;
  const sm = size === "sm";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: sm ? 18 : 20, padding: sm ? "0 7px" : "0 9px",
      borderRadius: "var(--r-sm)", background: m.bg, color: m.fg, fontSize: sm ? 10.5 : 11.5, fontWeight: 600,
      fontFamily: "var(--font-mono)", letterSpacing: "-0.2px", whiteSpace: "nowrap",
      border: tier === "two_expert" ? "0.5px solid var(--text-primary)" : "0.5px solid var(--border)" }}>
      <span style={{ display: "inline-flex", gap: 2 }}>
        {[0, 1].map(i => (
          <span key={i} style={{ width: 5, height: 5, borderRadius: "50%",
            background: i < m.experts ? "currentColor" : "var(--border-strong)" }} />
        ))}
      </span>
      {m.label}
    </span>
  );
}

/* The slice rendered per gate. Ported verbatim from the mockup (RatifyCard.jsx).
   TODO(reconcile): the real slice is the plan's issues for this discipline — the
   orchestrator wires it (plan.epics → issues by discipline). Kept as a constant so
   the panel is pixel-identical until that field lands on useApp(). */
const SLICE: Record<string, { id: string; t: string; s: string; tags: string[] }[]> = {
  uiux:     [{ id: "HARB-122", t: "Empty state + skeleton for map panel", s: "planned", tags: ["map-clustering", "empty-state"] }, { id: "HARB-119", t: "Filter rail tokens + spacing", s: "done", tags: ["tokens"] }],
  backend:  [{ id: "HARB-090", t: "Token-scope service for shareable views", s: "in_review", tags: ["token-scope", "auth"] }, { id: "HARB-091", t: "Rate-limit + retry budget", s: "in_progress", tags: ["rate-limit", "retry"] }],
  devops:   [{ id: "HARB-201", t: "Preview environments per MR", s: "done", tags: ["preview-env"] }, { id: "HARB-202", t: "Pipeline cache for pnpm", s: "done", tags: ["ci"] }],
  frontend: [{ id: "HARB-118", t: "Saved-view share links", s: "in_progress", tags: ["share-links"] }, { id: "HARB-104", t: "Geo-cluster perf pass", s: "blocked", tags: ["map-clustering", "perf"] }],
  qa:       [{ id: "HARB-300", t: "Acceptance: share-link scopes", s: "planned", tags: ["acceptance", "auth"] }],
};

/* signal → presentation (orange = ink spark) */
const SIGNAL: Record<string, { dot: string; label: string; spark: boolean }> = {
  orange: { dot: "var(--text-primary)", label: "Conflicts a battle-tested call", spark: true },
  green:  { dot: "var(--green)",        label: "Agrees with a validated past", spark: false },
  grey:   { dot: "var(--text-quaternary)", label: "Net-new — no prior call", spark: false },
};

/* The two-pass Decision Card for a discipline's gate. The card source is the
   decision-card payload per gate. TODO(reconcile): useApp() does not yet expose a
   per-gate decision-card field — the orchestrator should add `cards: Record<disc,
   DecisionCardResponse>` (or pass it via props). Falls back to `data` prop, then
   `cards?.[disc]`, then renders the "no decision card" state. */
function DecisionCard({ disc, data }: { disc: string; data?: any }) {
  const { cards, members }: any = useApp();
  // byUser closure over the live roster (was the mockup's module-level byUser over MEMBERS).
  const byUser = (u: string) => members?.find((m: any) => m.username === u);
  const cardData = data ?? cards?.[disc];
  const [pastOpen, setPastOpen] = useState(false);
  if (!cardData) {
    // No card payload at all → render the graceful "no decision card" state.
    return (
      <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 16, marginBottom: 16,
        background: "var(--bg-secondary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ZeroMark size={16} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>No decision card</span>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "8px 0 0", lineHeight: 1.5 }}>
          The AI couldn't produce a recommendation for this gate. Ratify on your own judgement — the card never blocks a call.
        </p>
      </div>
    );
  }
  const { card, signal, low_confidence, routing, past } = cardData;
  const sig = SIGNAL[signal] || SIGNAL.grey;
  const pastCount = (past?.own?.length || 0) + (past?.team?.length || 0);

  if (!card) {
    return (
      <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 16, marginBottom: 16,
        background: "var(--bg-secondary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ZeroMark size={16} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>No decision card</span>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "8px 0 0", lineHeight: 1.5 }}>
          The AI couldn't produce a recommendation for this gate. Ratify on your own judgement — the card never blocks a call.
        </p>
        <div style={{ marginTop: 10 }}><TierBadge tier={routing.tier} size="sm" /></div>
      </div>
    );
  }

  return (
    <div style={{ border: `0.5px solid ${sig.spark ? "var(--text-primary)" : "var(--border)"}`, borderRadius: "var(--r-lg)",
      overflow: "hidden", marginBottom: 16, boxShadow: "var(--shadow-1)" }}>
      {/* header: AI eval + signal + tier */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", background: "var(--bg-secondary)",
        borderBottom: "0.5px solid var(--border-subtle)" }}>
        <ZeroMark size={15} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Decision Card</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>two-pass</span>
        <div style={{ flex: 1 }} />
        <TierBadge tier={routing.tier} size="sm" />
      </div>

      <div style={{ padding: 14 }}>
        {/* signal line */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: sig.spark ? 2 : "50%", background: sig.dot, flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, fontWeight: 500, color: sig.spark ? "var(--text-primary)" : "var(--text-tertiary)" }}>{sig.label}</span>
        </div>

        {/* recommendation */}
        <div className="kicker" style={{ marginBottom: 6 }}>Recommendation</div>
        <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--text-primary)", margin: "0 0 12px", fontWeight: 450 }}>{card.recommendation}</p>

        {/* confidence meter */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", width: 64 }}>confidence</span>
          <span style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--bg-tertiary)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${card.confidence}%`, borderRadius: 3,
              background: low_confidence ? "var(--amber)" : "var(--text-secondary)" }} />
          </span>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: low_confidence ? "var(--amber)" : "var(--text-secondary)" }}>{card.confidence}%</span>
        </div>
        {low_confidence && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: "var(--r-md)",
            background: "rgba(199,120,0,0.10)", marginBottom: 14 }}>
            <Icon name="flag" size={13} style={{ color: "var(--amber)" }} />
            <span style={{ fontSize: 11.5, color: "var(--amber)", fontWeight: 500 }}>Low confidence — read the slice closely before clearing.</span>
          </div>
        )}

        {/* pros / cons */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
          <div>
            <div className="kicker" style={{ marginBottom: 6 }}>For</div>
            {card.pros.map((p: string, i: number) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <Icon name="check" size={13} style={{ color: "var(--green)", flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>{p}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="kicker" style={{ marginBottom: 6 }}>Against</div>
            {card.cons.length ? card.cons.map((c: string, i: number) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <span style={{ width: 11, height: 11, flexShrink: 0, marginTop: 2, display: "grid", placeItems: "center" }}>
                  <span style={{ width: 8, height: 1.5, background: "var(--text-quaternary)", borderRadius: 1 }} /></span>
                <span style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>{c}</span>
              </div>
            )) : <span style={{ fontSize: 11.5, color: "var(--text-quaternary)" }}>None flagged.</span>}
          </div>
        </div>

        {/* conflict flag — ink spark */}
        {card.conflict && (
          <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: "var(--r-md)", marginTop: 8,
            background: "var(--bg-active)", border: "0.5px solid var(--text-primary)" }}>
            <Icon name="bolt" size={14} style={{ color: "var(--text-primary)", flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-primary)" }}>Conflict with a prior call</div>
              <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.45, marginTop: 2 }}>{card.conflict_reason}</div>
            </div>
          </div>
        )}

        {/* routing rationale */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "0.5px solid var(--border-subtle)" }}>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>
            blast {routing.blast_radius ?? "—"} · cost {routing.expected_cost ?? "—"}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{routing.note}</span>
        </div>

        {/* what we did before — grounded past */}
        {pastCount > 0 && (
          <div style={{ marginTop: 12 }}>
            <button onClick={() => setPastOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%",
              fontSize: 11.5, fontWeight: 500, color: "var(--text-tertiary)" }}>
              <Icon name="chevronRight" size={13} style={{ transform: pastOpen ? "rotate(90deg)" : "none", transition: "transform var(--t-quick)" }} />
              What we did before · {pastCount} grounded
            </button>
            {pastOpen && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {[...(past.own || []).map((p: any) => ({ ...p, mine: true })), ...(past.team || [])].map((p: any) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "9px 11px", borderRadius: "var(--r-md)",
                    background: "var(--bg-secondary)" }}>
                    <Avatar name={byUser(p.who)?.name || p.who} size={20} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>{p.recommendation}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5 }}>
                        <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>@{p.who} · {p.project}{p.mine ? " · you" : ""}</span>
                        <GradeChip grade={p.grade} showLabel={false} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* Right sub-panel: Decision Card + slice + ratify actions. Renders for the gate
   `g` selected in RelayBoard. Ported 1:1 from the mockup (RatifyCard.jsx). */
export function RatifyPanel({ g }: { g: any }) {
  const { actGate, me, chrome, members }: any = useApp();
  // byUser closure over the live roster (was the mockup's module-level byUser).
  const byUserLocal = (u: string) => members?.find((m: any) => m.username === u);
  const meta = GATE_META[g.status];
  const slice = SLICE[g.discipline] || [];
  const done = g.status === "ratified" || g.status === "auto_passed";
  const [note, setNote] = useState("");
  const ownsThisGate = g.owner === me.username || chrome.seesAllGates;
  const locked = g.depends.length > 0;

  return (
    <div style={{ width: 380, flexShrink: 0, borderLeft: "0.5px solid var(--border)", display: "flex",
      flexDirection: "column", minHeight: 0, background: "var(--bg-elevated)",
      animation: "s0-panel-in var(--t-reg) var(--ease-out) both" }} key={g.discipline}>
      <div style={{ height: "var(--topbar-h)", display: "flex", alignItems: "center", gap: 8, padding: "0 14px",
        borderBottom: "0.5px solid var(--border-subtle)" }}>
        <DiscDot d={g.discipline} size={9} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{DISC[g.discipline].label} gate</span>
        {g.stretched && <Badge tone="outline" mono style={{ height: 16 }}>▲ stretched</Badge>}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, fontWeight: 500, color: meta.fg }}>{meta.label}</span>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <DecisionCard disc={g.discipline} />

        <div className="kicker" style={{ marginBottom: 8 }}>The slice · {slice.length} issues</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 16 }}>
          {slice.map(i => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 34, padding: "5px 8px", borderRadius: "var(--r-md)" }}>
              <StatusIcon status={i.s} size={14} />
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", width: 60, flexShrink: 0 }}>{i.id}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.t}</div>
                <div style={{ display: "flex", gap: 4, marginTop: 3 }}>{i.tags.map(t => <CapTag key={t} tag={t} />)}</div>
              </div>
              {i.s === "blocked" && <Badge tone="red">blocked</Badge>}
            </div>
          ))}
        </div>

        {locked && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: "var(--r-md)",
            background: "var(--bg-secondary)", marginBottom: 16 }}>
            <Icon name="lock" size={14} style={{ color: "var(--text-tertiary)" }} />
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Waiting on {g.depends.map((d: string) => DISC[d].label).join(", ")} to pass the baton.</span>
          </div>
        )}

        {!ownsThisGate && !done && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: "var(--r-md)",
            background: "var(--bg-secondary)", marginBottom: 16 }}>
            <Icon name="eye" size={14} style={{ color: "var(--text-tertiary)" }} />
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>This isn't your gate — {byUserLocal(g.owner)?.name?.split(" ")[0] || "the owner"} ratifies it. You're viewing.</span>
          </div>
        )}

        {!done && !locked && ownsThisGate && (
          <>
            <div className="kicker" style={{ marginBottom: 8 }}>Ratification note <span style={{ textTransform: "none", color: "var(--text-quaternary)", letterSpacing: 0 }}>· optional</span></div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="What did you verify? Anything to flag for the next leg…"
              style={{ width: "100%", padding: "10px 12px", fontSize: 13, lineHeight: 1.5, resize: "none",
                background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)",
                outline: "none", color: "var(--text-primary)", boxShadow: "var(--shadow-inset)", fontFamily: "var(--font-ui)" }} />
          </>
        )}
      </div>

      <div style={{ borderTop: "0.5px solid var(--border-subtle)", padding: 10, display: "flex", gap: 8 }}>
        {done ? (
          <Button variant="secondary" size="md" icon="ratify" style={{ flex: 1 }} disabled>Already cleared</Button>
        ) : locked ? (
          <Button variant="secondary" size="md" icon="lock" style={{ flex: 1 }} disabled>Locked</Button>
        ) : !ownsThisGate ? (
          <Button variant="secondary" size="md" icon="eye" style={{ flex: 1 }} disabled>Not your gate</Button>
        ) : (
          <>
            <Button variant="primary" size="md" icon="ratify" style={{ flex: 1 }} onClick={() => actGate(g.discipline, "ratified")}>Ratify slice</Button>
            <Button variant="secondary" size="md" onClick={() => actGate(g.discipline, "changes_requested")}>Request changes</Button>
          </>
        )}
      </div>
    </div>
  );
}
