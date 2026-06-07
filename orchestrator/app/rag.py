"""RAG via the official MongoDB MCP (Phase 3).

The orchestrator is the MCP client: it embeds text with Voyage and runs Atlas
$vectorSearch through the MCP's `aggregate` tool. (An LLM can't produce embedding
vectors, so vector retrieval lives here, not in the agent's tool-calls.)
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import AsyncExitStack
from functools import lru_cache
from pathlib import Path

import voyageai
from dotenv import load_dotenv
from voyageai.error import RateLimitError
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from app import demo

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

_URI = os.environ["MONGODB_URI"]
_DB = os.getenv("MONGODB_DB", "sprint0")
_MODEL = os.getenv("VOYAGE_MODEL", "voyage-3.5-lite")
_DIMS = int(os.getenv("EMBEDDING_DIMS", "1024"))
PP_COLL = os.getenv("PAST_PROJECTS_COLLECTION", "PastProjects")
DEV_COLL = os.getenv("DEVELOPER_PROFILES_COLLECTION", "DeveloperProfiles")
PP_INDEX = os.getenv("PAST_PROJECTS_VECTOR_INDEX", "pp_vector_index")
DEV_INDEX = os.getenv("DEVELOPER_VECTOR_INDEX", "dev_vector_index")
PROJ_COLL = os.getenv("PROJECT_RECORDS_COLLECTION", "ProjectRecords")
CODE_COLL = os.getenv("CODE_CHUNKS_COLLECTION", "CodeChunks")
CODE_INDEX = os.getenv("CODE_CHUNKS_VECTOR_INDEX", "code_vector_index")
PP_TEXT_INDEX = os.getenv("PAST_PROJECTS_TEXT_INDEX", "pp_text_index")

_vo = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])

# Demo mode: a fixed unit query-vector so `$vectorSearch` runs LIVE against Atlas (the MCP
# showcase) with ZERO Voyage calls — neutralizes the free-tier 3-req/min limit on public traffic.
_DEMO_VEC = [1.0 / (_DIMS ** 0.5)] * _DIMS


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


@lru_cache(maxsize=256)
def _embed_query_cached(text: str) -> tuple[float, ...]:
    """One brief is embedded across clarify→architectures→plan; cache the deterministic vector so
    we pay Voyage once, not 3×. Tuple (immutable) so a caller can't mutate the cached entry."""
    return tuple(_embed([text])[0])


def embed_query(text: str) -> list[float]:
    if demo.is_demo():
        return list(_DEMO_VEC)
    return list(_embed_query_cached(text))


def cosine_score(a: list[float], b: list[float]) -> float:
    """Atlas `$vectorSearch` cosine score, computed locally: (1 + cosine)/2 ∈ [0,1]. Replicated so a
    one-shot roster fetch + local rank reproduces the per-skill vectorSearch scores exactly."""
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return (1.0 + dot / (na * nb)) / 2.0 if na and nb else 0.0


def embed_queries(texts: list[str]) -> list[list[float]]:
    """Batch embed (one Voyage request) — the free tier is 3 req/min, so never loop."""
    if demo.is_demo():
        return [list(_DEMO_VEC) for _ in texts]
    return _embed(texts) if texts else []


def embed_document(text: str) -> list[float]:
    """Embed a stored document (matches the seed corpus' input_type)."""
    if demo.is_demo():
        return list(_DEMO_VEC)  # demo writes are no-ops (below) → the vector is discarded anyway
    return _embed([text], input_type="document")[0]


_RANK = {"low": 0, "medium": 1, "high": 2}
_DISC_ALIAS = {"db": "backend", "design": "uiux"}


def _discipline_of(task_type: str) -> str:
    a = (task_type or "").split(":")[0].strip().lower()
    return _DISC_ALIAS.get(a, a)


def _promote(history: list[dict], discipline: str | None = None) -> str:
    """Trust tier from good merges (score ≥0.7), optionally scoped to one discipline:
    low → medium (≥3) → high (≥6, avg ≥0.8)."""
    good = [
        h for h in history
        if h.get("score", 0) >= 0.7 and (discipline is None or _discipline_of(h.get("task_type", "")) == discipline)
    ]
    n = len(good)
    avg = sum(h.get("score", 0) for h in good) / n if n else 0
    if n >= 6 and avg >= 0.8:
        return "high"
    if n >= 3:
        return "medium"
    return "low"


