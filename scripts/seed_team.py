"""Seed the per-account DEMO team into Mongo, linked to real GitLab accounts. The roster is COMPOSABLE:
each member carries `disciplines` (the lanes they cover, multi) + `is_manager` (the Tech-Lead capability),
read from seed/team.json. The 3-user demo = Teddy (Tech Lead + tester), Tony (backend + devops), Sam
(frontend). An optional `senior_project` makes one dev busy (contrast); a junior is added LIVE via CV
onboarding.

Fill seed/team.json with real GitLab usernames first.  Run: uv run python scripts/seed_team.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parent.parent
load_dotenv(REPO / ".env")
sys.path.insert(0, str(REPO / "orchestrator"))

GREEN, YEL, RED, RST = "\033[32m", "\033[33m", "\033[31m", "\033[0m"
_RANK = {"low": 0, "medium": 1, "high": 2}


def die(msg: str) -> None:
    print(f"{RED}❌ {msg}{RST}")
    sys.exit(1)


MONGODB_URI = os.getenv("MONGODB_URI", "")
VOYAGE_API_KEY = os.getenv("VOYAGE_API_KEY", "")
VOYAGE_MODEL = os.getenv("VOYAGE_MODEL", "voyage-3.5-lite")
DIMS = int(os.getenv("EMBEDDING_DIMS", "1024"))
DB = os.getenv("MONGODB_DB", "sprint0")
DEV_COLL = os.getenv("DEVELOPER_PROFILES_COLLECTION", "DeveloperProfiles")
PROJ_COLL = os.getenv("PROJECT_RECORDS_COLLECTION", "ProjectRecords")
if not MONGODB_URI or not VOYAGE_API_KEY:
    die("MONGODB_URI / VOYAGE_API_KEY missing in .env")

import voyageai  # noqa: E402
from pymongo import MongoClient  # noqa: E402
from voyageai.error import RateLimitError  # noqa: E402

from app import gitlab as gl  # noqa: E402

vo = voyageai.Client(api_key=VOYAGE_API_KEY)


def embed(texts: list[str]) -> list[list[float]]:
    for attempt in range(5):
        try:
            return vo.embed(texts, model=VOYAGE_MODEL, input_type="document", output_dimension=DIMS).embeddings
        except RateLimitError:
            if attempt == 4:
                raise
            time.sleep(21)
    return []


def _link(username: str) -> int | None:
    try:
        u = gl.search_user(username)
        return u["id"] if u else None
    except Exception:
        return None


def main() -> int:
    team = json.loads((REPO / "seed" / "team.json").read_text())
    members = [team["manager"], *team["members"]]
    bad = [m["gitlab_username"] for m in members if str(m.get("gitlab_username", "")).startswith("FILL_")]
    if bad:
        die(f"team.json still has placeholder usernames: {bad} — fill them with real GitLab usernames")

    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)
    client.admin.command("ping")
    db = client[DB]

    print(f"{YEL}-- seeding demo team --{RST}")
    vecs = embed([m["skills_text"] for m in members])
    docs = []
    for m, v in zip(members, vecs):
        uid = _link(m["gitlab_username"])
        trust = m.get("trust", {})
        # composable roles: `disciplines` (lanes) + `is_manager` (capability) are the truth; accept either
        # the new shape or the legacy single `discipline`/`role` (the model reconciles on load).
        disciplines = m.get("disciplines") or ([m["discipline"]] if m.get("discipline") else [])
        is_manager = bool(m.get("is_manager")) or m.get("role") == "manager"
        docs.append({
            "name": m["name"], "gitlab_username": m["gitlab_username"], "username": m["gitlab_username"],
            "email": m.get("email", ""), "role": "manager" if is_manager else "developer",
            "discipline": disciplines[0] if disciplines else None, "disciplines": disciplines, "is_manager": is_manager,
            "seniority": m.get("seniority", "mid"), "load": int(m.get("load", 0)),
            "gitlab_user_id": uid, "skills_text": m["skills_text"], "skill_embedding": v,
            "trust": trust,
            "trust_level": max(trust.values(), key=lambda t: _RANK[t], default="low"),
            "joined": m.get("joined", ""),
            "history": [],
        })
        _tag = ("manager+" if is_manager else "") + ",".join(disciplines or ["-"])
        print(f"   {m['name']:12} {_tag:18} load={int(m.get('load',0)):3} gitlab_uid={uid}")
    db[DEV_COLL].delete_many({})
    db[DEV_COLL].insert_many(docs)
    print(f"{GREEN}✅ {DEV_COLL}: {len(docs)} members{RST}")
    # No dev vector index on purpose: developer matching fetches the roster once and ranks by LOCAL cosine
    # (reason.py + rag.cosine_score), so skill_embedding is read but never $vectorSearch'd. Dropping the
    # unused index keeps Atlas at 3 search indexes (pp_vector · pp_text · code_vector) — fits the M0 free tier.

    # The senior engineer's in-progress project → SE genuinely busy + a full dev view.
    se = next((d for d in docs if d["role"] == "developer" and d["load"] >= 100), None)
    sp = team.get("senior_project")
    if se and sp:
        print(f"{YEL}-- senior engineer's in-progress project --{RST}")
        with gl._client() as c:
            gid = gl._group_id(c, gl.DEMO_GROUP)
            for p in c.get("/projects", params={"search": sp["name"], "owned": True, "simple": True}).json():
                if p.get("path") == sp["name"] or p.get("name") == sp["name"]:
                    c.delete(f"/projects/{p['id']}")
            proj = None
            for _ in range(12):
                r = c.post("/projects", json={"name": sp["name"], "namespace_id": gid, "initialize_with_readme": True, "visibility": "private", "topics": [gl.SEED_TOPIC]})
                if r.status_code < 300:
                    proj = r.json()
                    break
                time.sleep(3)
            if proj is None:
                die("could not create the senior's project")
        pid = proj["project_id"] if "project_id" in proj else proj["id"]
        if se["gitlab_user_id"]:
            try:
                gl.add_member(pid, se["gitlab_user_id"])
            except Exception:
                pass
        aids = [se["gitlab_user_id"]] if se["gitlab_user_id"] else []
        gl.create_issues(pid, [
            {"title": t, "description": f"Owned by @{se['gitlab_username']} — in progress.",
             "labels": [f"runner:{se['gitlab_username']}", "status:in-progress"], "assignee_ids": aids}
            for t in sp["issues"]
        ])
        stack = {"frontend": "-", "backend": "Python", "db": "Postgres", "infra": "-"}
        rec = {
            "project_id": pid, "name": sp["name"], "web_url": proj["web_url"],
            "tech_stack": stack, "grounded_on": [], "status": "in_progress", "module_manifest": ["ledger.py"],
            "plan": {
                "project_name": sp["name"], "client_summary": sp.get("client_summary", ""), "tech_stack": stack,
                "grounded_on": [], "timeline_weeks": 4,
                "epics": [{"id": "e1", "title": "In progress", "issues": [
                    {"id": f"sp-{n+1}", "title": t, "description": "in progress", "type": "backend",
                     "estimate_days": 3, "risk": "medium", "required_skill": "backend:ledger",
                     "context_scope": {"files": ["ledger.py"], "note": ""}, "assignee": se["gitlab_username"]}
                    for n, t in enumerate(sp["issues"])
                ]}],
            },
        }
        db[PROJ_COLL].delete_many({"name": sp["name"]})
        db[PROJ_COLL].insert_one(rec)
        print(f"{GREEN}✅ {se['name']} on '{sp['name']}' ({len(sp['issues'])} issues) → {proj['web_url']}{RST}")

    print(f"\n{GREEN}Demo team seeded. Log in at the frontend (pick-your-account) as any member.{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
