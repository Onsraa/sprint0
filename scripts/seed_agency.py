"""Clean + seed the agency demo.

Wipes demo data, then creates 2 REAL GitLab repos (QuantaPay / TrailLog) by pushing
`seed/agency/<repo>/`, and registers them into MongoDB agency memory:
  - PastProjects  — one grounded summary per project (vector + full-text indexed)
  - CodeChunks    — one chunk per repo file, for chunk-level code-RAG ("find a reusable component")
  - DeveloperProfiles — the roster (re-seeded)

The 3 repos live in the `sprint0-demo` group, topic-tagged `sprint0-seed` so the
selective `reset_demo()` keeps them (it deletes only dispatched, untagged projects).

Run: uv run python scripts/seed_agency.py   (idempotent — clears + reloads each run)
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
sys.path.insert(0, str(REPO / "orchestrator"))  # so we can reuse app.gitlab (lightweight: httpx only)

GREEN, YEL, RED, RST = "\033[32m", "\033[33m", "\033[31m", "\033[0m"


def die(msg: str) -> None:
    print(f"{RED}❌ {msg}{RST}")
    sys.exit(1)


MONGODB_URI = os.getenv("MONGODB_URI", "")
VOYAGE_API_KEY = os.getenv("VOYAGE_API_KEY", "")
VOYAGE_MODEL = os.getenv("VOYAGE_MODEL", "voyage-3.5-lite")
DIMS = int(os.getenv("EMBEDDING_DIMS", "1024"))
DB = os.getenv("MONGODB_DB", "sprint0")
PP_COLL = os.getenv("PAST_PROJECTS_COLLECTION", "PastProjects")
DEV_COLL = os.getenv("DEVELOPER_PROFILES_COLLECTION", "DeveloperProfiles")
PROJ_COLL = os.getenv("PROJECT_RECORDS_COLLECTION", "ProjectRecords")
CODE_COLL = os.getenv("CODE_CHUNKS_COLLECTION", "CodeChunks")
PP_INDEX = os.getenv("PAST_PROJECTS_VECTOR_INDEX", "pp_vector_index")
DEV_INDEX = os.getenv("DEVELOPER_VECTOR_INDEX", "dev_vector_index")
CODE_INDEX = os.getenv("CODE_CHUNKS_VECTOR_INDEX", "code_vector_index")
PP_TEXT_INDEX = os.getenv("PAST_PROJECTS_TEXT_INDEX", "pp_text_index")  # Atlas Search (hybrid, item H)

if not MONGODB_URI:
    die("MONGODB_URI not set in .env")
if not VOYAGE_API_KEY:
    die("VOYAGE_API_KEY not set in .env")

import voyageai  # noqa: E402
from pymongo import MongoClient  # noqa: E402
from pymongo.operations import SearchIndexModel  # noqa: E402
from voyageai.error import RateLimitError  # noqa: E402

from app import gitlab as gl  # noqa: E402

vo = voyageai.Client(api_key=VOYAGE_API_KEY)


def embed(texts: list[str], input_type: str = "document") -> list[list[float]]:
    """Voyage embed with free-tier backoff (3 req/min)."""
    for attempt in range(5):
        try:
            return vo.embed(texts, model=VOYAGE_MODEL, input_type=input_type, output_dimension=DIMS).embeddings
        except RateLimitError:
            if attempt == 4:
                raise
            print(f"{YEL}   …Voyage rate limit, backing off 21s{RST}")
            time.sleep(21)
    return []


def ensure_vector_index(coll, name: str, path: str) -> None:
    if name in {ix["name"] for ix in coll.list_search_indexes()}:
        print(f"   vector index '{name}' exists")
        return
    coll.create_search_index(
        model=SearchIndexModel(
            name=name, type="vectorSearch",
            definition={"fields": [{"type": "vector", "path": path, "numDimensions": DIMS, "similarity": "cosine"}]},
        )
    )
    print(f"   created vector index '{name}'")


def ensure_search_index(coll, name: str) -> None:
    """Atlas full-text Search index (dynamic) — powers hybrid retrieval (item H)."""
    if name in {ix["name"] for ix in coll.list_search_indexes()}:
        print(f"   search index '{name}' exists")
        return
    coll.create_search_index(model=SearchIndexModel(name=name, type="search", definition={"mappings": {"dynamic": True}}))
    print(f"   created search index '{name}'")


def create_repo(name: str) -> dict:
    """Create a private repo in the `sprint0-demo` group, topic-tagged `sprint0-seed` so the
    selective reset_demo() keeps it. Idempotent: deletes a same-named owned project first."""
    with gl._client() as c:
        gid = gl._group_id(c, gl.DEMO_GROUP)
        for p in c.get("/projects", params={"search": name, "owned": True, "simple": True}).json():
            if p.get("path") == name or p.get("name") == name:
                c.delete(f"/projects/{p['id']}")
                print(f"   (deleted existing {name} for a clean re-seed)")
        # GitLab deletes async; the path can take a few seconds to free up — retry the create.
        for _ in range(12):
            r = c.post("/projects", json={"name": name, "namespace_id": gid, "initialize_with_readme": True, "visibility": "private", "topics": [gl.SEED_TOPIC]})
            if r.status_code < 300:
                p = r.json()
                return {"project_id": p["id"], "web_url": p["web_url"], "default_branch": p.get("default_branch", "main")}
            time.sleep(3)
        r.raise_for_status()
        return {}


_SKIP_DIRS = {"node_modules", ".venv", "venv", "dist", "build", ".next", "__pycache__", ".git", "coverage", ".turbo", ".cache", ".pytest_cache"}


def push_dir(project_id: int, repo_dir: Path, branch: str) -> list[dict]:
    """Push every source file under repo_dir as one commit (skips deps/build dirs + binaries).
    README.md updates the init'd one."""
    files = []
    for f in sorted(repo_dir.rglob("*")):
        if not f.is_file() or any(part in _SKIP_DIRS for part in f.relative_to(repo_dir).parts):
            continue
        if f.stat().st_size > 262_144:  # skip large/binary blobs (lockfiles, images)
            continue
        try:
            content = f.read_text()
        except UnicodeDecodeError:
            continue  # binary — skip
        rel = str(f.relative_to(repo_dir))
        files.append({"path": rel, "action": "update" if rel == "README.md" else "create", "content": content})
    gl.commit_files(project_id, files, branch=branch, message="chore: seed agency project")
    return files