async def record_merge(gitlab_username: str, task_type: str, score: float = 0.85) -> dict:
    """Passport-increment-on-merge: push a history entry, then grow the merged DISCIPLINE's
    trust + the skill profile — the passport becomes living per-discipline (junior → UI/UX)."""
    disc = _discipline_of(task_type)
    async with MongoMCP() as m:
        await m.update_many(
            DEV_COLL, {"gitlab_username": gitlab_username},
            {"$push": {"history": {"task_type": task_type, "score": score, "via": "sprint0-merge"}}},
        )
        rows = await m.find(
            DEV_COLL,
            projection={"_id": 0, "gitlab_username": 1, "trust_level": 1, "trust": 1, "history": 1, "skills_text": 1},
            query={"gitlab_username": gitlab_username},
        )
        if not rows:
            return {}
        dev = rows[0]
        trust = dev.get("trust") or {}
        new_tier = _promote(dev.get("history", []), disc)
        promoted = new_tier != trust.get(disc)
        trust[disc] = new_tier
        overall = max(trust.values(), key=lambda t: _RANK.get(t, 0), default="low")
        sets: dict = {"trust": trust, "trust_level": overall}
        skills = dev.get("skills_text", "")
        if disc and disc not in skills.lower():  # grew into a new discipline → extend + re-embed
            skills = f"{skills}, {disc}".strip(", ")
            sets["skills_text"] = skills
            sets["skill_embedding"] = embed_document(skills)
        await m.update_many(DEV_COLL, {"gitlab_username": gitlab_username}, {"$set": sets})
        dev.update(sets)
        dev["promoted"], dev["grew_discipline"] = promoted, disc
    return {k: v for k, v in dev.items() if k != "skill_embedding"}


async def set_developer_discipline(username: str, discipline: str) -> None:
    """Seat a member in a discipline (manager action) → they enter the assignment pool in-lane."""
    async with MongoMCP() as m:
        await m.update_many(DEV_COLL, {"username": username}, {"$set": {"discipline": discipline}})


_DEMO_PROJECTS: dict[int, dict] = {}  # DEMO_MODE in-mem store — Atlas writes no-op, so dispatched projects live here


def reset_demo_projects() -> None:
    """DEMO reset/seed: drop every session-dispatched project record (only the canned workspace remains)."""
    _DEMO_PROJECTS.clear()


async def save_project_record(record: dict) -> None:
    """Persist a scaffolded project (milestone write) so mid-prod feature-adds can
    ground against its real state later. Each dispatch is a new GitLab project_id → insert."""
    if demo.is_demo():
        _DEMO_PROJECTS[record["project_id"]] = dict(record)
        return
    async with MongoMCP() as m:
        await m.insert_many(PROJ_COLL, [record])


async def update_project_record(project_id: int, patch: dict) -> None:
    if demo.is_demo():
        if project_id in _DEMO_PROJECTS:
            _DEMO_PROJECTS[project_id].update(patch)
        return
    async with MongoMCP() as m:
        await m.update_many(PROJ_COLL, {"project_id": project_id}, {"$set": patch})


async def get_project_record(project_id: int) -> dict:
    if demo.is_demo():
        return dict(_DEMO_PROJECTS.get(project_id) or {})
    async with MongoMCP() as m:
        rows = await m.find(PROJ_COLL, query={"project_id": project_id}, projection={"_id": 0}, limit=1)
    return rows[0] if rows else {}


async def all_project_records() -> list[dict]:
    if demo.is_demo():
        return [dict(r) for r in _DEMO_PROJECTS.values()]
    async with MongoMCP() as m:
        return await m.find(PROJ_COLL, projection={"_id": 0}, limit=2000)  # was 50 — a real org has >50 projects


async def past_projects() -> list[dict]:
    """Agency reference projects (PastProjects memory) — summary/stack/outcome, sans embeddings.
    Enriches the manager Dashboard's Reference repos."""
    async with MongoMCP() as m:
        return await m.find(PP_COLL, projection={"_id": 0, "brief_embedding": 0}, limit=50)


async def record_postmortem(doc: dict) -> None:
    """On project close, write an outcome doc into agency memory (PastProjects) so future
    grounding improves. Embedding is added by the caller (reason.py) when a brief summary exists."""
    async with MongoMCP() as m:
        await m.insert_many(PP_COLL, [doc])


DECISIONS_COLLECTION = "Decisions"  # PascalCase, matches PastProjects/ProjectRecords convention


async def save_decision(doc: dict) -> None:
    """Persist a lead's ratification Decision (the agency's reasoning memory). Best-effort write."""
    async with MongoMCP() as m:
        await m.insert_many(DECISIONS_COLLECTION, [doc])


async def decisions_by_owner(owner_id: str) -> list[dict]:
    """Every Decision a member has made, across all projects (their portfolio)."""
    async with MongoMCP() as m:
        return await m.find(DECISIONS_COLLECTION, query={"owner_id": owner_id}, projection={"_id": 0}, limit=200)


async def get_decision(decision_id: str) -> dict:
    async with MongoMCP() as m:
        rows = await m.find(DECISIONS_COLLECTION, query={"id": decision_id}, projection={"_id": 0}, limit=1)
    return rows[0] if rows else {}


async def update_decision(decision_id: str, patch: dict) -> None:
    async with MongoMCP() as m:
        await m.update_many(DECISIONS_COLLECTION, {"id": decision_id}, {"$set": patch})


