"""Code Graph (System 4) pure logic — ast import parsing, cycles, traversal, governance/drift."""
import os
import tempfile

from app import graph as G
from app.contracts import GovernanceRule


def _write(root: str, rel: str, content: str) -> None:
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p) or root, exist_ok=True)
    with open(p, "w") as f:
        f.write(content)


def _fixture() -> str:
    """tmp/app: a→b→c→a cycle (+ external `os`), and rogue.py importing governed auth/core.py."""
    app = os.path.join(tempfile.mkdtemp(), "app")
    _write(app, "a.py", "from app.b import x\n")
    _write(app, "b.py", "from app.c import x\n")
    _write(app, "c.py", "from app.a import x\nimport os\n")
    _write(app, "auth/core.py", "x = 1\n")
    _write(app, "rogue.py", "from app.auth.core import x\n")
    return app


def test_build_resolves_internal_imports_skips_external():
    nodes, edges = G.build_python_graph(_fixture())
    assert {"a.py", "b.py", "c.py", "auth/core.py", "rogue.py"} <= {n.path for n in nodes}
    pairs = {(e.from_path, e.to_path) for e in edges}
    assert {("a.py", "b.py"), ("b.py", "c.py"), ("c.py", "a.py"), ("rogue.py", "auth/core.py")} <= pairs
    assert not any(e.to_path == "os" for e in edges)  # stdlib import → no intra-project edge


def test_find_cycles_and_traversal():
    _nodes, edges = G.build_python_graph(_fixture())
    assert any({"a.py", "b.py", "c.py"} <= set(c) for c in G.find_cycles(edges))
    assert {"a.py", "b.py"} <= set(G.dependents_of("c.py", edges))      # a,b transitively import c
    assert {"b.py", "c.py"} <= set(G.dependencies_of("a.py", edges))    # a transitively imports b,c


def test_governance_flags_outside_importer():
    nodes, edges = G.build_python_graph(_fixture())
    rule = GovernanceRule(id="g1", governs_pattern="auth/*", constraint="auth stays in auth/", domain="backend")
    reports = G.check_governance(nodes, edges, [rule])
    assert any("rogue.py" in r.affected_files for r in reports)


def test_drift_reports_has_blocking_cycle_and_drift_governance():
    nodes, edges = G.build_python_graph(_fixture())
    rule = GovernanceRule(id="g1", governs_pattern="auth/*", domain="backend")
    sevs = {r.severity for r in G.drift_reports(nodes, edges, [rule])}
    assert "blocking" in sevs and "drift" in sevs
