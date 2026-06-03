"""GitLab REST execution (Phase 4) — the agent's real-world ACTION.

Scaffold a project under the sacrificial demo group, commit boilerplate, and
batch-create issues (the loop runs here, server-side). httpx, sync. GitLab is
HTTPS/443, so this is unaffected by the Atlas :27017 network issue.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import quote

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

BASE = os.getenv("GITLAB_BASE_URL", "https://gitlab.com").rstrip("/")
TOKEN = os.environ["GITLAB_TOKEN"]
DEMO_GROUP = os.getenv("GITLAB_DEMO_GROUP", "sprint0-demo")
SEED_TOPIC = "sprint0-seed"  # topic-tag on seed projects; reset_demo() keeps these, deletes only dispatched
_API = f"{BASE}/api/v4"
_HEADERS = {"PRIVATE-TOKEN": TOKEN}


def _client() -> httpx.Client:
    return httpx.Client(base_url=_API, headers=_HEADERS, timeout=30)


def _group_id(c: httpx.Client, group_path: str) -> int:
    r = c.get(f"/groups/{quote(group_path, safe='')}")
    r.raise_for_status()
    return r.json()["id"]


def group_info(group: str | None = None) -> dict:
    """The demo group's display name + path + url — drives the dynamic workspace label in the UI."""
    group = group or DEMO_GROUP
    with _client() as c:
        r = c.get(f"/groups/{quote(group, safe='')}")
        r.raise_for_status()
        g = r.json()
        return {"name": g.get("name") or g.get("path") or group, "path": g.get("path") or group, "web_url": g.get("web_url", "")}


def create_project_scaffold(
    project_name: str, labels: dict[str, str] | None = None, group: str | None = None
) -> dict:
    """Create a project in the demo group + its labels. Returns ids + url."""
    group = group or DEMO_GROUP
    with _client() as c:
        gid = _group_id(c, group)
        r = c.post(
            "/projects",
            json={"name": project_name, "namespace_id": gid, "initialize_with_readme": True, "visibility": "private"},
        )
        r.raise_for_status()
        p = r.json()
        for name, color in (labels or {}).items():
            c.post(f"/projects/{p['id']}/labels", json={"name": name, "color": color})  # ignore dupes
        return {"project_id": p["id"], "web_url": p["web_url"], "clone_url": p.get("http_url_to_repo", ""), "default_branch": p.get("default_branch", "main")}


def get_project(project_id: int) -> dict:
    """Fetch a project's metadata (for its clone URL / default branch)."""
    with _client() as c:
        r = c.get(f"/projects/{project_id}")
        r.raise_for_status()
        return r.json()


def get_file_raw(project: str | int, file_path: str, ref: str = "main") -> str:
    """Raw content of one file from ANY project the owner token can read — the cross-repo fetch that
    turns a memory citation into real code (reuse layer-2). `project` is a numeric id or a `group/path`."""
    pid = project if isinstance(project, int) else quote(str(project), safe="")
    with _client() as c:
        r = c.get(f"/projects/{pid}/repository/files/{quote(file_path, safe='')}/raw", params={"ref": ref})
        r.raise_for_status()
        return r.text


def file_ref_from_blob_url(web_url: str) -> tuple[str, str, str] | None:
    """Parse a GitLab blob URL → (project_path, ref, file_path). None if it isn't a blob URL.
    e.g. https://gitlab.com/grp/repo/-/blob/main/src/a.js → ('grp/repo', 'main', 'src/a.js')."""
    if "/-/blob/" not in web_url:
        return None
    head, rest = web_url.split("/-/blob/", 1)
    project_path = head.split("://", 1)[-1].split("/", 1)[-1]  # strip scheme+host → group/repo
    ref, _, file_path = rest.partition("/")
    if not project_path or not file_path:
        return None
    return project_path, ref, file_path


