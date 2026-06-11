/* sprint0 — Capability Profiles (§11). A FLAT skills list: each profile is one row (label · skill
   keywords · the lane it maps to). No per-row status tag — the SECTION TITLE carries the status
   (amber = awaiting your confirm · green = confirmed · ink = the default profile that ships). The whole
   list caps to one page and scrolls, so a growing taxonomy never pushes the roster off-screen.

   Ported from the v6 Claude Design Profiles.jsx; data source: useApp() → GET /api/profiles
   (each: label · summary · skill_keywords · default_lane · status). */
import { useState } from "react";
import { useApp } from "../app/useApp";
import { Button, CapTag, DiscDot, DISC } from "../components/ui";
import { ViewChrome } from "../components/ViewChrome";
import type { CapabilityProfile } from "../lib/schemas";

const SECTION_TONE: Record<string, { fg: string; dot: string }> = {
  proposed:  { fg: "var(--amber)", dot: "var(--amber)" },
  confirmed: { fg: "var(--green)", dot: "var(--green)" },
  default:   { fg: "var(--text-primary)", dot: "var(--text-primary)" },
};

export function Profiles({ embedded = false }: { embedded?: boolean } = {}) {
  const { profiles, confirmProfile, role } = useApp();
  const canConfirm = role === "manager";

  const proposed = profiles.filter((p) => p.status === "proposed");
  const confirmed = profiles.filter((p) => p.status === "confirmed");
  const seed = profiles.filter((p) => p.status === "seed");

  const body = (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: embedded ? "20px 24px 32px" : "24px 24px 32px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
        <h1 style={{ fontSize: embedded ? 17 : 20, fontWeight: 600, letterSpacing: "-0.3px", margin: 0 }}>Capability profiles</h1>
        <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
          the skills sprint0 routes by{proposed.length > 0 && <> · <b style={{ color: "var(--amber)" }}>{proposed.length} awaiting confirm</b></>}
        </span>
      </div>

      {/* one capped, scrollable well so a long taxonomy fits a page */}
      <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden",
        boxShadow: "var(--shadow-1)", background: "var(--bg-elevated)" }}>
        <div style={{ maxHeight: embedded ? "calc(100vh - 220px)" : "calc(100vh - 220px)", overflow: "auto" }}>
          {proposed.length > 0 && (
            <FlatSection title="Proposed — awaiting confirm" hint="grown from unknown task tags" status="proposed" count={proposed.length}>
              {proposed.map((p) => <ProfileRow key={p.id} p={p} canConfirm={canConfirm} onConfirm={() => confirmProfile(p.id)} />)}
            </FlatSection>
          )}
          <FlatSection title="Confirmed" hint="can shape a lane" status="confirmed" count={confirmed.length}>
            {confirmed.map((p) => <ProfileRow key={p.id} p={p} />)}
          </FlatSection>
          <FlatSection title="Default profile" hint="ships by default" status="default" count={seed.length} last>
            {seed.map((p) => <ProfileRow key={p.id} p={p} />)}
          </FlatSection>
        </div>
      </div>
    </div>
  );

  if (embedded) return body;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Team", "Capabilities"]}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{profiles.length} profiles</span>
      </ViewChrome>
      <div style={{ flex: 1, overflow: "auto" }}>{body}</div>
    </div>
  );
}

/* a sticky, status-colored section header + its rows */
function FlatSection({ title, hint, status, count, last, children }: {
  title: string; hint: string; status: string; count: number; last?: boolean; children: React.ReactNode;
}) {
  const tone = SECTION_TONE[status] || SECTION_TONE.default;
  return (
    <div style={{ borderBottom: last ? "none" : "0.5px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 14px",
        position: "sticky", top: 0, zIndex: 1, background: "var(--bg-secondary)", borderBottom: "0.5px solid var(--border-subtle)" }}>
        <span style={{ width: 6, height: 6, borderRadius: status === "proposed" ? 2 : "50%", background: tone.dot, flexShrink: 0 }} />
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: tone.fg }}>{title}</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-quaternary)" }}>{count}</span>
        <span style={{ fontSize: 11.5, color: "var(--text-quaternary)" }}>· {hint}</span>
      </div>
      {children}
    </div>
  );
}

/* one profile = one flat row */
function ProfileRow({ p, canConfirm, onConfirm }: { p: CapabilityProfile; canConfirm?: boolean; onConfirm?: () => void }) {
  const [h, setH] = useState(false);
  const proposed = p.status === "proposed";
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, padding: "8px 14px",
        background: h ? "var(--bg-hover)" : "transparent", borderBottom: "0.5px solid var(--border-subtle)", transition: "background var(--t-quick)" }}>
      <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", width: 138, flexShrink: 0,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1, minWidth: 0 }}>
        {p.skill_keywords.map((k) => <CapTag key={k} tag={k} />)}
      </div>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-tertiary)", flexShrink: 0, width: 96 }}>
        <DiscDot d={p.default_lane} />{DISC[p.default_lane]?.label || p.default_lane}
      </span>
      <div style={{ width: 116, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
        {proposed && (canConfirm
          ? <Button variant="secondary" size="sm" icon="check" onClick={onConfirm}>Confirm</Button>
          : <span style={{ fontSize: 11, color: "var(--text-quaternary)" }}>Tech Lead confirms</span>)}
      </div>
    </div>
  );
}
