/* sprint0 — the useApp() adapter. The v4 design panels are written against a single `useApp()` store
 * (its store.jsx). This is a thin ADAPTER hook returning the SAME shape, composed from our real
 * TanStack Query hooks + Zustand + router — and it TRANSLATES our real Zod shapes into the mock field
 * names the copied panels read (est/by/dep, code/accent/issues, mr_title/candidates, baton/depends…).
 * State stays in Query/Zustand; this just shapes it. Also bridges mockup view-ids ↔ our route paths. */
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fmtDate } from "../lib/format";
import { toast } from "sonner";
import { useMe, useLogin } from "../features/auth/useAuth";
import { useView, memberToRole } from "../features/nav/nav";
import { useUI } from "../lib/store";
import { useInbox, useMarkAllRead } from "../features/notify/useNotifications";
import { useRelay, useRelayAuto, useRatifyGate, useDecisionCard } from "../features/relay/useRelay";
import { useProjects } from "../features/projects/useProjects";
import { useRoster } from "../features/roster/useRoster";
import { useWork } from "../features/work/useWork";
import { rankNext } from "../features/today/rank";
import { useProfiles, useConfirmProfile } from "../features/profiles/useProfiles";
import { api } from "../lib/api";
import { qk } from "../lib/query";
import type { Member, WorkTask, ProjectSummary, Attribution, Gate, RelayState } from "../lib/api";

type MockRole = "manager" | "developer" | "qa";
const ROLE_CHROME: Record<MockRole, { land: string; canDispatch: boolean; canOnboard: boolean; canGovern: boolean; canRefactor: boolean; seesAllGates: boolean }> = {
  manager: { land: "today", canDispatch: true, canOnboard: true, canGovern: true, canRefactor: true, seesAllGates: true },
  developer: { land: "today", canDispatch: false, canOnboard: false, canGovern: false, canRefactor: false, seesAllGates: false },
  qa: { land: "today", canDispatch: false, canOnboard: false, canGovern: false, canRefactor: false, seesAllGates: false },
};
const VIEW_TO_ROUTE: Record<string, string> = {
  today: "today", relays: "relays",
  inbox: "inbox", mywork: "work", projects: "dashboard", relay: "relay", ratify: "queue",
  qagate: "qa", team: "team", profiles: "profiles", codegraph: "codegraph", merges: "attributions",
  portfolio: "portfolio", passport: "passport", settings: "settings",
};
const ROUTE_TO_VIEW: Record<string, string> = Object.fromEntries(Object.entries(VIEW_TO_ROUTE).map(([v, r]) => [r, v]));

const DISC_ACCENTS = ["var(--disc-frontend)", "var(--disc-backend)", "var(--disc-uiux)", "var(--disc-devops)", "var(--disc-qa)"];
const hash = (s: string) => Math.abs([...(s || "")].reduce((a, c) => a + c.charCodeAt(0), 0));
const initials = (s: string) => (s || "?").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 3).join("").toUpperCase();

/* ── real → mock-shape translators (so the verbatim, loosely-typed panels render).
 *    Returns are intentionally `any`: the copied mockup panels read mock field names
 *    (trust as a string level, capability_tags, est/by/dep, code/accent, mr_title…)
 *    that don't line up with our strict Zod types — the adapter is the loose seam. ── */
