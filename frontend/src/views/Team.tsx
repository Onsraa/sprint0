import { useCallback, useEffect, useState } from "react";
import { useMe } from "../features/auth/useAuth";
import { useUI } from "../lib/store";
import { api, type AccessGrant, type Discipline, type Member, type TrustLevel } from "../lib/api";
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

type AccessState = { i_can_see: AccessGrant[]; can_see_me: AccessGrant[]; pending_in: AccessGrant[] };
const EMPTY_ACCESS: AccessState = { i_can_see: [], can_see_me: [], pending_in: [] };

export function TeamView() {
  const { role, member } = useMe();
  const setWizardOpen = useUI((s) => s.setWizardOpen);
  const setWizardKind = useUI((s) => s.setWizardKind);
  const isManager = role === "manager";
  const me = member?.username ?? null;
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // username being linked, or "reconcile"
  const [access, setAccess] = useState<AccessState>(EMPTY_ACCESS);

  const reloadAccess = useCallback(() => {
    api.listAccess()
      .then(setAccess)
      .catch(() => { /* best-effort */ });
  }, []);

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
    reloadAccess();
  }, [load, reloadAccess]);

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

  // Build a fast-lookup: subject_id → grant for "i_can_see" (status=granted)
  const grantedMap = new Map<string, AccessGrant>(
    access.i_can_see.filter((g) => g.status === "granted").map((g) => [g.subject_id, g])
  );
  const pendingSet = new Set<string>(
    access.i_can_see.filter((g) => g.status === "pending").map((g) => g.subject_id)
  );

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

      <AccessPanel access={access} reloadAccess={reloadAccess} />

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
            me={me}
            grantedMap={grantedMap}
            pendingSet={pendingSet}
            reloadAccess={reloadAccess}
          />
        ))
      )}
    </div>
  );
}

function TierStrip({
  name, range, devs, color, isManager, busy, onLink, me, grantedMap, pendingSet, reloadAccess,
}: {
  name: string; range: string; devs: Member[]; color: string;
  isManager: boolean; busy: string | null; onLink: (u: string) => void;
  me: string | null; grantedMap: Map<string, AccessGrant>; pendingSet: Set<string>;
  reloadAccess: () => void;
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
        {devs.map((d) => (
          <DevCard
            key={d.username}
            d={d}
            isManager={isManager}
            busy={busy}
            onLink={onLink}
            isMe={me !== null && d.username === me}
            grant={grantedMap.get(d.username) ?? null}
            isPending={pendingSet.has(d.username)}
            reloadAccess={reloadAccess}
          />
        ))}
        {devs.length === 0 && (
          <div className="card-soft" style={{ padding: 20, textAlign: "center", color: "var(--ink-mute)", fontSize: 13, fontStyle: "italic", border: "1.5px dashed var(--line-strong)" }}>
            no devs at this tier
          </div>
        )}
      </div>
    </div>
  );
}

