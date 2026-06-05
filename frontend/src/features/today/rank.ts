/* sprint0 — the Today spine's ranking core. Pure: data in, ranked next-actions out. No React/Query.
   score = (baton_on_me ? 1000) + blocks_count*100 − planning_order. Two signals only (baton + blocks);
   the relay DAG is fixed, so blocks_count comes from a constant adjacency, NOT a per-relay fetch.
   Deterministic — sorted by score, tie-broken by id. This is the testable seam (see __cases). */
import type { Discipline, QueueItem, RelaySummary, WorkTask, InboxNeed } from "../../lib/api";
import { DISC } from "../../components/ui";

export type ChipKind = "baton" | "blocks" | "next" | "delta" | "consent" | "ready" | "gap";
export interface NextChip { kind: ChipKind; n?: number }

export type NextTargetKind = "relay" | "qagate" | "scope" | "reschedule" | "relays";
/** The imperative primitive a Today row fires on click; fields carry its argument. */
export interface NextTarget { kind: NextTargetKind; planId?: string; discipline?: Discipline; taskId?: string }
export interface NextAction { label: string; target: NextTarget }

export interface NextItem {
  id: string;                                         // stable React key
  kind: "gate" | "qa" | "task" | "dispatch" | "gap" | "reschedule";
  title: string;
  why: string;                                        // one-line WHY (hero + row subtitle)
  project: string;
  discipline: Discipline | null;
  score: number;
  chips: NextChip[];
  action: NextAction;
}

export interface RankInput {
  role: "manager" | "developer" | "qa";
  myDiscipline: Discipline | null;
  myUsername: string;
  queue: QueueItem[];          // = baton_on_me — gates awaiting ME across all relays
  relays: RelaySummary[];      // the pool — per-relay gate statuses + all_ratified + is_delta
  myTasks: WorkTask[];         // useWork("me") — scheduled_start (order), depends_on
  needs: InboxNeed[];          // inbox.needs_action — reschedule consent rows
  projectNames?: Record<number, string>; // project_id → human name (task rows show the name, not the id)
  seatedDisciplines?: Discipline[];       // disciplines with ≥1 seated dev — a gate whose lane isn't here = an orphan staffing gap
}

// the fixed relay DAG: {uiux ∥ backend ∥ devops} → frontend → qa
const DOWNSTREAM: Record<Discipline, Discipline[]> = {
  uiux: ["frontend", "qa"],
  backend: ["frontend", "qa"],
  devops: ["frontend", "qa"],
  frontend: ["qa"],
  qa: [],
};
const DONE = ["ratified", "auto_passed"]; // GateStatus values that count as cleared
const isDone = (s?: string) => s != null && DONE.includes(s);
const labelOf = (d: Discipline) => DISC[d]?.label ?? d;
const chip = (kind: ChipKind, n?: number): NextChip => ({ kind, n });

/** downstream gates (in THIS relay) still waiting on `disc`, + 1 for the qa gate (it gates "ship"). */
export function blocksForGate(disc: Discipline, relay: RelaySummary): number {
  const statusOf = (d: Discipline) => relay.gates.find((g) => g.discipline === d)?.status;
  const waiting = DOWNSTREAM[disc].filter((d) => !isDone(statusOf(d))).length;
  return waiting + (disc === "qa" ? 1 : 0);
}

function whyGate(disc: Discipline, blocks: number, relay?: RelaySummary): string {
  if (disc === "qa") return blocks ? "Last gate before ship — acceptance pending." : "Acceptance pending.";
  const down = relay
    ? DOWNSTREAM[disc].filter((d) => !isDone(relay.gates.find((g) => g.discipline === d)?.status)).map(labelOf)
    : [];
  if (down.length) return `${down.join(" & ")} wait on it · ${blocks} leg${blocks === 1 ? "" : "s"} blocked.`;
  return "Your slice is ready to ratify.";
}

const countDependents = (id: string, tasks: WorkTask[]): number =>
  tasks.filter((t) => t.status !== "done" && (t.depends_on ?? []).includes(id)).length;

const startTime = (t: WorkTask) => (t.scheduled_start ? Date.parse(t.scheduled_start) : Number.POSITIVE_INFINITY);

