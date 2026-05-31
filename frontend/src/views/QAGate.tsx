/* sprint0 — §27 the QA acceptance experience. QA owns the *accept* gate (not the
   manager's "mark ok"). Run the acceptance checklist (pass / fail / needs-human per
   item), reject a failing item → reroute to the responsible runner, and the consumer
   side of the failing-API flow (report a failing dependency → it blocks the qa gate
   → pings the producer).

   Ported pixel-1:1 from the v5 mockup (app/QAGate.jsx). Data source: REAL backend —
   api.qaRun(projectId) drives the checklist; api.rejectIssue reopens+reroutes. The
   scripted QA_RUN/QA_PRODUCERS below are fallback seeds only (before a run is fired). */
import { useState } from "react";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { api, type QAReport } from "../lib/api";
import { toast } from "sonner";
import { Icon } from "../lib/icon";
import { Avatar, Badge, Button, DiscDot } from "../components/ui";
import { ViewChrome } from "../components/ViewChrome";

// Fallback seed shown only before a real run has been triggered. The primary path
// replaces these items with the live api.qaRun(projectId) result.
const QA_RUN: any = {
  project: "Harbor Logistics", plan: "plan_HARB_42",
  items: [
    { issue_id: "HARB-119", title: "Filter rail tokens + spacing", verdict: "pass", note: "Matches the design-system skeleton tokens.", runner: "mira", disc: "uiux" },
    { issue_id: "HARB-090", title: "Token-scope service — audience-pinned", verdict: "pass", note: "No wildcard tokens; audience claim verified.", runner: "rajiv", disc: "backend" },
    { issue_id: "HARB-201", title: "Preview environments per MR", verdict: "pass", note: "Envs spin up green on every MR.", runner: "dario", disc: "devops" },
    { issue_id: "HARB-104", title: "Geo-cluster perf — 60fps @ 12k pins", verdict: "fail", note: "Drops to 38fps at 9k pins — assertion on the pin budget fails.", runner: "noah", disc: "frontend" },
    { issue_id: "HARB-118", title: "Share-link expired state", verdict: "needs_human", note: "Expired link 404s instead of a recoverable state — judgement call on copy.", runner: "talia", disc: "frontend" },
  ],
  reopened: [],
};
const VERDICT_META: Record<string, { label: string; tone: string; icon: string }> = {
  pass:        { label: "Pass",        tone: "green",  icon: "check" },
  fail:        { label: "Fail",        tone: "red",    icon: "close" },
  needs_human: { label: "Needs human", tone: "amber",  icon: "eye" },
};

// Real QAItemResult now carries runner (issue.assignee) + disc (the gate) — stamped by the
// backend's qa_review. Pass them through so the DiscDot + reject "Route to" pills populate
// on live runs (falling back to "" / undefined for pre-assignment issues).
const toLocalItem = (i: QAReport["items"][number]): any => ({
  issue_id: i.issue_id, title: i.title, verdict: i.verdict, note: i.note,
  runner: i.runner ?? "", disc: i.disc ?? undefined,
});

