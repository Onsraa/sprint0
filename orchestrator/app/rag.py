"""RAG via the official MongoDB MCP (Phase 3).

The orchestrator is the MCP client: it embeds text with Voyage and runs Atlas
$vectorSearch through the MCP's `aggregate` tool. (An LLM can't produce embedding
vectors, so vector retrieval lives here, not in the agent's tool-calls.)
"""
from __future__ import annotations

import json
import os
import time
from contextlib import AsyncExitStack
from pathlib import Path

import voyageai
from dotenv import load_dotenv
from voyageai.error import RateLimitError
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

_URI = os.environ["MONGODB_URI"]
_DB = os.getenv("MONGODB_DB", "orchestrator")
_MODEL = os.getenv("VOYAGE_MODEL", "voyage-3.5-lite")
_DIMS = int(os.getenv("EMBEDDING_DIMS", "1024"))
PP_COLL = os.getenv("PAST_PROJECTS_COLLECTION", "PastProjects")
DEV_COLL = os.getenv("DEVELOPER_PROFILES_COLLECTION", "DeveloperProfiles")
PP_INDEX = os.getenv("PAST_PROJECTS_VECTOR_INDEX", "pp_vector_index")
DEV_INDEX = os.getenv("DEVELOPER_VECTOR_INDEX", "dev_vector_index")
PROJ_COLL = os.getenv("PROJECT_RECORDS_COLLECTION", "ProjectRecords")

_vo = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])


def _embed(texts: list[str], input_type: str = "query") -> list[list[float]]:
    # Voyage free tier (no card) = 3 req/min; back off and retry on rate limits.
    for attempt in range(4):
        try:
            return _vo.embed(texts, model=_MODEL, input_type=input_type, output_dimension=_DIMS).embeddings
        except RateLimitError:
            if attempt == 3:
                raise
            time.sleep(21)
    return []


def embed_query(text: str) -> list[float]:
    return _embed([text])[0]


def embed_queries(texts: list[str]) -> list[list[float]]:
    """Batch embed (one Voyage request) — the free tier is 3 req/min, so never loop."""
    return _embed(texts) if texts else []


def embed_document(text: str) -> list[float]:
    """Embed a stored document (matches the seed corpus' input_type)."""
    return _embed([text], input_type="document")[0]


def _promote(history: list[dict]) -> str:
    """Trust tier from the merge record: low → medium (≥3 good merges) → high (≥6, avg ≥0.8)."""
    good = [h for h in history if h.get("score", 0) >= 0.7]
    n = len(good)
    avg = sum(h.get("score", 0) for h in good) / n if n else 0
    if n >= 6 and avg >= 0.8:
        return "high"
    if n >= 3:
        return "medium"
    return "low"


async def record_merge(gitlab_username: str, task_type: str, score: float = 0.85) -> dict:
    """Passport-increment-on-merge (Idea 2): push a history entry (MongoDB WRITE via the MCP),
    then auto-promote trust_level when the track record earns it."""
    async with MongoMCP() as m:
        await m.update_many(
            DEV_COLL,
            {"gitlab_username": gitlab_username},
            {"$push": {"history": {"task_type": task_type, "score": score, "via": "baton-merge"}}},
        )
        rows = await m.find(
            DEV_COLL,
            projection={"_id": 0, "gitlab_username": 1, "trust_level": 1, "history": 1},
            query={"gitlab_username": gitlab_username},
        )
        if not rows:
            return {}
        dev = rows[0]
        new_trust = _promote(dev.get("history", []))
        if new_trust != dev.get("trust_level"):
            await m.update_many(DEV_COLL, {"gitlab_username": gitlab_username}, {"$set": {"trust_level": new_trust}})
            dev["trust_level"], dev["promoted"] = new_trust, True
    return dev


async def save_project_record(record: dict) -> None:
    """Persist a scaffolded project (milestone write) so mid-prod feature-adds can
    ground against its real state later. Each dispatch is a new GitLab project_id → insert."""
    async with MongoMCP() as m:
        await m.insert_many(PROJ_COLL, [record])


async def update_project_record(project_id: int, patch: dict) -> None:
    async with MongoMCP() as m:
        await m.update_many(PROJ_COLL, {"project_id": project_id}, {"$set": patch})