const LEVEL_NUM: Record<string, number> = { high: 88, medium: 58, low: 28 };
// real merge → graded strength: record_merge stores only {task_type, score, via}; map the score
// to the §12 grade ladder so the Passport's strength chip is real (project/date aren't tracked → "—").
const scoreGrade = (s: number) => (s >= 0.9 ? "retro_validated" : s >= 0.82 ? "prod_survived" : s >= 0.7 ? "shipped" : "proposed");
const toMockMember = (m: Member): any => ({
  ...m, trust: m.trust_level, gitlab: m.gitlab_username,
  // per-discipline numeric radar for the Passport, derived from the real per-discipline trust levels
  radar: Object.fromEntries(["uiux", "frontend", "backend", "devops", "qa"].map((d) =>
    [d, LEVEL_NUM[(m.trust as Record<string, string> | undefined)?.[d] ?? m.trust_level] ?? 28])),
  // real merge history → the Passport table shape (empty for fresh accounts → Passport seeds a preview)
  merges: (m.history ?? []).map((h) => { const r = h as { task_type?: string; score?: number };
    return { mr: r.task_type ?? "merge", project: "—", grade: scoreGrade(r.score ?? 0),
      delta: "+" + Number(r.score ?? 0).toFixed(2), date: "—" }; }),
});
const toMockTask = (t: WorkTask): any => ({ ...t, est: t.estimate_days ?? 1, by: t.assigned_by === "ai" ? "ai" : t.assigned_by ?? "self", dep: t.depends_on ?? [], project: t.project_id, score: 0, gap_cover: false, capability_tags: (t as { capability_tags?: string[] }).capability_tags ?? [] });
function toMockProject(p: ProjectSummary): any {
  const issues = (p.plan?.epics ?? []).reduce((n, e) => n + (e.issues?.length ?? 0), 0);
  const devs = new Set((p.plan?.epics ?? []).flatMap((e) => e.issues ?? []).map((i) => i.assignee).filter(Boolean)).size;
  return {
    ...p, id: p.project_id, code: initials(p.name), status: p.kind === "reference" ? "shipped" : (p.status || "in_progress"),
    stack: Object.values(p.tech_stack ?? {}).filter((v) => v && v !== "-"), issues, devs, grounded: p.grounded_on ?? [],
    accent: DISC_ACCENTS[hash(p.name) % DISC_ACCENTS.length], created: fmtDate(p.created_at), activity: fmtDate(p.last_activity_at),
  };
}
const toMockAttribution = (a: Attribution): any => ({
  id: a.id, mr_title: a.task_type ? `${a.task_type} merge` : "merge", project: String(a.project_id ?? ""),
  gitlab_author: a.gitlab_username, candidates: a.suggested ? [a.suggested] : [], resolved: null,
  ambiguous: true, trust_delta: null, score: a.score,
});
const toMockGate = (g: Gate, relay?: RelayState): any => ({ ...g, baton: !!relay?.baton?.includes(g.discipline as never), depends: g.depends_on ?? [], stretched: false, owner: null });

/* §10 Autonomy — a named risk posture (Cautious/Balanced/Fast) over the backend dial (~30/60/85).
   Frees the word "trust" to mean only the passport. Manager-only (enforced server-side). */
export const AUTONOMY_MODES = [
  { id: "cautious", label: "Cautious", hint: "A human reviews most gates" },
  { id: "balanced", label: "Balanced", hint: "Auto-pass clearly low-risk gates" },
  { id: "fast", label: "Fast", hint: "Auto-pass low + medium-risk gates" },
] as const;
const AUTONOMY_MAP: Record<string, number> = { cautious: 30, balanced: 60, fast: 85 };
const dialToMode = (d: number) => (d <= 45 ? "cautious" : d <= 72 ? "balanced" : "fast");

