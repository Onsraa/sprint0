/* sprint0 — the useApp() adapter. The v4 design panels are written against a single `useApp()` store
 * (its store.jsx). This is a thin ADAPTER hook returning the SAME shape, composed from our real
 * TanStack Query hooks + Zustand + router — and it TRANSLATES our real Zod shapes into the mock field
 * names the copied panels read (est/by/dep, code/accent/issues, mr_title/candidates, baton/depends…).
 * State stays in Query/Zustand; this just shapes it. Also bridges mockup view-ids ↔ our route paths. */
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
    stack: Object.values(p.tech_stack ?? {}).filter(Boolean), issues, devs, grounded: p.grounded_on ?? [],
    accent: DISC_ACCENTS[hash(p.name) % DISC_ACCENTS.length], created: p.created_at ?? "", activity: p.last_activity_at ?? "",
  };
}
const toMockAttribution = (a: Attribution): any => ({
  id: a.id, mr_title: a.task_type ? `${a.task_type} merge` : "merge", project: String(a.project_id ?? ""),
  gitlab_author: a.gitlab_username, candidates: a.suggested ? [a.suggested] : [], resolved: null,
  ambiguous: true, trust_delta: null, score: a.score,
});
const toMockGate = (g: Gate, relay?: RelayState): any => ({ ...g, baton: !!relay?.baton?.includes(g.discipline as never), depends: g.depends_on ?? [], stretched: false, owner: null });

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
      // Full identity change: EVICT all prior-persona cache so no stale tasks/queue/inbox blend into
      // the new persona (the Today list was accumulating across switches because work/inbox/queue keys
      // aren't user-scoped). clear() wipes `me` too, so re-seed it from the login result immediately.
      qc.clear();
      qc.setQueryData(qk.me(), res.member);
      const r: MockRole = res.member.role === "manager" ? "manager" : res.member.discipline === "qa" ? "qa" : "developer";
      setRoute((VIEW_TO_ROUTE[ROLE_CHROME[r].land] ?? ROLE_CHROME[r].land) as never);
    },
  });
  const members = useRoster().map(toMockMember);

  // notifications + bell
  const { data: inbox } = useInbox();
  const notifs = (inbox?.notifications ?? []).map((n) => ({ ...n, kind: n.type, unread: !n.read, time: n.created_at }));
  const unread = inbox?.unread ?? 0;
  const bellOpen = useUI((s) => s.bellOpen);
  const setBellOpen = useUI((s) => s.setBellOpen);
  const markRead = useMarkAllRead();
  const markAllRead = () => markRead.mutate();
  const setToast = (n: any): void => { toast(n?.title ?? "", { description: n?.body }); };
  const pushNotif = (_n?: any) => {};
  const toasts: never[] = [];

  // relay + Trust Dial (active plan from the UI store, else first active relay)
  const { data: relaySummaries = [] } = useQuery({ queryKey: qk.allRelays(), queryFn: () => api.allRelays().then((r) => r.relays) });
  const planId = useUI((s) => s.planId) ?? relaySummaries[0]?.plan_id ?? null;
  const { data: relay } = useRelay(planId);
  const gates = (relay?.gates ?? []).map((g) => toMockGate(g, relay));
  const integration = relay?.integration_signals ?? [];
  const dial = useUI((s) => s.dial);
  const setDial = useUI((s) => s.setDial);
  const relayAuto = useRelayAuto(planId ?? "");
  const applyDial = (d: number) => { setDial(d); if (planId) relayAuto.mutate(d); };
  const ratifyGate = useRatifyGate(planId ?? "");
  const actGate = (disc: string, status: string) => ratifyGate.mutate({ discipline: disc as never, body: { edits: [], note: "", approve: status === "ratified", reasoning: "", ai_recommendation: "", ai_confidence: null, deviated: false, deviation_reason: "" } as never });
  // per-gate Decision Cards (5 fixed disciplines)
  const cBack = useDecisionCard(planId, "backend"); const cFront = useDecisionCard(planId, "frontend");
  const cUiux = useDecisionCard(planId, "uiux"); const cQa = useDecisionCard(planId, "qa"); const cDev = useDecisionCard(planId, "devops");
  const cards: Record<string, unknown> = { backend: cBack.data, frontend: cFront.data, uiux: cUiux.data, qa: cQa.data, devops: cDev.data };
  // staffing/coverage for the active plan
  const { data: staffing } = useQuery({ queryKey: qk.staffing(planId ?? ""), queryFn: () => api.staffing(planId as string), enabled: !!planId });

  // work / projects
  const { data: tasksRaw = [] } = useWork("team");
  const tasks = tasksRaw.map(toMockTask);
  const { projects: projectsRaw } = useProjects();
  const projects = projectsRaw.map(toMockProject);
  // project_id → human name, so Today task rows show the project name, not the numeric id.
  const projectNames = useMemo(() => Object.fromEntries(projectsRaw.map((p) => [p.project_id, p.name])), [projectsRaw]);
  const liveProjectId = useUI((s) => s.liveProjectId);
  const { data: queue = [] } = useQuery({ queryKey: qk.myQueue(), queryFn: () => api.myQueue().then((r) => r.items) });
  // Today spine — ranked next-actions, composed client-side from existing streams (no new endpoint).
  const { data: myTasksRaw = [] } = useWork("me");
  const next = useMemo(() => rankNext({
    role, myDiscipline: member?.discipline ?? null, myUsername: member?.username ?? "",
    queue, relays: relaySummaries, myTasks: myTasksRaw, needs: inbox?.needs_action ?? [], projectNames,
  }), [role, member, queue, relaySummaries, myTasksRaw, inbox, projectNames]);
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
  const profiles = profilesData?.profiles ?? [];
  const confirm = useConfirmProfile();
  const confirmProfile = (id: string) => confirm.mutate(id);

  // subscriptions
  const { data: subs = { watching: [], watchers: [] } } = useQuery({ queryKey: ["subscriptions"], queryFn: () => api.listSubscriptions() });
  const invSubs = () => qc.invalidateQueries({ queryKey: ["subscriptions"] });
  const isWatching = (u: string) => (subs.watching ?? []).some((w: { subject_id?: string; username?: string }) => (w.subject_id ?? w.username) === u);
  const watch = (u: string) => { api.subscribe(u).then(invSubs); };
  const unwatch = (u: string) => { api.unsubscribe(u).then(invSubs); };

  // reschedule proposal (first pending, from the inbox)
  const proposalNeed = (inbox?.needs_action ?? []).find((n) => n.kind === "reschedule");
  const proposal: any = (proposalNeed?.item as any) ?? null;
  const resolveProposal = (decision: "applied" | "rejected") => { const id = proposal?.id; if (!id) return; (decision === "applied" ? api.applyReschedule(id) : api.rejectReschedule(id)).then(() => qc.invalidateQueries({ queryKey: qk.inbox() })); };

  // merge attributions
  const { data: attrsRaw = [] } = useQuery({ queryKey: ["attributions"], queryFn: () => api.attributions() });
  const attributions = attrsRaw.map(toMockAttribution);
  const resolveAttribution = (id: string, username: string) => { api.resolveAttribution(id, { username }).then(() => qc.invalidateQueries({ queryKey: ["attributions"] })); };

  // code-graph drift
  const { data: driftRaw } = useQuery({ queryKey: ["drift"], queryFn: () => api.checkDrift().then((r) => r.reports), staleTime: 60_000 });
  const drift = (driftRaw ?? []).map((d, i) => ({ ...d, id: `dr${i}`, title: d.drift_from_description || d.violation, detail: d.violation || d.suggested_fix, paths: d.affected_files ?? [], scheduled: false }));
  const scheduleRefactor = (id: string) => {
    const idx = parseInt(id.replace("dr", ""), 10);
    const report = (driftRaw ?? [])[idx];
    const pid = liveProjectId ?? projectsRaw[0]?.project_id;
    if (report && pid != null) api.createRefactorTask(pid, report as never).then(() => qc.invalidateQueries({ queryKey: ["drift"] }));
  };

  return {
    me, role, chrome, view, setView, switchPersona, members, next,
    notifs, unread, bellOpen, setBellOpen, markAllRead, pushNotif, toasts, setToast,
    gates, dial, applyDial, actGate, cards, staffing, planId, integration, relay,
    tasks, projects, relaySummaries, queue, drafts, addDraft,
    decisions, setVisibility, editReasoning, deprecate, removeDecision,
    profiles, confirmProfile,
    subs, isWatching, watch, unwatch,
    proposal, resolveProposal,
    attributions, resolveAttribution,
    drift, scheduleRefactor,
  };
}
