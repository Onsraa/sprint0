"""Test isolation — default the WHOLE suite to DEMO_MODE (in-mem stores).

A stray `pytest` run with `MONGODB_URI` pointed at the cloud once wrote test fixtures (`b1`/`f1` draft
tasks + in-flight plans) into the real Atlas, because tests run LIVE by default (`DEMO_MODE` unset →
`is_demo()` is False) and any save_tasks / MongoMCP write then hits whatever `MONGODB_URI` points at.

This autouse fixture forces `DEMO_MODE=True` (+ a clean in-mem slate) for every test, so the suite can
NEVER touch a real DB regardless of `MONGODB_URI`. Tests that genuinely need live behavior override it
explicitly with `monkeypatch.setattr(demo, "DEMO_MODE", False)` (they already do — e.g. test_demo_mode).

The DEMO_MODE default alone is NOT enough: a live-override test (security guards, gate routing) re-enters
the real persistence path, and with `.env`'s `MONGODB_URI` loaded those best-effort `_persist` calls write
canned fixtures (relays m1–m5, REQA project 1) into the REAL dev database. So we ALSO blank `MONGODB_URI`
for every test — MongoMCP then fails fast and the try/except best-effort persists swallow it."""
import pytest

from app import demo, rag


@pytest.fixture(autouse=True)
def _demo_isolation(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    # Live-override tests must never reach a real DB. Belt and suspenders: the env var, rag's import-time
    # copy, AND the import-time _MCP_PARAMS (which baked the connection string into the npx argv) — that
    # last one was the actual leak path that kept writing canned relays (m1–m5) into the real SessionState.
    monkeypatch.setenv("MONGODB_URI", "")
    monkeypatch.setattr(rag, "_URI", "", raising=False)
    if hasattr(rag, "_MCP_PARAMS"):
        monkeypatch.setattr(rag, "_MCP_PARAMS", type(rag._MCP_PARAMS)(command="false", args=[]))
    monkeypatch.setattr(rag, "_SHARED_SESSION", None, raising=False)   # drop any session a prior test opened
    monkeypatch.setattr(rag, "_SHARED_STACK", None, raising=False)
    demo.set_live(False)
    for fn in ("reset_demo_tasks", "reset_demo_session", "reset_demo_projects", "reset_demo_graph",
               "reset_demo_events", "reset_demo_notifications", "reset_demo_agreements"):
        reset = getattr(rag, fn, None)
        if callable(reset):
            try:
                reset()
            except Exception:
                pass
    yield