export function rankNext(input: RankInput): { startHere: NextItem | null; next: NextItem[] } {
  const items: NextItem[] = [];
  const queuedKeys = new Set(input.queue.map((q) => `${q.plan_id}:${q.discipline}`));
  const relayOf = (planId: string) => input.relays.find((r) => r.plan_id === planId);

  // planning_order: my not-done tasks ranked by scheduled_start (asc, nulls last)
  const ordered = [...input.myTasks].filter((t) => t.status !== "done").sort((a, b) => startTime(a) - startTime(b));
  const planOrder = new Map(ordered.map((t, i) => [t.id, i] as const));

  // 1) gates on my baton (queue = gates awaiting ME). baton_on_me = true.
  for (const q of input.queue) {
    const relay = relayOf(q.plan_id);
    const blocks = relay ? blocksForGate(q.discipline, relay) : 0;
    const isQa = q.discipline === "qa";
    items.push({
      id: `gate:${q.plan_id}:${q.discipline}`,
      kind: isQa ? "qa" : "gate",
      title: isQa ? `Run acceptance — ${q.project}` : `Ratify your ${labelOf(q.discipline)} slice — ${q.project}`,
      why: whyGate(q.discipline, blocks, relay),
      project: q.project,
      discipline: q.discipline,
      score: 1000 + blocks * 100,
      chips: [chip("baton"), ...(blocks ? [chip("blocks", blocks)] : []), ...(q.is_delta ? [chip("delta")] : [])],
      action: isQa
        ? { label: "Run acceptance", target: { kind: "qagate", planId: q.plan_id } }
        : { label: "Ratify slice", target: { kind: "relay", planId: q.plan_id, discipline: q.discipline } },
    });
  }

  // 2) manager only: dispatch-ready relays + orphan-gap gates (heuristic from the summary)
  if (input.role === "manager") {
    const seated = new Set(input.seatedDisciplines ?? []);  // a discipline with no seated dev = a real staffing gap
    for (const r of input.relays) {
      if (r.all_ratified) {
        items.push({
          id: `dispatch:${r.plan_id}`,
          kind: "dispatch",
          title: `${r.project} — ready to dispatch`,
          why: "All gates ratified — open the relay to dispatch.",
          project: r.project,
          discipline: null,
          score: 100,
          chips: [chip("ready"), ...(r.is_delta ? [chip("delta")] : [])],
          action: { label: "Open relay", target: { kind: "relays" } },
        });
      }
      for (const g of r.gates) {
        const ownerless = !seated.has(g.discipline);  // orphan = NO dev seated for this lane (not merely "not on the baton yet")
        if (!isDone(g.status) && ownerless && !queuedKeys.has(`${r.plan_id}:${g.discipline}`)) {
          const blocks = blocksForGate(g.discipline, r);
          items.push({
            id: `gap:${r.plan_id}:${g.discipline}`,
            kind: "gap",
            title: `${labelOf(g.discipline)} gap — ${r.project}`,
            why: `No owner on ${labelOf(g.discipline)}${blocks ? ` · ${blocks} leg${blocks === 1 ? "" : "s"} blocked` : ""}.`,
            project: r.project,
            discipline: g.discipline,
            score: blocks * 100,
            chips: [chip("gap"), ...(blocks ? [chip("blocks", blocks)] : [])],
            action: { label: "Cover gate", target: { kind: "relay", planId: r.plan_id, discipline: g.discipline } },
          });
        }
      }
    }
  }

  // 3) my tasks (developer/qa planning queue). baton_on_me = false.
  for (const t of input.myTasks) {
    if (t.status === "done") continue;
    const po = planOrder.get(t.id) ?? 999;
    const dep = countDependents(t.id, input.myTasks);
    items.push({
      id: `task:${t.id}`,
      kind: "task",
      title: t.title,
      why: dep ? `Blocks ${dep} task${dep === 1 ? "" : "s"} downstream.` : "Next in your planned order.",
      project: input.projectNames?.[t.project_id] ?? String(t.project_id),
      discipline: t.discipline,
      score: dep * 100 - po,
      chips: dep ? [chip("blocks", dep)] : [chip("next")],
      action: { label: "Open scope", target: { kind: "scope", taskId: t.id } },
    });
  }

  // 4) reschedule consent (from inbox needs_action)
  for (const n of input.needs.filter((x) => x.kind === "reschedule")) {
    const pid = (n.item as { id?: string } | undefined)?.id ?? n.title;
    items.push({
      id: `reschedule:${pid}`,
      kind: "reschedule",
      title: n.title || "Reschedule proposed",
      why: "A reflow needs your consent.",
      project: "",
      discipline: null,
      score: 50,
      chips: [chip("consent")],
      action: { label: "Review", target: { kind: "reschedule" } },
    });
  }

  items.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { startHere: items[0] ?? null, next: items.slice(1) };
}

/* ── Living verification fixtures (no test runner yet — assert by hand or wire vitest later). ──
   Each case's expected startHere id + score documents the locked formula. */
export const __cases: { name: string; input: RankInput; expect: { startHere: string; score: number } }[] = [
  {
    name: "backend gate on my baton, frontend+qa pending → 1000 + 2*100",
    input: {
      role: "developer", myDiscipline: "backend", myUsername: "jean",
      queue: [{ plan_id: "p1", project: "HomeHero", discipline: "backend", status: "changes_requested", issue_count: 2, is_delta: false, target_project_id: null }],
      relays: [{ plan_id: "p1", project: "HomeHero", baton: ["backend"], all_ratified: false, is_delta: false, target_project_id: null,
        gates: [{ discipline: "backend", status: "changes_requested", note: "" }, { discipline: "frontend", status: "locked", note: "" }, { discipline: "qa", status: "locked", note: "" }] }],
      myTasks: [], needs: [],
    },
    expect: { startHere: "gate:p1:backend", score: 1200 },
  },
  {
    name: "qa gate on my baton, frontend ratified → blocks 1 (ship) → 1100",
    input: {
      role: "qa", myDiscipline: "qa", myUsername: "pascal",
      queue: [{ plan_id: "p1", project: "HomeHero", discipline: "qa", status: "pending", issue_count: 1, is_delta: false, target_project_id: null }],
      relays: [{ plan_id: "p1", project: "HomeHero", baton: ["qa"], all_ratified: false, is_delta: false, target_project_id: null,
        gates: [{ discipline: "frontend", status: "ratified", note: "" }, { discipline: "qa", status: "pending", note: "" }] }],
      myTasks: [], needs: [],
    },
    expect: { startHere: "gate:p1:qa", score: 1100 },
  },
  {
    name: "no baton, a task with a not-done dependent outranks the idle one",
    input: {
      role: "developer", myDiscipline: "backend", myUsername: "jean",
      queue: [], relays: [],
      myTasks: [
        { id: "T1", project_id: 9, title: "API", status: "in_progress", discipline: "backend", assignee: "jean", depends_on: [], scheduled_start: "2026-06-01" },
        { id: "T2", project_id: 9, title: "UI", status: "planned", discipline: "frontend", assignee: "sam", depends_on: ["T1"], scheduled_start: "2026-06-03" },
      ] as WorkTask[],
      needs: [],
    },
    expect: { startHere: "task:T1", score: 100 }, // 1 dependent (T2) * 100 − planOrder 0
  },
];