async def delete_decision(decision_id: str) -> None:
    async with MongoMCP() as m:
        await m.delete_many(DECISIONS_COLLECTION, {"id": decision_id})


async def decisions_for_project(project_name: str) -> list[dict]:
    """Decisions captured for a given project (matched by project_name) — Outcome Validation join."""
    async with MongoMCP() as m:
        return await m.find(DECISIONS_COLLECTION, query={"project_name": project_name}, projection={"_id": 0}, limit=200)


async def all_decisions(limit: int = 500) -> list[dict]:
    """The whole Decisions pool — the cross-user surfacing endpoint filters it by the quality gate."""
    async with MongoMCP() as m:
        return await m.find(DECISIONS_COLLECTION, projection={"_id": 0}, limit=limit)


# ── Agreements (the coordination spine: AI-drafted, async-ratified, compounding) ──
AGREEMENTS_COLLECTION = "Agreements"
_DEMO_AGREEMENTS: dict[str, dict] = {}  # DEMO_MODE in-mem store — Atlas writes no-op, so agreements live here


def reset_demo_agreements() -> None:
    """DEMO reset/seed: drop every in-mem interface contract so the canned set is the only one left."""
    _DEMO_AGREEMENTS.clear()


async def save_agreement(doc: dict) -> None:
    if demo.is_demo():
        _DEMO_AGREEMENTS[doc["id"]] = dict(doc)
        return
    async with MongoMCP() as m:
        await m.insert_many(AGREEMENTS_COLLECTION, [doc])


async def agreements_for_plan(plan_id: str) -> list[dict]:
    if demo.is_demo():
        return [dict(d) for d in _DEMO_AGREEMENTS.values() if d.get("plan_id") == plan_id]
    async with MongoMCP() as m:
        return await m.find(AGREEMENTS_COLLECTION, query={"plan_id": plan_id}, projection={"_id": 0}, limit=200)


async def agreements_for_ratifier(username: str) -> list[dict]:
    """The agreements awaiting THIS person's signature (their Inbox queue). Demo: filter the in-mem
    store. Atlas: push the filter server-side (indexed on `ratifiers`) — array membership + state."""
    if demo.is_demo():
        return [r for r in (dict(d) for d in _DEMO_AGREEMENTS.values())
                if username in (r.get("ratifiers") or []) and r.get("state") == "proposed"]
    async with MongoMCP() as m:
        return await m.find(AGREEMENTS_COLLECTION, query={"ratifiers": username, "state": "proposed"},
                            projection={"_id": 0}, limit=200)


async def all_agreements(limit: int = 1000) -> list[dict]:
    """The whole pool — the precedent memory the compounding check reads (find a ratified match → auto-pass)."""
    if demo.is_demo():
        return [dict(d) for d in _DEMO_AGREEMENTS.values()]
    async with MongoMCP() as m:
        return await m.find(AGREEMENTS_COLLECTION, projection={"_id": 0}, limit=limit)


async def reuse_pack(projects: list[str], limit: int = 30) -> list[dict]:
    """The reuse agreement's executable payload: the cited source files for a chosen MEMORY solution —
    the CodeChunks of the grounded project(s) (file_path · web_url · excerpt). Loose-matched on the first
    name token so 'QuantaPay (2024)' finds the 'quantapay-2024' repo's chunks. 'it was built before' →
    'it's already in your branch'."""
    toks = {p.split()[0].split("-")[0].lower() for p in projects if p}
    if not toks:
        return []
    async with MongoMCP() as m:
        rows = await m.find(CODE_COLL, projection={"_id": 0, "project": 1, "file_path": 1, "web_url": 1, "excerpt": 1}, limit=300)
    out = [r for r in rows if str(r.get("project", "")).split("-")[0].lower() in toks]
    return out[:limit]


async def code_chunks_for_project(project: str) -> list[dict]:
    """Living corpus (P7): the stored CodeChunks for a project (by name) — to compare content_hash on re-embed."""
    if demo.is_demo():
        return []
    async with MongoMCP() as m:
        return await m.find(CODE_COLL, query={"project": project}, projection={"_id": 0}, limit=500)


async def upsert_code_chunk(doc: dict) -> None:
    """Living corpus (P7): replace the current chunk for (project, file_path) with the freshly re-embedded one,
    so recall grounds on CURRENT code, not the seed-time snapshot. Demo writes are no-ops."""
    if demo.is_demo():
        return
    async with MongoMCP() as m:
        await m.delete_many(CODE_COLL, {"project": doc.get("project"), "file_path": doc.get("file_path")})
        await m.insert_many(CODE_COLL, [doc])


async def get_agreement(agreement_id: str) -> dict:
    if demo.is_demo():
        return dict(_DEMO_AGREEMENTS.get(agreement_id) or {})
    async with MongoMCP() as m:
        rows = await m.find(AGREEMENTS_COLLECTION, query={"id": agreement_id}, projection={"_id": 0}, limit=1)
    return rows[0] if rows else {}


