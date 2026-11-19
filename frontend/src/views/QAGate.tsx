/* sprint0 — §27 the Tester (acceptance) experience. QA owns the *accept* gate.
   DETERMINISTIC + human-verified: each criterion row joins its task's REAL state
   (awaiting merge / ready / bounced to re-QA) — rows render instantly, no AI wait.
   The TESTER records the verdicts: Pass is enabled only once the work is merged
   (server-enforced), Fail = the reject flow (reopen the GitLab issue + reroute to
   the runner). The AI contributes async risk HINTS per row ("check token rotation
   by hand") — notes, never judgments. Same spine as the gates: AI proposes, the
   human ratifies. Data: api.qaChecklist / qaVerdict / qaHints / rejectIssue. */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../app/useApp";
import { useUI } from "../lib/store";
import { api, type QAQueueEntry } from "../lib/api";
import { toast } from "sonner";
import { Icon } from "../lib/icon";
import { Avatar, Badge, Button, DiscDot } from "../components/ui";
import { isDone } from "../lib/gate";
import { ViewChrome } from "../components/ViewChrome";
import { ProjectSwitcher } from "../components/ProjectSwitcher";

/* row visuals — STATE is the task-join truth; a recorded human verdict overrides it */
const STATE_META: Record<string, { label: string; tone: string; icon: string }> = {
  awaiting: { label: "Awaiting merge", tone: "outline", icon: "calendar" },
  ready:    { label: "Ready to check", tone: "ink",     icon: "qa" },
  bounced:  { label: "Awaiting re-QA", tone: "amber",   icon: "bolt" },
};
const VERDICT_META: Record<string, { label: string; tone: string; icon: string }> = {
  pass: { label: "Passed", tone: "green", icon: "check" },
  fail: { label: "Failed", tone: "red",   icon: "close" },
};
const rowMeta = (i: { state: string; verdict?: string | null }) =>
  (i.verdict && VERDICT_META[i.verdict] && !(i.verdict === "fail" && i.state === "bounced")
    ? VERDICT_META[i.verdict]
    : STATE_META[i.state] ?? STATE_META.awaiting);
const stripColor = (i: { state: string; verdict?: string | null }) =>
  i.verdict === "pass" ? "var(--green)"
  : i.state === "bounced" ? "var(--amber)"
  : i.verdict === "fail" ? "var(--red)"
  : i.state === "ready" ? "var(--text-secondary)"
  : "var(--bg-tertiary)";

