"""Per-stack project skeleton (real deps so a stub resolves its imports — no ts2307) + the worktree focus command."""
import json

from app import execute
from app.contracts import TechStack


def _stack(fe="React + Vite + TS", be="FastAPI"):
    return TechStack(frontend=fe, backend=be, db="PG", infra="-")


def test_frontend_skeleton_emits_a_real_react_project():
    files = {f["path"]: f["content"] for f in execute._frontend_skeleton(_stack())}
    assert {"package.json", "tsconfig.json", "vite.config.ts", "index.html", "src/main.tsx", "src/App.tsx"} <= set(files)
    pkg = json.loads(files["package.json"])
    assert "react" in pkg["dependencies"] and "react-dom" in pkg["dependencies"]
    assert "@types/react" in pkg["devDependencies"]
    json.loads(files["tsconfig.json"])                      # valid JSON


def test_backend_skeleton_emits_fastapi():
    files = {f["path"]: f["content"] for f in execute._backend_skeleton(_stack())}
    assert "requirements.txt" in files and "app/main.py" in files
    assert "fastapi" in files["requirements.txt"].lower() and "FastAPI" in files["app/main.py"]


def test_skeleton_empty_for_unknown_stack():
    s = _stack(fe="Svelte", be="Go")
    assert execute._frontend_skeleton(s) == [] and execute._backend_skeleton(s) == []


def test_scaffold_commit_actions_are_idempotent_against_the_tree(monkeypatch):
    # a retried dispatch must UPDATE files already in the repo, not CREATE them (which 400s 'already
    # exists') — scaffold_project classifies every committed file against the current tree.
    from app import canned, handoff
    captured: dict = {}
    monkeypatch.setattr(execute.demo, "DEMO_MODE", False)   # exercise the real GitLab path (mocked below)
    execute.demo.set_live(True)
    # simulate a RETRY: README.md + .gitlab-ci.yml already committed on the first (failed-later) attempt
    monkeypatch.setattr(execute.gl, "list_repo_tree", lambda pid, ref="main": {"README.md", ".gitlab-ci.yml"})
    monkeypatch.setattr(execute.gl, "commit_files", lambda pid, files, **k: captured.update(files=files) or {"commit_sha": "x", "files": len(files)})
    monkeypatch.setattr(execute.gl, "create_labels", lambda *a, **k: None)
    monkeypatch.setattr(execute, "_invite_assignees", lambda *a, **k: None)
    monkeypatch.setattr(execute.gl, "create_issues", lambda *a, **k: [])
    monkeypatch.setattr(handoff, "commit_context_branches", lambda *a, **k: [])
    monkeypatch.setattr(handoff, "create_qa_issue", lambda *a, **k: {"iid": 1})

    plan = canned.CANNED_PLAN.model_copy(deep=True)
    plan.tech_stack = _stack()
    execute.scaffold_project(plan, 7, default_branch="main")

    by_path = {f["path"]: f["action"] for f in captured["files"]}
    assert by_path["README.md"] == "update" and by_path[".gitlab-ci.yml"] == "update"   # already present → update
    assert by_path["package.json"] == "create"                                          # new → create


def test_focus_command_uses_a_worktree_and_no_editor_open():
    cmd = execute.focus_command_for("E1", "Add Login Endpoint")
    assert "git worktree add ../add-login-endpoint feat/add-login-endpoint" in cmd
    assert "curl -fsS" in cmd and "/api/focus/E1?t=" in cmd
    assert "code ." not in cmd and "git checkout" not in cmd


def test_focus_command_clone_form_clones_then_worktrees():
    cmd = execute.focus_command_for("E1", "Add Login", clone_url="https://gitlab.com/g/proj.git")
    assert cmd.startswith("git clone https://gitlab.com/g/proj.git proj && cd proj && { git worktree add ../add-login ")


def test_focus_command_falls_back_to_remote_branch():
    # fresh clone: the task branch exists only as origin/<branch> (worktree add has no checkout-style
    # remote DWIM) → -b fallback; `|| true` keeps a RE-RUN alive so it cd's into the existing worktree
    for cmd in (execute.focus_command_for("E1", "Add Login"),
                execute.focus_command_for("E1", "Add Login", clone_url="https://gitlab.com/g/proj.git")):
        assert "{ git worktree add ../add-login feat/add-login 2>/dev/null || " in cmd
        assert "git worktree add -b feat/add-login ../add-login origin/feat/add-login || true; }" in cmd
        assert "&& cd ../add-login &&" in cmd
