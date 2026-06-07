"""Living Project Graph P6 — GitLab webhook → sprint0 event mapping (pure, synthetic payloads)."""
from app import gitlab_hooks as gh


def test_merge_request_merged_maps_to_merge_event():
    payload = {"project": {"id": 4201},
               "object_attributes": {"action": "merge", "iid": 7, "title": "rotate token TTL",
                                     "source_branch": "fix/ttl", "last_commit": {"id": "abc123"}}}
    evs = gh.parse_gitlab_event("merge_request", payload)
    assert evs == [{"kind": "merge", "project_id": 4201, "iid": 7, "title": "rotate token TTL",
                    "branch": "fix/ttl", "sha": "abc123"}]


def test_merge_request_open_is_ignored():
    payload = {"project": {"id": 1}, "object_attributes": {"action": "open", "iid": 9}}
    assert gh.parse_gitlab_event("merge_request", payload) == []          # only a MERGE is a source change


def test_issue_close_maps():
    payload = {"project": {"id": 5}, "object_attributes": {"action": "close", "iid": 12}}
    assert gh.parse_gitlab_event("issue", payload) == [{"kind": "issue_closed", "project_id": 5, "iid": 12}]


def test_push_collects_touched_files_deduped_sorted():
    payload = {"project": {"id": 2}, "ref": "refs/heads/main",
               "commits": [{"added": ["b.py"], "modified": ["a.py"], "removed": []},
                           {"added": [], "modified": ["a.py"], "removed": ["c.py"]}]}
    evs = gh.parse_gitlab_event("push", payload)
    assert evs == [{"kind": "push", "project_id": 2, "ref": "refs/heads/main", "files": ["a.py", "b.py", "c.py"]}]


def test_unknown_kind_is_empty():
    assert gh.parse_gitlab_event("pipeline", {"project": {"id": 1}}) == []