def main() -> int:
    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)
    client.admin.command("ping")
    db = client[DB]

    # 1) CLEAN ────────────────────────────────────────────────────────────────
    print(f"{YEL}-- cleaning --{RST}")
    try:
        print(f"   reset_demo → {gl.reset_demo()}")
    except Exception as e:
        print(f"{YEL}   reset_demo skipped: {str(e)[:120]}{RST}")
    for coll in (PP_COLL, DEV_COLL, PROJ_COLL, CODE_COLL):
        n = db[coll].delete_many({}).deleted_count
        print(f"   cleared {coll}: {n}")

    # 2) 3 REAL REPOS + MEMORY + CODE CHUNKS ───────────────────────────────────
    projects = json.loads((REPO / "seed" / "agency_projects.json").read_text())
    chunk_docs: list[dict] = []
    print(f"{YEL}-- creating {len(projects)} agency repos --{RST}")
    for proj in projects:
        dirname = proj["name"].split("-")[0]  # quantapay-2024 → quantapay
        repo_dir = REPO / "seed" / "agency" / dirname
        if not repo_dir.is_dir():
            die(f"missing repo dir {repo_dir} (run the repo-seeder first)")
        created = create_repo(proj["name"])
        files = push_dir(created["project_id"], repo_dir, created["default_branch"])
        proj["web_url"] = created["web_url"]
        proj.pop("epics", None)
        print(f"{GREEN}   ✅ {proj['name']}: {len(files)} files → {created['web_url']}{RST}")
        for fobj in files:
            chunk_docs.append({
                "project": proj["name"],
                "file_path": fobj["path"],
                "web_url": f"{created['web_url']}/-/blob/{created['default_branch']}/{fobj['path']}",
                "excerpt": fobj["content"][:1500],
                "tags": proj.get("tags", []),
            })

    # Insert ALL data first — an Atlas index cap (M0) must never abort the data seed.
    print(f"{YEL}-- embedding + inserting memory --{RST}")
    for p, v in zip(projects, embed([p["brief_text"] for p in projects])):
        p["brief_embedding"] = v
    db[PP_COLL].insert_many(projects)
    print(f"{GREEN}✅ {PP_COLL}: {len(projects)} docs{RST}")

    chunk_texts = [f"{c['project']} · {c['file_path']}\n{c['excerpt']}" for c in chunk_docs]
    for c, v in zip(chunk_docs, embed(chunk_texts)):
        c["embedding"] = v
    db[CODE_COLL].insert_many(chunk_docs)
    print(f"{GREEN}✅ {CODE_COLL}: {len(chunk_docs)} code chunks{RST}")

    devs = json.loads((REPO / "seed" / "developer_profiles.json").read_text())
    for d, v in zip(devs, embed([d["skills_text"] for d in devs])):
        d["skill_embedding"] = v
    db[DEV_COLL].insert_many(devs)
    print(f"{GREEN}✅ {DEV_COLL}: {len(devs)} docs{RST}")

    # Indexes — best-effort. Vector indexes (needed for the run) get priority; the full-text
    # index (for hybrid retrieval, item H) is skipped if the M0 search-index cap is hit.
    print(f"{YEL}-- ensuring search indexes (best-effort on M0) --{RST}")
    for coll, name, path in [(PP_COLL, PP_INDEX, "brief_embedding"), (DEV_COLL, DEV_INDEX, "skill_embedding"), (CODE_COLL, CODE_INDEX, "embedding")]:
        try:
            ensure_vector_index(db[coll], name, path)
        except Exception as e:
            print(f"{YEL}   ⚠ vector index '{name}' skipped: {str(e)[:90]}{RST}")
    try:
        ensure_search_index(db[PP_COLL], PP_TEXT_INDEX)
    except Exception as e:
        print(f"{YEL}   ⚠ full-text index '{PP_TEXT_INDEX}' skipped (M0 cap; hybrid → vector-only for now): {str(e)[:90]}{RST}")

    print(f"\n{GREEN}Agency seeded. {len(projects)} repos live + memory (summaries + {len(chunk_docs)} code chunks) in Atlas.{RST}")
    for p in projects:
        print(f"   {p['name']:18} {p['web_url']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
