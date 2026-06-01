/* sprint0 — Decision Portfolio (§2 + §12). Every architectural call the signed-in
   user has made, with earned grade, validation badge, visibility control, and a
   reasoning-missing nudge (un-reasoned decisions can't go team-wide and can't
   surface to other people's briefs).

   Ported pixel-1:1 from the v4 mockup (app/Portfolio.jsx). Data source: useApp(). */
import { useState, useEffect } from "react";
import { useApp } from "../app/useApp";
import { Icon } from "../lib/icon";
import { Button, IconButton, Badge, DiscDot, DISC, CapTag } from "../components/ui";
import { ViewChrome } from "../components/ViewChrome";
import type { Decision } from "../lib/schemas";

/* §12 graded references — panel-local (mockup data2.jsx GRADE_ORDER / GRADE_META). */
const GRADE_ORDER = ["proposed", "shipped", "prod_survived", "retro_validated"];
const GRADE_META: Record<string, { label: string; step: number; proven: boolean; hint: string }> = {
  proposed: { label: "Proposed", step: 1, proven: false, hint: "not yet proven" },
  shipped: { label: "Shipped", step: 2, proven: false, hint: "merged, not battle-tested" },
  prod_survived: { label: "Prod-survived", step: 3, proven: true, hint: "survived in production" },
  retro_validated: { label: "Retro-validated", step: 4, proven: true, hint: "confirmed in retro" },
};
/* panel-local: compact grade chip. */
function GradeChip({ grade, showLabel = true }: { grade?: string; showLabel?: boolean }) {
  const m = grade ? GRADE_META[grade] : undefined;
  if (!m) return null;
  return (
    <Badge tone={m.proven ? "ink" : "outline"} mono>
      {m.proven && <Icon name="check" size={10} />}
      {showLabel ? m.label : m.label.split("-")[0]}
    </Badge>
  );
}

export function Portfolio() {
  const { decisions, me, setVisibility, editReasoning, deprecate, removeDecision } = useApp();
  const mine = decisions.filter((d) => d.owner_id === me.username);
  const [sel, setSel] = useState<string | null>(mine[0]?.id || null);
  const selD = decisions.find((d) => d.id === sel) || null;

  const teamCount = mine.filter((d) => d.visibility === "team" && !d.deprecated).length;
  const provenCount = mine.filter((d) => (d.grade ? GRADE_META[d.grade]?.proven : false)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["You", "Portfolio"]}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{mine.length} decisions</span>
      </ViewChrome>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28, padding: "16px 20px", borderBottom: "0.5px solid var(--border-subtle)" }}>
            {([["Your calls", mine.length], ["Surfacing team-wide", teamCount], ["Battle-tested", provenCount]] as const).map(([l, v]) => (
              <div key={l}>
                <div className="kicker" style={{ marginBottom: 4 }}>{l}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.5px" }}>{v}</div>
              </div>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--text-tertiary)", maxWidth: 260, lineHeight: 1.45, textAlign: "right" }}>
              Team + validated + reasoned decisions surface into others' briefs.
            </span>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "10px 0" }}>
            {mine.map((d) => <DecisionRow key={d.id} d={d} selected={sel === d.id} onOpen={() => setSel(d.id)} />)}
            {!mine.length && <Empty />}
          </div>
        </div>
        {selD && <DecisionDetail d={selD} onClose={() => setSel(null)}
          onVisibility={setVisibility} onReasoning={editReasoning} onDeprecate={deprecate} onDelete={removeDecision} />}
      </div>
    </div>
  );
}

function DecisionRow({ d, selected, onOpen }: { d: Decision; selected: boolean; onOpen: () => void }) {
  const [h, setH] = useState(false);
  const noReason = !d.reasoning;
  return (
    <div onClick={onOpen} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", cursor: "pointer",
        background: selected || h ? "var(--bg-hover)" : "transparent", borderBottom: "0.5px solid var(--border-subtle)",
        opacity: d.deprecated ? 0.55 : 1 }}>
      <DiscDot d={d.domain} size={9} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {d.recommendation}{d.deprecated && <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", marginLeft: 8 }}>· deprecated</span>}
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", marginTop: 2 }}>{d.project_name} · {d.domain}</div>
      </div>
      {noReason && <Badge tone="amber">needs reasoning</Badge>}
      {d.outcome_validated && <Badge tone="green"><Icon name="check" size={11} />validated</Badge>}
      <GradeChip grade={d.grade} />
      <Badge tone={d.visibility === "team" ? "ink" : "outline"}>{d.visibility}</Badge>
    </div>
  );
}

