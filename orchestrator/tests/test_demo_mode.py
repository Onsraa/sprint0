"""Demo/live switch (Phase 6 hybrid deploy). Verifies the gate without any live API call."""
import asyncio

from app import agent, canned, demo


def test_demo_off_by_default(monkeypatch):
    # No DEMO_MODE env → always live → existing behavior unchanged.
    monkeypatch.setattr(demo, "DEMO_MODE", False)
    demo.set_live(False)
    assert demo.is_live() is True
    assert demo.is_demo() is False


def test_unlock_token_flips_session_to_live(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    monkeypatch.setattr(demo, "_TOKEN", "s3cret")
    demo.set_live(False)
    assert demo.is_demo() is True              # demo-gated, no unlock yet
    assert demo.token_ok("nope") is False
    assert demo.token_ok("s3cret") is True
    demo.set_live(demo.token_ok("s3cret"))     # what the middleware does
    assert demo.is_live() is True
    demo.set_live(False)


def test_empty_token_never_unlocks(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    monkeypatch.setattr(demo, "_TOKEN", "")    # no token configured
    demo.set_live(False)
    assert demo.token_ok("") is False
    assert demo.token_ok(None) is False


def test_gated_agent_returns_canned_copy_in_demo(monkeypatch):
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    demo.set_live(False)
    plan = asyncio.run(agent.generate_plan("ignored in demo"))
    assert plan.project_name == canned.CANNED_PLAN.project_name
    assert plan is not canned.CANNED_PLAN      # deep copy → downstream mutation can't corrupt the fixture
    demo.set_live(False)


def test_demo_makes_mongo_writes_noop(monkeypatch):
    # Public/demo must be READ-ONLY against the shared Atlas DB. Bypass __init__ so there is no MCP
    # session: the guard must return before any self.session access (else AttributeError).
    from app.rag import MongoMCP
    monkeypatch.setattr(demo, "DEMO_MODE", True)
    demo.set_live(False)
    m = object.__new__(MongoMCP)
    assert "demo_noop" in asyncio.run(m.insert_many("Decisions", [{"x": 1}]))
    assert "demo_noop" in asyncio.run(m.update_many("Decisions", {}, {"$set": {"x": 1}}))
    assert "demo_noop" in asyncio.run(m.delete_many("Decisions", {}))
    demo.set_live(False)
