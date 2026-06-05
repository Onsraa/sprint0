"""The team roster — an in-memory cache of Members (DeveloperProfiles) loaded from MongoDB.

sprint0/Mongo is the source of truth for the team; the manager curates it (seed + CV onboarding).
We cache it in-process because the MongoDB MCP spins up a stdio subprocess per call — too slow to
hit on every authed request. Refresh on startup + after each onboard.
"""
from __future__ import annotations

from app import demo
from app.contracts import DeveloperProfile
from app.rag import DEV_COLL, MongoMCP

_CACHE: dict[str, DeveloperProfile] = {}
_DEMO_EXTRA: list[DeveloperProfile] = []  # devs onboarded live in a demo session (the Atlas write is a no-op)


def _load_demo_cache() -> None:
    """DEMO_MODE: the roster is the canned login team + anyone onboarded this session."""
    from app import canned
    fresh = {m.username: m for m in canned.CANNED_ROSTER}
    for m in _DEMO_EXTRA:
        fresh[m.username] = m
    _CACHE.clear()
    _CACHE.update(fresh)


async def refresh() -> None:
    """(Re)load the roster into the cache. Live: from Mongo (drops the server-side embedding).
    Demo: from CANNED_ROSTER + the in-mem onboarded devs (no Atlas to read)."""
    if demo.is_demo():
        _load_demo_cache()
        return
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


def add_demo_member(member: DeveloperProfile) -> None:
    """DEMO_MODE: onboard a dev into the in-mem roster (the Mongo insert is a no-op in demo)."""
    _DEMO_EXTRA.append(member)
    _CACHE[member.username] = member


def set_demo_discipline(username: str, discipline: str) -> None:
    """DEMO_MODE: seat a member in a discipline + seed a starting (low) per-discipline trust."""
    m = _CACHE.get(username)
    if m:
        m.discipline = discipline  # type: ignore[assignment]
        if discipline and discipline not in m.trust:
            m.trust[discipline] = "low"


def grow_demo_member(gitlab_username: str, task_type: str) -> dict:
    """DEMO_MODE: passport-increment-on-merge against the in-mem roster (record_merge needs Atlas).
    Bumps the merged discipline's trust one tier + appends history; returns the grown profile dict."""
    disc = (task_type or "").split(":")[0].strip().lower() or "backend"
    m = _CACHE.get(gitlab_username) or next(
        (x for x in _CACHE.values() if x.gitlab_username == gitlab_username), None)
    if not m:
        return {}
    nxt = {"low": "medium", "medium": "high", "high": "high"}
    before = m.trust.get(disc, m.trust_level)
    m.trust[disc] = nxt.get(before, "medium")
    m.history.append({"task_type": task_type, "score": 0.85, "via": "sprint0-merge"})
    rank = {"low": 0, "medium": 1, "high": 2}
    m.trust_level = max(m.trust.values(), key=lambda t: rank.get(t, 0), default=m.trust_level)
    out = m.model_dump()
    out["promoted"], out["grew_discipline"] = before != m.trust[disc], disc
    return out


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