export function QAGate() {
  const { members, projects } = useApp();
  const liveProjectId = useUI((s) => s.liveProjectId);
  const byUser = (u: string) => members.find((m: any) => m.username === u);

  const [projectId, setProjectId] = useState<number | null>(liveProjectId ?? projects[0]?.project_id ?? null);
  const [ran, setRan] = useState(false);
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [rejecting, setRejecting] = useState<string | null>(null); // issue_id being rejected
  const [flagging, setFlagging] = useState(false);
  const [blocks, setBlocks] = useState<any[]>([]); // failing-dep flags holding the gate

  const project = projects.find((p: any) => p.project_id === projectId);
  // Before a run, fall back to the scripted seed so the strip/checklist still render.
  const display = ran ? items : QA_RUN.items;

  const pass = display.filter((i: any) => i.verdict === "pass").length;
  const total = display.length;
  const gateBlocked = blocks.length > 0 || display.some((i: any) => i.verdict === "fail" && !i.rerouted);

  const runAcceptance = async () => {
    if (projectId == null) { toast.error("Pick a project to run acceptance on."); return; }
    setRunning(true);
    try {
      const report = await api.qaRun(projectId);
      setItems(report.items.map(toLocalItem));
      setRan(true);
      setRejecting(null);
      toast.success("Acceptance run complete", {
        description: `${report.items.filter((i) => i.verdict === "pass").length}/${report.items.length} checks pass`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Acceptance run failed");
    } finally {
      setRunning(false);
    }
  };

  const reroute = async (issue_id: string, to_runner: string, comment: string) => {
    const iid = Number(issue_id);
    if (!Number.isFinite(iid) || projectId == null) { toast.error("Can't reject this item (no numeric issue / project)."); return; }
    try {
      await api.rejectIssue(projectId, iid, { comment, to_runner: to_runner || undefined });
      setItems(is => is.map(i => i.issue_id === issue_id ? { ...i, rerouted: true, to: to_runner, comment } : i));
      setRejecting(null);
      toast.success(`${issue_id} reopened → @${to_runner}`, { description: comment || "see acceptance note" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reject failed");
    }
  };
  const addFlag = (c: any) => {
    setBlocks(b => [...b, { ...c, reporter: "HARB-300" }]);
    setFlagging(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={[project?.name ?? "QA", "QA gate"]}>
        <Badge tone={gateBlocked ? "red" : "green"}>{gateBlocked ? "gate blocked" : "gate open"}</Badge>
        <Badge tone="outline" mono>{ran ? `${total} checks` : QA_RUN.plan}</Badge>
      </ViewChrome>

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 28px 56px" }}>
          {/* project picker */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
            <span className="kicker" style={{ fontSize: 10 }}>Project</span>
            {projects.length === 0 ? (
              <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>No projects yet.</span>
            ) : projects.map((p: any) => (
              <button key={p.project_id} onClick={() => { setProjectId(p.project_id); setRan(false); setItems([]); setRejecting(null); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 11px", borderRadius: "var(--r-pill)",
                  border: `0.5px solid ${projectId === p.project_id ? "var(--text-primary)" : "var(--border)"}`,
                  background: projectId === p.project_id ? "var(--bg-active)" : "var(--bg-elevated)", fontSize: 12, fontWeight: 500 }}>
                {p.name}
              </button>
            ))}
          </div>

          {/* header */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 6px" }}>Acceptance & integration</h1>
              <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.5 }}>
                The <b style={{ color: "var(--text-primary)" }}>accept</b> gate — stage <span className="mono" style={{ color: "var(--text-secondary)" }}>build ∥ → integrate → accept</span>. Reject a failing check to reroute it to the runner.
              </p>
            </div>
            <Button variant="secondary" size="md" icon="ratify" disabled={running || projectId == null} onClick={runAcceptance}>{running ? "Running…" : ran ? "Re-run acceptance" : "Run acceptance"}</Button>
          </div>

          {!ran ? (
            /* empty state — no real run yet (the seed strip/checklist below stays as a preview) */
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderRadius: "var(--r-lg)",
              border: "0.5px solid var(--border)", background: "var(--bg-secondary)", marginBottom: 20 }}>
              <Icon name="ratify" size={14} style={{ color: "var(--text-tertiary)" }} />
              <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
                {running ? "Running the acceptance checklist…" : "Run acceptance to score this project's checklist against the real backend."}
              </span>
            </div>
          ) : null}

          {/* score */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: "var(--r-lg)",
            border: "0.5px solid var(--border)", background: "var(--bg-secondary)", marginBottom: 20 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 600, letterSpacing: "-1px" }}>{pass}<span style={{ color: "var(--text-quaternary)" }}>/{total}</span></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>acceptance checks pass</div>
              <div style={{ display: "flex", gap: 3, marginTop: 7 }}>
                {display.map((i: any) => (
                  <span key={i.issue_id} style={{ flex: 1, height: 5, borderRadius: 3,
                    background: i.rerouted ? "var(--text-quaternary)" : `var(--${VERDICT_META[i.verdict].tone === "green" ? "green" : VERDICT_META[i.verdict].tone === "red" ? "red" : "amber"})` }} />
                ))}
              </div>
            </div>
          </div>

          {/* checklist */}
          <div className="kicker" style={{ marginBottom: 10 }}>Acceptance checklist</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
            {ran && display.length === 0 ? (
              <div style={{ padding: "13px 14px", border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)",
                background: "var(--bg-elevated)", fontSize: 12.5, color: "var(--text-tertiary)" }}>
                No acceptance checks for this project.
              </div>
            ) : display.map((i: any) => (
              <AcceptanceItem key={i.issue_id} item={i} byUser={byUser} members={members}
                rejecting={rejecting === i.issue_id}
                onToggleReject={() => setRejecting(r => r === i.issue_id ? null : i.issue_id)}
                onReroute={reroute} />
            ))}
          </div>

          {/* integration / failing-API — consumer + QA side */}
          <Integration blocks={blocks} flagging={flagging} setFlagging={setFlagging} addFlag={addFlag}
            onClear={(i: number) => setBlocks(b => b.filter((_, j) => j !== i))} />
        </div>
      </div>
    </div>
  );
}

function AcceptanceItem({ item, byUser, members, rejecting, onToggleReject, onReroute }: any) {
  const vm = VERDICT_META[item.verdict];
  const runner = byUser(item.runner);
  const canReject = item.verdict === "fail" || item.verdict === "needs_human";
  return (
    <div style={{ border: `0.5px solid ${rejecting ? "var(--text-primary)" : "var(--border)"}`, borderRadius: "var(--r-lg)",
      overflow: "hidden", boxShadow: "var(--shadow-1)", background: "var(--bg-elevated)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
          background: `color-mix(in srgb, var(--${vm.tone}) 14%, transparent)`, color: `var(--${vm.tone})` }}>
          <Icon name={vm.icon as never} size={13} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{item.issue_id}</span>
            <span style={{ fontSize: 13, fontWeight: 500, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 3, lineHeight: 1.45 }}>{item.note}</div>
        </div>
        <Badge tone={vm.tone as never}>{vm.label}</Badge>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, width: 78 }} title={`runner: ${runner?.name}`}>
          <DiscDot d={item.disc} /><Avatar name={runner?.name} size={18} />
        </span>
        {canReject && !item.rerouted && (
          <Button variant="secondary" size="sm" onClick={onToggleReject}>{rejecting ? "Cancel" : "Reject"}</Button>
        )}
        {item.rerouted && <Badge tone="outline" mono>awaiting re-QA · @{item.to}</Badge>}
      </div>
      {rejecting && <RejectForm item={item} members={members} onReroute={onReroute} />}
    </div>
  );
}

