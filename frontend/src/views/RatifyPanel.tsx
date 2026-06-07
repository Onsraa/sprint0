/* sprint0 — the Contract sub-panel (§1′): ratifying a gate is now a CHOICE, not an approval.
   Per discipline gate the AI proposes grounded solutions — one reused from agency memory (the MongoDB-MCP
   star), one or two fresh, plus a write-your-own slot — each with on-demand detail (pros/cons · confidence
   · grounded-on · impacted files). Picking = ratifying; a write-your-own makes the backend regenerate the
   gate's task; a cross-gate file overlap flags the other gate (the relay state reflects it).

   Ported from the v6 Claude Design RatifyCard.jsx, wired to the REAL backend:
   solutions ← GET /api/plans/{id}/gates/{disc}/solutions (useGateSolutions); ratify ← useApp().ratifyWith
   with `chosen_solution`. The mock's richer fields (grounded_on object, delta_note object, per-solution
   conflict, client-side regen preview) collapse onto the real Zod shapes. TierBadge + GATE_META stay
   exported so RelayBoard composes them. */
import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AgreementCard } from "./AgreementCard";
import { toast } from "sonner";
import { Avatar, Badge, DiscDot, DISC, StatusIcon, CapTag, Button } from "../components/ui";
import { Icon, ZeroMark, type IconName } from "../lib/icon";
import { useApp } from "../app/useApp";
import { useGateSolutions } from "../features/relay/useRelay";
import { api } from "../lib/api";
import { qk } from "../lib/query";
import type { SolutionCard, Discipline, HandoffCandidate } from "../lib/api";

/* ───────── routing-tier presentation (§10) — the two_expert tier is the ink "spark" ───────── */
const TIER_META: Record<string, { label: string; experts: number; fg: string; bg: string }> = {
  auto_pass:  { label: "owner only", experts: 0, fg: "var(--text-tertiary)",  bg: "var(--bg-secondary)" },
  one_expert: { label: "1 expert",  experts: 1, fg: "var(--text-secondary)", bg: "var(--bg-secondary)" },
  two_expert: { label: "2 experts", experts: 2, fg: "var(--text-primary)",   bg: "var(--bg-active)" },
};

export const GATE_META: Record<string, { label: string; tone: string; fg: string }> = {
  ratified:          { label: "Ratified",          tone: "green",   fg: "var(--green)" },
  auto_passed:       { label: "Auto-passed",       tone: "blue",    fg: "var(--blue)" },
  changes_requested: { label: "Changes requested", tone: "amber",   fg: "var(--amber)" },
  blocked:           { label: "Blocked",           tone: "red",     fg: "var(--red)" },
  locked:            { label: "Locked",            tone: "neutral", fg: "var(--text-quaternary)" },
  pending:           { label: "Pending",           tone: "outline", fg: "var(--text-tertiary)" },
};

const GRADE_META: Record<string, { label: string; step: number; proven: boolean; hint: string }> = {
  proposed:        { label: "Proposed",        step: 1, proven: false, hint: "not yet proven" },
  shipped:         { label: "Shipped",         step: 2, proven: false, hint: "merged, not battle-tested" },
  prod_survived:   { label: "Prod-survived",   step: 3, proven: true,  hint: "survived in production" },
  retro_validated: { label: "Retro-validated", step: 4, proven: true,  hint: "confirmed in retro" },
};