export function QAGate() {
  const { me, members, projects } = useApp();
  const qc = useQueryClient();
  const liveProjectId = useUI((s) => s.liveProjectId);
  const projectFilter = useUI((s) => s.projectFilter);
  const byUser = (u: string) => members.find((m: any) => m.username === u);

  // cross-project QA queue — every project with acceptance work outstanding (the Tester is no longer
  // locked to one project). The ProjectSwitcher narrows it; selecting a row scopes the acceptance below.
  const { data: queueResp } = useQuery({ queryKey: ["qaQueue"], queryFn: () => api.qaQueue(), refetchInterval: 8000 });
  const queue: QAQueueEntry[] = useMemo(() => queueResp?.queue ?? [], [queueResp]);
  const queueShown = projectFilter == null ? queue : queue.filter((e) => e.project_id === projectFilter);

  const [projectId, setProjectId] = useState<number | null>(projectFilter ?? liveProjectId ?? null);
  const [rejecting, setRejecting] = useState<string | null>(null); // issue_id whose reject form is open
  const [openId, setOpenId] = useState<number | null>(null); // which project's acceptance detail is open (null = the queue list)

  // follow the topbar ProjectSwitcher; otherwise default to the top queue entry once it loads
  useEffect(() => { if (projectFilter != null && projectFilter !== projectId) { setProjectId(projectFilter); setRejecting(null); } }, [projectFilter, projectId]);
  useEffect(() => { if (projectId == null && queue.length) setProjectId(queue[0].project_id); }, [queue, projectId]);

  const project = projects.find((p: any) => p.project_id === projectId);
  const sel = queue.find((e) => e.project_id === projectId);

  // the checklist is DETERMINISTIC — instant rows from real task state (refetched as merges land)
  const { data: report } = useQuery({
    queryKey: ["qaChecklist", projectId],
    queryFn: () => api.qaChecklist(projectId as number),
    enabled: openId != null && projectId != null,
    refetchInterval: 8000,
    retry: false,
  });
  // async AI risk hints — fired AFTER the rows render; notes only, never verdicts
  const { data: hintsResp } = useQuery({
    queryKey: ["qaHints", projectId],
    queryFn: () => api.qaHints(projectId as number),
    enabled: !!report && projectId != null,
    staleTime: Infinity,
    retry: false,
  });
  const display = useMemo(
    () => (report?.items ?? []).map((i) => ({ ...i, hint: i.hint ?? hintsResp?.hints?.[i.issue_id] ?? null })),
    [report, hintsResp],
  );

  const passCount = display.filter((i: any) => i.verdict === "pass").length;
  const total = display.length;
  const allPassed = total > 0 && passCount === total && !(report?.reopened?.length);
  const gateBlocked = display.some((i: any) => i.state === "bounced");

  const passItem = useMutation({
    mutationFn: (issueId: string) => api.qaVerdict(projectId as number, issueId),
    onSuccess: (res) => {
      toast.success(res.all_passed ? `All ${res.total} checks passed — acceptance complete` : `${res.issue_id} passed (${res.passed}/${res.total})`);
      qc.invalidateQueries({ queryKey: ["qaChecklist", projectId] });
      qc.invalidateQueries({ queryKey: ["qaQueue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't record the verdict"),
  });

  // acceptance complete → the manager closes the project (post-mortem → agency memory). The CTA is the
  // missing last beat: without it the 10/10 banner was a dead end.
  const closeIt = useMutation({
    mutationFn: () => api.closeProject(projectId as number),
    onSuccess: () => {
      toast.success("Project closed — outcome written to agency memory");
      qc.invalidateQueries({ queryKey: ["qaQueue"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setOpenId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Close failed"),
  });

  const reroute = async (issue_id: string, to_runner: string, comment: string, itemIid?: number | null) => {
    // live items carry plan ids ("epic-1-3") — the server-overlaid `iid` is the real GitLab issue number
    const iid = itemIid ?? Number(issue_id);
    if (!Number.isFinite(iid) || projectId == null) { toast.error("Can't reject this item (no numeric issue / project)."); return; }
    try {
      await api.rejectIssue(projectId, iid, { comment, to_runner: to_runner || undefined });
      setRejecting(null);
      toast.success(`${issue_id} reopened${to_runner ? ` → @${to_runner}` : ""}`, { description: comment || "see acceptance note" });
      qc.invalidateQueries({ queryKey: ["qaChecklist", projectId] });
      qc.invalidateQueries({ queryKey: ["qaQueue"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reject failed");
    }
  };
  const openProject = (id: number) => { setProjectId(id); setOpenId(id); setRejecting(null); };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={openId == null ? ["Studio", "Tester"] : ["Tester", project?.name ?? "Acceptance"]}>
        {openId == null
          ? <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{queueShown.length} {queueShown.length === 1 ? "project" : "projects"}</span>
          : <>
              <Badge tone={gateBlocked ? "red" : allPassed ? "green" : "outline"}>{gateBlocked ? "gate blocked" : allPassed ? "all checks passed" : "gate open"}</Badge>
              <Badge tone="outline" mono>{total ? `${passCount}/${total} passed` : (sel?.plan_id ?? "—")}</Badge>
            </>}
        <ProjectSwitcher />
      </ViewChrome>

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 28px 56px" }}>
          {openId == null ? (
            /* the acceptance QUEUE — the list of projects with outstanding acceptance (JIT, like the relays) */
            <>
              <div style={{ marginBottom: 16 }}>
                <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 6px" }}>Acceptance queue</h1>
                <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.5 }}>
                  Every project with acceptance work — pick one to verify its checklist. The <b style={{ color: "var(--text-primary)" }}>accept</b> gate is the last stage before ship.
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {queueShown.length === 0 ? (
                  <div style={{ padding: "13px 14px", border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)",
                    background: "var(--bg-secondary)", fontSize: 12.5, color: "var(--text-tertiary)" }}>
                    {projectFilter != null ? "This project's accept gate has no outstanding acceptance." : "No projects need acceptance right now."}
                  </div>
                ) : queueShown.map((e) => (
                  /* a project can hold several relays (initial + feature adds) → key by the RELAY, not the project */
                  <QueueRow key={e.plan_id || e.project_id} e={e} active={false} onClick={() => openProject(e.project_id)} />
                ))}
              </div>
            </>
          ) : (
            /* the selected project's acceptance DETAIL — real states + human verdicts + AI hints */
            <>
              <button onClick={() => setOpenId(null)} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14, fontSize: 12.5, fontWeight: 500, color: "var(--text-tertiary)" }}>
                <Icon name="chevronLeft" size={14} /> Acceptance queue
              </button>
              <div style={{ marginBottom: 20 }}>
                <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 6px" }}>Acceptance</h1>
                <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.5 }}>
                  The <b style={{ color: "var(--text-primary)" }}>accept</b> gate — each check unlocks when its work is <b style={{ color: "var(--text-primary)" }}>merged</b>; you verify it against the definition of done and pass it, or reject it back to the runner.
                </p>
              </div>

              {report?.tester && <TesterRouting tester={report.tester} />}

              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: "var(--r-lg)",
                border: `0.5px solid ${allPassed ? "var(--green)" : "var(--border)"}`, background: "var(--bg-secondary)", marginBottom: 20 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 600, letterSpacing: "-1px" }}>
                  {passCount}<span style={{ color: "var(--text-quaternary)" }}>/{total}</span>
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{allPassed ? "all checks passed — acceptance complete" : "checks passed"}</div>
                  {total > 0 && (
                    <div style={{ display: "flex", gap: 3, marginTop: 7 }}>
                      {display.map((i: any) => (
                        <span key={i.issue_id} style={{ flex: 1, height: 5, borderRadius: 3, background: stripColor(i) }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {allPassed && (
                /* the next beat after 10/10 — close the project so the outcome compounds into agency memory */
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: "var(--r-lg)",
                  border: "0.5px solid var(--green)", background: "var(--bg-secondary)", marginBottom: 20 }}>
                  <Icon name="check" size={18} style={{ color: "var(--green)" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>Ready to close out</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                      {me?.is_manager
                        ? "Close the project to write its outcome into agency memory — future briefs ground on it."
                        : "The manager has been notified to close the project."}
                    </div>
                  </div>
                  {me?.is_manager && (
                    <Button onClick={() => closeIt.mutate()} disabled={closeIt.isPending}>
                      {closeIt.isPending ? "Closing…" : "Close project"}
                    </Button>
                  )}
                </div>
              )}

              <div className="kicker" style={{ marginBottom: 10 }}>Acceptance checklist</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
                {report && display.length === 0 ? (
                  <div style={{ padding: "13px 14px", border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)",
                    background: "var(--bg-elevated)", fontSize: 12.5, color: "var(--text-tertiary)" }}>
                    No acceptance checks for this project.
                  </div>
                ) : display.map((i: any) => (
                  <AcceptanceItem key={i.issue_id} item={i} byUser={byUser} members={members}
                    rejecting={rejecting === i.issue_id}
                    passing={passItem.isPending}
                    onPass={() => passItem.mutate(i.issue_id)}
                    onToggleReject={() => setRejecting(r => r === i.issue_id ? null : i.issue_id)}
                    onReroute={reroute} />
                ))}
              </div>
            </>
          )}
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
    : e.qa_status === "passed" || isDone(e.qa_status) ? "green" : "outline";
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
          {e.passed_count}/{e.issue_count} passed{e.awaiting_reqa.length ? ` · ${e.awaiting_reqa.length} re-QA` : ""}
        </div>
      </div>
      {e.baton && <Badge tone="ink"><Icon name="flag" size={10} />baton</Badge>}
      <Badge tone={statusTone as never} mono>{e.qa_status}</Badge>
      <Icon name="chevronRight" size={15} style={{ color: "var(--text-quaternary)" }} />
    </button>
  );
}

function AcceptanceItem({ item, byUser, members, rejecting, passing, onPass, onToggleReject, onReroute }: any) {
  const m = rowMeta(item);
  const runner = byUser(item.runner);
  const canPass = item.state === "ready" && item.verdict !== "pass";
  const canFail = item.state !== "awaiting" && item.verdict !== "pass" && item.state !== "bounced";
  return (
    <div style={{ border: `0.5px solid ${rejecting ? "var(--text-primary)" : "var(--border)"}`, borderRadius: "var(--r-lg)",
      overflow: "hidden", boxShadow: "var(--shadow-1)", background: "var(--bg-elevated)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
          background: m.tone === "outline" || m.tone === "ink" ? "var(--bg-secondary)" : `color-mix(in srgb, var(--${m.tone}) 14%, transparent)`,
          color: m.tone === "outline" ? "var(--text-quaternary)" : m.tone === "ink" ? "var(--text-secondary)" : `var(--${m.tone})` }}>
          <Icon name={m.icon as never} size={13} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>{item.issue_id}</span>
            <span style={{ fontSize: 13, fontWeight: 500, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
          </div>
          {item.criterion && (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 3, lineHeight: 1.45 }}>{item.criterion}</div>
          )}
          {item.hint && (
            <div style={{ fontSize: 11.5, color: "var(--text-quaternary)", marginTop: 3, lineHeight: 1.45 }}>
              <span className="mono" style={{ fontSize: 10 }}>AI</span> · {item.hint}
            </div>
          )}
        </div>
        <Badge tone={m.tone as never}>{m.label}</Badge>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, width: 78 }} title={`runner: ${runner?.name}`}>
          <DiscDot d={item.disc} /><Avatar name={runner?.name} size={18} />
        </span>
        {canPass && <Button variant="primary" size="sm" icon="check" disabled={passing} onClick={onPass}>Pass</Button>}
        {canFail && <Button variant="secondary" size="sm" onClick={onToggleReject}>{rejecting ? "Cancel" : "Fail"}</Button>}
      </div>
      {rejecting && <RejectForm item={item} members={members} onReroute={onReroute} />}
    </div>
  );
}

function RejectForm({ item, members, onReroute }: any) {
  const [comment, setComment] = useState("");
  const [to, setTo] = useState(item.runner);
  // composable roles: a member covers a lane via disciplines[] (the single `discipline` is a display mirror)
  const candidates = members.filter((m: any) => m.role === "developer"
    && ((m.disciplines ?? [m.discipline]).includes(item.disc) || m.username === item.runner));
  return (
    <div style={{ borderTop: "0.5px solid var(--border-subtle)", background: "var(--bg-secondary)", padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon name="bolt" size={13} style={{ color: "var(--text-primary)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Fail → reopen the GitLab issue and route it back to a runner</span>
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
        <Button variant="primary" size="sm" icon="arrowRight" onClick={() => onReroute(item.issue_id, to, comment, item.iid)}>Fail & reroute</Button>
      </div>
    </div>
  );
}
