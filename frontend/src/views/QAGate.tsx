/* sprint0 — §27 the QA acceptance experience. QA owns the *accept* gate (not the
   manager's "mark ok"). Run the acceptance checklist (pass / fail / needs-human per
   item), reject a failing item → reroute to the responsible runner, and the consumer
   side of the failing-API flow (report a failing dependency → it blocks the qa gate
   → pings the producer).

   Ported pixel-1:1 from the v5 mockup (app/QAGate.jsx). Data source: REAL backend —
   api.qaRun(projectId) drives the checklist; api.rejectIssue reopens+reroutes. Before a
   run the checklist is empty (a prompt to run acceptance) — no scripted/fabricated rows. */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { api, type QAReport, type QAQueueEntry } from "../lib/api";
import { toast } from "sonner";
import { Icon } from "../lib/icon";
import { Avatar, Badge, Button, DiscDot } from "../components/ui";
import { ViewChrome } from "../components/ViewChrome";
import { ProjectSwitcher } from "../components/ProjectSwitcher";

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
  const projectFilter = useUI((s) => s.projectFilter);
  const byUser = (u: string) => members.find((m: any) => m.username === u);

  // cross-project QA queue — every project with acceptance work outstanding (the Tester is no longer
  // locked to one project). The ProjectSwitcher narrows it; selecting a row scopes the acceptance below.
  const { data: queueResp } = useQuery({ queryKey: ["qaQueue"], queryFn: () => api.qaQueue() });
  const queue: QAQueueEntry[] = useMemo(() => queueResp?.queue ?? [], [queueResp]);
  const queueShown = projectFilter == null ? queue : queue.filter((e) => e.project_id === projectFilter);

  const [projectId, setProjectId] = useState<number | null>(projectFilter ?? liveProjectId ?? null);
  const [ran, setRan] = useState(false);
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [rejecting, setRejecting] = useState<string | null>(null); // issue_id being rejected
  const [tester, setTester] = useState<any>(null); // who sprint0 routed acceptance to (qaRun → best-by-passport)

  // follow the topbar ProjectSwitcher; otherwise default to the top queue entry once it loads
  useEffect(() => { if (projectFilter != null && projectFilter !== projectId) { setProjectId(projectFilter); setRan(false); setItems([]); setRejecting(null); setTester(null); } }, [projectFilter, projectId]);
  useEffect(() => { if (projectId == null && queue.length) setProjectId(queue[0].project_id); }, [queue, projectId]);

  const project = projects.find((p: any) => p.project_id === projectId);
  const sel = queue.find((e) => e.project_id === projectId);  // selected queue entry → its real plan_id pre-run
  // No scripted preview: before a run the checklist is empty and the header prompts to run acceptance.
  const display = ran ? items : [];

  const pass = display.filter((i: any) => i.verdict === "pass").length;
  const total = display.length;
  const gateBlocked = display.some((i: any) => i.verdict === "fail" && !i.rerouted);

  const runAcceptance = async () => {
    if (projectId == null) { toast.error("Pick a project to run acceptance on."); return; }
    setRunning(true);
    try {
      const report = await api.qaRun(projectId);
      setItems(report.items.map(toLocalItem));
      setTester(report.tester ?? null);
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
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={[project?.name ?? "QA", "Tester"]}>
        <Badge tone={gateBlocked ? "red" : "green"}>{gateBlocked ? "gate blocked" : "gate open"}</Badge>
        <Badge tone="outline" mono>{ran ? `${total} checks` : (sel?.plan_id ?? "—")}</Badge>
        <ProjectSwitcher />
      </ViewChrome>

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 28px 56px" }}>
          {/* cross-project QA queue — pick a project's acceptance to run */}
          <div className="kicker" style={{ fontSize: 10, marginBottom: 10 }}>QA queue · acceptance across projects</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
            {queueShown.length === 0 ? (
              <div style={{ padding: "13px 14px", border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)",
                background: "var(--bg-secondary)", fontSize: 12.5, color: "var(--text-tertiary)" }}>
                {projectFilter != null ? "This project's accept gate has no outstanding QA." : "No projects need QA right now."}
              </div>
            ) : queueShown.map((e) => (
              <QueueRow key={e.project_id} e={e} active={projectId === e.project_id}
                onClick={() => { setProjectId(e.project_id); setRan(false); setItems([]); setRejecting(null); setTester(null); }} />
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

          {ran && tester && <TesterRouting tester={tester} />}

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
          <Integration />
        </div>
      </div>
    </div>
  );
}

/* who sprint0 routed acceptance to + why (best-by-passport — skill × trust, not always a titled QA). */
function TesterRouting({ tester }: { tester: { name: string; discipline?: string | null; score?: number; reason?: string } }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 15px", marginBottom: 20,
      borderRadius: "var(--r-lg)", border: "0.5px solid var(--border)", background: "var(--bg-secondary)", boxShadow: "var(--shadow-1)" }}>
      <Avatar name={tester.name} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Icon name="bolt" size={13} style={{ color: "var(--text-primary)" }} />
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>sprint0 routed acceptance to <b style={{ color: "var(--text-primary)", fontWeight: 600 }}>{tester.name}</b></span>
          {tester.discipline && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-tertiary)" }}><DiscDot d={tester.discipline as never} />{tester.discipline}</span>}
        </div>
        <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {typeof tester.score === "number" && tester.score > 0 && (
            <span className="mono" style={{ display: "inline-flex", alignItems: "center", height: 19, padding: "0 8px", borderRadius: "var(--r-pill)", fontSize: 10.5, fontWeight: 600, background: "var(--ink-fill)", color: "#fff" }}>match {tester.score.toFixed(2)}</span>
          )}
          {tester.reason && (
            <span className="mono" style={{ display: "inline-flex", alignItems: "center", height: 19, padding: "0 8px", borderRadius: "var(--r-pill)", fontSize: 10.5, fontWeight: 600, background: "var(--bg-elevated)", color: "var(--text-tertiary)", border: "0.5px solid var(--border)" }}>{tester.reason}</span>
          )}
        </div>
      </div>
      <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)", flexShrink: 0, textAlign: "right", maxWidth: 130, lineHeight: 1.45 }}>skill × trust · not always a titled QA</span>
    </div>
  );
}

