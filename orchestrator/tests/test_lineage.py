"""Living Project Graph — content-addressed dedup + reuse-lineage propagation (pure logic, no DB)."""
from app import graph as G
from app import lineage as L
from app.contracts import ChangeEvent, GraphEdge, GraphNode


def test_normalize_and_hash_is_content_addressed():
    # identical content, different whitespace → SAME hash (one node, not two) = dedup by construction
    assert G.normalize_and_hash("def f():\n    return 1\n") == G.normalize_and_hash("def  f():\treturn 1")
    # different content → different hash (a fix is a new identity)
    assert G.normalize_and_hash("return 1") != G.normalize_and_hash("return 2")
    assert G.normalize_and_hash("x").startswith("sha256:")


def _lineage():
    """One source feature reused by 3 project instances (3 derived_from edges) under project_id='lineage'."""
    src = GraphNode(path="feat:qpauth0001", node_type="feature", project_id="lineage",
                    title="QuantaPay JWT+TOTP auth", content_hash="sha256:qpauth0001", domain="backend")
    deps = [
        GraphNode(path="proj:atlas/auth", node_type="feature", project_id="lineage",
                  title="Atlas Billing · auth", domain="backend", ref_project_id=4201),
        GraphNode(path="proj:fintrack/auth", node_type="feature", project_id="lineage",
                  title="FinTrack · auth", domain="backend", ref_project_id=4301),
        GraphNode(path="proj:ledger/auth", node_type="feature", project_id="lineage",
                  title="LedgerLite · auth", domain="backend", ref_project_id=4187),
    ]
    edges = [GraphEdge(from_path=d.path, to_path=src.path, edge_type="derived_from", project_id="lineage")
             for d in deps]
    return [src, *deps], edges


def test_propagate_source_change_finds_all_dependents_sorted():
    nodes, edges = _lineage()
    ev = ChangeEvent(id="e1", kind="source_changed", created_at="2026-06-07T00:00:00Z",
                     payload={"feature_node": "feat:qpauth0001", "summary": "rotate refresh-token TTL"})
    out = L.propagate_source_change(ev, nodes, edges)
    assert [p["dependent_path"] for p in out] == sorted(p["dependent_path"] for p in out)  # deterministic
    assert {p["project_id"] for p in out} == {4201, 4301, 4187}                            # real target boards
    assert all(p["summary"] == "rotate refresh-token TTL" for p in out)
    assert len(out) == 3


def test_build_reuse_lineage_dedups_identical_source():
    # Project 4201 reuses source "AAA" → a new feature node + its instance + a derived_from edge
    n1, e1 = L.build_reuse_lineage(project_id=4201, project_name="Atlas", discipline="backend",
                                   source_project="QuantaPay", source_text="def auth(): return 1",
                                   now="2026-06-07T00:00:00Z", existing_features=[])
    feat = [n for n in n1 if n["ref_project_id"] is None]
    assert len(feat) == 1 and len(n1) == 2 and e1[0]["edge_type"] == "derived_from"
    feat_path = feat[0]["path"]

    # Project 4187 reuses the SAME source → NO new feature (deduped), only its instance + edge to the same node
    n2, e2 = L.build_reuse_lineage(project_id=4187, project_name="LedgerLite", discipline="backend",
                                   source_project="QuantaPay", source_text="def  auth():\treturn 1",  # same after normalize
                                   now="2026-06-07T01:00:00Z", existing_features=feat)
    assert all(n["ref_project_id"] is not None for n in n2) and len(n2) == 1   # feature reused, only instance added
    assert e2[0]["to_path"] == feat_path                                       # edge points at the shared feature

    # A DIFFERENT source → a new feature node
    n3, _ = L.build_reuse_lineage(project_id=4163, project_name="BudgetBuddy", discipline="backend",
                                  source_project="Other", source_text="def pay(): return 2",
                                  now="2026-06-07T02:00:00Z", existing_features=feat)
    assert any(n["ref_project_id"] is None for n in n3)                        # distinct content → new feature


def test_propagate_ignores_non_derived_edges_and_unknown_feature():
    nodes, edges = _lineage()
    edges.append(GraphEdge(from_path="x", to_path="feat:qpauth0001", edge_type="import", project_id="lineage"))
    ev = ChangeEvent(id="e2", kind="source_changed", created_at="t", payload={"feature_node": "feat:qpauth0001"})
    assert len(L.propagate_source_change(ev, nodes, edges)) == 3          # the import edge is NOT a dependent
    ev2 = ChangeEvent(id="e3", kind="source_changed", created_at="t", payload={"feature_node": "feat:nope"})
    assert L.propagate_source_change(ev2, nodes, edges) == []             # unknown feature → no proposals
