"""Reuse layer-2 — 'it was built before' → 'it's already in your branch'. Covers the blob-URL parser,
the focus payload (adapted source files + REUSE_MANIFEST.md ride in build_focus_payload and are materialized
locally by the /api/focus bootstrap, never committed), and the gate→discipline→issue-branch mapping that
builds the seed set. No real GitLab / Vertex is touched."""
import asyncio

from app import gitlab, handoff, main
from app.contracts import ContextScope, Epic, Issue, PlanJSON, SolutionCard, TechStack
from app.rag import project_key


# ── the canonical project key (collision-free; replaces the old lossy first-token match) ──

def test_project_key_normalizes_display_and_slug_to_one_canonical_key():
    assert project_key("QuantaPay (2024)") == "quantapay-2024"   # demo display name
    assert project_key("quantapay-2024") == "quantapay-2024"     # live slug — idempotent
    assert project_key("TrailLog (2025)") == project_key("traillog-2025")


def test_project_key_does_not_collide_distinct_projects():
    # the old `split("-")[0]` collapsed BOTH of these to "quanta" → wrong-project reuse pack
    assert project_key("quanta-pay") != project_key("quanta-ledger")
    assert project_key("quanta-pay") == "quanta-pay"


def test_reuse_pack_demo_never_touches_mongo(monkeypatch):
    # SECURITY/robustness: demo has no Atlas — reuse_pack must short-circuit, never open an MCP session
    from app import rag

    class _Boom:
        def __call__(self, *a, **k):
            raise AssertionError("MongoMCP must not be touched in demo")
    monkeypatch.setattr(rag.demo, "is_demo", lambda: True)
    monkeypatch.setattr(rag, "MongoMCP", _Boom())
    assert asyncio.run(rag.reuse_pack(["QuantaPay (2024)"], discipline="backend")) == []


# ── the blob-URL parser (citation → fetchable coordinates) ──

def test_file_ref_from_blob_url_parses_project_ref_path():
    out = gitlab.file_ref_from_blob_url("https://gitlab.com/sprint0-demo/quantapay-2024/-/blob/main/src/auth/jwt.js")
    assert out == ("sprint0-demo/quantapay-2024", "main", "src/auth/jwt.js")


def test_file_ref_from_blob_url_rejects_non_blob():
    assert gitlab.file_ref_from_blob_url("https://gitlab.com/sprint0-demo/quantapay-2024") is None


def test_file_ref_from_blob_url_strips_query_and_anchor():
    # real GitLab API blob urls carry ?ref_type=heads (and sometimes #Ln) — they must not leak into the file path
    out = gitlab.file_ref_from_blob_url("https://gitlab.com/g/r/-/blob/main/src/a.js?ref_type=heads#L10")
    assert out == ("g/r", "main", "src/a.js")


# ── handoff seeds the branch with the reused files + a manifest ──

def _issue(i, t):
    return Issue(id=i, title=i.upper(), description="d", type=t, estimate_days=1, risk="low",
                 required_skill="", context_scope=ContextScope(files=[f"{i}.py"]))


def _plan(issues):
    return PlanJSON(project_name="HomeHero", client_summary="", grounded_on=[], timeline_weeks=4,
                    tech_stack=TechStack(frontend="React", backend="FastAPI", db="PG", infra="-"),
                    epics=[Epic(id="e1", title="E", issues=issues)])


def _capture_gl(monkeypatch):
    calls = []
    monkeypatch.setattr(handoff.gl, "create_branch", lambda *a, **k: {"name": "b"})
    monkeypatch.setattr(handoff.gl, "commit_files", lambda pid, files, **k: calls.append({"files": files, **k}) or {"commit_sha": "x"})
    return calls


def test_commit_context_branches_with_pointers_commits_only_stubs(monkeypatch):
    calls = _capture_gl(monkeypatch)
    plan = _plan([_issue("b1", "backend")])
    ptrs = {"b1": [{"path": ".sprint0/reused/quantapay-2024/src/auth/jwt.js", "project": "g/quantapay-2024",
                    "ref": "main", "src_path": "src/auth/jwt.js", "source_url": "http://x/blob", "source_project": "quantapay-2024"}]}
    made = handoff.commit_context_branches(1, plan, reuse_seeds=ptrs)
    assert made == ["feat/b1"]
    # reused (pointers) + manifest are NOT committed — the /api/focus endpoint fetches + materializes them
    committed = [f["path"] for c in calls for f in c["files"]]
    assert ".sprint0/reused/quantapay-2024/src/auth/jwt.js" not in committed and "REUSE_MANIFEST.md" not in committed


