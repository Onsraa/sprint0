"""Clean + seed the agency demo.

Wipes demo data, then creates 2 REAL GitLab repos (QuantaPay / TrailLog) by pushing
`seed/agency/<repo>/`, and registers them into MongoDB agency memory:
  - PastProjects  — one grounded summary per project (vector + full-text indexed)
  - CodeChunks    — one chunk per repo file, for chunk-level code-RAG ("find a reusable component")

The roster (DeveloperProfiles) is owned by scripts/seed_team.py — run it after this.

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
PROJ_COLL = os.getenv("PROJECT_RECORDS_COLLECTION", "ProjectRecords")
CODE_COLL = os.getenv("CODE_CHUNKS_COLLECTION", "CodeChunks")
PP_INDEX = os.getenv("PAST_PROJECTS_VECTOR_INDEX", "pp_vector_index")
CODE_INDEX = os.getenv("CODE_CHUNKS_VECTOR_INDEX", "code_vector_index")
PP_TEXT_INDEX = os.getenv("PAST_PROJECTS_TEXT_INDEX", "pp_text_index")  # Atlas Search (hybrid, item H)
DECISIONS_COLL = os.getenv("DECISIONS_COLLECTION", "Decisions")

# #33 — graded TEAM decisions so a fresh-seed demo shows the full Contract signal spread (green/orange/grey).
# project_name matches the canned solution `grounded_on` so grade_for derives the green option's pill.
_SEED_DECISIONS = [
    {"id": "dec-auth-quantapay", "owner_id": "sprint0-se", "domain": "backend",
     "recommendation": "Reuse the QuantaPay JWT+TOTP auth module", "reasoning": "Battle-tested; reused since QuantaPay.",
     "project_id": "seed-quantapay", "project_name": "QuantaPay (2024)", "issue_ids": [],
     "outcome_validated": True, "visibility": "team", "deprecated": False, "grade": "prod_survived",
     "merged": True, "qa_passed": True, "days_clean": 30,
     "created_at": "2024-08-01T00:00:00Z", "updated_at": "2024-08-01T00:00:00Z"},
    {"id": "dec-realtime-traillog", "owner_id": "sprint0-se", "domain": "backend",
     "recommendation": "Prefer managed push + polling over self-hosted WebSocket fan-out on flaky field connectivity",
     "reasoning": "Lesson from the TrailLog field rollout.", "project_id": "seed-traillog",
     "project_name": "TrailLog (2025)", "issue_ids": [], "outcome_validated": True, "visibility": "team",
     "deprecated": False, "grade": "shipped", "merged": True, "qa_passed": False, "days_clean": 0,
     "created_at": "2025-03-01T00:00:00Z", "updated_at": "2025-03-01T00:00:00Z"},
    {"id": "dec-payments-quantapay", "owner_id": "sprint0-se", "domain": "backend",
     "recommendation": "Stripe Connect for marketplace payouts, idempotent webhooks", "reasoning": "Shipped in QuantaPay.",
     "project_id": "seed-quantapay", "project_name": "QuantaPay (2024)", "issue_ids": [],
     "outcome_validated": True, "visibility": "team", "deprecated": False, "grade": "shipped",
     "merged": True, "qa_passed": True, "days_clean": 5,
     "created_at": "2024-09-01T00:00:00Z", "updated_at": "2024-09-01T00:00:00Z"},
]

if not MONGODB_URI:
    die("MONGODB_URI not set in .env")
if not VOYAGE_API_KEY:
    die("VOYAGE_API_KEY not set in .env")

import voyageai  # noqa: E402
from pymongo import MongoClient  # noqa: E402
from pymongo.operations import SearchIndexModel  # noqa: E402
from voyageai.error import RateLimitError  # noqa: E402

from app import corpus  # noqa: E402
from app import gitlab as gl  # noqa: E402
from app import graph as graph_mod  # noqa: E402

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


def ensure_vector_index(coll, name: str, path: str, filters: list[str] | None = None) -> None:
    """Idempotent, filter-aware: if the index exists but lacks a required `filter` field (needed for
    $vectorSearch pre-filtering, e.g. per-discipline code_search), drop + recreate it."""
    existing = next((ix for ix in coll.list_search_indexes() if ix["name"] == name), None)
    if existing:
        defn = existing.get("latestDefinition") or existing.get("definition") or {}
        have = {f.get("path") for f in defn.get("fields", []) if f.get("type") == "filter"}
        if set(filters or []) <= have:
            print(f"   vector index '{name}' exists")
            return
        print(f"{YEL}   vector index '{name}' missing filter fields → drop + recreate (~1 min; code_search degrades to [] meanwhile){RST}")
        coll.drop_search_index(name)
        for _ in range(30):  # drop is async on Atlas — wait until gone before recreating
            if name not in {ix["name"] for ix in coll.list_search_indexes()}:
                break
            time.sleep(2)
    coll.create_search_index(
        model=SearchIndexModel(
            name=name, type="vectorSearch",
            definition={"fields": [
                {"type": "vector", "path": path, "numDimensions": DIMS, "similarity": "cosine"},
                *({"type": "filter", "path": f} for f in filters or []),
            ]},
        )
    )
    print(f"   created vector index '{name}'" + (f" (filters: {', '.join(filters)})" if filters else ""))


def ensure_search_index(coll, name: str) -> None:
    """Atlas full-text Search index (dynamic) — powers hybrid retrieval (item H)."""
    if name in {ix["name"] for ix in coll.list_search_indexes()}:
        print(f"   search index '{name}' exists")
        return
    coll.create_search_index(model=SearchIndexModel(name=name, type="search", definition={"mappings": {"dynamic": True}}))
    print(f"   created search index '{name}'")


# Plain B-tree indexes on the runtime collections' filter fields, so reads filter server-side
# (indexed) instead of fetch-all-then-filter-in-Python. One entry per field a query filters on.
_FIELD_INDEXES = {
    "Agreements": ["id", "plan_id", "ratifiers"],
    "Notifications": ["id", "user_id"],
    "Tasks": ["id", "project_id"],
    "Decisions": ["id", "owner_id", "project_name"],
    "ProjectRecords": ["project_id"],
    "Subscriptions": ["watcher_id", "subject_id"],
    "AccessGrants": ["id", "subject_id", "requester_id"],
    "RescheduleProposals": ["id", "status"],
    "GraphNodes": ["project_id"],
    "GraphEdges": ["project_id", "from_path", "to_path"],
    "Profiles": ["id"],
    "DeveloperProfiles": ["gitlab_username", "username"],
}


def ensure_field_indexes(db) -> None:
    """Provision the runtime collections' field indexes. create_index is idempotent (same spec = no-op)."""
    n = sum(1 for coll, fields in _FIELD_INDEXES.items() for f in fields if db[coll].create_index(f))
    print(f"{GREEN}✅ field indexes ensured ({n} across {len(_FIELD_INDEXES)} collections){RST}")


