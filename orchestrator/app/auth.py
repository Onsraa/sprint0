"""Per-account identity (demo-grade). Login = pick your account, no passwords. The session
token IS the username (opaque to the client; resolved here). A FastAPI dependency turns the
token into the caller's Member so every route can scope to "you" — no more "act as" switching.
"""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException

from app import team
from app.contracts import DeveloperProfile


async def current_member(x_sprint0_user: str | None = Header(default=None)) -> DeveloperProfile:
    """Resolve the logged-in Member from the X-Sprint0-User token (= username)."""
    await team.ensure_loaded()
    if not x_sprint0_user:
        raise HTTPException(401, "not logged in")
    member = team.get(x_sprint0_user)
    if member is None:
        raise HTTPException(401, "unknown account — log in again")
    return member


async def current_manager(member: DeveloperProfile = Depends(current_member)) -> DeveloperProfile:
    """Guard manager-only routes (orchestration: brief/plan/dispatch/staffing/onboard)."""
    if not member.is_manager:
        raise HTTPException(403, "manager only")
    return member


async def login(username: str) -> dict:
    """Validate the account exists; hand back the token + the member (no password — demo)."""
    await team.ensure_loaded()
    member = team.get(username)
    if member is None:
        raise HTTPException(404, f"no account '{username}'")
    return {"token": member.username, "member": member.model_dump()}
