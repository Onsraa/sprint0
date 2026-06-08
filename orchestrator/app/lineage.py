"""Living Project Graph — reuse-lineage projection (pure, deterministic, no DB).

A `source_changed` event on a content-addressed feature node → the project instances that DERIVED from it
(inbound `derived_from` edges) → one proposed sync descriptor each. Mirrors `scheduler.reflow`'s shape: a
pure function of (event, nodes, edges) → sorted proposals. Persistence + Task creation live in main.py
(`_project_source_change`). NO-AUTO-APPROVAL: this only DESCRIBES proposals; a human ratifies the tasks.
"""
from __future__ import annotations

from app.contracts import ChangeEvent, GraphEdge, GraphNode
from app.graph import _adjacency, normalize_and_hash


def propagate_source_change(ev: ChangeEvent, nodes: list[GraphNode], edges: list[GraphEdge]) -> list[dict]:
    """Inbound `derived_from` traversal of the changed feature node → one proposal per dependent instance.

    Deterministic (sorted by dependent path). Direct dependents only (one hop): a reuse edge is a direct
    lineage link, not a transitive import chain. Returns descriptors only — no I/O, no Task objects.
    """
    feature = ev.payload.get("feature_node")
    if not feature:
        return []
    derived = [e for e in edges if e.edge_type == "derived_from"]
    rev = _adjacency(derived, reverse=True)          # source feature path → {dependent instance paths}
    by_path = {n.path: n for n in nodes}
    summary = ev.payload.get("summary") or "upstream change"
    out: list[dict] = []
    for dep_path in sorted(rev.get(feature, set())):
        n = by_path.get(dep_path)
        out.append({
            "dependent_path": dep_path,
            "project_id": (n.ref_project_id if n else None),   # the real project the sync task lands on
            "domain": (n.domain if n else "backend"),
            "title": (n.title if n and n.title else dep_path),
            "summary": summary,
        })
    return out


def build_reuse_lineage(*, project_id: int, project_name: str, discipline: str, source_project: str,
                        source_text: str, now: str, existing_features: list[dict]) -> tuple[list[dict], list[dict]]:
    """Pure: a project reused `source_text` (from `source_project`, for `discipline`) → the lineage records to
    persist. CONTENT-ADDRESSED: identical source_text → the SAME feature node (dedup by construction) — a new
    feature node is emitted ONLY when its content_hash isn't already among `existing_features`. The reusing
    project always gets its own instance node + a `derived_from` edge to the (shared) feature. Bitemporally
    stamped (valid_from=now, open-ended). Returns (new_nodes, new_edges)."""
    chash = normalize_and_hash(source_text)
    feat = next((f for f in existing_features
                 if f.get("content_hash") == chash and f.get("ref_project_id") in (None, 0)
                 and f.get("valid_to") is None), None)
    new_nodes: list[dict] = []
    if feat:
        feat_path = feat["path"]
    else:
        feat_path = f"feat:{chash.split(':')[-1][:12]}"
        new_nodes.append({"path": feat_path, "node_type": "feature", "project_id": "lineage", "domain": discipline,
                          "title": f"{source_project} · {discipline}", "content_hash": chash, "ref_project_id": None,
                          "valid_from": now, "valid_to": None, "tx_time": now})
    inst_path = f"proj:{project_id}/{discipline}"
    new_nodes.append({"path": inst_path, "node_type": "feature", "project_id": "lineage", "domain": discipline,
                      "title": f"{project_name} · {discipline}", "content_hash": chash, "ref_project_id": project_id,
                      "valid_from": now, "valid_to": None, "tx_time": now})
    new_edges = [{"from_path": inst_path, "to_path": feat_path, "edge_type": "derived_from", "project_id": "lineage",
                  "valid_from": now, "valid_to": None, "tx_time": now}]
    return new_nodes, new_edges
