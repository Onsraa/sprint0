import { useCallback, useEffect, useState } from "react";
import { useApp } from "../app/AppContext";
import { api, type Discipline, type Member, type TrustLevel } from "../lib/api";
import { DISCIPLINE_COLOR, DISCIPLINE_LABEL } from "../lib/relayUtils";

/* Per-discipline trust as filled/empty dots — makes within-tier difference visible
   so a roster of high+medium devs doesn't read as uniformly "maxed". */
const DOTS: Record<TrustLevel, string> = { low: "●○○", medium: "●●○", high: "●●●" };

/* Team roster — real members from GET /api/developers. Trust grows with every merge;
   tiers bucket by per-account trust_level. Manager can Link a member's GitLab account
   or Reconcile the whole roster (R3 GitLab linking). */

const TIERS: { name: string; level: TrustLevel; range: string; color: string }[] = [
  { name: "Senior", level: "high", range: "high trust", color: "var(--positive)" },
  { name: "Trusted", level: "medium", range: "medium trust", color: "var(--info)" },
  { name: "Apprentice", level: "low", range: "low trust", color: "var(--ink-mute)" },
];

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

const roleLabel = (m: Member) => `${m.discipline ? DISCIPLINE_LABEL[m.discipline] : "Generalist"} · ${m.seniority}`;
const accentOf = (m: Member) => (m.discipline ? DISCIPLINE_COLOR[m.discipline] : "var(--ink-mute)");

export function TeamView() {
  const { role, setWizardOpen, setWizardKind } = useApp();
  const isManager = role === "manager";
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // username being linked, or "reconcile"

  const load = useCallback(() => {
    setLoading(true);
    api
      .developers()
      .then((ms) => {
        setMembers(ms);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const link = async (username: string) => {
    setBusy(username);
    try {
      await api.linkMember(username);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const reconcile = async () => {
    setBusy("reconcile");
    try {
      await api.reconcileTeam();
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onboard = () => {
    setWizardKind("hire");
    setWizardOpen(true);
  };

  const unlinked = members.filter((m) => m.gitlab_user_id == null).length;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <div className="display" style={{ fontSize: 28, marginBottom: 6 }}>The team.</div>
          <p style={{ color: "var(--ink-soft)", maxWidth: 520, margin: 0, fontSize: 14 }}>
            Live passports. Trust grows with every successful merge. New hires start at <b>Apprentice</b> and earn their way up.
          </p>
        </div>
        {isManager && (
          <div style={{ display: "flex", gap: 8 }}>
            {unlinked > 0 && (
              <button onClick={reconcile} disabled={busy != null} className="btn btn-ghost btn-sm" style={{ opacity: busy != null ? 0.5 : 1 }}>
                {busy === "reconcile" ? "Reconciling…" : `Reconcile all (${unlinked})`}
              </button>
            )}
            <button onClick={onboard} className="btn btn-primary btn-sm">+ Onboard a dev</button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="card-soft" style={{ padding: 24, textAlign: "center", color: "var(--ink-soft)" }}>Loading roster…</div>
      ) : err ? (
        <div className="card-soft mono" style={{ padding: 16, color: "var(--orange-deep)", fontSize: 13 }}>{err}</div>
      ) : (
        TIERS.map((t) => (
          <TierStrip
            key={t.level}
            name={t.name}
            range={t.range}
            color={t.color}
            devs={members.filter((m) => m.trust_level === t.level)}
            isManager={isManager}
            busy={busy}
            onLink={link}
          />
        ))
      )}
    </div>
  );
}

function TierStrip({
  name, range, devs, color, isManager, busy, onLink,
}: {
  name: string; range: string; devs: Member[]; color: string;
  isManager: boolean; busy: string | null; onLink: (u: string) => void;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
        <div className="display" style={{ fontSize: 20 }}>{name}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", fontWeight: 700 }}>
          {range} · {devs.length} {devs.length === 1 ? "dev" : "devs"}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {devs.map((d) => <DevCard key={d.username} d={d} isManager={isManager} busy={busy} onLink={onLink} />)}
        {devs.length === 0 && (
          <div className="card-soft" style={{ padding: 20, textAlign: "center", color: "var(--ink-mute)", fontSize: 13, fontStyle: "italic", border: "1.5px dashed var(--line-strong)" }}>
            no devs at this tier
          </div>
        )}
      </div>
    </div>
  );
}

function DevCard({ d, isManager, busy, onLink }: { d: Member; isManager: boolean; busy: string | null; onLink: (u: string) => void }) {
  const linked = d.gitlab_user_id != null;
  return (
    <div className="card-soft" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%",
          background: accentOf(d), color: "var(--paper)", border: "2px solid var(--ink)",
          display: "grid", placeItems: "center", fontWeight: 800, flexShrink: 0,
        }}>{initials(d.name)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</div>
            {d.promoted && <span className="chip" style={{ fontSize: 9, padding: "1px 6px", background: "var(--positive-tint)", color: "var(--positive)" }}>↑</span>}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{roleLabel(d)}</div>
        </div>
        <div className="mono" style={{ fontSize: 12, fontWeight: 800, color: "var(--orange)", textTransform: "capitalize" }}>{d.trust_level}</div>
      </div>

      {Object.keys(d.trust).length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {(Object.entries(d.trust) as [Discipline, TrustLevel][]).map(([disc, lvl]) => (
            <span key={disc} className="mono" style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: DISCIPLINE_COLOR[disc], fontWeight: 700 }}>{DISCIPLINE_LABEL[disc]}</span>
              <span style={{ letterSpacing: 1, color: "var(--ink-soft)" }}>{DOTS[lvl]}</span>
            </span>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4, color: "var(--ink-mute)", fontWeight: 700 }}>
          <span>BANDWIDTH</span>
          <span>{d.load}%</span>
        </div>
        <div style={{ height: 5, background: "var(--cream-deep)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${d.load}%`, background: d.load > 75 ? "var(--warn)" : "var(--positive)" }} />
        </div>
      </div>

      {d.skills_text && (
        <div style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.4, marginBottom: 10, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {d.skills_text}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {linked ? (
          <span className="mono" style={{ fontSize: 10, color: "var(--positive)", fontWeight: 700 }}>✓ @{d.gitlab_username}</span>
        ) : (
          <>
            <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 700 }}>unlinked</span>
            {isManager && (
              <button
                onClick={() => onLink(d.username)}
                disabled={busy != null}
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: "auto", opacity: busy != null ? 0.5 : 1, padding: "4px 10px", fontSize: 11 }}
              >
                {busy === d.username ? "Linking…" : "Link GitLab"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