async def update_agreement(agreement_id: str, patch: dict) -> None:
    if demo.is_demo():
        if agreement_id in _DEMO_AGREEMENTS:
            _DEMO_AGREEMENTS[agreement_id].update(patch)
        return
    async with MongoMCP() as m:
        await m.update_many(AGREEMENTS_COLLECTION, {"id": agreement_id}, {"$set": patch})


# ── Code Graph (System 4): Graph A (nodes/edges) + Graph B (governance rules) ──
GRAPH_NODES_COLL = "GraphNodes"
GRAPH_EDGES_COLL = "GraphEdges"
GOVERNANCE_COLL = "GovernanceRules"

_DEMO_GRAPH_NODES: list[dict] = []  # DEMO in-mem graph (Atlas writes no-op) — the lineage/feature graph lives here
_DEMO_GRAPH_EDGES: list[dict] = []


def reset_demo_graph() -> None:
    """DEMO reset/seed: drop the in-mem graph (lineage/feature nodes + edges) before re-seeding."""
    _DEMO_GRAPH_NODES.clear()
    _DEMO_GRAPH_EDGES.clear()


async def save_graph(nodes: list[dict], edges: list[dict], project_id: str) -> None:
    """Replace the stored Graph A for a project (clear then insert) — a rebuild is idempotent.
    Per-project_id isolation matters: the file graph ('local') and the lineage graph ('lineage') never
    clobber each other, since this only clears the partition it's writing."""
    if demo.is_demo():
        _DEMO_GRAPH_NODES[:] = [n for n in _DEMO_GRAPH_NODES if n.get("project_id") != project_id] + [dict(n) for n in nodes]
        _DEMO_GRAPH_EDGES[:] = [e for e in _DEMO_GRAPH_EDGES if e.get("project_id") != project_id] + [dict(e) for e in edges]
        return
    async with MongoMCP() as m:
        await m.delete_many(GRAPH_NODES_COLL, {"project_id": project_id})
        await m.delete_many(GRAPH_EDGES_COLL, {"project_id": project_id})
        if nodes:
            await m.insert_many(GRAPH_NODES_COLL, nodes)
        if edges:
            await m.insert_many(GRAPH_EDGES_COLL, edges)


async def graph_nodes(project_id: str = "local") -> list[dict]:
    if demo.is_demo():
        return [dict(n) for n in _DEMO_GRAPH_NODES if n.get("project_id") == project_id]
    async with MongoMCP() as m:
        return await m.find(GRAPH_NODES_COLL, query={"project_id": project_id}, projection={"_id": 0}, limit=2000)


async def graph_edges(project_id: str = "local") -> list[dict]:
    if demo.is_demo():
        return [dict(e) for e in _DEMO_GRAPH_EDGES if e.get("project_id") == project_id]
    async with MongoMCP() as m:
        return await m.find(GRAPH_EDGES_COLL, query={"project_id": project_id}, projection={"_id": 0}, limit=5000)


async def add_graph_nodes(nodes: list[dict]) -> None:
    """Append node VERSIONS (bitemporal) WITHOUT clearing the partition — for versioned/incremental writes."""
    if not nodes:
        return
    if demo.is_demo():
        _DEMO_GRAPH_NODES.extend(dict(n) for n in nodes)
        return
    async with MongoMCP() as m:
        await m.insert_many(GRAPH_NODES_COLL, nodes)


async def add_graph_edges(edges: list[dict]) -> None:
    """Append edge VERSIONS (bitemporal) without clearing the partition."""
    if not edges:
        return
    if demo.is_demo():
        _DEMO_GRAPH_EDGES.extend(dict(e) for e in edges)
        return
    async with MongoMCP() as m:
        await m.insert_many(GRAPH_EDGES_COLL, edges)


async def close_graph_node(path: str, project_id: str, patch: dict) -> None:
    """Close the CURRENT (valid_to is None) version of a node path — e.g. {'valid_to': now, 'deleted': True}
    on supersede/tombstone. The old version stays queryable via as_of."""
    if demo.is_demo():
        for n in _DEMO_GRAPH_NODES:
            if n.get("path") == path and n.get("project_id") == project_id and n.get("valid_to") is None:
                n.update(patch)
        return
    async with MongoMCP() as m:
        await m.update_many(GRAPH_NODES_COLL,
                            {"path": path, "project_id": project_id, "valid_to": None}, {"$set": patch})


async def save_governance_rule(doc: dict) -> None:
    async with MongoMCP() as m:
        await m.insert_many(GOVERNANCE_COLL, [doc])


async def all_governance_rules() -> list[dict]:
    async with MongoMCP() as m:
        return await m.find(GOVERNANCE_COLL, projection={"_id": 0}, limit=200)


# ── Capability Profiles (spine refactor): the growing dictionary of AI-discovered work profiles ──
PROFILES_COLL = "Profiles"


