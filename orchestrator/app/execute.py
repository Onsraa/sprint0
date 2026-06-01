"""Execute an APPROVED PlanJSON as real GitLab infrastructure (Phase 4).

The EXECUTE half of the reason/execute split — deterministic, runs only after the relay
clears (Trust Dial). Per kind: code/infra issues get a sparse-checkout focus branch;
design/audit/content live as issues + attachments (no branch). Mid-prod (`extend_project`)
appends to an existing project instead of scaffolding a new one.
"""
from __future__ import annotations

import os

from app import gitlab as gl
from app import demo, handoff, policy, team
from app.contracts import Issue, PlanJSON

_TYPE_COLOR = {"backend": "#2A6FDB", "frontend": "#F4511E", "db": "#0F8E5C", "devops": "#7C3AED", "design": "#D97706"}
_RISK_COLOR = {"low": "#2F8A4E", "medium": "#D97706", "high": "#D63E0E"}

_FOCUS_SH = """#!/usr/bin/env bash
# sprint0 focus — collapse the working tree to ONLY this issue's files (real micro-context).
# Usage: git checkout sprint0/<issue> && bash .sprint0/focus.sh
set -e
[ -f .sprint0/focus.json ] || { echo "no .sprint0/focus.json — checkout a sprint0/<issue> branch first"; exit 1; }
FILES=$(python3 -c "import json;print(' '.join(json.load(open('.sprint0/focus.json'))['files']))")
git sparse-checkout init --no-cone
git sparse-checkout set $FILES .sprint0 .vscode
echo "sprint0: working tree focused on:"; echo "$FILES" | tr ' ' '\\n' | sed 's/^/  - /'
"""

_CI_YML = """# sprint0 CI gate — bad merges blocked here, before the QA-agent + human sign-off.
stages: [test]
lint:
  stage: test
  script: ['echo "sprint0 CI · lint placeholder — wire eslint/ruff here"']
test:
  stage: test
  script: ['echo "sprint0 CI · acceptance tests run here; the QA relay adjudicates downstream"']
"""


def _issue_body(issue: Issue, clone_url: str = "") -> str:
    """Body is polymorphic on kind — the execution surface, not the workflow, changes."""
    head = f"{issue.description}\n\n---\n"
    foot = (
        f"\n\n**Runner (sprint0):** @{issue.assignee or 'unassigned'} · kind: `{issue.kind}` · "
        f"risk: `{issue.risk}` · skill: `{issue.required_skill}` · est: {issue.estimate_days}d"
        + (f"\n\n> ⚠ **Stretch assignment:** {issue.stretch_flag}" if issue.stretch_flag else "")
    )
    if issue.kind in ("code", "infra"):
        files = "\n".join(f"- `{f}`" for f in issue.context_scope.files)
        bid = issue.id.lower()
        if clone_url:
            repo_dir = clone_url.rstrip("/").split("/")[-1].removesuffix(".git") or "repo"
            fetch = f"git clone {clone_url} && cd {repo_dir} && git checkout sprint0/{bid} && bash .sprint0/focus.sh && code ."
        else:
            fetch = f"git checkout sprint0/{bid} && bash .sprint0/focus.sh && code ."
        body = (
            f"🎯 **Micro-context** — you only need:\n{files}\n\n> {issue.context_scope.note}\n\n"
            f"**Fetch → focus → open** (VSCode; swap `code .` for your editor):\n```sh\n{fetch}\n```"
        )
        if issue.api_contract:
            body += f"\n\n**API contract (mock payload) — produced here:**\n```json\n{issue.api_contract}\n```"
        consumed = issue.context.api_contract or issue.context.mock_payload
        if consumed and not issue.api_contract:
            body += f"\n\n**Consumes API contract:**\n```json\n{consumed}\n```"
    elif issue.kind == "design":
        screens = ", ".join(issue.context.screens) or "(see brief)"
        figma = issue.context.figma_file or "(create a Figma file, paste the link here)"
        body = (
            f"🎨 **Design task** — no repo branch.\n- Screens: {screens}\n- Figma: {figma}\n\n"
            f"**Done when:** published frames + exported design tokens are attached to this issue."
        )
    elif issue.kind == "audit":
        pages = "\n".join(f"- {p}" for p in issue.context.target_pages) or "- (see brief)"
        rubric = "\n".join(f"- [ ] {r}" for r in issue.context.rubric) or "- [ ] (define the rubric)"
        body = (
            f"🔍 **Audit task** — no repo branch.\n**Target pages:**\n{pages}\n\n**Rubric:**\n{rubric}\n\n"
            f"**Done when:** the audit report is attached to this issue."
        )
    elif issue.kind == "content":
        slots = "\n".join(f"- {s}" for s in issue.context.slots) or "- (see brief)"
        body = (
            f"✍️ **Content task** — no repo branch.\n**Slots:**\n{slots}\n- Tone: "
            f"{issue.context.tone or 'brand default'}\n\n**Done when:** the copy is attached to this issue."
        )
    else:
        body = issue.context_scope.note
    return head + body + foot


