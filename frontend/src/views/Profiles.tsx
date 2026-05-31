/* sprint0 — Capability Profiles (§11). Lanes are no longer the fixed 5: the AI
   tags issues with free-text capability_tags, and an unknown tag becomes a
   `proposed` profile the manager confirms before it can shape a lane. This is the
   bound that keeps the lane set small while the taxonomy grows.

   Ported pixel-1:1 from the v4 mockup (app/Profiles.jsx). Data source: useApp(). */
import { useState } from "react";
import { useApp } from "../app/useApp";
import { Button, Badge, DiscDot, DISC, CapTag, type BadgeTone } from "../components/ui";
import { ViewChrome } from "../components/ViewChrome";
import type { CapabilityProfile } from "../lib/schemas";

/* mockup data2.jsx PROFILE_STATUS — panel-local presentation map. */
const PROFILE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  seed: { label: "Seed", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "green" },
  proposed: { label: "Proposed", tone: "amber" },
};

export function Profiles() {
  const { profiles, confirmProfile, role } = useApp();
  const [_filter, _setFilter] = useState("all");
  const canConfirm = role === "manager";

  const groups = {
    proposed: profiles.filter((p) => p.status === "proposed"),
    confirmed: profiles.filter((p) => p.status === "confirmed"),
    seed: profiles.filter((p) => p.status === "seed"),
  };
  const proposedCount = groups.proposed.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Team", "Profiles"]}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{profiles.length} profiles</span>
      </ViewChrome>
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 24px 40px" }}>
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: 0 }}>The growing taxonomy</h1>
            <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "6px 0 0", lineHeight: 1.55, maxWidth: 560 }}>
              The 5 seed lanes still ship, but the AI grows new capability profiles from issue tags.
              {proposedCount > 0 && <> <b style={{ color: "var(--text-primary)" }}>{proposedCount} proposed</b> {canConfirm ? "need your confirm" : "await the manager"}.</>}
            </p>
          </div>

          {proposedCount > 0 && (
            <Section title="Proposed — awaiting confirm" hint="Grown from unknown issue tags">
              {groups.proposed.map((p) => <ProfileCard key={p.id} p={p} canConfirm={canConfirm} onConfirm={() => confirmProfile(p.id)} />)}
            </Section>
          )}
          <Section title="Confirmed" hint="Can shape a lane">
            {groups.confirmed.map((p) => <ProfileCard key={p.id} p={p} />)}
          </Section>
          <Section title="Seed lanes" hint="Ship by default">
            {groups.seed.map((p) => <ProfileCard key={p.id} p={p} />)}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <span className="kicker">{title}</span>
        <span style={{ fontSize: 11, color: "var(--text-quaternary)" }}>· {hint}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(228px, 1fr))", gap: 10 }}>{children}</div>
    </div>
  );
}

function ProfileCard({ p, canConfirm, onConfirm }: { p: CapabilityProfile; canConfirm?: boolean; onConfirm?: () => void }) {
  const m = PROFILE_STATUS[p.status];
  const proposed = p.status === "proposed";
  return (
    <div style={{ border: `0.5px solid ${proposed ? "var(--text-primary)" : "var(--border)"}`, borderRadius: "var(--r-lg)",
      padding: 14, background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</span>
        <div style={{ flex: 1 }} />
        <Badge tone={m.tone}>{m.label}</Badge>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        {p.skill_keywords.map((k) => <CapTag key={k} tag={k} />)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: proposed ? 12 : 0 }}>
        <span style={{ fontSize: 11, color: "var(--text-quaternary)" }}>maps to</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-tertiary)" }}>
          <DiscDot d={p.default_lane} />{DISC[p.default_lane]?.label || p.default_lane}
        </span>
      </div>
      {proposed && (canConfirm
        ? <Button variant="primary" size="sm" icon="check" style={{ width: "100%" }} onClick={onConfirm}>Confirm profile</Button>
        : <div style={{ fontSize: 11, color: "var(--text-quaternary)", textAlign: "center", padding: "6px 0" }}>Manager confirms</div>)}
    </div>
  );
}