async def save_profile(doc: dict) -> None:
    """Upsert a capability profile by id (idempotent — re-discovering a profile updates it)."""
    async with MongoMCP() as m:
        await m.delete_many(PROFILES_COLL, {"id": doc["id"]})
        await m.insert_many(PROFILES_COLL, [doc])


async def all_profiles() -> list[dict]:
    async with MongoMCP() as m:
        return await m.find(PROFILES_COLL, projection={"_id": 0}, limit=200)


async def update_profile(profile_id: str, patch: dict) -> None:
    async with MongoMCP() as m:
        await m.update_many(PROFILES_COLL, {"id": profile_id}, {"$set": patch})


# ── Subscriptions (System 5): watcher → subject event follows (notification fan-out) ──
SUBSCRIPTIONS_COLL = "Subscriptions"


async def save_subscription(doc: dict) -> None:
    """Upsert a watcher→subject subscription (one row per pair)."""
    async with MongoMCP() as m:
        await m.delete_many(SUBSCRIPTIONS_COLL, {"watcher_id": doc["watcher_id"], "subject_id": doc["subject_id"]})
        await m.insert_many(SUBSCRIPTIONS_COLL, [doc])


async def delete_subscription(watcher_id: str, subject_id: str) -> None:
    async with MongoMCP() as m:
        await m.delete_many(SUBSCRIPTIONS_COLL, {"watcher_id": watcher_id, "subject_id": subject_id})


async def subscriptions_of(watcher_id: str) -> list[dict]:
    async with MongoMCP() as m:
        return await m.find(SUBSCRIPTIONS_COLL, query={"watcher_id": watcher_id}, projection={"_id": 0}, limit=200)


async def watchers_of(subject_id: str) -> list[dict]:
    async with MongoMCP() as m:
        return await m.find(SUBSCRIPTIONS_COLL, query={"subject_id": subject_id}, projection={"_id": 0}, limit=200)


NOTIFICATIONS_COLL = "Notifications"
ACCESS_GRANTS_COLL = "AccessGrants"

_DEMO_NOTIFICATIONS: list[dict] = []  # DEMO in-mem feed (Atlas writes no-op) — runtime pings persist here so the bell works


def reset_demo_notifications() -> None:
    """DEMO reset: drop session-generated notifications (the canned feed is added by the inbox endpoint)."""
    _DEMO_NOTIFICATIONS.clear()


async def save_notification(doc: dict) -> None:
    if demo.is_demo():
        _DEMO_NOTIFICATIONS.append(dict(doc))
        return
    async with MongoMCP() as m:
        await m.insert_many(NOTIFICATIONS_COLL, [doc])


async def notifications_for_user(user_id: str, limit: int = 30) -> list[dict]:
    if demo.is_demo():
        return [dict(n) for n in _DEMO_NOTIFICATIONS if n.get("user_id") == user_id][-limit:]
    async with MongoMCP() as m:
        return await m.find(NOTIFICATIONS_COLL, query={"user_id": user_id}, projection={"_id": 0}, limit=limit)


async def mark_all_read(user_id: str) -> None:
    if demo.is_demo():
        for n in _DEMO_NOTIFICATIONS:
            if n.get("user_id") == user_id:
                n["read"] = True
        return
    async with MongoMCP() as m:
        await m.update_many(NOTIFICATIONS_COLL, {"user_id": user_id}, {"$set": {"read": True}})


async def delete_notification(user_id: str, notif_id: str) -> None:
    """Dismiss one of the caller's own notifications (scoped to user_id)."""
    if demo.is_demo():
        _DEMO_NOTIFICATIONS[:] = [n for n in _DEMO_NOTIFICATIONS
                                  if not (n.get("user_id") == user_id and n.get("id") == notif_id)]
        return
    async with MongoMCP() as m:
        await m.delete_many(NOTIFICATIONS_COLL, {"user_id": user_id, "id": notif_id})


async def notification_exists(user_id: str, type: str, ref: dict) -> bool:
    """Dedup: True if an UNREAD notification of this type for this user + ref already exists."""
    if demo.is_demo():
        return any(n.get("user_id") == user_id and n.get("type") == type and not n.get("read")
                   and all((ref or {}).get(k) is None or (n.get("ref") or {}).get(k) == ref[k]
                           for k in ("plan_id", "issue_id"))
                   for n in _DEMO_NOTIFICATIONS)
    q: dict = {"user_id": user_id, "type": type, "read": False}
    for k in ("plan_id", "issue_id"):
        if (ref or {}).get(k) is not None:
            q[f"ref.{k}"] = ref[k]
    async with MongoMCP() as m:
        rows = await m.find(NOTIFICATIONS_COLL, query=q, projection={"_id": 0, "id": 1}, limit=1)
    return bool(rows)


