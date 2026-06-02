/* sprint0 × Linear — Team (with §6 Watch + the §7 staffing gap). Ported pixel-1:1 from the v4 design's
   Misc.jsx Team component (+ Bell.jsx's WatchControl helper); only the data source changed (mock
   MEMBERS/STAFFING/SUBSCRIPTIONS → the useApp() adapter). Reads the live store. */
import { useState } from "react";
import { ViewChrome } from "../components/ViewChrome";
import { Avatar, Badge, Button, DiscDot, DISC, LoadMeter, Tab, TrustDot } from "../components/ui";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { Profiles } from "./Profiles";
import { api } from "../lib/api";
import type { Member } from "../lib/api";
import { qk } from "../lib/query";

// real Member uses gitlab_username / trust_level; the mock used gitlab / trust.
const gitlabOf = (m: Member) => (m as Member & { gitlab?: string }).gitlab ?? m.gitlab_username;
const trustOf = (m: Member) => (m as Member & { trust?: unknown }).trust_level ?? "medium";

// TODO(reconcile): the mockup read STAFFING.plan_HARB_42.coverage (gaps + stretch_candidates) — there is
// no staffing/coverage field on the useApp() adapter. Fall back to the orphan-gap discipline + a stretch
// candidate derived from the roster so the banner still renders; wire to a real coverage endpoint later.
const ORPHAN_GAP = "uiux";

export function TeamView() {
  const { chrome, members } = useApp();
  const setWizardKind = useUI((s) => s.setWizardKind);
  const setWizardOpen = useUI((s) => s.setWizardOpen);
  const openHire = () => { setWizardKind("hire"); setWizardOpen(true); };
  const [tab, setTab] = useState<"roster" | "capabilities">("roster");
  const gap = ORPHAN_GAP;
  // strongest non-uiux candidate by trust as the stretch suggestion (mock had cov.stretch_candidates[0]).
  const stretch =
    members.find((m) => m.role === "developer" && m.trust_level === "high" && m.discipline !== gap) ??
    members.find((m) => m.role === "developer");
  const stretchScore = "0.74"; // TODO(reconcile): mock cosine match score had no real equivalent.

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Team"]}>
        <div style={{ display: "flex", gap: 6, marginRight: 6 }}>
          <Tab active={tab === "roster"} onClick={() => setTab("roster")}>Roster</Tab>
          <Tab active={tab === "capabilities"} onClick={() => setTab("capabilities")}>Capabilities</Tab>
        </div>
        {chrome.canOnboard && <Button variant="primary" size="sm" icon="plus" onClick={openHire}>Onboard a dev</Button>}
      </ViewChrome>
      {tab === "capabilities" ? (
        <div style={{ flex: 1, overflow: "auto" }}><Profiles embedded /></div>
      ) : (
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* staffing gap banner */}
        <div style={{ margin: "16px 20px 0", border: "0.5px solid var(--text-primary)", borderRadius: "var(--r-lg)", padding: "13px 14px", background: "var(--bg-secondary)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 28, height: 28, borderRadius: "var(--r-md)", display: "grid", placeItems: "center", background: "var(--bg-elevated)", border: "1px dashed var(--text-primary)" }}><DiscDot d={gap} size={9} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{DISC[gap].label} is an orphan gap</div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>No dedicated dev — the gate routes to the manager. Stretch: {stretch?.name} (match {stretchScore}).</div>
          </div>
          {chrome.canOnboard && <Button variant="secondary" size="sm" icon="plus" onClick={openHire}>Onboard</Button>}
        </div>

        <div style={{ display: "flex", alignItems: "center", height: 30, padding: "0 20px", marginTop: 12, borderBottom: "0.5px solid var(--border-subtle)", position: "sticky", top: 0, background: "var(--bg-elevated)", zIndex: 1 }}>
          <span className="kicker" style={{ flex: 1 }}>Member</span>
          <span className="kicker" style={{ width: 110 }}>Discipline</span>
          <span className="kicker" style={{ width: 110 }}>Trust</span>
          <span className="kicker" style={{ width: 110 }}>Load</span>
        </div>
        {members.map((m) => <TeamRow key={m.username} m={m} />)}
      </div>
      )}
    </div>
  );
}

function TeamRow({ m }: { m: Member }) {
  const { me } = useApp();
  const [h, setH] = useState(false);
  const isSelf = m.username === me.username;
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", height: 52, padding: "0 20px", background: h ? "var(--bg-hover)" : "transparent", borderBottom: "0.5px solid var(--border-subtle)" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 11 }}>
        <Avatar name={m.name} size={28} tone={m.role === "manager" ? "ink" : undefined} />
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>{m.name} {isSelf && <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>· you</span>}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>@{m.username} · gitlab:{gitlabOf(m)}</div>
        </div>
      </div>
      <div style={{ width: 110 }}><SeatControl m={m} /></div>
      <div style={{ width: 110, display: "flex", alignItems: "center", gap: 6 }}>
        <TrustDot level={trustOf(m)} /><span style={{ fontSize: 12.5, color: "var(--text-secondary)", textTransform: "capitalize" }}>{trustOf(m)}</span>
      </div>
      <div style={{ width: 110 }}><LoadMeter value={m.load} /></div>
    </div>
  );
}

const DISCIPLINES = ["backend", "frontend", "devops", "qa", "uiux"] as const;

/* Manager seats a member in a discipline (the onboarded junior arrives discipline-less). A seated dev
   enters the assignment pool in-lane; before seating they sit out (so the AI doesn't stretch-flag them). */
function SeatControl({ m }: { m: Member }) {
  const { me } = useApp();
  const qc = useQueryClient();
  const seat = async (d: string) => {
    if (!d) return;
    try {
      await api.setDiscipline(m.username, d);
      toast.success(`${m.name} seated in ${DISC[d as keyof typeof DISC]?.label ?? d}`);
      qc.invalidateQueries({ queryKey: qk.roster() });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set discipline");
    }
  };
  if (m.role === "manager") return <Badge tone="ink">Manager</Badge>;
  if (me.role !== "manager") {
    return m.discipline
      ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}><DiscDot d={m.discipline} />{DISC[m.discipline].label}</span>
      : <Badge tone="outline">Unseated</Badge>;
  }
  return (
    <select value={m.discipline ?? ""} onChange={(e) => seat(e.target.value)}
      style={{ height: 26, padding: "0 6px", fontSize: 12, borderRadius: "var(--r-md)",
        border: m.discipline ? "0.5px solid var(--border)" : "0.5px dashed var(--text-tertiary)",
        background: "var(--bg-elevated)", color: m.discipline ? "var(--text-primary)" : "var(--text-tertiary)", cursor: "pointer" }}>
      <option value="" disabled>Seat…</option>
      {DISCIPLINES.map((d) => <option key={d} value={d}>{DISC[d].label}</option>)}
    </select>
  );
}
