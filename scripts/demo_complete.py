"""Demo accelerator — finish dispatched tasks for real, fast, so the tester/QA + attribution + passport
panels populate without hand-doing checkout → code → push → merge per task per user.

Per selected code/infra task it: (1) commits a real change to the task's `feat/<slug>` branch, AUTHORED as
the assignee; (2) opens an MR → main with a `runner:<assignee>` label and merges it; (3) nudges the gateway
(`POST /api/merge` → verify-on-merge + passport/attribution) and flips the task to `done`.

Targets a REAL recording: needs the gateway up + a live GitLab (owner token in .env, DEMO_MODE=false).

  uv run python scripts/demo_complete.py --project 83135319
  uv run python scripts/demo_complete.py --project 83135319 --tasks E1,F2 --gemini

Cleanup between takes: `uv run python -c "from app import gitlab as gl; gl.reset_demo()"` (keeps seeds).
"""
from __future__ import annotations

import argparse
import sys

import httpx
from dotenv import load_dotenv

SP = "/Users/teddyadmin/Developments/Hackathon/sprint0"
load_dotenv(f"{SP}/.env")
sys.path.insert(0, f"{SP}/orchestrator")

import os

from app import gitlab as gl, handoff  # noqa: E402

GATEWAY = os.getenv("ORCHESTRATOR_PUBLIC_URL", "http://localhost:8000").rstrip("/")
MANAGER = os.getenv("DEMO_MANAGER_USER", "Onsraa")  # a manager identity for the gateway calls
_HDR = {"X-Sprint0-User": MANAGER}


def _filler(path: str, title: str, does: str, stack: str, gemini: bool) -> str:
    """A small, real, valid file body to replace the stub (so the MR has a meaningful diff)."""
    if gemini:
        try:
            import asyncio
            from app.agent import generate_adapted_code
            tmpl = _deterministic(path, title, does)
            return asyncio.run(generate_adapted_code(tmpl, stack, f"{title}: {does}"))
        except Exception as e:
            print(f"    (gemini fell back to deterministic: {e})")
    return _deterministic(path, title, does)


def _deterministic(path: str, title: str, does: str) -> str:
    ext = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
    note = f"{title} — {does}".strip(" —")
    if ext in (".tsx", ".jsx"):
        return ("import React from 'react'\n\n"
                f"// {note}\n"
                "export default function Component() {\n"
                "  return <div>shipped by sprint0</div>\n}\n")
    if ext in (".ts", ".js"):
        return f"// {note}\nexport function run(): boolean {{\n  return true\n}}\n"
    if ext == ".py":
        return f'"""{note}"""\n\n\ndef run() -> bool:\n    return True\n'
    if ext in (".css", ".scss"):
        return f"/* {note} */\n.shipped {{ display: block; }}\n"
    return f"# {note}\nshipped by sprint0\n"


def _tasks_for(project_id: int, only: set[str] | None) -> list[dict]:
    r = httpx.get(f"{GATEWAY}/api/work", params={"scope": "team"}, headers=_HDR, timeout=30)
    r.raise_for_status()
    rows = r.json().get("tasks", [])
    out = []
    for t in rows:
        if t.get("project_id") != project_id:
            continue
        if (t.get("kind") or "code") not in ("code", "infra"):
            continue
        if only and t["id"] not in only:
            continue
        out.append(t)
    return out


def _complete(t: dict, stack: str, gemini: bool) -> None:
    import time

    tid, title = t["id"], t.get("title", t["id"])
    assignee = t.get("assignee") or "sprint0-bot"
    disc = t.get("discipline") or "backend"
    pid = t["project_id"]
    branch = t.get("branch") or handoff.branch_for(title, tid)
    files = [f for f in ((t.get("context_scope") or {}).get("files") or [])
             if f != ".gitlab-ci.yml"]  # main owns the managed CI file — touching it on a branch = guaranteed conflict
    target = files[0] if files else f"src/{handoff._slug(title) or tid.lower()}.ts"
    print(f"  [{tid}] {title}  →  {branch}  (@{assignee})")

    # 0) the focus branch is created best-effort at dispatch — a GitLab flake there means it's missing
    try:
        gl.create_branch(pid, branch, ref="main")
        print(f"      (created missing branch {branch})")
    except Exception:
        pass  # already exists — the normal case

    # 1) a real change on the branch, authored as the assignee ("update" 400s when the stub never landed → "create")
    body = _filler(target, title, t.get("does", ""), stack, gemini)
    for action in ("update", "create"):
        try:
            gl.commit_files(pid, [{"path": target, "content": body, "action": action}],
                            branch=branch, message=f"feat: {title}",
                            author_email=f"{assignee}@sprint0.demo", author_name=assignee)
            break
        except Exception:
            if action == "create":
                raise

    # 2) MR → main with the runner label, then merge (GitLab computes mergeability async → retry the 405s)
    mr = gl.create_merge_request(pid, branch, "main", title=title, labels=[f"runner:{assignee}"])
    last: Exception | None = None
    for _ in range(6):
        try:
            gl.merge_merge_request(pid, mr["iid"])
            last = None
            break
        except Exception as e:
            last = e
            time.sleep(5)
    if last is not None:
        raise last
    print(f"      merged !{mr['iid']}")

    # 3) nudge the gateway: passport + attribution + verify beat, then flip the task to done
    httpx.post(f"{GATEWAY}/api/merge", headers=_HDR, timeout=30, json={
        "gitlab_username": assignee, "task_type": f"{disc}:merge", "score": 0.85,
        "project_id": pid, "issue_iid": t.get("gitlab_issue_iid"), "issue_id": tid,
    }).raise_for_status()
    httpx.patch(f"{GATEWAY}/api/tasks/{tid}", headers=_HDR, timeout=30,
                json={"patch": {"status": "done"}})
    print("      credited + marked done")


def main() -> None:
    ap = argparse.ArgumentParser(description="Finish dispatched tasks (commit + MR + merge + credit) for the demo.")
    ap.add_argument("--project", type=int, required=True, help="GitLab project_id of the dispatched repo")
    ap.add_argument("--tasks", default="", help="comma-separated task ids to finish (default: all code/infra)")
    ap.add_argument("--gemini", action="store_true", help="AI-write the file body (default: deterministic filler)")
    args = ap.parse_args()

    only = {s.strip() for s in args.tasks.split(",") if s.strip()} or None
    tasks = _tasks_for(args.project, only)
    if not tasks:
        print("no code/infra tasks matched — is the gateway up and the project dispatched?")
        return
    proj = gl.get_project(args.project)
    stack = proj.get("description") or "React + FastAPI"
    print(f"finishing {len(tasks)} task(s) on project {args.project}:")
    done = 0
    for t in tasks:
        try:
            _complete(t, stack, args.gemini)
            done += 1
        except Exception as e:
            print(f"  [{t.get('id')}] FAILED: {e}")
    print(f"\ndone: {done}/{len(tasks)} tasks finished → check the tester/QA + attribution panels.")


if __name__ == "__main__":
    main()