export function useApp() {
  const qc = useQueryClient();
  const { member } = useMe();
  const me = (member ? toMockMember(member) : {}) as any;
  const role: MockRole = (() => { const r = memberToRole(member); return r === "manager" ? "manager" : r === "qa" ? "qa" : "developer"; })();
  const chrome = ROLE_CHROME[role];

  // nav (mockup view-ids ↔ routes; "wizard" opens the modal)
  const { view: routeView, setView: setRoute } = useView();
  const view = ROUTE_TO_VIEW[routeView] ?? routeView;
  const setWizardOpen = useUI((s) => s.setWizardOpen);
  const setWizardKind = useUI((s) => s.setWizardKind);
  const setView = (id: string) => { if (id === "wizard") { setWizardKind("brief"); setWizardOpen(true); return; } setRoute((VIEW_TO_ROUTE[id] ?? id) as never); };
  const login = useLogin();
  const switchPersona = (username: string) => login.mutate(username, {
    onSuccess: (res) => {
      // Full identity change: EVICT every prior-persona cache (work/inbox/queue/relays/decisions keys
      // aren't user-scoped, so the Today list was blending across switches) but KEEP `me` — useLogin
      // already re-seeded it from this login result, so this predicate avoids a null-member frame.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      const r: MockRole = res.member.role === "manager" ? "manager" : res.member.discipline === "qa" ? "qa" : "developer";
      setRoute((VIEW_TO_ROUTE[ROLE_CHROME[r].land] ?? ROLE_CHROME[r].land) as never);
    },
  });
  const rosterRaw = useRoster();
  const members = useMemo(() => rosterRaw.map(toMockMember), [rosterRaw]);

  // notifications + bell
  const { data: inbox } = useInbox();
  const notifs = useMemo(() => (inbox?.notifications ?? []).map((n) => ({ ...n, kind: n.type, unread: !n.read, time: n.created_at })), [inbox]);
  const unread = inbox?.unread ?? 0;
  const bellOpen = useUI((s) => s.bellOpen);
  const setBellOpen = useUI((s) => s.setBellOpen);
  const markRead = useMarkAllRead();
  const markAllRead = () => markRead.mutate();
  const setToast = (n: any): void => { toast(n?.title ?? "", { description: n?.body }); };
  const pushNotif = (_n?: any) => {};
  const toasts: never[] = [];

  // relay + Trust Dial (active plan from the UI store, else first active relay)
  const { data: relaySummariesRaw } = useQuery({ queryKey: qk.allRelays(), queryFn: () => api.allRelays().then((r) => r.relays) });
  const relaySummaries = useMemo(() => relaySummariesRaw ?? [], [relaySummariesRaw]);
  // Honor the UI's pinned plan ONLY while it's still an in-flight relay. Once dispatched it leaves the
  // board, so drop the stale pin (else useRelay keeps polling a removed relay → 404). Fall back to the top.
  const pinnedPlanId = useUI((s) => s.planId);
  const planId = (pinnedPlanId && relaySummaries.some((r) => r.plan_id === pinnedPlanId) ? pinnedPlanId : null)
    ?? relaySummaries[0]?.plan_id ?? null;
  const { data: relay } = useRelay(planId);
  const gates = useMemo(() => (relay?.gates ?? []).map((g) => toMockGate(g, relay)), [relay]);
  const integration = useMemo(() => relay?.integration_signals ?? [], [relay]);
  const dial = useUI((s) => s.dial);
  const setDial = useUI((s) => s.setDial);
  const relayAuto = useRelayAuto(planId ?? "");
  const applyDial = (d: number) => { setDial(d); if (planId) relayAuto.mutate(d); };
  const autonomy = dialToMode(dial);
  const setAutonomy = (m: string) => applyDial(AUTONOMY_MAP[m] ?? 60);
  const ratifyGate = useRatifyGate(planId ?? "");
  const actGate = (disc: string, status: string) => ratifyGate.mutate({ discipline: disc as never, body: { edits: [], note: "", approve: status === "ratified", reasoning: "", ai_recommendation: "", ai_confidence: null, deviated: false, deviation_reason: "" } as never });
  // reuse-or-innovate: ratify a gate by SELECTING a solution (or a write-your-own). The backend records
  // the choice on the Decision + (for a user solution) regenerates the gate's issue + flags cross-gate overlap.
  const ratifyWith = (disc: string, chosen_solution: any, note = "") => ratifyGate.mutate({ discipline: disc as never, body: { approve: true, note, reasoning: note, chosen_solution } as never });
  // per-gate Decision Cards (5 fixed disciplines)
  const cBack = useDecisionCard(planId, "backend"); const cFront = useDecisionCard(planId, "frontend");
  const cUiux = useDecisionCard(planId, "uiux"); const cQa = useDecisionCard(planId, "qa"); const cDev = useDecisionCard(planId, "devops");
  const cards: Record<string, unknown> = useMemo(() => ({ backend: cBack.data, frontend: cFront.data, uiux: cUiux.data, qa: cQa.data, devops: cDev.data }), [cBack.data, cFront.data, cUiux.data, cQa.data, cDev.data]);
  // staffing/coverage for the active plan
  const { data: staffing } = useQuery({ queryKey: qk.staffing(planId ?? ""), queryFn: () => api.staffing(planId as string), enabled: !!planId });

  // work / projects
  const { data: tasksRaw } = useWork("team");
  const tasks = useMemo(() => (tasksRaw ?? []).map(toMockTask), [tasksRaw]);
  const { projects: projectsRaw } = useProjects();
  const projects = useMemo(() => projectsRaw.map(toMockProject), [projectsRaw]);
  // project_id → human name, so Today task rows show the project name, not the numeric id.
  const projectNames = useMemo(() => Object.fromEntries(projectsRaw.map((p) => [p.project_id, p.name])), [projectsRaw]);
  const liveProjectId = useUI((s) => s.liveProjectId);
  const { data: queueRaw } = useQuery({ queryKey: qk.myQueue(), queryFn: () => api.myQueue().then((r) => r.items) });
  const queue = useMemo(() => queueRaw ?? [], [queueRaw]);
  // Today spine — ranked next-actions, composed client-side from existing streams (no new endpoint).
  const { data: myTasksRaw } = useWork("me");
  const myTasks = useMemo(() => myTasksRaw ?? [], [myTasksRaw]);
  const next = useMemo(() => rankNext({
    role, myDiscipline: member?.discipline ?? null, myUsername: member?.username ?? "",
    queue, relays: relaySummaries, myTasks, needs: inbox?.needs_action ?? [], projectNames,
    seatedDisciplines: members.filter((m: any) => m.discipline).map((m: any) => m.discipline),
  }), [role, member, queue, relaySummaries, myTasks, inbox, projectNames, members]);
  const drafts = useUI((s) => s.drafts);
  const addDraft = useUI((s) => s.addDraft);

  // decisions (Portfolio) — real shape already matches the mock
  const { data: decisions = [] } = useQuery({ queryKey: qk.decisions(), queryFn: () => api.myDecisions().then((r) => r.decisions) });
  const invDec = () => qc.invalidateQueries({ queryKey: qk.decisions() });
  const setVisibility = (id: string, v: "personal" | "team") => { api.setDecisionVisibility(id, v).then(invDec); };
  const editReasoning = (id: string, r: string) => { api.patchDecision(id, { reasoning: r }).then(invDec); };
  const deprecate = (id: string) => { api.deprecateDecision(id, "").then(invDec); };
  const removeDecision = (id: string) => { api.deleteDecision(id).then(invDec); };

  // capability profiles — real shape matches
  const { data: profilesData } = useProfiles();
  const profiles = useMemo(() => profilesData?.profiles ?? [], [profilesData]);
  const confirm = useConfirmProfile();
  const confirmProfile = (id: string) => confirm.mutate(id);

  // Watch = consent-based access grants (request → subject accepts → granted). The Contract-visibility key:
  // a granted Watch un-gates a watched person's Contracts (tickets stay open). Drives the Relays person-picker.
  const { data: access = { i_can_see: [], can_see_me: [], pending_in: [], pending_out: [] } } = useQuery({ queryKey: ["access"], queryFn: () => api.listAccess() });
  const invAccess = () => qc.invalidateQueries({ queryKey: ["access"] });
  const subs = useMemo(() => ({
    watching: (access.i_can_see ?? []).map((g) => g.subject_id),     // people I watch (granted)
    watchers: (access.can_see_me ?? []).map((g) => g.requester_id),  // people watching me (granted)
  }), [access]);
  const watchedPeople = subs.watching;
  const watchStatus = (u: string): "none" | "pending" | "active" =>
    (access.i_can_see ?? []).some((g) => g.subject_id === u) ? "active"
      : (access.pending_out ?? []).some((g) => g.subject_id === u) ? "pending" : "none";
  const isWatching = (u: string) => watchStatus(u) === "active";
  const requestWatch = (u: string) => { api.requestAccess(u).then(invAccess); };
  const unwatch = (u: string) => {  // cancel my pending request OR stop an active watch
    const g = [...(access.i_can_see ?? []), ...(access.pending_out ?? [])].find((x) => x.subject_id === u);
    if (g) api.revokeAccess(g.id).then(invAccess);
  };
  const removeWatcher = (u: string) => {  // revoke someone who watches me
    const g = (access.can_see_me ?? []).find((x) => x.requester_id === u);
    if (g) api.revokeAccess(g.id).then(invAccess);
  };
  const personFilter = useUI((s) => s.personFilter);
  const setPersonFilter = useUI((s) => s.setPersonFilter);
  // incoming Watch requests awaiting MY accept (the consent step) → drive the Inbox accept/reject.
  const accessRequests = useMemo(() => (inbox?.needs_action ?? []).filter((n) => n.kind === "access_request"), [inbox]);
  const acceptAccess = (grantId: string) => { api.acceptAccess(grantId).then(() => { qc.invalidateQueries({ queryKey: qk.inbox() }); invAccess(); }); };
  const rejectAccess = (grantId: string) => { api.rejectAccess(grantId).then(() => { qc.invalidateQueries({ queryKey: qk.inbox() }); invAccess(); }); };

  // reschedule proposal (first pending, from the inbox)
  const proposalNeed = (inbox?.needs_action ?? []).find((n) => n.kind === "reschedule");
  const proposal: any = (proposalNeed?.item as any) ?? null;
  const resolveProposal = (decision: "applied" | "rejected") => { const id = proposal?.id; if (!id) return; (decision === "applied" ? api.applyReschedule(id) : api.rejectReschedule(id)).then(() => qc.invalidateQueries({ queryKey: qk.inbox() })); };

  // merge attributions
  const { data: attrsRaw } = useQuery({ queryKey: ["attributions"], queryFn: () => api.attributions(), enabled: role === "manager" });
  const attributions = useMemo(() => (attrsRaw ?? []).map(toMockAttribution), [attrsRaw]);
  const resolveAttribution = (id: string, username: string) => { api.resolveAttribution(id, { username }).then(() => qc.invalidateQueries({ queryKey: ["attributions"] })); };

  // code-graph drift
  const { data: driftRaw } = useQuery({ queryKey: ["drift"], queryFn: () => api.checkDrift().then((r) => r.reports), staleTime: 60_000 });
  const drift = useMemo(() => (driftRaw ?? []).map((d, i) => ({ ...d, id: `dr${i}`, title: d.drift_from_description || d.violation, detail: d.violation || d.suggested_fix, paths: d.affected_files ?? [], scheduled: false })), [driftRaw]);
  const scheduleRefactor = (id: string) => {
    const idx = parseInt(id.replace("dr", ""), 10);
    const report = (driftRaw ?? [])[idx];
    const pid = liveProjectId ?? projectsRaw[0]?.project_id;
    if (report && pid != null) api.createRefactorTask(pid, report as never).then(() => qc.invalidateQueries({ queryKey: ["drift"] }));
  };

  return {
    me, role, chrome, view, setView, switchPersona, members, next,
    notifs, unread, bellOpen, setBellOpen, markAllRead, pushNotif, toasts, setToast,
    gates, dial, applyDial, autonomy, setAutonomy, actGate, ratifyWith, cards, staffing, planId, integration, relay,
    tasks, projects, relaySummaries, queue, drafts, addDraft,
    decisions, setVisibility, editReasoning, deprecate, removeDecision,
    profiles, confirmProfile,
    subs, isWatching, watchStatus, requestWatch, unwatch, removeWatcher, watchedPeople, personFilter, setPersonFilter,
    accessRequests, acceptAccess, rejectAccess,
    proposal, resolveProposal,
    attributions, resolveAttribution,
    drift, scheduleRefactor,
  };
}