async def dedup_notifications() -> int:
    """One-shot cleanup: collapse duplicates — keep the latest per (user_id, type, ref), drop the rest."""
    async with MongoMCP() as m:
        rows = await m.find(NOTIFICATIONS_COLL,
                            projection={"_id": 0, "id": 1, "user_id": 1, "type": 1, "ref": 1, "created_at": 1}, limit=2000)
        seen: set = set()
        drop: list[str] = []
        for r in sorted(rows, key=lambda x: x.get("created_at", ""), reverse=True):
            ref = r.get("ref") or {}
            key = (r.get("user_id"), r.get("type"), ref.get("plan_id"), ref.get("issue_id"))
            if key in seen:
                drop.append(r["id"])
            else:
                seen.add(key)
        if drop:
            await m.delete_many(NOTIFICATIONS_COLL, {"id": {"$in": drop}})
    return len(drop)


async def save_access_grant(doc: dict) -> None:
    async with MongoMCP() as m:
        await m.insert_many(ACCESS_GRANTS_COLL, [doc])


async def update_access_grant(grant_id: str, patch: dict) -> None:
    async with MongoMCP() as m:
        await m.update_many(ACCESS_GRANTS_COLL, {"id": grant_id}, {"$set": patch})


async def get_access_grant(grant_id: str) -> dict:
    async with MongoMCP() as m:
        rows = await m.find(ACCESS_GRANTS_COLL, query={"id": grant_id}, projection={"_id": 0}, limit=1)
    return rows[0] if rows else {}


async def access_grants_for_subject(subject_id: str) -> list[dict]:
    async with MongoMCP() as m:
        return await m.find(ACCESS_GRANTS_COLL, query={"subject_id": subject_id}, projection={"_id": 0}, limit=100)


async def access_grants_for_requester(requester_id: str) -> list[dict]:
    async with MongoMCP() as m:
        return await m.find(ACCESS_GRANTS_COLL, query={"requester_id": requester_id}, projection={"_id": 0}, limit=100)


TASKS_COLL = "Tasks"  # PascalCase, the Work hub's source of truth (Phase A)
_DEMO_TASKS: dict[str, dict] = {}  # DEMO_MODE in-mem task store — Atlas writes no-op, so the Work hub lives here


def reset_demo_tasks() -> None:
    """DEMO reset/seed: drop every in-mem task so only the freshly re-seeded board's tasks remain."""
    _DEMO_TASKS.clear()


async def save_tasks(docs: list[dict]) -> None:
    if not docs:
        return
    if demo.is_demo():
        for d in docs:
            _DEMO_TASKS[d["id"]] = dict(d)
        return
    async with MongoMCP() as m:
        await m.insert_many(TASKS_COLL, docs)


async def tasks_for_project(project_id: int) -> list[dict]:
    if demo.is_demo():
        return [dict(d) for d in _DEMO_TASKS.values() if d.get("project_id") == project_id]
    async with MongoMCP() as m:
        return await m.find(TASKS_COLL, query={"project_id": project_id}, projection={"_id": 0}, limit=500)


async def all_tasks() -> list[dict]:
    if demo.is_demo():
        return [dict(d) for d in _DEMO_TASKS.values()]
    async with MongoMCP() as m:
        return await m.find(TASKS_COLL, projection={"_id": 0}, limit=10000)  # was 1000 — don't drop tasks at scale


async def get_task(task_id: str) -> dict:
    if demo.is_demo():
        return dict(_DEMO_TASKS.get(task_id) or {})
    async with MongoMCP() as m:
        rows = await m.find(TASKS_COLL, query={"id": task_id}, projection={"_id": 0}, limit=1)
    return rows[0] if rows else {}


async def update_task(task_id: str, doc: dict) -> None:
    if demo.is_demo():
        if task_id in _DEMO_TASKS:
            _DEMO_TASKS[task_id].update(doc)
        return
    async with MongoMCP() as m:
        await m.update_many(TASKS_COLL, {"id": task_id}, {"$set": doc})


async def delete_tasks_for_project(project_id: int) -> None:
    """Drop a project's Tasks — used on dispatch to re-key the plan-time placeholder project_id
    to the real GitLab project_id without leaving ghost docs (Phase A: deviation from the plan)."""
    if demo.is_demo():
        for tid in [k for k, v in _DEMO_TASKS.items() if v.get("project_id") == project_id]:
            _DEMO_TASKS.pop(tid, None)
        return
    async with MongoMCP() as m:
        await m.delete_many(TASKS_COLL, {"project_id": project_id})


EVENTS_COLL = "ChangeEvents"  # append-only change log (calendar + work) driving the reflow engine + the LPG spine

_DEMO_EVENTS: list[dict] = []  # DEMO in-mem event log (Atlas writes no-op) — append-ordered = chronological


def reset_demo_events() -> None:
    """DEMO reset: drop the session event log."""
    _DEMO_EVENTS.clear()


async def save_event(doc: dict) -> None:
    if demo.is_demo():
        _DEMO_EVENTS.append(dict(doc))
        return
    async with MongoMCP() as m:
        await m.insert_many(EVENTS_COLL, [doc])