function DevCard({
  d, isManager, busy, onLink, isMe, grant, isPending, reloadAccess,
}: {
  d: Member; isManager: boolean; busy: string | null; onLink: (u: string) => void;
  isMe: boolean; grant: AccessGrant | null; isPending: boolean; reloadAccess: () => void;
}) {
  const linked = d.gitlab_user_id != null;
  const [accessBusy, setAccessBusy] = useState(false);
  const [inlineNote, setInlineNote] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);

  const toggleWatch = async () => {
    if (accessBusy) return;
    setAccessBusy(true);
    try {
      if (watched) { await api.unsubscribe(d.username); setWatched(false); }
      else { await api.subscribe(d.username, ["assigned", "qa_failed"]); setWatched(true); }
    } catch { /* ignore */ } finally { setAccessBusy(false); }
  };

  const handleRequestAccess = async () => {
    if (accessBusy) return;
    setAccessBusy(true);
    setInlineNote(null);
    try {
      await api.requestAccess(d.username);
      reloadAccess();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 409 = already pending or granted
      if (msg.includes("409") || msg.toLowerCase().includes("already")) {
        setInlineNote("requested");
      }
    } finally {
      setAccessBusy(false);
    }
  };

  const handleRevoke = async (grantId: string) => {
    if (accessBusy) return;
    setAccessBusy(true);
    setInlineNote(null);
    try {
      await api.revokeAccess(grantId);
      reloadAccess();
    } catch {
      setInlineNote("error");
    } finally {
      setAccessBusy(false);
    }
  };

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

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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

        {!isMe && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={toggleWatch}
              disabled={accessBusy}
              title="Get notified of this member's assigned / QA-failed events (System 5)"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 10, padding: "2px 8px", opacity: accessBusy ? 0.5 : 1 }}
            >
              {watched ? "🔔 Watching" : "Watch"}
            </button>
            {grant ? (
              <>
                <span className="chip mono" style={{ fontSize: 9, padding: "2px 6px", background: "var(--positive-tint)", color: "var(--positive)", fontWeight: 700 }}>✓ access</span>
                {inlineNote === "error" && (
                  <span className="mono" style={{ fontSize: 9, color: "var(--orange-deep)", fontWeight: 700 }}>error</span>
                )}
                <button
                  onClick={() => handleRevoke(grant.id)}
                  disabled={accessBusy}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 10, padding: "2px 8px", opacity: accessBusy ? 0.5 : 1 }}
                >
                  Revoke
                </button>
              </>
            ) : isPending || inlineNote === "requested" ? (
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 700 }}>requested</span>
            ) : (
              <button
                onClick={handleRequestAccess}
                disabled={accessBusy}
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 10, padding: "2px 8px", opacity: accessBusy ? 0.5 : 1 }}
              >
                {accessBusy ? "…" : "Request access"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Access panel ─────────────────────────────────────────────────────── */

function AccessPanel({ access, reloadAccess }: { access: AccessState; reloadAccess: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleRevoke = async (grantId: string) => {
    if (busyId) return;
    setBusyId(grantId);
    setErr(null);
    try {
      await api.revokeAccess(grantId);
      reloadAccess();
    } catch {
      setErr("action failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleMute = async (grantId: string) => {
    if (busyId) return;
    setBusyId(grantId);
    setErr(null);
    try {
      await api.muteAccess(grantId);
      reloadAccess();
    } catch {
      setErr("action failed");
    } finally {
      setBusyId(null);
    }
  };

  const hasAny = access.can_see_me.length > 0 || access.i_can_see.length > 0;

  return (
    <div className="card-soft" style={{ padding: "14px 18px", marginBottom: 24 }}>
      <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-mute)", letterSpacing: 1, marginBottom: hasAny ? 12 : 0, textTransform: "uppercase" }}>
        Access
      </div>
      {err && (
        <div className="mono" style={{ fontSize: 10, color: "var(--orange-deep)", fontWeight: 700, marginBottom: 8 }}>{err}</div>
      )}
      {!hasAny ? (
        <div style={{ fontSize: 12, color: "var(--ink-mute)", fontStyle: "italic" }}>No access grants yet.</div>
      ) : (
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          {access.can_see_me.length > 0 && (
            <div style={{ minWidth: 220 }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6 }}>Can see my tasks</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {access.can_see_me.map((g) => (
                  <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>@{g.requester_id}</span>
                    <button
                      onClick={() => handleMute(g.id)}
                      disabled={busyId != null}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 10, padding: "2px 8px", opacity: busyId ? 0.5 : 1 }}
                    >
                      {g.notifications_muted ? "Unmute" : "Mute"}
                    </button>
                    <button
                      onClick={() => handleRevoke(g.id)}
                      disabled={busyId != null}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 10, padding: "2px 8px", opacity: busyId ? 0.5 : 1 }}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {access.i_can_see.length > 0 && (
            <div style={{ minWidth: 180 }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6 }}>I can see</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {access.i_can_see.map((g) => (
                  <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>@{g.subject_id}</span>
                    <span className="chip mono" style={{ fontSize: 9, padding: "1px 5px", background: g.status === "granted" ? "var(--positive-tint)" : "var(--cream-deep)", color: g.status === "granted" ? "var(--positive)" : "var(--ink-mute)" }}>
                      {g.status}
                    </span>
                    {g.status === "granted" && (
                      <button
                        onClick={() => handleRevoke(g.id)}
                        disabled={busyId != null}
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 10, padding: "2px 8px", opacity: busyId ? 0.5 : 1 }}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
