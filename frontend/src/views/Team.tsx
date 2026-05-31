/* sprint0 × Linear — Team (with §6 Watch + the §7 staffing gap). Ported pixel-1:1 from the v4 design's
   Misc.jsx Team component (+ Bell.jsx's WatchControl helper); only the data source changed (mock
   MEMBERS/STAFFING/SUBSCRIPTIONS → the useApp() adapter). Reads the live store. */
import { useState } from "react";
import { Icon } from "../lib/icon";
import { ViewChrome } from "../components/ViewChrome";
import { Avatar, Badge, Button, DiscDot, DISC, LoadMeter, TrustDot } from "../components/ui";
import { useApp } from "../app/useApp";
import type { Member } from "../lib/api";

// real Member uses gitlab_username / trust_level; the mock used gitlab / trust.
const gitlabOf = (m: Member) => (m as Member & { gitlab?: string }).gitlab ?? m.gitlab_username;
const trustOf = (m: Member) => (m as Member & { trust?: unknown }).trust_level ?? "medium";

// TODO(reconcile): the mockup read STAFFING.plan_HARB_42.coverage (gaps + stretch_candidates) — there is
// no staffing/coverage field on the useApp() adapter. Fall back to the orphan-gap discipline + a stretch
// candidate derived from the roster so the banner still renders; wire to a real coverage endpoint later.
const ORPHAN_GAP = "uiux";

export function TeamView() {
  const { chrome, subs, members } = useApp();
  const gap = ORPHAN_GAP;
  // strongest non-uiux candidate by trust as the stretch suggestion (mock had cov.stretch_candidates[0]).
  const stretch =
    members.find((m) => m.role === "developer" && m.trust_level === "high" && m.discipline !== gap) ??
    members.find((m) => m.role === "developer");
  const stretchScore = "0.74"; // TODO(reconcile): mock cosine match score had no real equivalent.

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Team"]}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", marginRight: 6 }}>watching {subs.watching.length} · watchers {subs.watchers.length}</span>
        {chrome.canOnboard && <Button variant="primary" size="sm" icon="plus">Onboard a dev</Button>}
      </ViewChrome>
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* staffing gap banner */}
        <div style={{ margin: "16px 20px 0", border: "0.5px solid var(--text-primary)", borderRadius: "var(--r-lg)", padding: "13px 14px", background: "var(--bg-secondary)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 28, height: 28, borderRadius: "var(--r-md)", display: "grid", placeItems: "center", background: "var(--bg-elevated)", border: "1px dashed var(--text-primary)" }}><DiscDot d={gap} size={9} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{DISC[gap].label} is an orphan gap</div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>No dedicated dev — the gate routes to the manager. Stretch: {stretch?.name} (match {stretchScore}).</div>
          </div>
          {chrome.canOnboard && <Button variant="secondary" size="sm" icon="plus">Onboard</Button>}
        </div>

        <div style={{ display: "flex", alignItems: "center", height: 30, padding: "0 20px", marginTop: 12, borderBottom: "0.5px solid var(--border-subtle)", position: "sticky", top: 0, background: "var(--bg-elevated)", zIndex: 1 }}>
          <span className="kicker" style={{ flex: 1 }}>Member</span>
          <span className="kicker" style={{ width: 110 }}>Discipline</span>
          <span className="kicker" style={{ width: 110 }}>Trust</span>
          <span className="kicker" style={{ width: 110 }}>Load</span>
          <span className="kicker" style={{ width: 96, textAlign: "right" }}>Watch</span>
        </div>
        {members.map((m) => <TeamRow key={m.username} m={m} />)}
      </div>
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
      <div style={{ width: 110 }}>
        {m.discipline
          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}><DiscDot d={m.discipline} />{DISC[m.discipline].label}</span>
          : <Badge tone="ink">Manager</Badge>}
      </div>
      <div style={{ width: 110, display: "flex", alignItems: "center", gap: 6 }}>
        <TrustDot level={trustOf(m)} /><span style={{ fontSize: 12.5, color: "var(--text-secondary)", textTransform: "capitalize" }}>{trustOf(m)}</span>
      </div>
      <div style={{ width: 110 }}><LoadMeter value={m.load} /></div>
      <div style={{ width: 96, display: "flex", justifyContent: "flex-end" }}>
        {!isSelf && <WatchControl username={m.username} />}
      </div>
    </div>
  );
}

/* §6 Watch toggle — panel-local helper ported verbatim from the v4 design's Bell.jsx. */
function WatchControl({ username }: { username: string }) {
  const { isWatching, watch, unwatch } = useApp();
  const on = isWatching(username);
  const [h, setH] = useState(false);
  return (
    <button onClick={(e) => { e.stopPropagation(); on ? unwatch(username) : watch(username); }}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 9px", borderRadius: "var(--r-md)",
        fontSize: 11.5, fontWeight: 500, border: "0.5px solid var(--border-strong)",
        background: on ? "var(--bg-active)" : h ? "var(--bg-hover)" : "var(--bg-elevated)",
        color: on ? "var(--text-primary)" : "var(--text-tertiary)" }}>
      <Icon name={on ? "check" : "eye"} size={12} />{on ? "Watching" : "Watch"}
    </button>
  );
}