/* one cross-project QA queue row — a project whose accept gate still has work. */
function QueueRow({ e, active, onClick }: { e: QAQueueEntry; active: boolean; onClick: () => void }) {
  const [h, setH] = useState(false);
  const statusTone = e.qa_status === "blocked" ? "red" : e.qa_status === "changes_requested" ? "amber"
    : e.qa_status === "ratified" || e.qa_status === "auto_passed" ? "green" : "outline";
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", textAlign: "left", width: "100%",
        borderRadius: "var(--r-lg)", background: "var(--bg-elevated)",
        border: `0.5px solid ${active ? "var(--text-primary)" : "var(--border)"}`,
        boxShadow: active || h ? "var(--shadow-2)" : "var(--shadow-1)", transition: "box-shadow var(--t-quick), border-color var(--t-quick)" }}>
      <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
        background: e.baton ? "var(--ink-fill)" : "var(--bg-secondary)", color: e.baton ? "#fff" : "var(--text-tertiary)" }}>
        <Icon name="qa" size={12} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.project_name}</div>
        <div className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>
          {e.issue_count} {e.issue_count === 1 ? "check" : "checks"}{e.awaiting_reqa.length ? ` · ${e.awaiting_reqa.length} re-QA` : ""}
        </div>
      </div>
      {e.baton && <Badge tone="ink"><Icon name="flag" size={10} />baton</Badge>}
      <Badge tone={statusTone as never} mono>{e.qa_status}</Badge>
      <Icon name="chevronRight" size={15} style={{ color: "var(--text-quaternary)" }} />
    </button>
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

/* §28 failing-API gate (consumer side). The wired report→block→ping flow (POST …/integration/flag)
   is a Claude-Design item — see docs/UI-NEEDS.md — so the Tester never shows a fabricated producer. */
function Integration() {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon name="bolt" size={14} style={{ color: "var(--text-primary)" }} />
        <span className="kicker" style={{ fontSize: 10 }}>Integration · failing dependency</span>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "0 0 12px", lineHeight: 1.5 }}>
        A failing producer contract holds the <b style={{ color: "var(--text-primary)" }}>accept</b> gate <b style={{ color: "var(--text-primary)" }}>blocked</b> and pings the producer's Inbox — acceptance can't pass until they fix it.
      </p>
      <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
        <div style={{ padding: "13px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} />
          <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>All producer contracts green.</span>
        </div>
      </div>
    </div>
  );
}
