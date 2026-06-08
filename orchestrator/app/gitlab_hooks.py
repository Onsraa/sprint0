"""GitLab webhook → sprint0 events (Living Project Graph P6) — the missing INBOUND edge.

`parse_gitlab_event` is a pure mapper from a GitLab webhook payload to normalized sprint0 events; the gateway
(`POST /api/webhooks/gitlab`) verifies the secret, emits them on the spine, and routes a merge on a reused
SOURCE feature into the existing source_changed propagation. This is what turns sprint0 from commanding GitLab
to PERCEIVING it. (`reconcile_gitlab` is the catch-up sweep for missed/dropped webhooks — live-only.)

Payload shapes follow GitLab's webhook docs: merge_request / issue / push hooks each carry `object_kind`,
`project.id`, and `object_attributes`.
"""
from __future__ import annotations


def parse_gitlab_event(object_kind: str, payload: dict) -> list[dict]:
    """Map a GitLab webhook payload → normalized sprint0 events (pure). Returns [] for kinds we don't act on."""
    proj = (payload.get("project") or {}).get("id")
    attrs = payload.get("object_attributes") or {}
    out: list[dict] = []
    if object_kind == "merge_request":
        if attrs.get("action") in ("merge", "merged") or attrs.get("state") == "merged":
            # Who to credit on the passport: sprint0's own `runner:<user>` label (the assigned dev) wins;
            # else the actor who triggered the hook. The gateway resolves it against the roster.
            labels = [(l or {}).get("title", "") for l in (payload.get("labels") or [])]
            runner = next((l.split("runner:", 1)[1] for l in labels if l.startswith("runner:")), "")
            out.append({"kind": "merge", "project_id": proj, "iid": attrs.get("iid"),
                        "title": attrs.get("title", ""), "branch": attrs.get("source_branch", ""),
                        "sha": (attrs.get("last_commit") or {}).get("id", ""),
                        "author": runner or (payload.get("user") or {}).get("username", "")})
    elif object_kind == "issue":
        if attrs.get("action") == "close" or attrs.get("state") == "closed":
            out.append({"kind": "issue_closed", "project_id": proj, "iid": attrs.get("iid")})
    elif object_kind == "push":
        files: list[str] = []
        for c in payload.get("commits") or []:
            files += (c.get("added") or []) + (c.get("modified") or []) + (c.get("removed") or [])
        out.append({"kind": "push", "project_id": proj, "ref": payload.get("ref", ""),
                    "files": sorted(set(files))})
    return out
