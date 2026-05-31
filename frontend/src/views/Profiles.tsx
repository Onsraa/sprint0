/* sprint0 — Capability Profiles (spine P2). Lanes are no longer the fixed 5: the AI tags issues
 * with free-text capabilities, and an unknown tag becomes a `proposed` profile the manager confirms
 * before it can shape a lane. This panel is the confirm gate — the bound that keeps the lane set
 * small while the taxonomy grows. Reads GET /api/profiles via TanStack Query. */
import { useMe } from "../features/auth/useAuth";
import { useProfiles, useConfirmProfile } from "../features/profiles/useProfiles";
import { Icon } from "../lib/icon";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL } from "../lib/relayUtils";
import type { Discipline } from "../lib/api";
import type { CapabilityProfile, ProfileStatus } from "../lib/schemas";

const STATUS_CHIP: Record<ProfileStatus, { label: string; bg: string; fg: string; border: string }> = {
  proposed: { label: "Proposed", bg: "var(--bg-secondary)", fg: "var(--text-primary)", border: "var(--text-primary)" },
  confirmed: { label: "Confirmed", bg: "var(--bg-secondary)", fg: "var(--green)", border: "var(--green)" },
  seed: { label: "Seed", bg: "var(--bg-secondary)", fg: "var(--text-tertiary)", border: "var(--border)" },
};

export function Profiles() {
  const { role } = useMe();
  const { data, isLoading, error } = useProfiles();
  const confirm = useConfirmProfile();
  const canConfirm = role === "manager";

  const profiles = data?.profiles ?? [];
  const proposed = profiles.filter((p) => p.status === "proposed");
  const confirmed = profiles.filter((p) => p.status === "confirmed");
  const seed = profiles.filter((p) => p.status === "seed");

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div className="kicker">Team</div>
      <div className="display">The growing taxonomy</div>
      <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 6, maxWidth: 580, lineHeight: 1.55 }}>
        The 5 seed lanes still ship, but the AI grows new capability profiles from issue tags.
        {proposed.length > 0 && (
          <> <b style={{ color: "var(--text-primary)" }}>{proposed.length} proposed</b> {canConfirm ? "need your confirm" : "await the manager"}.</>
        )}
      </div>

      {isLoading && <div className="card-soft" style={{ marginTop: 16, textAlign: "center" }}>Loading profiles…</div>}
      {error && <div className="card-soft mono" style={{ marginTop: 16, color: "var(--red)" }}>{error instanceof Error ? error.message : String(error)}</div>}

      {!isLoading && !error && (
        <>
          {proposed.length > 0 && (
            <Section title="Proposed — awaiting confirm" hint="grown from unknown issue tags">
              {proposed.map((p) => (
                <ProfileCard key={p.id} p={p} canConfirm={canConfirm} busy={confirm.isPending} onConfirm={() => confirm.mutate(p.id)} />
              ))}
            </Section>
          )}
          {confirmed.length > 0 && (
            <Section title="Confirmed" hint="can shape a lane">
              {confirmed.map((p) => <ProfileCard key={p.id} p={p} />)}
            </Section>
          )}
          {seed.length > 0 && (
            <Section title="Seed lanes" hint="ship by default">
              {seed.map((p) => <ProfileCard key={p.id} p={p} />)}
            </Section>
          )}
          {profiles.length === 0 && (
            <div className="card-soft" style={{ marginTop: 16, textAlign: "center", border: "1px dashed var(--border-strong)" }}>
              <div className="display">No capability profiles yet.</div>
              <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 6 }}>They grow as the AI tags issues across new projects.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <span className="kicker" style={{ paddingLeft: 0 }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>· {hint}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(238px, 1fr))", gap: 10 }}>{children}</div>
    </div>
  );
}

function ProfileCard({ p, canConfirm, busy, onConfirm }: {
  p: CapabilityProfile; canConfirm?: boolean; busy?: boolean; onConfirm?: () => void;
}) {
  const chip = STATUS_CHIP[p.status];
  const isProposed = p.status === "proposed";
  const laneColor = DISCIPLINE_COLOR[p.default_lane as Discipline] ?? "var(--text-tertiary)";
  const laneLabel = DISCIPLINE_LABEL[p.default_lane as Discipline] ?? p.default_lane;
  return (
    <div className="card-soft" style={{ borderColor: isProposed ? "var(--text-primary)" : "var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</span>
        <span style={{ flex: 1 }} />
        <span className="chip" style={{ fontSize: 10, background: chip.bg, color: chip.fg, borderColor: chip.border }}>{chip.label}</span>
      </div>
      {p.skill_keywords.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
          {p.skill_keywords.map((k) => (
            <span key={k} className="chip mono" style={{ fontSize: 9.5, padding: "1px 6px" }}>{k}</span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: isProposed && canConfirm ? 12 : 0 }}>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>maps to</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-secondary)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: laneColor }} />{laneLabel}
        </span>
      </div>
      {isProposed && canConfirm && (
        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "7px 14px", opacity: busy ? 0.6 : 1 }}
          onClick={onConfirm} disabled={busy}>
          <Icon name="check" size={14} /> Confirm profile
        </button>
      )}
      {isProposed && !canConfirm && (
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", textAlign: "center", padding: "6px 0" }}>Manager confirms</div>
      )}
    </div>
  );
}
