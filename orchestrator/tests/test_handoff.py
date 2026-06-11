"""Focus-branch handoff — the micro-context mechanic. Per CODE/INFRA issue, sprint0 cuts a conventional
`feat/<task-title-slug>` branch and commits ONLY the file stubs. The agent docs + reused code are NOT
committed — the docs ride in the server-side context (`render_focus_docs`), reused code is stored as POINTERS
and fetched live by the `/api/focus` endpoint, and the `focus_script` bootstrap materializes everything locally
on checkout, so a merge into main carries nothing sprint0. GitLab is mocked — we assert content, not wire calls."""
import base64
import json

from app import handoff
from app.contracts import ContextScope, Epic, Issue, PlanJSON, TechStack

BR = "feat/b1"   # the focus branch for issue B1 (title "B1" → slug "b1")


class _FakeGL:
    def __init__(self, tree=None, blobs=None):
        self.branches: list[tuple] = []
        self.commits: dict[str, list] = {}   # branch -> [files]
        self._tree = set(tree or [])          # CURRENT files on the default branch
        self._blobs = blobs or {}             # path -> raw content (for the existing-file fetch)

    def create_branch(self, pid, branch, ref="main"):
        self.branches.append((branch, ref))

    def commit_files(self, pid, files, branch, message=""):
        self.commits[branch] = files

    def list_repo_tree(self, pid, ref=None):
        return set(self._tree)

    def get_file_raw(self, pid, path, ref="main"):
        return self._blobs[path]


def _iss(i, kind, files, note="only these matter"):
    return Issue(id=i, title=i, description="d", type="backend", estimate_days=1, risk="low",
                 required_skill="", kind=kind, context_scope=ContextScope(files=files, note=note))


def _plan():
    return PlanJSON(project_name="P", client_summary="", grounded_on=[], timeline_weeks=2,
                    tech_stack=TechStack(frontend="R", backend="Py", db="PG", infra="-"),
                    epics=[Epic(id="e", title="E", issues=[
                        _iss("B1", "code", ["api/auth.py", "api/models.py"]),
                        _iss("D1", "design", ["(figma)"]),           # design → no branch (lives as an issue)
                        _iss("I1", "infra", ["ci/.gitlab-ci.yml"]),
                    ])])


def _one_issue_plan(iss):
    return PlanJSON(project_name="P", client_summary="", grounded_on=[], timeline_weeks=2,
                    tech_stack=TechStack(frontend="R", backend="Py", db="PG", infra="-"),
                    epics=[Epic(id="e", title="E", issues=[iss])])


# ── branch naming: conventional feat/<slug>, not sprint0/<id> ──

def test_branch_name_is_conventional_feat_slug():
    assert handoff.branch_name(_iss("B1", "code", [])) == "feat/b1"
    assert handoff.branch_for("Add Login Endpoint!", "X9") == "feat/add-login-endpoint"
    assert handoff.branch_for("", "X9") == "feat/task-x9"     # empty/garbage title → id fallback


def test_only_code_and_infra_get_a_focus_branch(monkeypatch):
    fake = _FakeGL()
    monkeypatch.setattr(handoff, "gl", fake)
    made = handoff.commit_context_branches(42, _plan())
    assert made == ["feat/b1", "feat/i1"]                        # conventional; the design issue is skipped
    assert [b for b, _ in fake.branches] == ["feat/b1", "feat/i1"]


# ── the branch commits ONLY stubs; docs + reused are never committed ──

def test_commit_carries_only_stubs_no_docs_no_focus_json(monkeypatch):
    fake = _FakeGL()
    monkeypatch.setattr(handoff, "gl", fake)
    handoff.commit_context_branches(42, _plan())
    committed = {f["path"] for f in fake.commits[BR]}
    assert committed == {"api/auth.py", "api/models.py"}        # only the dev's work files
    # none of the old committed artifacts remain (they would merge into main)
    assert not ({".sprint0/focus.json", ".vscode/settings.json", "AGENTS.md", "CLAUDE.md",
                 "CONTEXT.md", "CONTRACT.md"} & committed)


