#!/usr/bin/env python
"""App-aware helper for the one-command bootstrap (scripts/bootstrap.sh).

bash drives docker/uv/pnpm/servers; this owns the steps that need the app + its creds.
Three phases, each a separate invocation (so bash `set -e` can gate them):

  preflight   .env secrets are present · MongoDB answers a ping · the GitLab demo group
              is reachable (auto-create a top-level group by path if it 404s)
  reset       WIPE to a clean slate: drop the Mongo demo DB + delete the dispatched GitLab
              projects (seed repos are rebuilt by the seed scripts that run next)
  wait        block until every Atlas search index reports READY, so grounding works on the
              reviewer's very first query (indexes build async — CLAUDE.md gotcha)

Run:  uv run python scripts/setup_check.py {preflight|reset|wait}
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parent.parent
load_dotenv(REPO / ".env")
sys.path.insert(0, str(REPO / "orchestrator"))  # so `from app import gitlab` resolves

G, Y, R, RST = "\033[32m", "\033[33m", "\033[31m", "\033[0m"

DB = os.getenv("MONGODB_DB", "orchestrator")
MONGODB_URI = os.getenv("MONGODB_URI", "")
GROUP = os.getenv("GITLAB_DEMO_GROUP", "sprint0-demo")
SEARCH_COLLS = [
    os.getenv("PAST_PROJECTS_COLLECTION", "PastProjects"),
    os.getenv("DEVELOPER_PROFILES_COLLECTION", "DeveloperProfiles"),
    os.getenv("CODE_CHUNKS_COLLECTION", "CodeChunks"),
]

# Required .env values → why, so a missing one prints an actionable line.
REQUIRED = {
    "VOYAGE_API_KEY": "embeddings — free key at voyageai.com",
    "MONGODB_URI": "mongodb://localhost:27018/?directConnection=true (Atlas Local) or an Atlas cluster URI",
    "GITLAB_TOKEN": "GitLab personal/group access token, scope: api",
    "GITLAB_DEMO_GROUP": "a sacrificial GitLab group path the demo writes into",
}


def die(msg: str) -> None:
    print(f"{R}✗ {msg}{RST}")
    sys.exit(1)


def ok(msg: str) -> None:
    print(f"{G}✓ {msg}{RST}")


# ── preflight ─────────────────────────────────────────────────────────────────
def _check_secrets() -> None:
    missing = [k for k in REQUIRED if not os.getenv(k)]
    # Gemini: either a local API key OR Vertex (project + the use-vertex flag).
    if not os.getenv("GEMINI_API_KEY") and not (
        os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true" and os.getenv("GOOGLE_CLOUD_PROJECT")
    ):
        missing.append("GEMINI_API_KEY")
    if missing:
        print(f"{R}Missing required .env values:{RST}")
        for k in missing:
            why = REQUIRED.get(k, "Gemini API key (aistudio.google.com/apikey), or set Vertex (GOOGLE_CLOUD_PROJECT + GOOGLE_GENAI_USE_VERTEXAI=true)")
            print(f"   {R}{k}{RST} — {why}")
        die("fill them in .env, then re-run ./scripts/bootstrap.sh")
    ok(".env secrets present")


def _ping_mongo() -> None:
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError
    last = ""
    for _ in range(20):  # ~40s — the Atlas Local container may still be warming up
        try:
            MongoClient(MONGODB_URI, serverSelectionTimeoutMS=2000).admin.command("ping")
            ok("MongoDB reachable")
            return
        except PyMongoError as e:
            last = str(e).splitlines()[0][:90]
            time.sleep(2)
    die(f"MongoDB unreachable at MONGODB_URI after 40s ({last}) — is the container up?")


def _ensure_group() -> None:
    import httpx
    from app import gitlab as gl  # import here: secrets are validated, so GITLAB_TOKEN exists
    with gl._client() as c:
        try:
            ok(f"GitLab group '{GROUP}' reachable (id={gl._group_id(c, GROUP)})")
            return
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 404:
                die(f"GitLab group check failed ({e.response.status_code}): {e.response.text[:160]}")
        # 404 → create a private top-level group whose path is the last segment.
        path = GROUP.rstrip("/").split("/")[-1]
        r = c.post("/groups", json={"name": path, "path": path, "visibility": "private"})
        if r.status_code >= 300:
            die(f"GitLab group '{GROUP}' not found and auto-create failed ({r.status_code}: {r.text[:160]}). "
                "Create it manually, or check the token has `api` scope + group-create rights.")
        ok(f"created GitLab group '{GROUP}'")


def preflight() -> None:
    _check_secrets()
    _ping_mongo()
    _ensure_group()


# ── reset ───────────────────────────────────────────────────────────────────--
def reset() -> None:
    if not os.getenv("GITLAB_TOKEN"):
        die("GITLAB_TOKEN missing (run preflight first)")
    from pymongo import MongoClient
    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)
    client.admin.command("ping")
    client.drop_database(DB)
    ok(f"dropped Mongo database '{DB}'")
    from app import gitlab as gl
    try:
        res = gl.reset_demo(GROUP)
        ok(f"GitLab '{GROUP}': deleted {res.get('deleted', 0)} dispatched project(s) (seed repos rebuilt by the seeders)")
    except Exception as e:  # group may be brand-new/empty — not fatal
        print(f"{Y}⚠ reset_demo skipped: {str(e)[:120]}{RST}")


# ── wait (indexes READY) ───────────────────────────────────────────────────────
def wait() -> None:
    from pymongo import MongoClient
    db = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)[DB]
    for _ in range(50):  # ~150s
        pending = []
        for coll in SEARCH_COLLS:
            try:
                for ix in db[coll].list_search_indexes():
                    ready = ix.get("status") == "READY" or ix.get("queryable") is True
                    if not ready:
                        pending.append(f"{coll}/{ix.get('name')}={ix.get('status', '?')}")
            except Exception:
                pass  # collection/indexes not present yet → nothing to wait on
        if not pending:
            ok("all search indexes READY")
            return
        print(f"{Y}   building: {', '.join(pending)}{RST}")
        time.sleep(3)
    print(f"{Y}⚠ some indexes still building after 150s — the app runs now; grounding sharpens as they finish{RST}")


PHASES = {"preflight": preflight, "reset": reset, "wait": wait}

if __name__ == "__main__":
    phase = sys.argv[1] if len(sys.argv) > 1 else ""
    if phase not in PHASES:
        die(f"usage: setup_check.py {{{'|'.join(PHASES)}}}")
    PHASES[phase]()