export function GradeChip({ grade, showLabel = true }: { grade?: string; showLabel?: boolean }) {
  const m = GRADE_META[grade ?? ""] || GRADE_META.proposed;
  return (
    <span title={`${m.label} · ${m.hint}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 18,
      padding: "0 7px 0 6px", borderRadius: "var(--r-sm)", background: "var(--bg-secondary)", border: "0.5px solid var(--border)" }}>
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

// #33 — the green/orange/grey triage dot (server-derived). green=earned reuse · orange=look/contested · grey=unproven.
const SIGNAL_META: Record<string, { color: string; label: string }> = {
  green:  { color: "var(--green)", label: "earned — confident + grounded" },
  orange: { color: "var(--amber)", label: "weigh this — middling or contested" },
  grey:   { color: "var(--text-quaternary)", label: "unproven — the AI's own bet" },
};
export function SignalDot({ signal }: { signal?: string }) {
  const m = SIGNAL_META[signal ?? "grey"] || SIGNAL_META.grey;
  return <span title={m.label} style={{ width: 8, height: 8, borderRadius: "50%", background: m.color, flexShrink: 0, display: "inline-block" }} />;
}

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
          <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: i < m.experts ? "currentColor" : "var(--border-strong)" }} />
        ))}
      </span>
      {m.label}
    </span>
  );
}

const SOURCE_META: Record<string, { label: string }> = {
  memory: { label: "Reuse · memory" }, ai: { label: "Fresh · AI" }, user: { label: "Yours" },
};
const chipBox: React.CSSProperties = { width: 26, height: 26, borderRadius: "var(--r-sm)", flexShrink: 0,
  display: "grid", placeItems: "center", background: "var(--bg-secondary)", border: "0.5px solid var(--border)" };

function SourceMark({ source, name }: { source: string; name?: string }) {
  if (source === "ai") return <span style={chipBox}><ZeroMark size={14} /></span>;
  if (source === "user") return <Avatar name={name || "You"} size={26} tone="ink" />;
  return <span style={{ ...chipBox, background: "var(--bg-active)" }} title="reused from a shipped project"><Icon name="clock" size={14} style={{ color: "var(--text-secondary)" }} /></span>;
}

/* smooth open-down: grid-rows 0fr→1fr animates height with no snap */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0,
      transition: "grid-template-rows 0.30s var(--ease-out), opacity 0.22s var(--ease-out)" }}>
      <div style={{ overflow: "hidden", minHeight: 0 }}>{children}</div>
    </div>
  );
}

/* a file the choice touches, tagged by change kind: add (green +) · modify (amber doc) · remove (red ×) */
type FileChange = { path: string; change?: "add" | "modify" | "remove" };
const FC_META: Record<string, { icon: IconName; color: string }> = {
  add:    { icon: "plus",  color: "var(--green)" },
  modify: { icon: "doc",   color: "var(--amber)" },
  remove: { icon: "close", color: "var(--red)" },
};
/* prefer the typed file_changes; fall back to a bare impacted_files list (rendered as all-modify) */
function fileChangesOf(s: { file_changes?: FileChange[]; impacted_files?: string[] } | null | undefined): FileChange[] {
  if (s?.file_changes?.length) return s.file_changes;
  return (s?.impacted_files ?? []).map((path) => ({ path, change: "modify" as const }));
}
function FileRow({ fc }: { fc: FileChange }) {
  const m = FC_META[fc.change ?? "modify"] ?? FC_META.modify;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: "var(--r-sm)", background: "var(--bg-secondary)" }}>
      <Icon name={m.icon} size={12} style={{ color: m.color, flexShrink: 0 }} />
      <span className="mono" style={{ fontSize: 11, color: "var(--text-secondary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fc.path}</span>
    </div>
  );
}

/* §reuse — the cited source files for a chosen memory solution (the reuse agreement made executable):
   link + file list now; the seed-the-focus-branch step lands at dispatch. "built before → here it is." */
function ReusePack({ projects }: { projects: string[] }) {
  const { data } = useQuery({ queryKey: ["reusePack", projects.join(",")], queryFn: () => api.reusePack(projects), enabled: projects.length > 0 });
  const files = (data?.files ?? []).filter((f) => /\.(py|ts|tsx|js|jsx|sql|go|rs|vue)$/.test(f.file_path)).slice(0, 6);
  if (!files.length) return null;
  return (
    <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: "var(--r-sm)", background: "var(--bg-secondary)", border: "0.5px solid var(--border)" }}>
      <div className="mono" style={{ fontSize: 9.5, color: "var(--text-quaternary)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 5 }}>Reuse pack · {files.length} files</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {files.map((f) => (
          <a key={f.file_path} href={f.web_url} target="_blank" rel="noreferrer" className="mono"
            style={{ fontSize: 11, color: "var(--text-secondary)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="relay" size={10} style={{ color: "var(--text-quaternary)" }} />{f.file_path}
          </a>
        ))}
      </div>
    </div>
  );
}

/* one selectable solution card — collapsed headline, detail on demand */
function SolutionCardView({ s, selected, recommended, interactive, onSelect }:
  { s: SolutionCard; selected: boolean; recommended: boolean; interactive: boolean; onSelect: () => void }) {
  const [open, setOpen] = useState(false);
  const meta = SOURCE_META[s.source] || SOURCE_META.ai;
  const star = s.source === "memory";
  return (
    <div onClick={() => interactive && onSelect()}
      style={{ borderRadius: "var(--r-lg)", overflow: "hidden", background: "var(--bg-elevated)", border: "0.5px solid var(--border)",
        boxShadow: selected ? "0 0 0 1.5px var(--text-primary), var(--shadow-2)" : "var(--shadow-1)",
        cursor: interactive ? "pointer" : "default", transition: "box-shadow var(--t-quick)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "12px 13px" }}>
        {interactive && (
          <span style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 3, display: "grid", placeItems: "center",
            background: selected ? "var(--ink-fill)" : "transparent", border: selected ? "none" : "1.5px solid var(--border-strong)" }}>
            {selected && <Icon name="check" size={11} style={{ color: "#fff" }} />}
          </span>
        )}
        <SourceMark source={s.source} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <SignalDot signal={s.signal} />
            <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
              color: star ? "var(--text-primary)" : "var(--text-quaternary)" }}>{meta.label}</span>
            {s.source === "memory" && s.grade && <GradeChip grade={s.grade} />}
            {recommended && <Badge tone="ink" style={{ height: 15 }}>sprint0 pick</Badge>}
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.2px", margin: "3px 0 0", color: "var(--text-primary)" }}>{s.title}</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.45, marginTop: 3 }}>{s.summary}</div>
          {star && s.grounded_on.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="relay" size={12} style={{ color: "var(--text-tertiary)" }} />
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Reuse {s.grounded_on.join(" · ")}</span>
            </div>
          )}
          {star && s.grounded_on.length > 0 && <ReusePack projects={s.grounded_on} />}
          {s.delta_note && (
            <div style={{ marginTop: 7 }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--text-tertiary)", background: "var(--bg-secondary)", padding: "2px 7px", borderRadius: "var(--r-xs)" }}>{s.delta_note}</span>
            </div>
          )}
          {s.conflict && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "flex-start", gap: 6, padding: "6px 9px", borderRadius: "var(--r-sm)",
              background: "var(--bg-secondary)", border: "0.5px solid var(--amber)" }}>
              <Icon name="warn" size={12} style={{ color: "var(--amber)", marginTop: 1, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>{s.conflict_reason || "Contradicts a past team decision."}</span>
            </div>
          )}
        </div>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
          <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: s.confidence >= 75 ? "var(--text-primary)" : s.confidence >= 60 ? "var(--text-secondary)" : "var(--amber)" }}>{s.confidence}</span>
          <span className="mono" style={{ fontSize: 9.5, color: "var(--text-quaternary)" }}>conf</span>
        </span>
      </div>
      <button onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 13px", borderTop: "0.5px solid var(--border-subtle)", background: "transparent", textAlign: "left" }}>
        <Icon name="chevronRight" size={12} style={{ color: "var(--text-quaternary)", transform: open ? "rotate(90deg)" : "none", transition: "transform var(--t-quick)" }} />
        <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-tertiary)" }}>{open ? "Hide detail" : "Detail"}</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="check" size={12} style={{ color: "var(--green)" }} /><span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>{s.pros.length}</span></span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="close" size={12} style={{ color: "var(--red)" }} /><span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>{s.cons.length}</span></span>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)", marginLeft: 4 }}>{s.impacted_files.length} files</span>
      </button>
      <Collapse open={open}>
        <div onClick={(e) => e.stopPropagation()} style={{ padding: "0 13px 13px", cursor: "default" }}>
          {s.rationale && <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)", margin: "2px 0 12px" }}>{s.rationale}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div className="kicker" style={{ marginBottom: 6 }}>For</div>
              {s.pros.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <Icon name="check" size={12} style={{ color: "var(--green)", flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>{p}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="kicker" style={{ marginBottom: 6 }}>Against</div>
              {s.cons.length ? s.cons.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <Icon name="close" size={12} style={{ color: "var(--red)", flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>{c}</span>
                </div>
              )) : <span style={{ fontSize: 11.5, color: "var(--text-quaternary)" }}>None flagged.</span>}
            </div>
          </div>
          {/* impacted files live ONLY in the "Your pick touches" panel below (one place, on selection) — no dup here */}
        </div>
      </Collapse>
    </div>
  );
}

/* the write-your-own slot — title + reasoning; the backend regenerates the gate's task on ratify */
function WriteYourOwn({ selected, interactive, onSelect, onChange, custom, meName }:
  { selected: boolean; interactive: boolean; onSelect: () => void; onChange: (c: { title: string; reasoning: string }) => void; custom: { title: string; reasoning: string } | null; meName?: string }) {
  const title = custom?.title ?? "";
  const reasoning = custom?.reasoning ?? "";
  return (
    <div onClick={() => interactive && onSelect()}
      style={{ borderRadius: "var(--r-lg)", background: "var(--bg-elevated)",
        border: selected ? "1.5px solid var(--text-primary)" : "0.5px dashed var(--border-strong)",
        boxShadow: selected ? "var(--shadow-2)" : "none", cursor: interactive ? "pointer" : "default", transition: "border-color var(--t-quick)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 13px" }}>
        {interactive && (
          <span style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
            background: selected ? "var(--ink-fill)" : "transparent", border: selected ? "none" : "1.5px solid var(--border-strong)" }}>
            {selected && <Icon name="check" size={11} style={{ color: "#fff" }} />}
          </span>
        )}
        <SourceMark source="user" name={meName} />
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-quaternary)" }}>Yours</div>
          <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.2px", marginTop: 2 }}>Write your own</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>Title it and say why — sprint0 adapts this gate's task to match.</div>
        </div>
      </div>
      <Collapse open={selected}>
        <div onClick={(e) => e.stopPropagation()} style={{ padding: "0 13px 13px", cursor: "default" }}>
          <input value={title} onChange={(e) => onChange({ title: e.target.value, reasoning })}
            placeholder="Your approach — a short title"
            style={{ width: "100%", padding: "9px 11px", fontSize: 13, fontWeight: 500, marginBottom: 8, background: "var(--bg-elevated)",
              border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)", outline: "none", color: "var(--text-primary)", boxShadow: "var(--shadow-inset)", fontFamily: "var(--font-ui)" }} />
          <textarea value={reasoning} onChange={(e) => onChange({ title, reasoning: e.target.value })} rows={2}
            placeholder="Why this over the options above…"
            style={{ width: "100%", padding: "9px 11px", fontSize: 12.5, lineHeight: 1.5, resize: "none", background: "var(--bg-elevated)",
              border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)", outline: "none", color: "var(--text-primary)", boxShadow: "var(--shadow-inset)", fontFamily: "var(--font-ui)" }} />
        </div>
      </Collapse>
    </div>
  );
}

type Choice = { solutionId: string; custom: { title: string; reasoning: string } | null };

/* the solution set: live from GET /api/plans/{id}/gates/{disc}/solutions */
function SolutionsBlock({ planId, disc, interactive, choice, onPick, onWriteOwn, meName }:
  { planId: string | null; disc: Discipline; interactive: boolean; choice: Choice | null;
    onPick: (id: string) => void; onWriteOwn: (c: { title: string; reasoning: string }) => void; meName?: string }) {
  const { data: set, isLoading } = useGateSolutions(planId, disc);
  // AI/memory cards only — the write-your-own is the frontend's own slot below (filter guards a stale set).
  const sols: SolutionCard[] = (set?.solutions ?? []).filter((s) => s.source !== "user");
  const recommended = sols.reduce<SolutionCard | null>((best, s) => (!best || s.confidence > best.confidence ? s : best), null)?.id;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <ZeroMark size={15} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{interactive ? "Reuse or innovate?" : "Solutions"}</span>
        <div style={{ flex: 1 }} />
        {!isLoading && <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>{sols.length} + your own</span>}
      </div>
      {isLoading ? (
        <div className="mono" style={{ fontSize: 11.5, color: "var(--text-quaternary)", padding: "10px 0" }}>sprint0 is grounding solutions on agency memory…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {sols.map(s => (
            <SolutionCardView key={s.id} s={s} selected={choice?.solutionId === s.id} recommended={recommended === s.id} interactive={interactive} onSelect={() => onPick(s.id)} />
          ))}
          {interactive && (
            <WriteYourOwn selected={choice?.solutionId === "user"} interactive={interactive} meName={meName}
              custom={choice?.solutionId === "user" ? choice.custom : null}
              onSelect={() => onWriteOwn(choice?.solutionId === "user" && choice.custom ? choice.custom : { title: "", reasoning: "" })}
              onChange={(c) => onWriteOwn(c)} />
          )}
        </div>
      )}
    </div>
  );
}

/* Hand off this gate (+ its slice) to a teammate — passport-ranked picker (★ = best fit). Human-in-control:
   a lead who doesn't want to make this call passes it on; the recipient sees it OPEN in their Relays. */
function HandoffControl({ planId, disc }: { planId: string; disc: string }) {
  const qc = useQueryClient();
  const [cands, setCands] = useState<HandoffCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.gateCandidates(planId, disc).then((r) => setCands(r.candidates)).catch(() => setCands([])); }, [planId, disc]);
  const hand = (u: string) => {
    setBusy(true);
    api.handoffGate(planId, disc, u)
      .then(() => { qc.invalidateQueries({ queryKey: qk.relay(planId) }); qc.invalidateQueries({ queryKey: qk.allRelays() }); toast.success(u ? "Gate handed off — it's now in their Relays." : "Delegation cleared."); })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
      .finally(() => setBusy(false));
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10 }}>
      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Not your call to make? Hand off</span>
      <select value="__" disabled={busy}
        onChange={(e) => { const v = e.target.value; if (v === "__") return; hand(v === "__clear__" ? "" : v); e.currentTarget.value = "__"; }}
        title="Ranked by passport fit — trust in this lane, availability, lane-match, seniority"
        style={{ padding: "4px 8px", border: "0.5px solid var(--border-strong)", borderRadius: 8, fontSize: 11.5, background: "var(--bg-elevated)", fontFamily: "inherit", cursor: busy ? "not-allowed" : "pointer" }}>
        <option value="__" disabled>Recommend &amp; hand off…</option>
        {cands.map((c, i) => <option key={c.username} value={c.username}>{i === 0 ? "★ " : ""}{c.name} · {c.score}% · {c.in_lane ? "in-lane" : "stretch"}</option>)}
        <option value="__clear__">— Clear delegation —</option>
      </select>
    </div>
  );
}

/* Read-only review of a DONE gate — the single validated card (the ratified pick, or the sprint0 pick an
   auto-pass cleared), instead of the picker. A decision receipt, not a choice. */
function GateReview({ set, status }: { set: any; status: string }) {
  const sols: SolutionCard[] = set?.solutions ?? [];
  const recommended = sols.reduce<SolutionCard | null>((best, s) => (!best || s.confidence > best.confidence ? s : best), null);
  const chosen: SolutionCard | null = set?.chosen ?? recommended;
  const autoPassed = status === "auto_passed";
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="kicker" style={{ marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 7 }}>
        <Icon name={autoPassed ? "ratify" : "check"} size={13} style={{ color: autoPassed ? "var(--blue)" : "var(--green)" }} />
        {autoPassed ? "Auto-passed · the sprint0 pick stands" : "Validated · what you chose"}
      </div>
      {chosen
        ? <SolutionCardView s={chosen} selected recommended={autoPassed} interactive={false} onSelect={() => {}} />
        : <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", padding: 14, border: "0.5px dashed var(--border-strong)", borderRadius: "var(--r-lg)", textAlign: "center" }}>No recorded choice for this gate.</div>}
    </div>
  );
}

/* Right sub-panel: the feature frame · the solution choice · the slice · forward-only ratify. */
export function RatifyPanel({ g, layout = "panel" }: { g: any; layout?: "panel" | "page" }) {
  const { me, chrome, members, planId, ratifyWith, personFilter }: any = useApp();
  const byUser = (u: string) => members?.find((m: any) => m.username === u);
  const meta = GATE_META[g.status];
  // the real slice — this plan's issues for this discipline (shared ["plan", planId] query, cached across gates)
  const { data: plan } = useQuery({ queryKey: ["plan", planId], queryFn: () => api.getPlan(planId), enabled: !!planId });
  const slice = useMemo(() => (plan?.epics ?? [])
    .flatMap((e: any) => e.issues ?? [])
    .filter((i: any) => i.discipline === g.discipline)
    .map((i: any) => ({ id: i.id, t: i.title, s: "planned", tags: i.capability_tags ?? [] })), [plan, g.discipline]);
  const done = g.status === "ratified" || g.status === "auto_passed";
  // A dev owns their own discipline's gate; the manager sees all; a granted Watch (personFilter) is read-only.
  // (Gate.owner is unset in the adapter, so ownership is by discipline — exact in the demo's one-dev-per-lane.)
  // a delegated gate is the delegate's to ratify (not the original lead's); else the discipline lead's.
  const ownsThisGate = !personFilter && (chrome.seesAllGates || (g.delegate ? g.delegate === me.username : me.discipline === g.discipline));
  // a gate is actionable only when it's on the baton (deps cleared → relay flips locked→pending). Gating on
  // depends.length wrongly locked every frontend/qa gate (they always have deps) — incl. a handed-off one.
  const locked = !done && g.status !== "pending" && g.status !== "changes_requested";
  const interactive = !done && !locked && ownsThisGate;
  const flaggedHere = g.status === "changes_requested";

  const [choice, setChoice] = useState<Choice | null>(null);
  const { data: set } = useGateSolutions(interactive || done ? planId : null, g.discipline);  // done → for the review
  const selectedSol = choice && choice.solutionId !== "user" ? (set?.solutions ?? []).find(s => s.id === choice.solutionId) ?? null : null;
  const isCustom = choice?.solutionId === "user";
  const customFilled = isCustom && !!choice?.custom?.title?.trim();
  const hasPick = !!selectedSol || !!customFilled;

  const doRatify = () => {
    if (!choice) return;
    const chosen: SolutionCard = selectedSol ?? {
      id: "user", source: "user", title: choice.custom!.title, summary: choice.custom!.reasoning,
      rationale: choice.custom!.reasoning, pros: [], cons: [], confidence: 0, grounded_on: [], delta_note: "", impacted_files: [],
      conflict: false, conflict_reason: "", grade: null, signal: "grey",
    };
    ratifyWith(g.discipline, chosen, choice.custom?.reasoning ?? "");
  };

  return (
    <div style={{ ...(layout === "page"
        ? { flex: 1, minWidth: 0, border: "0.5px solid var(--border)", borderRadius: "var(--r-xl)", overflow: "hidden" }
        : { width: 400, flexShrink: 0, borderLeft: "0.5px solid var(--border)" }),
      display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg-elevated)", animation: "s0-panel-in var(--t-reg) var(--ease-out) both" }} key={g.discipline}>
      <div style={{ height: "var(--topbar-h)", display: "flex", alignItems: "center", gap: 8, padding: "0 14px", borderBottom: "0.5px solid var(--border-subtle)" }}>
        <DiscDot d={g.discipline} size={9} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{DISC[g.discipline].label} gate</span>
        {g.stretched && <Badge tone="outline" mono style={{ height: 16 }}>▲ stretched</Badge>}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, fontWeight: 500, color: meta.fg }}>{meta.label}</span>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {/* a Contract is a Feature — this gate is the discipline's slice of it */}
        <div style={{ padding: "11px 13px", borderRadius: "var(--r-lg)", background: "var(--bg-secondary)", border: "0.5px solid var(--border)", marginBottom: 16 }}>
          <span className="kicker">Gate</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7 }}>
            <DiscDot d={g.discipline} size={8} />
            <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>This gate — the <b style={{ fontWeight: 600 }}>{DISC[g.discipline].label}</b> slice. {done ? "The validated choice is shown below." : "The AI proposes solutions; you pick one (or write your own)."}</span>
          </div>
          {g.delegate && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 9, height: 20, padding: "0 8px", borderRadius: "var(--r-pill)", background: "var(--bg-active)", border: "0.5px solid var(--text-primary)" }}>
              <Icon name="eye" size={11} style={{ color: "var(--text-primary)" }} />
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Handed to <b style={{ fontWeight: 600 }}>@{g.delegate}</b></span>
            </div>
          )}
          {ownsThisGate && !done && <HandoffControl planId={planId} disc={g.discipline} />}
        </div>

        {flaggedHere && (
          <div style={{ display: "flex", gap: 9, padding: "10px 12px", borderRadius: "var(--r-md)", marginBottom: 16, background: "var(--bg-active)", border: "0.5px solid var(--text-primary)" }}>
            <Icon name="flag" size={14} style={{ color: "var(--text-primary)", flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              <b style={{ color: "var(--text-primary)", fontWeight: 600 }}>Back for a re-ratify.</b> Another gate's chosen solution now touches this slice. Re-pick — nothing was rewritten for you.
            </div>
          </div>
        )}

        {/* done → a read-only review of the validated choice; else the reuse-or-innovate picker */}
        {done
          ? <GateReview set={set} status={g.status} />
          : <SolutionsBlock planId={planId} disc={g.discipline} interactive={interactive} choice={choice} meName={me.name}
              onPick={(id) => setChoice({ solutionId: id, custom: null })}
              onWriteOwn={(c) => setChoice({ solutionId: "user", custom: c })} />}

        {/* the picked solution's impacted files — per-choice, tagged add/modify/remove */}
        {interactive && selectedSol && fileChangesOf(selectedSol).length > 0 && (() => {
          const fcs = fileChangesOf(selectedSol);
          return (
            <div style={{ marginBottom: 18, animation: "s0-pop-in var(--t-reg) var(--ease-out) both" }}>
              <div className="kicker" style={{ marginBottom: 8 }}>Your pick touches · {fcs.length} files</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>{fcs.map(fc => <FileRow key={fc.path} fc={fc} />)}</div>
              <div style={{ fontSize: 11, color: "var(--text-quaternary)", marginTop: 7, lineHeight: 1.45 }}>If this overlaps another discipline's slice, ratifying flags that gate for a re-ratify — nothing is silently rewritten.</div>
            </div>
          );
        })()}

        <div className="kicker" style={{ marginBottom: 8 }}>The slice · {slice.length} task{slice.length === 1 ? "" : "s"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 16 }}>
          {slice.map(i => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 34, padding: "5px 8px", borderRadius: "var(--r-md)" }}>
              <StatusIcon status={i.s} size={14} />
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", width: 60, flexShrink: 0 }}>{i.id}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.t}</div>
                <div style={{ display: "flex", gap: 4, marginTop: 3 }}>{i.tags.map((t: string) => <CapTag key={t} tag={t} />)}</div>
              </div>
              {i.s === "blocked" && <Badge tone="red">blocked</Badge>}
            </div>
          ))}
        </div>

        {/* gate-folds-contract: the interface contracts this discipline produces/consumes, JIT + light (collapsed).
            Only in the side-panel layout — on the Gate × Contract page the right column owns the contract (no dup). */}
        {layout !== "page" && <GateContracts planId={planId} discipline={g.discipline} me={me} />}

        {locked && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--bg-secondary)", marginBottom: 16 }}>
            <Icon name="lock" size={14} style={{ color: "var(--text-tertiary)" }} />
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Read-ahead — solutions preview here. Selection opens once {g.depends.map((d: string) => DISC[d].label).join(", ")} passes the baton.</span>
          </div>
        )}
        {!ownsThisGate && !done && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--bg-secondary)", marginBottom: 16 }}>
            <Icon name="eye" size={14} style={{ color: "var(--text-tertiary)" }} />
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{personFilter ? "Reviewing this gate via your Watch — read-only, you can't make the call." : `This isn't your gate — ${byUser(g.owner)?.name?.split(" ")[0] || "the owner"} makes the call. You're viewing.`}</span>
          </div>
        )}
      </div>

      <div style={{ borderTop: "0.5px solid var(--border-subtle)", padding: 10, display: "flex", gap: 8 }}>
        {done ? (
          <Button variant="secondary" size="md" icon="ratify" style={{ flex: 1 }} disabled>{g.status === "auto_passed" ? "Auto-passed" : "Already cleared"}</Button>
        ) : locked ? (
          <Button variant="secondary" size="md" icon="lock" style={{ flex: 1 }} disabled>Locked</Button>
        ) : !ownsThisGate ? (
          <Button variant="secondary" size="md" icon="eye" style={{ flex: 1 }} disabled>Not your gate</Button>
        ) : (
          <Button variant="primary" size="md" icon="ratify" style={{ flex: 1, opacity: hasPick ? 1 : 0.5, pointerEvents: hasPick ? "auto" : "none" }} onClick={doRatify}>
            {hasPick ? "Ratify selection" : "Pick a solution"}
          </Button>
        )}
      </div>
    </div>
  );
}

/* The interface contracts THIS gate produces or consumes — folded into the gate, surfaced just-in-time.
   Light: collapsed by default (the slice pick stays primary); the header reads as a count-to-sign, not a
   wall of API tables. Reuses the same planAgreements query + AgreementCard + ratify mutation as the board. */
function GateContracts({ planId, discipline, me }: { planId: string | null; discipline: string; me: any }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["planAgreements", planId], queryFn: () => api.planAgreements(planId as string), enabled: !!planId });
  const ags = (data?.agreements ?? []).filter((a) => a.type === "interface"
    && (a.producer_discipline === discipline || a.consumer_discipline === discipline));
  if (!ags.length) return null;
  // contracts awaiting THIS viewer: their lane to pick/sign (proposed) or to agree/counter (active)
  const toSign = ags.filter((a) => (a.ratifiers ?? []).includes(me.username) && (a.state === "proposed" || a.state === "active")).length;
  return (
    <div style={{ marginBottom: 16, border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "10px 13px", textAlign: "left", background: "var(--bg-secondary)", borderBottom: open ? "0.5px solid var(--border-subtle)" : "none" }}>
        <Icon name="relay" size={14} style={{ color: toSign > 0 ? "var(--text-primary)" : "var(--text-tertiary)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{toSign > 0 ? `${toSign} ${toSign === 1 ? "contract" : "contracts"} to sign` : "Contracts"}</span>
        <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>— this gate produces / consumes, just-in-time</span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{ags.length}</span>
        <Icon name="chevronDown" size={14} style={{ color: "var(--text-quaternary)", transform: open ? "none" : "rotate(-90deg)", transition: "transform var(--t-quick)" }} />
      </button>
      {open && (
        <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 10, background: "var(--bg-base)" }}>
          {ags.map((a) => <AgreementCard key={a.id} a={a} me={me} />)}
        </div>
      )}
    </div>
  );
}