def test_agent_docs_are_docs_only_not_committed():
    """render_focus_docs returns ONLY the doc files (materialized locally), no reused content (the endpoint
    fetches that live) — so merging the branch never overrides the project's own AGENTS.md/CLAUDE.md/etc."""
    docs = handoff.render_focus_docs(_iss("B1", "code", ["api/auth.py"]), [])
    assert set(docs) == {"AGENTS.md", "CLAUDE.md", "CONTEXT.md", "CONTRACT.md", ".vscode/settings.json"}
    assert docs["CLAUDE.md"].strip() == "@AGENTS.md"           # Claude Code import → no duplication, no drift


def test_reuse_pointers_are_never_committed(monkeypatch):
    """commit_context_branches commits ONLY stubs; reuse pointers (passed as reuse_seeds) never land in a commit."""
    fake = _FakeGL()
    monkeypatch.setattr(handoff, "gl", fake)
    ptrs = {"B1": [{"path": ".sprint0/reused/QuantaPay/api/auth.py", "project": "g/QuantaPay", "ref": "main",
                    "src_path": "api/auth.py", "source_project": "QuantaPay", "source_url": "http://x"}]}
    handoff.commit_context_branches(42, _plan(), reuse_seeds=ptrs)
    committed = [f["path"] for f in fake.commits[BR]]
    assert all(not p.startswith(".sprint0/reused/") for p in committed) and "REUSE_MANIFEST.md" not in committed


def test_context_md_strips_semicolons_and_emdashes():
    iss = Issue(id="B1", title="t", description="adds auth; uses JWT — securely", type="backend",
                estimate_days=1, risk="low", required_skill="", kind="code",
                context_scope=ContextScope(files=["api/auth.py"]), does="do x; do y")
    ctx = handoff.render_focus_docs(iss, [])["CONTEXT.md"]
    assert ";" not in ctx and "—" not in ctx


# ── the bootstrap script the gateway serves ──

def test_focus_script_inlines_payload_and_is_swap_safe():
    gen = {"AGENTS.md": "hi\n", ".sprint0/reused/x/app.py": "code\n"}
    script = handoff.focus_script(gen)
    assert script.startswith("#!/usr/bin/env bash")
    blob = script.split('base64.b64decode("', 1)[1].split('")', 1)[0]
    assert json.loads(base64.b64decode(blob)) == gen           # payload round-trips out of the script
    assert ".git/info/exclude" in script                       # keeps the materialized files untracked
    assert ".sprint0/.materialized" in script and "ls-files" in script   # clean prior set + never clobber a tracked file


# ── the dev's GitLab issue body carries the new gateway bootstrap command ──

def test_issue_body_carries_the_gateway_bootstrap_command():
    from app import execute
    body = execute._issue_body(_iss("B1", "code", ["api/auth.py"]))
    assert "git checkout feat/b1 &&" in body and "curl -fsS" in body and "/api/focus/B1?t=" in body


# ── stubs: create missing, header-prepend existing (never overwrite), idempotent ──

def test_stub_creates_missing_focus_files_with_header(monkeypatch):
    fake = _FakeGL()  # empty tree → both focus files are new
    monkeypatch.setattr(handoff, "gl", fake)
    handoff.commit_context_branches(42, _plan())
    stubs = {f["path"]: f for f in fake.commits[BR] if f["path"] in ("api/auth.py", "api/models.py")}
    assert stubs["api/auth.py"]["action"] == "create"
    assert "sprint0 task B1" in stubs["api/auth.py"]["content"]
    assert stubs["api/auth.py"]["content"].startswith("#")   # .py → hash comment


def test_stub_prepends_header_to_existing_file_without_overwrite(monkeypatch):
    body = "def login():\n    return True\n"
    fake = _FakeGL(tree=["api/auth.py"], blobs={"api/auth.py": body})
    monkeypatch.setattr(handoff, "gl", fake)
    handoff.commit_context_branches(42, _plan())
    entry = next(f for f in fake.commits[BR] if f["path"] == "api/auth.py")
    assert entry["action"] == "update"
    assert body in entry["content"]                          # original code preserved verbatim
    assert entry["content"].index("sprint0 task B1") < entry["content"].index("def login")


