"""Execute an APPROVED PlanJSON as real GitLab infrastructure (Phase 4).

This is the EXECUTE half of the reason/execute split — deterministic, runs only
after human approval (Trust Dial). Micro-context goes into each issue body.
"""
from __future__ import annotations

from app import gitlab as gl
from app import handoff
from app.contracts import Issue, PlanJSON

_TYPE_COLOR = {"backend": "#2A6FDB", "frontend": "#F4511E", "db": "#0F8E5C", "devops": "#7C3AED", "design": "#D97706"}
_RISK_COLOR = {"low": "#2F8A4E", "medium": "#D97706", "high": "#D63E0E"}


def _issue_body(issue: Issue) -> str:
    files = "\n".join(f"- `{f}`" for f in issue.context_scope.files)
    return (
        f"{issue.description}\n\n---\n"
        f"🎯 **Context Scope** — you only need:\n{files}\n\n> {issue.context_scope.note}\n\n"
        f"**Runner (baton):** @{issue.assignee or 'unassigned'} · "
        f"risk: `{issue.risk}` · skill: `{issue.required_skill}` · est: {issue.estimate_days}d"
    )


def execute_plan(plan: PlanJSON, project_name: str | None = None, with_handoff: bool = True) -> dict:
    project_name = project_name or plan.project_name

    labels: dict[str, str] = {}
    for epic in plan.epics:
        for i in epic.issues:
            labels[f"type:{i.type}"] = _TYPE_COLOR.get(i.type, "#8a7d72")
            labels[f"risk:{i.risk}"] = _RISK_COLOR.get(i.risk, "#8a7d72")
            if i.assignee:
                labels[f"runner:{i.assignee}"] = "#F4511E"

    scaf = gl.create_project_scaffold(project_name, labels=labels)
    pid = scaf["project_id"]

    ts = plan.tech_stack
    readme = (
        f"# {plan.project_name}\n\n{plan.client_summary}\n\n"
        f"## Stack\n- frontend: {ts.frontend}\n- backend: {ts.backend}\n- db: {ts.db}\n- infra: {ts.infra}\n\n"
        f"## Grounded on (agency memory)\n{', '.join(plan.grounded_on) or '—'}\n\n"
        f"_Scaffolded by baton — {plan.timeline_weeks}-week plan, "
        f"{sum(len(e.issues) for e in plan.epics)} issues._\n"
    )
    # README.md already exists (repo init); update it rather than create.
    gl.commit_files(pid, [{"path": "README.md", "action": "update", "content": readme}], branch=scaf["default_branch"])

    issues = []
    for epic in plan.epics:
        for i in epic.issues:
            lbls = [f"type:{i.type}", f"risk:{i.risk}", f"epic:{epic.id}"]
            if i.assignee:
                lbls.append(f"runner:{i.assignee}")
            issues.append({"title": f"[{epic.title}] {i.title}", "description": _issue_body(i), "labels": lbls})
    created = gl.create_issues(pid, issues)

    extra: dict = {}
    if with_handoff:  # Idea 2: per-issue .vscode micro-context branches + a QA-only issue
        branches = handoff.commit_context_branches(pid, plan, default_branch=scaf["default_branch"])
        qa = handoff.create_qa_issue(pid, plan, staging_url=scaf["web_url"])
        extra = {"context_branches": len(branches), "qa_issue_iid": qa.get("iid")}

    return {"web_url": scaf["web_url"], "project_id": pid, "issues_created": len(created), **extra}