async def all_events(limit: int = 20000) -> list[dict]:  # was 1000 — the reflow + runtime rebuild need the full log
    if demo.is_demo():
        return [dict(e) for e in _DEMO_EVENTS[-limit:]]
    async with MongoMCP() as m:
        return await m.find(EVENTS_COLL, projection={"_id": 0}, limit=limit)


# ── Durable session state (production): the in-memory workflow dicts (BRIEFS/SPECS/ARCHS/PLANS/RELAYS/
# CHOSEN/SOLUTIONS/RESERVED/DELTA_*/REQA/ATTRIBUTIONS/RESULTS) write THROUGH to here so they survive a
# restart, while the dicts stay the fast read cache (hot paths never hit Mongo). Rehydrated on startup. ──
SESSION_COLL = "SessionState"
_DEMO_SESSION: dict[tuple[str, str], dict] = {}  # DEMO in-mem (store,key) → value (Atlas writes no-op)


def reset_demo_session() -> None:
    """DEMO reset: drop the persisted session snapshot."""
    _DEMO_SESSION.clear()


async def save_state(store: str, key: str, value: dict) -> None:
    """Write-through one session entry (durable). value MUST be JSON-able (model_dump primitives). Cold-path
    only (brief/plan/ratify/dispatch), so the delete+insert upsert cost is fine."""
    if demo.is_demo():
        _DEMO_SESSION[(store, key)] = dict(value)
        return
    async with MongoMCP() as m:
        await m.delete_many(SESSION_COLL, {"store": store, "key": key})
        await m.insert_many(SESSION_COLL, [{"store": store, "key": key, "value": value}])


async def delete_state(store: str, key: str) -> None:
    if demo.is_demo():
        _DEMO_SESSION.pop((store, key), None)
        return
    async with MongoMCP() as m:
        await m.delete_many(SESSION_COLL, {"store": store, "key": key})


async def load_states(store: str) -> dict[str, dict]:
    """All persisted entries for a store → {key: value}, for startup rehydration."""
    if demo.is_demo():
        return {k: dict(v) for (s, k), v in _DEMO_SESSION.items() if s == store}
    async with MongoMCP() as m:
        rows = await m.find(SESSION_COLL, query={"store": store}, projection={"_id": 0}, limit=10000)
    return {r["key"]: r["value"] for r in rows if "key" in r}


RESCHEDULE_COLL = "RescheduleProposals"


async def save_reschedule_proposal(doc: dict) -> None:
    async with MongoMCP() as m:
        await m.insert_many(RESCHEDULE_COLL, [doc])


async def get_reschedule_proposal(proposal_id: str) -> dict:
    async with MongoMCP() as m:
        rows = await m.find(RESCHEDULE_COLL, query={"id": proposal_id}, projection={"_id": 0}, limit=1)
    return rows[0] if rows else {}


async def update_reschedule_proposal(proposal_id: str, patch: dict) -> None:
    async with MongoMCP() as m:
        await m.update_many(RESCHEDULE_COLL, {"id": proposal_id}, {"$set": patch})


async def open_reschedule_proposals() -> list[dict]:
    async with MongoMCP() as m:
        return await m.find(RESCHEDULE_COLL, query={"status": "proposed"}, projection={"_id": 0}, limit=50)


def _parse_docs(text: str) -> list[dict]:
    """The MCP returns a prose line + an EJSON array (wrapped in safety tags)."""
    a, b = text.find("["), text.rfind("]")
    if a == -1 or b == -1:
        return []
    try:
        return json.loads(text[a : b + 1])
    except json.JSONDecodeError:
        return []


# ── Persistent MCP session ──────────────────────────────────────────────────
# The official MongoDB MCP runs as a stdio subprocess (npx). Spawning one per call costs
# ~2-3s, so we keep ONE long-lived session, reused by every `async with MongoMCP()` block
# and serialized by a lock (stdio is a single pipe; demo concurrency is low). Respawns if it dies.
_MCP_PARAMS = StdioServerParameters(
    command="npx", args=["-y", "mongodb-mcp-server", "--connectionString", _URI]
)
_SHARED_SESSION: ClientSession | None = None
_SHARED_STACK: AsyncExitStack | None = None
_MCP_LOCK = asyncio.Lock()


async def _ensure_mcp() -> ClientSession:
    """Lazily start (or reuse) the shared MCP session. Caller must hold _MCP_LOCK."""
    global _SHARED_SESSION, _SHARED_STACK
    if _SHARED_SESSION is None:
        _SHARED_STACK = AsyncExitStack()
        read, write = await _SHARED_STACK.enter_async_context(stdio_client(_MCP_PARAMS))
        _SHARED_SESSION = await _SHARED_STACK.enter_async_context(ClientSession(read, write))
        await _SHARED_SESSION.initialize()
    return _SHARED_SESSION


