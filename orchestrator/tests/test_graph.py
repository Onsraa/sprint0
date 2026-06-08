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


# ── Multi-language import graph (seed agency repos → retrieval expansion) ──


def test_js_import_specifiers():
    src = (
        "import express from 'express'\n"
        "import { db } from './db'\n"
        "export { helper } from '../lib/helper'\n"
        "import './styles.css'\n"
        "const stripe = require('./stripeClient')\n"
    )
    specs = G.js_import_specifiers(src)
    assert specs == ["express", "./db", "../lib/helper", "./styles.css", "./stripeClient"]


def test_resolve_js_specifier():
    known = {"payments/stripeClient.js", "models/subscription.js", "lib/rbac.ts", "components/index.tsx"}
    assert G.resolve_js_specifier("./stripeClient", "payments/server.js", known) == "payments/stripeClient.js"
    assert G.resolve_js_specifier("../models/subscription", "payments/server.js", known) == "models/subscription.js"
    assert G.resolve_js_specifier("@/lib/rbac", "pages/admin.tsx", known) == "lib/rbac.ts"
    assert G.resolve_js_specifier("./components", "app.tsx", known) == "components/index.tsx"  # /index fallback
    assert G.resolve_js_specifier("react", "app.tsx", known) is None  # external → no edge


def test_build_import_graph_mixed():
    files = {
        "app/db.py": "import os\n",
        "app/api.py": "from app.db import store\n",
        "server.js": "const db = require('./db')\nconst react = require('react')\n",
        "db.js": "module.exports = {}\n",
        "broken.py": "def (:\n",  # SyntaxError → node, no edges
    }
    nodes, edges = G.build_import_graph(files, "quantapay-2024")
    assert {n.path for n in nodes} == set(files)
    assert all(n.project_id == "quantapay-2024" for n in nodes)
    assert {n.path: n.domain for n in nodes}["app/db.py"] == "backend"
    pairs = {(e.from_path, e.to_path) for e in edges}
    assert pairs == {("app/api.py", "app/db.py"), ("server.js", "db.js")}


def test_one_hop_neighbors():
    edges = [
        {"from_path": "a.js", "to_path": "b.js"},   # a imports b → b is a dependency-neighbor of a
        {"from_path": "c.js", "to_path": "a.js"},   # c imports a → c is a dependent-neighbor of a
        {"from_path": "c.js", "to_path": "d.js"},   # 2 hops from a — must NOT appear
        {"from_path": "a.js", "to_path": "a.js"},   # self — excluded (already in seed set)
    ]
    assert G.one_hop_neighbors({"a.js"}, edges, cap=10) == ["b.js", "c.js"]
    assert G.one_hop_neighbors({"a.js"}, edges, cap=1) == ["b.js"]  # deterministic, capped
    assert G.one_hop_neighbors({"a.js", "b.js", "c.js"}, edges, cap=10) == ["d.js"]