def _plan_labels(plan: PlanJSON) -> dict[str, str]:
    labels: dict[str, str] = {}
    for epic in plan.epics:
        for i in epic.issues:
            labels[f"type:{i.type}"] = _TYPE_COLOR.get(i.type, "#8a7d72")
            labels[f"risk:{i.risk}"] = _RISK_COLOR.get(i.risk, "#8a7d72")
            if i.assignee:
                labels[f"runner:{i.assignee}"] = "#F4511E"
    return labels


def _gitlab_uid(username: str | None) -> int | None:
    m = team.get(username or "")
    return m.gitlab_user_id if m else None


def _issue_dicts(plan: PlanJSON, clone_url: str = "") -> list[dict]:
    out: list[dict] = []
    for epic in plan.epics:
        for i in epic.issues:
            lbls = [f"type:{i.type}", f"risk:{i.risk}", f"epic:{epic.id}"]
            if i.assignee:
                lbls.append(f"runner:{i.assignee}")
            if i.stretch_flag:
                lbls.append("stretch")
            uid = _gitlab_uid(i.assignee)
            out.append({
                "title": f"[{epic.title}] {i.title}", "description": _issue_body(i, clone_url),
                "labels": lbls, "assignee_ids": [uid] if uid else [],
            })
    return out


def _invite_assignees(project_id: int, plan: PlanJSON) -> None:
    """Native assignees must be project members — invite each assigned member whose craft has
    repo access (policy). Non-code crafts (e.g. marketing) are never invited to the repo."""
    uids = {
        m.gitlab_user_id
        for e in plan.epics for i in e.issues
        if i.assignee and (m := team.get(i.assignee)) and m.gitlab_user_id and policy.needs_repo(m.discipline)
    }
    for uid in uids:
        try:
            gl.add_member(project_id, uid)
        except Exception:
            pass  # already a member


def execute_plan(plan: PlanJSON, project_name: str | None = None, with_handoff: bool = True) -> dict:
    if demo.is_demo():  # public demo: no real GitLab writes — point at a pre-made showcase project
        n = sum(len(e.issues) for e in plan.epics)
        return {
            "web_url": os.getenv("DEMO_SHOWCASE_URL", "https://gitlab.com/sprint0-demo"),
            "clone_url": "", "project_id": int(os.getenv("DEMO_SHOWCASE_PID", "0")),
            "default_branch": "main", "issues_created": n, "context_branches": n,
            "qa_issue_iid": None, "demo_stub": True,
        }
    project_name = project_name or plan.project_name
    scaf = gl.create_project_scaffold(project_name, labels=_plan_labels(plan))
    pid = scaf["project_id"]

    ts = plan.tech_stack
    readme = (
        f"# {plan.project_name}\n\n{plan.client_summary}\n\n"
        f"## Stack\n- frontend: {ts.frontend}\n- backend: {ts.backend}\n- db: {ts.db}\n- infra: {ts.infra}\n\n"
        f"## Grounded on (agency memory)\n{', '.join(plan.grounded_on) or '—'}\n\n"
        f"_Scaffolded by sprint0 — {plan.timeline_weeks}-week plan, "
        f"{sum(len(e.issues) for e in plan.epics)} issues._\n"
    )
    # README.md already exists (repo init) → update; add the sprint0 focus helper + a CI gate.
    gl.commit_files(
        pid,
        [
            {"path": "README.md", "action": "update", "content": readme},
            {"path": ".sprint0/focus.sh", "content": _FOCUS_SH},
            {"path": ".gitlab-ci.yml", "content": _CI_YML},
        ],
        branch=scaf["default_branch"],
    )

    _invite_assignees(pid, plan)  # native assignees must be project members first
    created = gl.create_issues(pid, _issue_dicts(plan, scaf.get("clone_url", "")))

    extra: dict = {}
    if with_handoff:  # per-kind focus branches + a QA-only issue (the relay's tail)
        branches = handoff.commit_context_branches(pid, plan, default_branch=scaf["default_branch"])
        qa = handoff.create_qa_issue(pid, plan, staging_url=scaf["web_url"])
        extra = {"context_branches": len(branches), "qa_issue_iid": qa.get("iid")}

    return {
        "web_url": scaf["web_url"], "clone_url": scaf.get("clone_url", ""), "project_id": pid,
        "default_branch": scaf["default_branch"], "issues_created": len(created), **extra,
    }


def extend_project(plan: PlanJSON, project_id: int, default_branch: str = "main") -> dict:
    """Mid-prod: append a delta plan's issues + focus branches to an EXISTING project."""
    if demo.is_demo():  # public demo: no real GitLab writes
        n = sum(len(e.issues) for e in plan.epics)
        return {"issues_created": n, "context_branches": n, "demo_stub": True}
    clone_url = gl.get_project(project_id).get("http_url_to_repo", "")
    gl.create_labels(project_id, _plan_labels(plan))
    _invite_assignees(project_id, plan)
    created = gl.create_issues(project_id, _issue_dicts(plan, clone_url))
    branches = handoff.commit_context_branches(project_id, plan, default_branch=default_branch)
    return {"issues_created": len(created), "context_branches": len(branches)}