def test_commit_context_branches_unseeded_issue_has_no_manifest(monkeypatch):
    calls = _capture_gl(monkeypatch)
    plan = _plan([_issue("b1", "backend")])
    handoff.commit_context_branches(1, plan, reuse_seeds={"OTHER": [{"path": "x", "content": "y"}]})
    paths = [f["path"] for f in calls[0]["files"]]
    assert "REUSE_MANIFEST.md" not in paths and all(not p.startswith("reused/") for p in paths)


# ── _build_reuse_pointers: a memory-grounded gate maps blob POINTERS (no fetch/adapt) to its branches ──

def test_build_reuse_pointers_maps_grounded_gate_to_its_issue_branches(monkeypatch):
    async def _reuse_pack(projects, discipline=None, limit=6):
        return [{"web_url": "https://gitlab.com/g/quantapay-2024/-/blob/main/src/a.js", "project": "quantapay-2024"}]

    monkeypatch.setattr(main.demo, "is_demo", lambda: False)
    monkeypatch.setattr(main, "reuse_pack", _reuse_pack)
    monkeypatch.setattr(main, "CHOSEN", {("p1", "backend"): SolutionCard(source="memory", grounded_on=["QuantaPay (2024)"])})

    plan = _plan([_issue("b1", "backend"), _issue("f1", "frontend")])
    ptrs = asyncio.run(main._build_reuse_pointers("p1", plan))
    assert set(ptrs) == {"b1"}                                   # only the backend gate's branch, not frontend
    p = ptrs["b1"][0]
    assert p["path"] == ".sprint0/reused/quantapay-2024/src/a.js"   # namespaced by source project
    assert p["project"] == "g/quantapay-2024" and p["ref"] == "main" and p["src_path"] == "src/a.js"
    assert "content" not in p                                    # POINTER only — content is fetched live at /api/focus


def test_build_reuse_pointers_empty_in_demo(monkeypatch):
    monkeypatch.setattr(main.demo, "is_demo", lambda: True)
    monkeypatch.setattr(main, "CHOSEN", {("p1", "backend"): SolutionCard(grounded_on=["QuantaPay (2024)"])})
    plan = _plan([_issue("b1", "backend")])
    assert asyncio.run(main._build_reuse_pointers("p1", plan)) == {}  # live-only — never spend a reuse_pack in demo


def test_build_reuse_pointers_skips_non_grounded_pick(monkeypatch):
    monkeypatch.setattr(main.demo, "is_demo", lambda: False)
    monkeypatch.setattr(main, "CHOSEN", {("p1", "backend"): SolutionCard(source="ai", grounded_on=[])})  # fresh, not reuse
    plan = _plan([_issue("b1", "backend")])
    assert asyncio.run(main._build_reuse_pointers("p1", plan)) == {}


def test_build_reuse_pointers_skips_gate_with_no_code_issue(monkeypatch):
    # a grounded gate whose only issue is NON-code (design) has no branch to seed → skip BEFORE any fetch/Gemini
    calls = {"reuse_pack": 0}
    async def _rp(projects, discipline=None, limit=6):
        calls["reuse_pack"] += 1
        return [{"web_url": "https://gitlab.com/g/r/-/blob/main/a.js", "project": "r"}]
    monkeypatch.setattr(main.demo, "is_demo", lambda: False)
    monkeypatch.setattr(main, "reuse_pack", _rp)
    design = Issue(id="dz", title="D", description="d", type="design", estimate_days=1, risk="low",
                   required_skill="", context_scope=ContextScope(files=["d"]), kind="design")
    monkeypatch.setattr(main, "CHOSEN", {("p1", design.discipline): SolutionCard(source="memory", grounded_on=["X"])})
    ptrs = asyncio.run(main._build_reuse_pointers("p1", _plan([design])))
    assert ptrs == {} and calls["reuse_pack"] == 0              # skipped before reuse_pack — no wasted GitLab/vector call
