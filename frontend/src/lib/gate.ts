/* sprint0 — shared gate semantics (mirrors orchestrator/app/const.py + relay.ratifier_of).
   One rule, one place: every view imports these instead of re-inlining the status pair or the
   delegate-or-owner fallback (15 hand-rolled copies drifted before this). */

/** A gate/agreement that CLEARED — human-ratified or auto-passed (= backend const.DONE). */
export const DONE_STATES = ["ratified", "auto_passed"] as const;

export const isDone = (status?: string | null): boolean =>
  !!status && (DONE_STATES as readonly string[]).includes(status);

/** THE ratifier rule (= backend relay.ratifier_of): a handed-off gate is the delegate's, else the
    assigned owner's; null → callers fall back to discipline-match / the manager. */
export const ratifierOf = (g?: { delegate?: string | null; owner?: string | null } | null): string | null =>
  g?.delegate ?? g?.owner ?? null;

type GateLike = { discipline: string; delegate?: string | null; owner?: string | null };
type MemberLike = { username: string; disciplines?: string[]; discipline?: string | null; is_manager?: boolean };
const coversLane = (m: MemberLike, lane: string): boolean =>
  (m.disciplines?.length ? m.disciplines : [m.discipline].filter(Boolean) as string[]).includes(lane);

/** THE per-user gate-ownership rule (= backend relay.owns_gate): a gate belongs to exactly ONE user —
    its ratifier (delegate ?? owner), else a discipline coverer (the qa acceptance gate → the tester),
    else, for a true orphan nobody covers, the manager. No role grants ownership of another's gate. */
export const ownsGate = (g: GateLike | null | undefined, me: MemberLike, members: MemberLike[]): boolean => {
  if (!g || !me) return false;
  const r = ratifierOf(g);
  if (r) return r === me.username;
  if (members.some((m) => coversLane(m, g.discipline))) return coversLane(me, g.discipline);
  return !!me.is_manager;  // true orphan → the manager inherits it
};
