"""Idea 2 — Handoff slices (the relay mechanic), built on GitLab REST.

- `commit_context_branches`: per issue, a branch with a `.vscode/settings.json`
  micro-context artifact — makes "only these 3 files matter" real, not just UI.
- `create_qa_issue`: a QA-only issue (staging URL + checklist, no source needed).
- `reroute`: QA reject → reopen + route back to the responsible-layer runner.
(Passport-increment-on-merge is a MongoDB write — see app.rag.record_merge.)
"""
from __future__ import annotations

import json

from app import gitlab as gl
from app.contracts import PlanJSON

_VSCODE_NOISE = {
    "**/.git": True, "**/node_modules": True, "**/dist": True, "**/build": True,
    "**/.venv": True, "**/__pycache__": True, "**/*.lock": True, "**/coverage": True,
}


def _vscode_settings(context_files: list[str], issue_id: str, note: str) -> str:
    return json.dumps(
        {
            "// baton": f"Micro-context for {issue_id}. Only these files matter; the rest is noise.",
            "baton.contextScope": context_files,
            "baton.note": note,
            "files.exclude": _VSCODE_NOISE,
            "search.exclude": {"**/node_modules": True, "**/dist": True},
        },
        indent=2,
    )


_BRANCH_KINDS = {"code", "infra"}  # only these get a repo branch; design/audit/content live as issues + attachments


def _focus_json(issue) -> str:
    """The file list `.baton/focus.sh` reads to collapse the working tree via sparse-checkout."""
    return json.dumps({"issue": issue.id, "files": issue.context_scope.files, "note": issue.context_scope.note}, indent=2)


def commit_context_branches(project_id: int, plan: PlanJSON, default_branch: str = "main") -> list[str]:
    """One branch per CODE/INFRA issue, carrying `.baton/focus.json` (the sparse-checkout
    list) + `.vscode/settings.json` (noise hiding + metadata). Non-code kinds get no branch."""
    made: list[str] = []
    for epic in plan.epics:
        for issue in epic.issues:
            if (issue.kind or "code") not in _BRANCH_KINDS:
                continue
            branch = f"baton/{issue.id.lower()}"
            try:
                gl.create_branch(project_id, branch, ref=default_branch)
                gl.commit_files(
                    project_id,
                    [
                        {"path": ".baton/focus.json", "content": _focus_json(issue)},
                        {"path": ".vscode/settings.json", "content": _vscode_settings(issue.context_scope.files, issue.id, issue.context_scope.note)},
                    ],
                    branch=branch,
                    message=f"chore(baton): focus context for {issue.id}",
                )
                made.append(branch)
            except Exception:
                pass  # skip branch/commit conflicts; best-effort for the demo
    return made


def create_qa_issue(project_id: int, plan: PlanJSON, staging_url: str = "https://staging.example.com") -> dict:
    items = [
        f"- [ ] **{i.title}** — acceptance: works end-to-end ({i.type})"
        for e in plan.epics
        for i in e.issues
    ]
    body = (
        "**QA pass — no source access needed.**\n\n"
        f"Staging: {staging_url}\nLogin: `demo` / `demo`\n\n"
        "## Acceptance checklist\n" + "\n".join(items) + "\n\n"
        "> Reject any item with a comment; baton routes it back to the responsible runner."
    )
    return gl.create_issues(project_id, [{"title": "QA — Acceptance checklist", "description": body, "labels": ["role:qa"]}])[0]


def reroute(project_id: int, issue_iid: int, comment: str, to_runner: str | None = None) -> dict:
    note = (
        f"❌ **QA reject:** {comment}\n\n"
        f"baton → re-routing to @{to_runner or 'responsible runner'} (the responsible layer), "
        f"reopened with the failing context."
    )
    gl.reopen_issue(project_id, issue_iid, comment=note)
    return {"issue_iid": issue_iid, "rerouted_to": to_runner}