_SUMMARY_LANGS = {"python", "typescript", "javascript"}


def summarize_chunks(chunks: list[dict]) -> list[str]:
    """Per-file Gemini summaries (prose embeds better against prose briefs than raw code). Best-effort:
    missing creds / import / call failure → blanks, and the seed falls back to excerpt-only embeddings."""
    blanks = [""] * len(chunks)
    if not (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
            or os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in ("1", "true", "yes")):
        print(f"{YEL}   no Gemini creds — seeding with excerpt-only embeddings{RST}")
        return blanks
    try:
        import asyncio

        from app.agent import generate_file_summary
    except Exception as e:
        print(f"{YEL}   agent unavailable ({str(e)[:80]}) — excerpt-only embeddings{RST}")
        return blanks

    async def run() -> list[str]:
        sem = asyncio.Semaphore(4)

        async def one(c: dict) -> str:
            if c["language"] not in _SUMMARY_LANGS:
                return ""
            async with sem:
                return await generate_file_summary(c["file_path"], c["_content"])

        return list(await asyncio.gather(*(one(c) for c in chunks)))

    try:
        out = asyncio.run(run())
        print(f"{GREEN}   ✅ {sum(1 for s in out if s)} file summaries via Gemini{RST}")
        return out
    except Exception as e:
        print(f"{YEL}   summaries failed ({str(e)[:80]}) — excerpt-only embeddings{RST}")
        return blanks


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
    for coll in (PP_COLL, PROJ_COLL, CODE_COLL, DECISIONS_COLL):
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
                "language": corpus.language_of(fobj["path"]),
                "discipline": corpus.discipline_of_path(fobj["path"]),
                "content_hash": graph_mod.normalize_and_hash(fobj["content"]),  # living-corpus reembed gate
                "_content": fobj["content"],  # full text for the summary pass; stripped before insert
            })
        # Import graph for this repo (project_id = repo name = CodeChunks.project, the retrieval-expansion
        # join key). Built from push_dir's in-memory file list — paths byte-identical to file_path, and
        # never re-walks disk (seed dirs can contain a venv/). Delete+insert = idempotent re-seed,
        # touching ONLY this partition (the app's 'local'/'lineage' graphs stay).
        nodes, edges = graph_mod.build_import_graph({f["path"]: f["content"] for f in files}, proj["name"])
        db["GraphNodes"].delete_many({"project_id": proj["name"]})
        db["GraphEdges"].delete_many({"project_id": proj["name"]})
        if nodes:
            db["GraphNodes"].insert_many([n.model_dump() for n in nodes])
        if edges:
            db["GraphEdges"].insert_many([e.model_dump() for e in edges])
        print(f"      import graph: {len(nodes)} nodes, {len(edges)} edges")

    # Insert ALL data first — an Atlas index cap (M0) must never abort the data seed.
    print(f"{YEL}-- embedding + inserting memory --{RST}")
    for p, v in zip(projects, embed([p["brief_text"] for p in projects])):
        p["brief_embedding"] = v
    db[PP_COLL].insert_many(projects)
    print(f"{GREEN}✅ {PP_COLL}: {len(projects)} docs{RST}")

    summaries = summarize_chunks(chunk_docs)  # best-effort; blanks → excerpt-only embeddings
    chunk_texts = [
        corpus.chunk_embed_text(c["project"], c["file_path"], c["discipline"], c["language"], s, c["excerpt"])
        for c, s in zip(chunk_docs, summaries)
    ]
    for c, v, s in zip(chunk_docs, embed(chunk_texts), summaries):  # still ONE batched Voyage call
        c["embedding"] = v
        c["summary"] = s
        c.pop("_content", None)
    db[CODE_COLL].insert_many(chunk_docs)
    print(f"{GREEN}✅ {CODE_COLL}: {len(chunk_docs)} code chunks{RST}")

    db[DECISIONS_COLL].insert_many([dict(d) for d in _SEED_DECISIONS])
    print(f"{GREEN}✅ {DECISIONS_COLL}: {len(_SEED_DECISIONS)} graded team decisions (#33 signal seed){RST}")

    # Indexes — best-effort. Vector indexes (needed for the run) get priority; the full-text
    # index (for hybrid retrieval, item H) is skipped if the M0 search-index cap is hit.
    print(f"{YEL}-- ensuring search indexes (best-effort on M0) --{RST}")
    for coll, name, path, filters in [(PP_COLL, PP_INDEX, "brief_embedding", None),
                                      (CODE_COLL, CODE_INDEX, "embedding", ["discipline", "language"])]:
        try:
            ensure_vector_index(db[coll], name, path, filters)
        except Exception as e:
            print(f"{YEL}   ⚠ vector index '{name}' skipped: {str(e)[:90]}{RST}")
    try:
        ensure_search_index(db[PP_COLL], PP_TEXT_INDEX)
    except Exception as e:
        print(f"{YEL}   ⚠ full-text index '{PP_TEXT_INDEX}' skipped (M0 cap; hybrid → vector-only for now): {str(e)[:90]}{RST}")
    ensure_field_indexes(db)

    print(f"\n{GREEN}Agency seeded. {len(projects)} repos live + memory (summaries + {len(chunk_docs)} code chunks) in Atlas.{RST}")
    for p in projects:
        print(f"   {p['name']:18} {p['web_url']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