async def _reset_mcp() -> None:
    """Drop the shared session so the next _ensure_mcp() respawns it (after a transport death)."""
    global _SHARED_SESSION, _SHARED_STACK
    stack, _SHARED_STACK, _SHARED_SESSION = _SHARED_STACK, None, None
    if stack is not None:
        try:
            await stack.aclose()
        except BaseException:
            pass  # ignore stdio teardown races


async def mongo_close() -> None:
    """Close the shared MCP session on app shutdown."""
    await _reset_mcp()


class MongoMCP:
    """Handle to the shared stdio session to the official MongoDB MCP (reused, lock-serialized)."""

    async def __aenter__(self) -> "MongoMCP":
        await _MCP_LOCK.acquire()
        try:
            self.session = await _ensure_mcp()
        except BaseException:
            _MCP_LOCK.release()
            raise
        return self

    async def __aexit__(self, *exc) -> None:
        try:
            # A transport/stream death (not our own RuntimeError/ValueError) → drop the session
            # so the next op respawns it.
            if exc and exc[0] is not None and not issubclass(exc[0], (RuntimeError, ValueError)):
                await _reset_mcp()
        finally:
            _MCP_LOCK.release()

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

    async def _aggregate(self, collection: str, pipeline: list[dict]) -> list[dict]:
        res = await self.session.call_tool("aggregate", {"database": _DB, "collection": collection, "pipeline": pipeline})
        text = "".join(getattr(b, "text", "") or "" for b in res.content)
        if getattr(res, "isError", False):
            raise RuntimeError(f"MongoDB MCP aggregate failed: {text[:200]}")
        return _parse_docs(text)

    async def hybrid_search(
        self, collection: str, vector_index: str, text_index: str, vpath: str,
        query_vec: list[float], query_text: str, k: int = 3, projection: dict | None = None,
    ) -> list[dict]:
        """Hybrid retrieval: native MongoDB $rankFusion (server-side reciprocal rank fusion of
        $vectorSearch + $search full-text). Falls back to vector-only if fusion errors (e.g. the
        full-text index is absent, or the server predates 8.1)."""
        proj: dict = {"_id": 0}
        proj.update(projection or {})
        try:
            return await self._aggregate(collection, [
                {"$rankFusion": {"input": {"pipelines": {
                    "vector": [{"$vectorSearch": {"index": vector_index, "path": vpath, "queryVector": query_vec, "numCandidates": max(50, k * 10), "limit": k * 2}}],
                    "text": [{"$search": {"index": text_index, "text": {"query": query_text, "path": {"wildcard": "*"}}}}, {"$limit": k * 2}],
                }}}},
                {"$limit": k},
                {"$project": proj},
            ])
        except Exception:
            return await self._aggregate(collection, [
                {"$vectorSearch": {"index": vector_index, "path": vpath, "queryVector": query_vec, "numCandidates": max(50, k * 10), "limit": k}},
                {"$project": proj},
            ])

    async def code_search(self, query_vec: list[float], k: int = 5, projection: dict | None = None) -> list[dict]:
        """Code-RAG: vector search over CodeChunks — reusable code across the agency's past repos."""
        proj: dict = {"_id": 0, "project": 1, "file_path": 1, "web_url": 1, "excerpt": 1}
        proj.update(projection or {})
        return await self._aggregate(CODE_COLL, [
            {"$vectorSearch": {"index": CODE_INDEX, "path": "embedding", "queryVector": query_vec, "numCandidates": max(50, k * 10), "limit": k}},
            {"$project": proj},
        ])

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
        if demo.is_demo():
            return '{"acknowledged": true, "demo_noop": true}'  # demo: read-only against the shared DB
        res = await self.session.call_tool(
            "update-many", {"database": _DB, "collection": collection, "filter": query, "update": update}
        )
        text = "".join(getattr(b, "text", "") or "" for b in res.content)
        if getattr(res, "isError", False):
            raise RuntimeError(f"MongoDB MCP update-many failed: {text[:200]}")
        return text

    async def insert_many(self, collection: str, documents: list[dict]) -> str:
        if demo.is_demo():
            return '{"acknowledged": true, "demo_noop": true}'  # demo: read-only against the shared DB
        res = await self.session.call_tool("insert-many", {"database": _DB, "collection": collection, "documents": documents})
        text = "".join(getattr(b, "text", "") or "" for b in res.content)
        if getattr(res, "isError", False):
            raise RuntimeError(f"MongoDB MCP insert-many failed: {text[:200]}")
        return text

    async def delete_many(self, collection: str, query: dict) -> str:
        if demo.is_demo():
            return '{"acknowledged": true, "demo_noop": true}'  # demo: read-only against the shared DB
        res = await self.session.call_tool("delete-many", {"database": _DB, "collection": collection, "filter": query})
        text = "".join(getattr(b, "text", "") or "" for b in res.content)
        if getattr(res, "isError", False):
            raise RuntimeError(f"MongoDB MCP delete-many failed: {text[:200]}")
        return text
