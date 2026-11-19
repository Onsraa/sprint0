"""GitLab REST client (gitlab.py) — the create-project collision retry (B1).

A repeated Create of the same brief produces the same slug; GitLab 400s 'path has already been taken'.
create_project_scaffold must retry once with a uniquified name so Create always succeeds."""
from app import gitlab


class _Resp:
    def __init__(self, code, text="", js=None):
        self.status_code, self.text, self._js = code, text, js or {}

    def json(self):
        return self._js

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}: {self.text}")


def test_create_project_retries_on_path_taken(monkeypatch):
    names: list[str] = []

    class _C:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, path, json=None):
            names.append(json["name"])
            if path == "/projects" and len(names) == 1:   # first attempt → collision
                return _Resp(400, "Path has already been taken")
            return _Resp(201, js={"id": 7, "web_url": "u", "default_branch": "main"})

    monkeypatch.setattr(gitlab, "_client", lambda: _C())
    monkeypatch.setattr(gitlab, "_group_id", lambda c, g: 1)

    out = gitlab.create_project_scaffold("freight-tenant-portal")
    assert out["project_id"] == 7
    assert names[0] == "freight-tenant-portal"          # clean first try
    assert names[1].startswith("freight-tenant-portal-") and names[1] != names[0]  # retried, uniquified


def test_create_project_raises_on_a_non_collision_400(monkeypatch):
    class _C:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, path, json=None):
            return _Resp(400, "namespace is invalid")   # not a collision → no retry, surfaces

    monkeypatch.setattr(gitlab, "_client", lambda: _C())
    monkeypatch.setattr(gitlab, "_group_id", lambda c, g: 1)

    try:
        gitlab.create_project_scaffold("x")
        assert False, "should raise"
    except RuntimeError as e:
        assert "400" in str(e)


def test_create_issues_idempotent_reuses_existing_titles(monkeypatch):
    # a retried scaffold (the relay's 'Retry from Dispatch' after a flake) must NOT double-create: an
    # issue whose title already exists is reused (its iid returned), only genuinely new titles are POSTed.
    posted: list[str] = []

    class _C:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, path, params=None):                 # list_issue_titles — one page, one pre-existing issue
            return _Resp(200, js=[{"iid": 5, "title": "[Auth] Existing", "web_url": "u5"}])
        def post(self, path, json=None):
            posted.append(json["title"])
            return _Resp(201, js={"iid": 9, "title": json["title"], "web_url": "u9"})

    monkeypatch.setattr(gitlab, "_client", lambda: _C())
    out = gitlab.create_issues(7, [
        {"title": "[Auth] Existing", "description": "d", "labels": []},   # already there → reuse iid 5
        {"title": "[Auth] New", "description": "d", "labels": []},        # new → POST
    ])
    assert posted == ["[Auth] New"]                       # only the genuinely-new issue created
    assert [o["iid"] for o in out] == [5, 9]              # existing reused (iid map preserved), new created
