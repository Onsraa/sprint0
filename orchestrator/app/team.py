"""The team roster — an in-memory cache of Members (DeveloperProfiles) loaded from MongoDB.

sprint0/Mongo is the source of truth for the team; the manager curates it (seed + CV onboarding).
We cache it in-process because the MongoDB MCP spins up a stdio subprocess per call — too slow to
hit on every authed request. Refresh on startup + after each onboard.
"""
from __future__ import annotations

from app.contracts import DeveloperProfile
from app.rag import DEV_COLL, MongoMCP

_CACHE: dict[str, DeveloperProfile] = {}


async def refresh() -> None:
    """(Re)load the roster from Mongo into the cache (drops the server-side embedding)."""
    async with MongoMCP() as m:
        rows = await m.find(DEV_COLL, projection={"_id": 0, "skill_embedding": 0}, limit=100)
    fresh: dict[str, DeveloperProfile] = {}
    for r in rows:
        try:
            member = DeveloperProfile(**r)
            fresh[member.username] = member
        except Exception:
            pass  # skip malformed/legacy docs
    _CACHE.clear()
    _CACHE.update(fresh)


async def ensure_loaded() -> None:
    if not _CACHE:
        await refresh()


def get(username: str) -> DeveloperProfile | None:
    return _CACHE.get(username)


def all_members() -> list[DeveloperProfile]:
    return list(_CACHE.values())


def developers() -> list[DeveloperProfile]:
    return [m for m in _CACHE.values() if m.role == "developer"]


def manager() -> DeveloperProfile | None:
    return next((m for m in _CACHE.values() if m.role == "manager"), None)
