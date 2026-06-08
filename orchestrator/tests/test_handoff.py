"""Focus-branch handoff — the micro-context mechanic. Per CODE/INFRA issue, sprint0 cuts a
`sprint0/<id>` branch carrying `.sprint0/focus.json` (the sparse-checkout list) + `.vscode/settings.json`
(+ adapted reuse seeds). The `.sprint0/focus.sh` script lives on the default branch (execute._FOCUS_SH),
so `git checkout sprint0/<id> && bash .sprint0/focus.sh` collapses the worktree to just the slice.
GitLab is mocked — we assert the branch names + committed file CONTENT, not the wire calls."""
import json

from app import handoff
from app.contracts import ContextScope, Epic, Issue, PlanJSON, TechStack


class _FakeGL:
    def __init__(self):
        self.branches: list[tuple] = []
        self.commits: dict[str, list] = {}   # branch -> [files]

    def create_branch(self, pid, branch, ref="main"):
        self.branches.append((branch, ref))

    def commit_files(self, pid, files, branch, message=""):
        self.commits[branch] = files


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


def test_only_code_and_infra_get_a_focus_branch(monkeypatch):
    fake = _FakeGL()
    monkeypatch.setattr(handoff, "gl", fake)
    made = handoff.commit_context_branches(42, _plan())
    assert made == ["sprint0/b1", "sprint0/i1"]                       # lowercased; the design issue is skipped
    assert [b for b, _ in fake.branches] == ["sprint0/b1", "sprint0/i1"]


def test_focus_branch_carries_focus_json_and_vscode(monkeypatch):
    fake = _FakeGL()
    monkeypatch.setattr(handoff, "gl", fake)
    handoff.commit_context_branches(42, _plan())
    files = {f["path"]: f["content"] for f in fake.commits["sprint0/b1"]}
    assert ".sprint0/focus.json" in files and ".vscode/settings.json" in files
    assert json.loads(files[".sprint0/focus.json"]) == {
        "issue": "B1", "files": ["api/auth.py", "api/models.py"], "note": "only these matter"}
    assert json.loads(files[".vscode/settings.json"])["sprint0.contextScope"] == ["api/auth.py", "api/models.py"]


def test_reuse_seeds_commit_adapted_code_plus_manifest(monkeypatch):
    fake = _FakeGL()
    monkeypatch.setattr(handoff, "gl", fake)
    seeds = {"B1": [{"path": "api/auth.py", "content": "# reused", "source_project": "QuantaPay", "source_url": "http://x"}]}
    handoff.commit_context_branches(42, _plan(), reuse_seeds=seeds)
    paths = [f["path"] for f in fake.commits["sprint0/b1"]]
    assert "api/auth.py" in paths and "REUSE_MANIFEST.md" in paths   # the reused file is committed INTO the branch


def test_issue_body_carries_the_focus_checkout_command():
    """The dev's GitLab issue tells them exactly how to focus: checkout the branch + run focus.sh + open."""
    from app import execute
    body = execute._issue_body(_iss("B1", "code", ["api/auth.py"]))
    assert "git checkout sprint0/b1 && bash .sprint0/focus.sh && code ." in body
