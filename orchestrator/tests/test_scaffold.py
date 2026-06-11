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


def test_focus_command_uses_a_worktree_and_no_editor_open():
    cmd = execute.focus_command_for("E1", "Add Login Endpoint")
    assert "git worktree add ../add-login-endpoint feat/add-login-endpoint" in cmd
    assert "curl -fsS" in cmd and "/api/focus/E1?t=" in cmd
    assert "code ." not in cmd and "git checkout" not in cmd


def test_focus_command_clone_form_clones_then_worktrees():
    cmd = execute.focus_command_for("E1", "Add Login", clone_url="https://gitlab.com/g/proj.git")
    assert cmd.startswith("git clone https://gitlab.com/g/proj.git proj && cd proj && git worktree add ../add-login ")