def list_group_projects(group: str | None = None) -> list[dict]:
    """Every repo in the demo group — the real source of truth for the manager Dashboard.
    `seed=True` marks the topic-tagged agency reference repos (vs sprint0-dispatched projects)."""
    group = group or DEMO_GROUP
    with _client() as c:
        gid = _group_id(c, group)
        r = c.get(f"/groups/{gid}/projects", params={"per_page": 100, "order_by": "last_activity_at"})
        r.raise_for_status()
        return [
            {
                "project_id": p["id"], "name": p["name"], "path": p.get("path", ""),
                "web_url": p["web_url"], "description": p.get("description") or "",
                "topics": p.get("topics") or [], "last_activity_at": p.get("last_activity_at", ""),
                "seed": SEED_TOPIC in (p.get("topics") or []),
            }
            for p in r.json()
            if "deletion_scheduled" not in (p.get("name") or "")  # hide repos GitLab is purging (delayed delete)
        ]


def search_user(username: str) -> dict | None:
    """Find a real GitLab user by username (for native-assignee linking)."""
    with _client() as c:
        r = c.get("/users", params={"username": username})
        r.raise_for_status()
        users = r.json()
        return users[0] if users else None


def add_member(project_id: int, user_id: int, access_level: int = 30) -> None:
    """Invite a user to a project (Developer=30) so they can be a native assignee. Dupes ignored."""
    with _client() as c:
        c.post(f"/projects/{project_id}/members", json={"user_id": user_id, "access_level": access_level})


def create_labels(project_id: int, labels: dict[str, str]) -> None:
    """Best-effort label creation on an existing project (dupes ignored). Used by mid-prod."""
    with _client() as c:
        for name, color in (labels or {}).items():
            c.post(f"/projects/{project_id}/labels", json={"name": name, "color": color})


def commit_files(
    project_id: int, files: list[dict], branch: str = "main", message: str = "chore: scaffold boilerplate"
) -> dict:
    actions = [{"action": f.get("action", "create"), "file_path": f["path"], "content": f["content"]} for f in files]
    with _client() as c:
        r = c.post(
            f"/projects/{project_id}/repository/commits",
            json={"branch": branch, "commit_message": message, "actions": actions},
        )
        r.raise_for_status()
        return {"commit_sha": r.json().get("id"), "files": len(files)}


def create_issues(project_id: int, issues: list[dict]) -> list[dict]:
    """BATCHED issue creation — one call from the caller's view; loop is here.
    Each issue: {title, description, labels[]}."""
    out = []
    with _client() as c:
        for iss in issues:
            body = {"title": iss["title"], "description": iss["description"], "labels": ",".join(iss.get("labels", []))}
            if iss.get("assignee_ids"):
                body["assignee_ids"] = iss["assignee_ids"]  # native GitLab assignees (real avatars)
            r = c.post(f"/projects/{project_id}/issues", json=body)
            r.raise_for_status()
            j = r.json()
            out.append({"iid": j["iid"], "web_url": j["web_url"]})
    return out


def create_branch(project_id: int, branch: str, ref: str = "main") -> dict:
    with _client() as c:
        r = c.post(f"/projects/{project_id}/repository/branches", params={"branch": branch, "ref": ref})
        r.raise_for_status()
        return r.json()


def reopen_issue(project_id: int, iid: int, comment: str | None = None) -> dict:
    with _client() as c:
        r = c.put(f"/projects/{project_id}/issues/{iid}", json={"state_event": "reopen"})
        r.raise_for_status()
        if comment:
            c.post(f"/projects/{project_id}/issues/{iid}/notes", json={"body": comment})
        return {"iid": iid, "state": r.json().get("state")}


def reset_demo(group: str | None = None) -> dict:
    """Delete only DISPATCHED projects under the demo group, keeping topic-tagged seed projects
    (the agency repos + the SE's in-progress project), so re-running never nukes the seed."""
    group = group or DEMO_GROUP
    with _client() as c:
        gid = _group_id(c, group)
        r = c.get(f"/groups/{gid}/projects", params={"per_page": 100})
        r.raise_for_status()
        n = 0
        for p in r.json():
            if SEED_TOPIC in (p.get("topics") or []):
                continue  # protected seed project
            d = c.delete(f"/projects/{p['id']}")
            if d.status_code in (202, 204):
                n += 1
        return {"deleted": n}
