"""Test isolation — default the WHOLE suite to DEMO_MODE (in-mem stores).

A stray `pytest` run with `MONGODB_URI` pointed at the cloud once wrote test fixtures (`b1`/`f1` draft
tasks + in-flight plans) into the real Atlas, because tests run LIVE by default (`DEMO_MODE` unset →
`is_demo()` is False) and any save_tasks / MongoMCP write then hits whatever `MONGODB_URI` points at.

This autouse fixture forces `DEMO_MODE=True` (+ a clean in-mem slate) for every test, so the suite can
NEVER touch a real DB regardless of `MONGODB_URI`. Tests that genuinely need live behavior override it
explicitly with `monkeypatch.setattr(demo, "DEMO_MODE", False)` (they already do — e.g. test_demo_mode)."""
import pytest

from app import demo, rag


@pytest.fixture(autouse=True)
def _demo_isolation(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
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