def test_stub_preserves_shebang_then_header(monkeypatch):
    body = "#!/usr/bin/env python\nprint('hi')\n"
    fake = _FakeGL(tree=["api/auth.py"], blobs={"api/auth.py": body})
    monkeypatch.setattr(handoff, "gl", fake)
    handoff.commit_context_branches(42, _plan())
    entry = next(f for f in fake.commits[BR] if f["path"] == "api/auth.py")
    assert entry["content"].startswith("#!/usr/bin/env python\n")


def test_stub_is_idempotent_when_header_already_present(monkeypatch):
    headered = "# sprint0 task B1 - F\ndef login():\n    return True\n"
    fake = _FakeGL(tree=["api/auth.py"], blobs={"api/auth.py": headered})
    monkeypatch.setattr(handoff, "gl", fake)
    handoff.commit_context_branches(42, _plan())
    paths = [f["path"] for f in fake.commits[BR]]
    assert "api/auth.py" not in paths                        # already headered → skipped


def test_stub_skips_a_focus_file_that_is_also_a_seed_path():
    out = handoff._stub_files(42, _iss("B1", "code", ["api/auth.py", "api/models.py"]),
                              "main", set(), seeded_paths={"api/auth.py"})
    paths = [e["path"] for e in out]
    assert "api/auth.py" not in paths and "api/models.py" in paths


def test_json_focus_file_gets_no_comment_header(monkeypatch):
    fake = _FakeGL()
    monkeypatch.setattr(handoff, "gl", fake)
    handoff.commit_context_branches(42, _one_issue_plan(_iss("B1", "code", ["config/app.json"])))
    entry = next(f for f in fake.commits[BR] if f["path"] == "config/app.json")
    assert entry["content"] == ""


# ── /api/focus endpoint: serves the bootstrap, token-gated ──

def test_focus_endpoint_is_token_gated():
    import asyncio
    import pytest
    from fastapi import HTTPException
    from app import main

    iss = _iss("E9", "code", ["app/x.py"])
    main.FOCUS_CONTEXTS["E9"] = {"docs": handoff.render_focus_docs(iss, []), "reused": []}
    script = asyncio.run(main.focus_bootstrap("E9", t=handoff.focus_token("E9")))   # right token
    assert script.startswith("#!/usr/bin/env bash") and "base64" in script
    with pytest.raises(HTTPException) as bad:
        asyncio.run(main.focus_bootstrap("E9", t="wrong"))
    assert bad.value.status_code == 403                                             # bad token
    with pytest.raises(HTTPException) as missing:
        asyncio.run(main.focus_bootstrap("NOPE", t=""))
    assert missing.value.status_code == 404                                         # unknown task


def test_focus_endpoint_fetches_reused_live(monkeypatch):
    """Reused code is stored as POINTERS; the endpoint fetches each raw file live and inlines it. A fetch that
    raises is skipped (the manifest still cites it)."""
    import asyncio
    from app import main, gitlab

    iss = _iss("E8", "code", ["app/x.py"])
    ptrs = [
        {"path": ".sprint0/reused/proj/app/main.py", "project": "g/proj", "ref": "main", "src_path": "app/main.py",
         "source_project": "proj", "source_url": "http://x"},
        {"path": ".sprint0/reused/dead/gone.py", "project": "g/dead", "ref": "main", "src_path": "gone.py",
         "source_project": "dead", "source_url": "http://y"},
    ]
    main.FOCUS_CONTEXTS["E8"] = {"docs": handoff.render_focus_docs(iss, ptrs), "reused": ptrs}
    monkeypatch.setattr(gitlab, "get_file_raw",
                        lambda project, path, ref="main": ("# RAW" if path == "app/main.py" else _boom()))
    script = asyncio.run(main.focus_bootstrap("E8", t=handoff.focus_token("E8")))
    import base64 as b64, json as j
    gen = j.loads(b64.b64decode(script.split('base64.b64decode("', 1)[1].split('")', 1)[0]))
    assert gen[".sprint0/reused/proj/app/main.py"] == "# RAW"            # fetched + inlined
    assert ".sprint0/reused/dead/gone.py" not in gen                    # failed fetch skipped
    assert ".sprint0/reused/REUSE_MANIFEST.md" in gen                   # manifest still cites both


def _boom():
    raise RuntimeError("source deleted")
