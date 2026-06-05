"""Reuse layer-2 — 'it was built before' → 'it's already in your branch'. Covers the blob-URL parser,
the focus-branch seeding (adapted source files + REUSE_MANIFEST.md committed into the dev's branch), and
the gate→discipline→issue-branch mapping that builds the seed set. No real GitLab / Vertex is touched."""
import asyncio

from app import gitlab, handoff, main
from app.contracts import ContextScope, Epic, Issue, PlanJSON, SolutionCard, TechStack


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


def test_commit_context_branches_seeds_reuse(monkeypatch):
    calls = _capture_gl(monkeypatch)
    plan = _plan([_issue("b1", "backend")])
    seeds = {"b1": [{"path": "reused/src/auth/jwt.js", "content": "ADAPTED", "source_url": "http://x/blob", "source_project": "quantapay-2024"}]}
    made = handoff.commit_context_branches(1, plan, reuse_seeds=seeds)
    assert made == ["sprint0/b1"]
    paths = [f["path"] for f in calls[0]["files"]]
    assert "reused/src/auth/jwt.js" in paths and "REUSE_MANIFEST.md" in paths
    manifest = next(f["content"] for f in calls[0]["files"] if f["path"] == "REUSE_MANIFEST.md")
    assert "quantapay-2024" in manifest and "http://x/blob" in manifest


def test_commit_context_branches_unseeded_issue_has_no_manifest(monkeypatch):
    calls = _capture_gl(monkeypatch)
    plan = _plan([_issue("b1", "backend")])
    handoff.commit_context_branches(1, plan, reuse_seeds={"OTHER": [{"path": "x", "content": "y"}]})
    paths = [f["path"] for f in calls[0]["files"]]
    assert "REUSE_MANIFEST.md" not in paths and all(not p.startswith("reused/") for p in paths)


# ── _build_reuse_seeds: a memory-grounded gate maps adapted files to that discipline's branches ──

def test_build_reuse_seeds_maps_grounded_gate_to_its_issue_branches(monkeypatch):
    async def _reuse_pack(projects, limit=6):
        return [{"web_url": "https://gitlab.com/g/quantapay-2024/-/blob/main/src/a.js", "project": "quantapay-2024"}]

    async def _adapt(raw, stack, ctx):
        return f"ADAPTED::{raw}"

    monkeypatch.setattr(main.demo, "is_demo", lambda: False)
    monkeypatch.setattr(main, "reuse_pack", _reuse_pack)
    monkeypatch.setattr(main.gitlab, "get_file_raw", lambda proj, path, ref="main": "RAW")
    monkeypatch.setattr(main, "generate_adapted_code", _adapt)
    monkeypatch.setattr(main, "CHOSEN", {("p1", "backend"): SolutionCard(source="memory", grounded_on=["QuantaPay (2024)"])})

    plan = _plan([_issue("b1", "backend"), _issue("f1", "frontend")])
    seeds = asyncio.run(main._build_reuse_seeds("p1", plan))
    assert set(seeds) == {"b1"}                                  # only the backend gate's branch, not frontend
    assert seeds["b1"][0]["path"] == "reused/src/a.js"
    assert seeds["b1"][0]["content"] == "ADAPTED::RAW"           # fetched then adapted


def test_build_reuse_seeds_empty_in_demo(monkeypatch):
    monkeypatch.setattr(main.demo, "is_demo", lambda: True)
    monkeypatch.setattr(main, "CHOSEN", {("p1", "backend"): SolutionCard(grounded_on=["QuantaPay (2024)"])})
    plan = _plan([_issue("b1", "backend")])
    assert asyncio.run(main._build_reuse_seeds("p1", plan)) == {}  # live-only — never spend a fetch in demo


def test_build_reuse_seeds_skips_non_grounded_pick(monkeypatch):
    monkeypatch.setattr(main.demo, "is_demo", lambda: False)
    monkeypatch.setattr(main, "CHOSEN", {("p1", "backend"): SolutionCard(source="ai", grounded_on=[])})  # fresh, not reuse
    plan = _plan([_issue("b1", "backend")])
    assert asyncio.run(main._build_reuse_seeds("p1", plan)) == {}


def test_build_reuse_seeds_skips_gate_with_no_code_issue(monkeypatch):
    # a grounded gate whose only issue is NON-code (design) has no branch to seed → skip BEFORE any fetch/Gemini
    calls = {"reuse_pack": 0}
    async def _rp(projects, limit=6):
        calls["reuse_pack"] += 1
        return [{"web_url": "https://gitlab.com/g/r/-/blob/main/a.js", "project": "r"}]
    monkeypatch.setattr(main.demo, "is_demo", lambda: False)
    monkeypatch.setattr(main, "reuse_pack", _rp)
    design = Issue(id="dz", title="D", description="d", type="design", estimate_days=1, risk="low",
                   required_skill="", context_scope=ContextScope(files=["d"]), kind="design")
    monkeypatch.setattr(main, "CHOSEN", {("p1", design.discipline): SolutionCard(source="memory", grounded_on=["X"])})
    seeds = asyncio.run(main._build_reuse_seeds("p1", _plan([design])))
    assert seeds == {} and calls["reuse_pack"] == 0              # skipped before the fetch — no wasted Vertex/GitLab
