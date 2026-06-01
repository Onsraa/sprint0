"""Demo/live mode switch for the hosted hybrid deploy.

The public Cloud Run service runs with `DEMO_MODE=true`: paid Gemini calls and real GitLab
dispatch are swapped for canned output, while the MongoDB MCP RAG path stays LIVE (the partner
showcase). A judge-private magic link `?unlock=<LIVE_UNLOCK_TOKEN>` sets the `X-Sprint0-Live`
header → a request-scoped flag flips THAT session to LIVE (real Vertex + real GitLab).

`DEMO_MODE` defaults to off, so local dev, tests, and demo_e2e keep their current real behavior
unchanged — demo mode is opt-in via env, set only on the public deployment.
"""
from __future__ import annotations

import contextvars
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DEMO_MODE = os.getenv("DEMO_MODE", "").strip().lower() in ("1", "true", "yes")
_TOKEN = os.getenv("LIVE_UNLOCK_TOKEN", "")
_LIVE: contextvars.ContextVar[bool] = contextvars.ContextVar("sprint0_live", default=False)


def set_live(unlocked: bool) -> None:
    """Set the per-request live flag (called by the gateway middleware from the header)."""
    _LIVE.set(unlocked)


def token_ok(supplied: str | None) -> bool:
    """True when the supplied unlock token matches the configured one (and one is configured)."""
    return bool(_TOKEN) and supplied == _TOKEN


def is_live() -> bool:
    """Live when this deploy isn't demo-gated, OR this request presented the unlock token."""
    return (not DEMO_MODE) or _LIVE.get()


def is_demo() -> bool:
    return not is_live()
