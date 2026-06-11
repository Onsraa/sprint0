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

def _gateway_url() -> str:
    """The orchestrator's own public base, embedded into the dev's bootstrap command. Must be the Cloud Run
    URL in the hosted demo; defaults to localhost for local dev."""
    return os.getenv("ORCHESTRATOR_PUBLIC_URL", "http://localhost:8000").rstrip("/")


def focus_command_for(issue_id: str, title: str, clone_url: str = "") -> str:
    """The dev's copy/paste: a DEDICATED git worktree per task (`feat/<title>` in its own dir, so two tasks
    never collide and a swap is impossible), then fetch + run the focus bootstrap from the gateway (writes the
    agent docs + reused code locally, UNTRACKED). Nothing is committed. `git worktree remove ../<slug>` when done."""
    branch = handoff.branch_for(title, issue_id)
    slug = branch.split("/", 1)[-1]
    boot = f'curl -fsS "{_gateway_url()}/api/focus/{issue_id}?t={handoff.focus_token(issue_id)}" | bash'
    tree = f"git worktree add ../{slug} {branch} && cd ../{slug} && {boot}"
    if clone_url:
        repo_dir = clone_url.rstrip("/").split("/")[-1].removesuffix(".git") or "repo"
        return f"git clone {clone_url} {repo_dir} && cd {repo_dir} && {tree}"
    return f"git fetch -q && {tree}"


def focus_command(issue: Issue, clone_url: str = "") -> str:
    return focus_command_for(issue.id, issue.title, clone_url)

_CI_YML = """# sprint0 CI gate — bad merges blocked here, before the QA-agent + human sign-off.
stages: [test]
lint:
  stage: test
  script: ['echo "sprint0 CI · lint placeholder — wire eslint/ruff here"']
test:
  stage: test
  script: ['echo "sprint0 CI · acceptance tests run here; the QA relay adjudicates downstream"']
"""

# ── per-stack project skeleton: a REAL buildable repo so a .tsx/.py stub resolves its imports (no ts2307).
# Static, known-good, committed at scaffold on the default branch. node_modules is NOT committed → `npm install`. ──
_VITE_PACKAGE_JSON = """{
  "name": "sprint0-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -b && vite build", "preview": "vite preview" },
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": {
    "@types/react": "^18.3.3", "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1", "typescript": "^5.5.3", "vite": "^5.4.0"
  }
}
"""
_TSCONFIG_JSON = """{
  "compilerOptions": {
    "target": "ES2020", "useDefineForClassFields": true, "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext", "skipLibCheck": true, "moduleResolution": "bundler",
    "allowImportingTsExtensions": true, "resolveJsonModule": true, "isolatedModules": true,
    "noEmit": true, "jsx": "react-jsx", "strict": true
  },
  "include": ["src"]
}
"""
_VITE_CONFIG = """import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [react()] })
"""
_INDEX_HTML = """<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>sprint0 app</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
"""
_MAIN_TSX = """import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
"""
_APP_TSX = """import React from 'react'

export default function App() {
  return <h1>sprint0 scaffolded app</h1>
}
"""
_REQUIREMENTS = """fastapi>=0.110
uvicorn[standard]>=0.29
"""
_BACKEND_MAIN = '''from fastapi import FastAPI

app = FastAPI(title="sprint0 app")


@app.get("/")
def root() -> dict:
    return {"status": "ok", "service": "sprint0 scaffolded app"}
'''


def _frontend_skeleton(stack) -> list[dict]:
    """A minimal React + Vite + TS project (demo stack) so `import React from 'react'` resolves after npm install."""
    fe = (stack.frontend or "").lower()
    if not any(k in fe for k in ("react", "vite", "next", "typescript")):
        return []
    return [
        {"path": "package.json", "content": _VITE_PACKAGE_JSON},
        {"path": "tsconfig.json", "content": _TSCONFIG_JSON},
        {"path": "vite.config.ts", "content": _VITE_CONFIG},
        {"path": "index.html", "content": _INDEX_HTML},
        {"path": "src/main.tsx", "content": _MAIN_TSX},
        {"path": "src/App.tsx", "content": _APP_TSX},
    ]


