"""Phase 2 seed loader.

Reads seed/*.json, embeds text with Voyage AI, (re)loads the PastProjects and
DeveloperProfiles collections in Atlas, creates the two vector-search indexes,
then runs a sample $vectorSearch to prove the pipeline.

Run: uv run python scripts/seed_load.py
Requires .env: MONGODB_URI, VOYAGE_API_KEY (+ optional VOYAGE_MODEL, EMBEDDING_DIMS).
Idempotent: clears + reloads the two collections each run.
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

GREEN, YEL, RED, RST = "\033[32m", "\033[33m", "\033[31m", "\033[0m"


def die(msg: str) -> None:
    print(f"{RED}❌ {msg}{RST}")
    sys.exit(1)


MONGODB_URI = os.getenv("MONGODB_URI", "")
VOYAGE_API_KEY = os.getenv("VOYAGE_API_KEY", "")
VOYAGE_MODEL = os.getenv("VOYAGE_MODEL", "voyage-3.5-lite")
DIMS = int(os.getenv("EMBEDDING_DIMS", "1024"))
DB = os.getenv("MONGODB_DB", "orchestrator")
PP_COLL = os.getenv("PAST_PROJECTS_COLLECTION", "PastProjects")
DEV_COLL = os.getenv("DEVELOPER_PROFILES_COLLECTION", "DeveloperProfiles")
PP_INDEX = os.getenv("PAST_PROJECTS_VECTOR_INDEX", "pp_vector_index")
DEV_INDEX = os.getenv("DEVELOPER_VECTOR_INDEX", "dev_vector_index")

if not MONGODB_URI:
    die("MONGODB_URI not set in .env")
if not VOYAGE_API_KEY:
    die("VOYAGE_API_KEY not set in .env (free key at voyageai.com)")

import voyageai  # noqa: E402
from pymongo import MongoClient  # noqa: E402
from pymongo.operations import SearchIndexModel  # noqa: E402

vo = voyageai.Client(api_key=VOYAGE_API_KEY)


def embed(texts: list[str], input_type: str) -> list[list[float]]:
    r = vo.embed(texts, model=VOYAGE_MODEL, input_type=input_type, output_dimension=DIMS)
    return r.embeddings


def load_json(name: str) -> list[dict]:
    return json.loads((REPO / "seed" / name).read_text())


def ensure_vector_index(coll, index_name: str, path: str) -> None:
    existing = {ix["name"] for ix in coll.list_search_indexes()}
    if index_name in existing:
        print(f"   index '{index_name}' already exists")
        return
    coll.create_search_index(
        model=SearchIndexModel(
            name=index_name,
            type="vectorSearch",
            definition={"fields": [{"type": "vector", "path": path, "numDimensions": DIMS, "similarity": "cosine"}]},
        )
    )
    print(f"   created index '{index_name}' ({DIMS} dims, cosine)")


def wait_queryable(coll, index_name: str, timeout: int = 180) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        for ix in coll.list_search_indexes():
            if ix["name"] == index_name and ix.get("queryable"):
                return True
        time.sleep(5)
    return False


def main() -> int:
    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)
    client.admin.command("ping")
    db = client[DB]
    print(f"-- seeding db '{DB}' via Voyage {VOYAGE_MODEL} ({DIMS} dims) --")

    # PastProjects
    projects = load_json("past_projects.json")
    pp_vecs = embed([p["brief_text"] for p in projects], "document")
    for p, v in zip(projects, pp_vecs):
        p["brief_embedding"] = v
    db[PP_COLL].delete_many({})
    db[PP_COLL].insert_many(projects)
    print(f"{GREEN}✅ {PP_COLL}: {len(projects)} docs{RST}")
    ensure_vector_index(db[PP_COLL], PP_INDEX, "brief_embedding")

    # DeveloperProfiles
    devs = load_json("developer_profiles.json")
    dev_vecs = embed([d["skills_text"] for d in devs], "document")
    for d, v in zip(devs, dev_vecs):
        d["skill_embedding"] = v
    db[DEV_COLL].delete_many({})
    db[DEV_COLL].insert_many(devs)
    print(f"{GREEN}✅ {DEV_COLL}: {len(devs)} docs{RST}")
    ensure_vector_index(db[DEV_COLL], DEV_INDEX, "skill_embedding")

    # Verify with a sample query
    print(f"{YEL}… waiting for '{PP_INDEX}' to become queryable{RST}")
    if not wait_queryable(db[PP_COLL], PP_INDEX):
        print(f"{YEL}index still building — re-run the verify query in a minute{RST}")
        return 0
    qv = embed(["real-estate listings marketplace with a map and an agent CRM"], "query")[0]
    hits = list(
        db[PP_COLL].aggregate(
            [
                {"$vectorSearch": {"index": PP_INDEX, "path": "brief_embedding", "queryVector": qv, "numCandidates": 50, "limit": 3}},
                {"$project": {"_id": 0, "name": 1, "score": {"$meta": "vectorSearchScore"}}},
            ]
        )
    )
    print(f"{GREEN}✅ sample $vectorSearch (real-estate brief) →{RST}")
    for h in hits:
        print(f"     {h['name']:24} {h['score']:.3f}")
    print(f"\n{GREEN}Seed complete. Vector search live through Atlas.{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