function DecisionDetail({ d, onClose, onVisibility, onReasoning, onDeprecate, onDelete }: {
  d: Decision;
  onClose: () => void;
  onVisibility: (id: string, v: "personal" | "team") => void;
  onReasoning: (id: string, r: string) => void;
  onDeprecate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.reasoning);
  const [confirmDel, setConfirmDel] = useState(false);
  const noReason = !d.reasoning;
  const canTeam = !!d.reasoning;

  useEffect(() => { setDraft(d.reasoning); setEditing(false); setConfirmDel(false); }, [d.id, d.reasoning]);

  return (
    <div style={{ width: 380, flexShrink: 0, borderLeft: "0.5px solid var(--border)", display: "flex", flexDirection: "column",
      minHeight: 0, background: "var(--bg-elevated)", animation: "s0-panel-in var(--t-reg) var(--ease-out) both" }}>
      <div style={{ height: "var(--topbar-h)", display: "flex", alignItems: "center", gap: 8, padding: "0 8px 0 14px", borderBottom: "0.5px solid var(--border-subtle)" }}>
        <DiscDot d={d.domain} size={9} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{DISC[d.domain].label} decision</span>
        <div style={{ flex: 1 }} />
        <IconButton name="close" onClick={onClose} />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35, letterSpacing: "-0.2px", margin: "0 0 12px" }}>{d.recommendation}</h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
          <GradeChip grade={d.grade} />
          {d.outcome_validated && <Badge tone="green"><Icon name="check" size={11} />validated</Badge>}
          {d.deprecated && <Badge tone="neutral">deprecated</Badge>}
        </div>

        {/* grade strength explainer */}
        <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-md)", padding: 12, marginBottom: 16, background: "var(--bg-secondary)" }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Earned strength</div>
          <div style={{ display: "flex", gap: 6 }}>
            {GRADE_ORDER.map((g) => {
              const eff = d.grade ?? "proposed";   // an ungraded decision sits at the "proposed" baseline
              const m = GRADE_META[g], reached = m.step <= GRADE_META[eff].step;
              const proven = GRADE_META[eff].proven;
              return (
                <div key={g} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ height: 4, borderRadius: 2, background: reached ? (proven && m.proven ? "var(--text-primary)" : "var(--text-quaternary)") : "var(--bg-tertiary)", marginBottom: 5 }} />
                  <div style={{ fontSize: 9, color: g === eff ? "var(--text-primary)" : "var(--text-quaternary)", fontWeight: g === eff ? 600 : 400 }}>{m.label}</div>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: "10px 0 0", lineHeight: 1.5 }}>
            {(d.grade ? GRADE_META[d.grade].proven : false) ? "Battle-tested — carries routing weight and can fire the conflict override." : "Not yet proven — shows in cards but can't override a routing tier."}
          </p>
        </div>

        {/* reasoning */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <span className="kicker">Reasoning</span>
          <div style={{ flex: 1 }} />
          {!editing && <button onClick={() => setEditing(true)} style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-tertiary)" }}>Edit</button>}
        </div>
        {editing ? (
          <div>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} autoFocus
              placeholder="Why this call? What did the outcome confirm?"
              style={{ width: "100%", padding: "10px 12px", fontSize: 13, lineHeight: 1.55, resize: "vertical",
                background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)",
                outline: "none", color: "var(--text-primary)", boxShadow: "var(--shadow-inset)", fontFamily: "var(--font-ui)" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Button variant="primary" size="sm" onClick={() => { onReasoning(d.id, draft); setEditing(false); }}>Save</Button>
              <Button variant="ghost" size="sm" onClick={() => { setDraft(d.reasoning); setEditing(false); }}>Cancel</Button>
            </div>
          </div>
        ) : noReason ? (
          <div style={{ display: "flex", gap: 8, padding: "11px 12px", borderRadius: "var(--r-md)", background: "rgba(199,120,0,0.10)", marginBottom: 16 }}>
            <Icon name="flag" size={14} style={{ color: "var(--amber)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: "var(--amber)", lineHeight: 1.45 }}>No reasoning yet. Add it before this can go team-wide and surface to other briefs.</span>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 16px" }}>{d.reasoning}</p>
        )}

        <div className="kicker" style={{ marginBottom: 8 }}>Context tags</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>{d.context_tags.map((t) => <CapTag key={t} tag={t} />)}</div>

        {/* visibility */}
        <div className="kicker" style={{ marginBottom: 8 }}>Visibility</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {([["personal", "Personal"], ["team", "Team"]] as const).map(([v, label]) => {
            const on = d.visibility === v;
            const blocked = v === "team" && !canTeam;
            return (
              <button key={v} disabled={blocked || d.deprecated} onClick={() => onVisibility(d.id, v)}
                style={{ flex: 1, height: 32, borderRadius: "var(--r-md)", fontSize: 12.5, fontWeight: 500,
                  background: on ? "var(--text-primary)" : "var(--bg-elevated)", color: on ? "#fff" : blocked ? "var(--text-quaternary)" : "var(--text-secondary)",
                  border: `0.5px solid ${on ? "var(--text-primary)" : "var(--border-strong)"}`, cursor: blocked || d.deprecated ? "not-allowed" : "pointer",
                  opacity: blocked ? 0.55 : 1 }}>
                {label}
              </button>
            );
          })}
        </div>
        {!canTeam && <p style={{ fontSize: 11, color: "var(--text-quaternary)", margin: "0 0 4px", lineHeight: 1.45 }}>Add reasoning to enable team visibility.</p>}
      </div>

      <div style={{ borderTop: "0.5px solid var(--border-subtle)", padding: 10, display: "flex", gap: 8 }}>
        {!d.deprecated && <Button variant="secondary" size="md" style={{ flex: 1 }} onClick={() => onDeprecate(d.id)}>Deprecate</Button>}
        {confirmDel
          ? <Button variant="secondary" size="md" style={{ flex: 1, color: "var(--red)", borderColor: "var(--red)" }} onClick={() => { onDelete(d.id); onClose(); }}>Confirm delete</Button>
          : <Button variant="ghost" size="md" onClick={() => setConfirmDel(true)}>Delete</Button>}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 40 }}>
      <div style={{ textAlign: "center", maxWidth: 320 }}>
        <span style={{ width: 44, height: 44, borderRadius: "var(--r-lg)", background: "var(--bg-secondary)", display: "grid", placeItems: "center", margin: "0 auto 14px", color: "var(--text-tertiary)" }}>
          <Icon name="portfolio" size={22} />
        </span>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No decisions yet</div>
        <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.5, margin: 0 }}>Ratify a gate with reasoning and it lands here — graded as it survives in production.</p>
      </div>
    </div>
  );
}