function RejectForm({ item, members, onReroute }: any) {
  const [comment, setComment] = useState("");
  const [to, setTo] = useState(item.runner);
  const candidates = members.filter((m: any) => m.role === "developer" && (m.discipline === item.disc || m.username === item.runner));
  return (
    <div style={{ borderTop: "0.5px solid var(--border-subtle)", background: "var(--bg-secondary)", padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon name="bolt" size={13} style={{ color: "var(--text-primary)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Reject → reopen the GitLab issue and route it back to a runner</span>
      </div>
      <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
        placeholder="What failed, and what the runner needs to change…"
        style={{ width: "100%", padding: "9px 11px", fontSize: 13, lineHeight: 1.5, resize: "none", marginBottom: 10,
          background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)", borderRadius: "var(--r-md)",
          outline: "none", color: "var(--text-primary)", boxShadow: "var(--shadow-inset)", fontFamily: "var(--font-ui)" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="kicker" style={{ fontSize: 10 }}>Route to</span>
        <div style={{ display: "flex", gap: 6 }}>
          {candidates.map((m: any) => (
            <button key={m.username} onClick={() => setTo(m.username)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 9px", borderRadius: "var(--r-pill)",
                border: `0.5px solid ${to === m.username ? "var(--text-primary)" : "var(--border)"}`, background: to === m.username ? "var(--bg-active)" : "var(--bg-elevated)",
                fontSize: 12, fontWeight: 500 }}>
              <Avatar name={m.name} size={16} />{m.name.split(" ")[0]}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <Button variant="primary" size="sm" icon="arrowRight" onClick={() => onReroute(item.issue_id, to, comment)}>Reject & reroute</Button>
      </div>
    </div>
  );
}

/* consumer + QA side of the failing-API flow (§28) */
const QA_PRODUCERS = [
  { id: "HARB-090", title: "Token-scope service", assignee: "rajiv", api_contract: "POST /api/scopes" },
  { id: "HARB-091", title: "Rate-limit + retry budget", assignee: "rajiv", api_contract: "middleware/ratelimit" },
];
function Integration({ blocks, flagging, setFlagging, addFlag }: any) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon name="bolt" size={14} style={{ color: "var(--text-primary)" }} />
        <span className="kicker" style={{ fontSize: 10 }}>Integration · failing dependency</span>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" icon="bolt" onClick={() => setFlagging((f: boolean) => !f)}>Report failing dependency</Button>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "0 0 12px", lineHeight: 1.5 }}>
        A failing producer contract holds the <b style={{ color: "var(--text-primary)" }}>accept</b> gate <b style={{ color: "var(--text-primary)" }}>blocked</b> and pings the producer's Inbox — acceptance can't pass until they fix it.
      </p>

      {flagging && (
        <div style={{ border: "0.5px solid var(--text-primary)", borderRadius: "var(--r-lg)", padding: 13, marginBottom: 12, background: "var(--bg-secondary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
            <Icon name="flag" size={13} style={{ color: "var(--text-tertiary)" }} />
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>More than one upstream producer — pick which contract is failing</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {QA_PRODUCERS.map(c => (
              <button key={c.id} onClick={() => addFlag(c)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", textAlign: "left",
                background: "var(--bg-elevated)", border: "0.5px solid var(--border)", borderRadius: "var(--r-md)" }}>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", width: 60 }}>{c.id}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{c.title}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{c.api_contract} · @{c.assignee}</div>
                </div>
                <Icon name="chevronRight" size={14} style={{ color: "var(--text-quaternary)" }} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
        {blocks.length === 0 ? (
          <div style={{ padding: "13px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} />
            <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>All producer contracts green.</span>
          </div>
        ) : blocks.map((s: any, i: number) => (
          <div key={s.id + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderTop: i ? "0.5px solid var(--border-subtle)" : "none" }}>
            <Badge tone="red">failing</Badge>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{s.title} <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", fontWeight: 400 }}>{s.id}</span></div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{s.api_contract} · pinged @{s.assignee} · accept gate <b style={{ color: "var(--text-primary)" }}>blocked</b></div>
            </div>
            <Badge tone="outline" mono>acceptance held</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