async def get_project_record(project_id: int) -> dict:
    async with MongoMCP() as m:
        rows = await m.find(PROJ_COLL, query={"project_id": project_id}, projection={"_id": 0}, limit=1)
    return rows[0] if rows else {}


async def record_postmortem(doc: dict) -> None:
    """On project close, write an outcome doc into agency memory (PastProjects) so future
    grounding improves. Embedding is added by the caller (reason.py) when a brief summary exists."""
    async with MongoMCP() as m:
        await m.insert_many(PP_COLL, [doc])


def _parse_docs(text: str) -> list[dict]:
    """The MCP returns a prose line + an EJSON array (wrapped in safety tags)."""
    a, b = text.find("["), text.rfind("]")
    if a == -1 or b == -1:
        return []
    try:
        return json.loads(text[a : b + 1])
    except json.JSONDecodeError:
        return []


class MongoMCP:
    """One stdio session to the official MongoDB MCP, reused for many searches."""

    def __init__(self) -> None:
        self._params = StdioServerParameters(
            command="npx", args=["-y", "mongodb-mcp-server", "--connectionString", _URI]
        )

    async def __aenter__(self) -> "MongoMCP":
        self._stack = AsyncExitStack()
        read, write = await self._stack.enter_async_context(stdio_client(self._params))
        self.session = await self._stack.enter_async_context(ClientSession(read, write))
        await self.session.initialize()
        return self

    async def __aexit__(self, *exc) -> None:
        try:
            await self._stack.aclose()
        except BaseException:
            pass  # ignore stdio teardown races

    async def vector_search(
        self, collection: str, index: str, path: str, query_vec: list[float], k: int = 3, projection: dict | None = None
    ) -> list[dict]:
        proj: dict = {"_id": 0, "score": {"$meta": "vectorSearchScore"}}
        proj.update(projection or {})
        pipeline = [
            {"$vectorSearch": {"index": index, "path": path, "queryVector": query_vec, "numCandidates": max(50, k * 10), "limit": k}},
            {"$project": proj},
        ]
        res = await self.session.call_tool("aggregate", {"database": _DB, "collection": collection, "pipeline": pipeline})
        text = "".join(getattr(b, "text", "") or "" for b in res.content)
        if getattr(res, "isError", False):
            raise RuntimeError(f"MongoDB MCP aggregate failed (is Atlas reachable on :27017?): {text[:200]}")
        return _parse_docs(text)

    async def find(self, collection: str, projection: dict | None = None, query: dict | None = None, limit: int = 20) -> list[dict]:
        res = await self.session.call_tool(
            "find",
            {"database": _DB, "collection": collection, "filter": query or {}, "projection": projection or {}, "limit": limit},
        )
        text = "".join(getattr(b, "text", "") or "" for b in res.content)
        if getattr(res, "isError", False):
            raise RuntimeError(f"MongoDB MCP find failed (is Atlas reachable on :27017?): {text[:200]}")
        return _parse_docs(text)

    async def update_many(self, collection: str, query: dict, update: dict) -> str:
        res = await self.session.call_tool(
            "update-many", {"database": _DB, "collection": collection, "filter": query, "update": update}
        )
        text = "".join(getattr(b, "text", "") or "" for b in res.content)
        if getattr(res, "isError", False):
            raise RuntimeError(f"MongoDB MCP update-many failed: {text[:200]}")
        return text

    async def insert_many(self, collection: str, documents: list[dict]) -> str:
        res = await self.session.call_tool("insert-many", {"database": _DB, "collection": collection, "documents": documents})
        text = "".join(getattr(b, "text", "") or "" for b in res.content)
        if getattr(res, "isError", False):
            raise RuntimeError(f"MongoDB MCP insert-many failed: {text[:200]}")
        return text

    async def delete_many(self, collection: str, query: dict) -> str:
        res = await self.session.call_tool("delete-many", {"database": _DB, "collection": collection, "filter": query})
        text = "".join(getattr(b, "text", "") or "" for b in res.content)
        if getattr(res, "isError", False):
            raise RuntimeError(f"MongoDB MCP delete-many failed: {text[:200]}")
        return text