def _backend_skeleton(stack) -> list[dict]:
    """A minimal FastAPI project (demo stack) so `from fastapi import FastAPI` resolves after pip install."""
    be = (stack.backend or "").lower()
    if not any(k in be for k in ("fastapi", "python", "uvicorn", "flask")):
        return []
    return [
        {"path": "requirements.txt", "content": _REQUIREMENTS},
        {"path": "app/__init__.py", "content": ""},
        {"path": "app/main.py", "content": _BACKEND_MAIN},
    ]


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
        fetch = focus_command(issue, clone_url)
        body = (
            f"🎯 **Micro-context** — you only need:\n{files}\n\n> {issue.context_scope.note}\n\n"
            f"**Get your task** (a dedicated git worktree + the focus context; run `npm install` once for deps):"
            f"\n```sh\n{fetch}\n```"
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


_DEMO_PID_SEQ = 9000  # module counter — each demo dispatch gets a UNIQUE fake project_id (so created projects don't collide at 0 and can be listed)


def reserve_project(plan: PlanJSON, project_name: str | None = None) -> dict:
    """Phase 1 of two-phase create: RESERVE the GitLab project — an empty repo, name only. No issues, branches,
    focus files, labels, or members yet (those land at scaffold_project once the relay closes)."""
    if demo.is_demo():  # public demo: no real GitLab — a unique stub pid so the reserved project is browsable
        global _DEMO_PID_SEQ
        _DEMO_PID_SEQ += 1
        name = project_name or plan.project_name or "project"
        slug = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-") or "project"
        return {"web_url": f"https://gitlab.com/sprint0-demo/{slug}", "clone_url": "",
                "project_id": _DEMO_PID_SEQ, "default_branch": "main", "demo_stub": True}
    scaf = gl.create_project_scaffold(project_name or plan.project_name, labels={})  # empty repo, no labels yet
    return {"web_url": scaf["web_url"], "clone_url": scaf.get("clone_url", ""),
            "project_id": scaf["project_id"], "default_branch": scaf["default_branch"]}


def scaffold_project(plan: PlanJSON, project_id: int, *, web_url: str = "", clone_url: str = "",
                     default_branch: str = "main", with_handoff: bool = True,
                     reuse_seeds: dict[str, list[dict]] | None = None) -> dict:
    """Phase 2 (the relay has closed): commit the README/focus/CI with the FINAL stack + labels + members +
    issues + focus branches + QA onto the already-reserved project. Writing the README here (not at reserve)
    means a setup-gate stack override is reflected in the repo."""
    if demo.is_demo():  # public demo: no real GitLab writes
        n = sum(len(e.issues) for e in plan.epics)
        return {"issues_created": n, "context_branches": n, "qa_issue_iid": None, "demo_stub": True}
    ts = plan.tech_stack
    skeleton = _frontend_skeleton(ts) + _backend_skeleton(ts)  # real deps so a stub resolves its imports (no ts2307)
    develop = ("## Develop\n```sh\nnpm install && npm run dev          # frontend (Vite)\n"
               "pip install -r requirements.txt && uvicorn app.main:app --reload   # backend (FastAPI)\n```\n\n"
               if skeleton else "")
    readme = (
        f"# {plan.project_name}\n\n{plan.client_summary}\n\n"
        f"## Stack\n- frontend: {ts.frontend}\n- backend: {ts.backend}\n- db: {ts.db}\n- infra: {ts.infra}\n\n"
        f"{develop}"
        f"## Grounded on (agency memory)\n{', '.join(plan.grounded_on) or '—'}\n\n"
        f"_Scaffolded by sprint0 — {plan.timeline_weeks}-week plan, "
        f"{sum(len(e.issues) for e in plan.epics)} issues._\n"
    )
    gl.commit_files(
        project_id,
        [
            {"path": "README.md", "action": "update", "content": readme},
            {"path": ".gitlab-ci.yml", "content": _CI_YML},
            *skeleton,
        ],
        branch=default_branch,
    )
    gl.create_labels(project_id, _plan_labels(plan))
    _invite_assignees(project_id, plan)  # native assignees must be project members first
    created = gl.create_issues(project_id, _issue_dicts(plan, clone_url))

    extra: dict = {}
    if with_handoff:  # per-kind focus branches + a QA-only issue (the relay's tail)
        branches = handoff.commit_context_branches(project_id, plan, default_branch=default_branch, reuse_seeds=reuse_seeds)
        qa = handoff.create_qa_issue(project_id, plan, staging_url=web_url)
        extra = {"context_branches": len(branches), "qa_issue_iid": qa.get("iid")}
    return {"issues_created": len(created), **extra}


def execute_plan(plan: PlanJSON, project_name: str | None = None, with_handoff: bool = True, reuse_seeds: dict[str, list[dict]] | None = None) -> dict:
    """Legacy single-shot create = reserve + scaffold. The two-phase flow calls the halves directly
    (reserve at Create, scaffold when the relay closes)."""
    res = reserve_project(plan, project_name)
    scaf = scaffold_project(plan, res["project_id"], web_url=res["web_url"], clone_url=res.get("clone_url", ""),
                            default_branch=res["default_branch"], with_handoff=with_handoff, reuse_seeds=reuse_seeds)
    return {**res, **scaf}


def extend_project(plan: PlanJSON, project_id: int, default_branch: str = "main", reuse_seeds: dict[str, list[dict]] | None = None) -> dict:
    """Mid-prod: append a delta plan's issues + focus branches to an EXISTING project."""
    if demo.is_demo():  # public demo: no real GitLab writes
        n = sum(len(e.issues) for e in plan.epics)
        return {"issues_created": n, "context_branches": n, "demo_stub": True}
    clone_url = gl.get_project(project_id).get("http_url_to_repo", "")
    gl.create_labels(project_id, _plan_labels(plan))
    _invite_assignees(project_id, plan)
    created = gl.create_issues(project_id, _issue_dicts(plan, clone_url))
    branches = handoff.commit_context_branches(project_id, plan, default_branch=default_branch, reuse_seeds=reuse_seeds)
    return {"issues_created": len(created), "context_branches": len(branches)}
