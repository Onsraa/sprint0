"""Code Graph (roadmap System 4) — pure static analysis, no DB.

Graph A: parse Python `import`s with the stdlib `ast` into a dependency graph (nodes + edges).
Helpers: cycle detection, transitive dependents/dependencies (planning-time focus branches), and
governance checks (Graph B) → DriftReports. Persistence + endpoints live in rag.py / main.py.

Scope note: Python-only here (TS/tree-sitter deferred); traversal is in-memory BFS (no $graphLookup
needed at demo scale)."""
from __future__ import annotations

import ast
import fnmatch
import hashlib
import os
import posixpath
import re

from app.contracts import DriftReport, GovernanceRule, GraphEdge, GraphNode


def normalize_and_hash(content: str) -> str:
    """Content-addressed identity (Living Project Graph, pillar 2): collapse whitespace, sha256 → a stable id.
    EXACT-match only — identical normalized content yields the SAME hash → one node, N reuse edges, no
    duplication. Near-duplicate / semantically-equal-but-different code is explicitly out of scope."""
    norm = " ".join(content.split())
    return f"sha256:{hashlib.sha256(norm.encode('utf-8')).hexdigest()[:16]}"


def _domain_of(path: str) -> str:
    p = path.lower()
    if "front" in p or p.endswith((".tsx", ".ts", ".jsx")):
        return "frontend"
    if "test" in p:
        return "qa"
    if "deploy" in p or "infra" in p or "docker" in p:
        return "devops"
    return "backend"


def build_python_graph(root_dir: str, project_id: str = "local") -> tuple[list[GraphNode], list[GraphEdge]]:
    """Walk `root_dir` for .py files; resolve intra-package imports to file paths → nodes + edges.
    Node paths are relative to root_dir (posix). External imports (stdlib/3rd-party) produce no edge."""
    root_dir = os.path.abspath(root_dir)
    pkg = os.path.basename(root_dir)  # e.g. "app" → resolves `from app.rag import ...`
    files: list[str] = []
    for dp, _dn, fns in os.walk(root_dir):
        for fn in fns:
            if fn.endswith(".py"):
                files.append(os.path.join(dp, fn))

    def rel(p: str) -> str:
        return os.path.relpath(p, root_dir).replace(os.sep, "/")

    known = {rel(p) for p in files}

    def module_to_rel(mod: str) -> str | None:
        parts = mod.split(".")
        if parts and parts[0] == pkg:
            parts = parts[1:]
        if not parts:
            return None
        for cand in ("/".join(parts) + ".py", "/".join(parts) + "/__init__.py"):
            if cand in known:
                return cand
        return None

    nodes: list[GraphNode] = []
    targets_by_file: dict[str, set[str]] = {}
    for p in files:
        r = rel(p)
        try:
            src = open(p, encoding="utf-8").read()
            tree = ast.parse(src)
        except (OSError, SyntaxError):
            continue
        nodes.append(GraphNode(path=r, domain=_domain_of(r), loc=src.count("\n") + 1, project_id=project_id))
        targets: set[str] = set()
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                for a in n.names:
                    t = module_to_rel(a.name)
                    if t and t != r:
                        targets.add(t)
            elif isinstance(n, ast.ImportFrom):
                if n.level and n.level > 0:  # relative import: resolve against this file's dir
                    base = os.path.dirname(r)
                    for _ in range(n.level - 1):
                        base = os.path.dirname(base)
                    mod_parts = n.module.split(".") if n.module else []
                    stem = "/".join([x for x in [base, *mod_parts] if x])
                    for cand in (f"{stem}.py", f"{stem}/__init__.py"):
                        if cand in known and cand != r:
                            targets.add(cand)
                    for a in n.names:  # `from . import sibling`
                        c = "/".join([x for x in [base, *mod_parts, a.name] if x]) + ".py"
                        if c in known and c != r:
                            targets.add(c)
                elif n.module:
                    t = module_to_rel(n.module)
                    if t and t != r:
                        targets.add(t)
                    for a in n.names:  # `from app.pkg import submodule`
                        t2 = module_to_rel(f"{n.module}.{a.name}")
                        if t2 and t2 != r:
                            targets.add(t2)
        targets_by_file[r] = targets

    edges = [GraphEdge(from_path=r, to_path=t, edge_type="import", project_id=project_id)
             for r, ts in targets_by_file.items() for t in sorted(ts)]
    return nodes, edges


# ── Multi-language import graph from an in-memory file set (seed agency repos) ──────────────
# Built from the {path: content} dict push_dir already produced — never re-walks disk (seed dirs can
# contain a venv/), and guarantees edge paths are byte-identical to CodeChunks.file_path.
_JS_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
_JS_IMPORT_RES = [
    re.compile(r"""(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]"""),  # import x from / export {x} from
    re.compile(r"""import\s*['"]([^'"]+)['"]"""),                          # side-effect import './x'
    re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)"""),                  # CommonJS require('./x')
]


def js_import_specifiers(src: str) -> list[str]:
    """All import specifiers in a JS/TS source (order-preserving, deduped)."""
    out: list[str] = []
    for rx in _JS_IMPORT_RES:
        for m in rx.finditer(src):
            if m.group(1) not in out:
                out.append(m.group(1))
    return out


def resolve_js_specifier(spec: str, from_path: str, known: set[str]) -> str | None:
    """Resolve a JS/TS import specifier to a repo-relative file path. Only './', '../' and the
    '@/' root alias resolve; bare specifiers (react, express) are external → None."""
    if spec.startswith("@/"):
        stem = spec[2:]
    elif spec.startswith(("./", "../")):
        stem = posixpath.normpath(posixpath.join(posixpath.dirname(from_path), spec))
    else:
        return None
    if stem in known:
        return stem
    for ext in _JS_EXTS:
        if f"{stem}{ext}" in known:
            return f"{stem}{ext}"
    for ext in _JS_EXTS:
        if f"{stem}/index{ext}" in known:
            return f"{stem}/index{ext}"
    return None


def _py_targets(src: str, r: str, known: set[str]) -> set[str]:
    """Python import targets for one file, resolved against the repo-root-relative `known` set.
    Absolute modules map directly (`from app.db import x` → app/db.py — paths ARE repo-relative, no
    package-prefix stripping); relative imports walk up from the file's dir (same as build_python_graph)."""
    def module_to_rel(mod: str) -> str | None:
        stem = mod.replace(".", "/")
        for cand in (f"{stem}.py", f"{stem}/__init__.py"):
            if cand in known:
                return cand
        return None

    targets: set[str] = set()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return targets
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                t = module_to_rel(a.name)
                if t and t != r:
                    targets.add(t)
        elif isinstance(n, ast.ImportFrom):
            if n.level and n.level > 0:  # relative import: resolve against this file's dir
                base = posixpath.dirname(r)
                for _ in range(n.level - 1):
                    base = posixpath.dirname(base)
                mod_parts = n.module.split(".") if n.module else []
                stem = "/".join([x for x in [base, *mod_parts] if x])
                for cand in (f"{stem}.py", f"{stem}/__init__.py"):
                    if cand in known and cand != r:
                        targets.add(cand)
                for a in n.names:  # `from . import sibling`
                    c = "/".join([x for x in [base, *mod_parts, a.name] if x]) + ".py"
                    if c in known and c != r:
                        targets.add(c)
            elif n.module:
                t = module_to_rel(n.module)
                if t and t != r:
                    targets.add(t)
                for a in n.names:  # `from app.pkg import submodule`
                    t2 = module_to_rel(f"{n.module}.{a.name}")
                    if t2 and t2 != r:
                        targets.add(t2)
    return targets


def build_import_graph(files: dict[str, str], project_id: str) -> tuple[list[GraphNode], list[GraphEdge]]:
    """Nodes + import edges from an in-memory {repo-relative path: content} file set.
    .py via AST, JS/TS via regex specifiers; unparseable/unresolvable imports yield a node, no edge."""
    known = set(files)
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    for r in sorted(files):
        src = files[r]
        nodes.append(GraphNode(path=r, domain=_domain_of(r), loc=src.count("\n") + 1, project_id=project_id))
        if r.endswith(".py"):
            targets = _py_targets(src, r, known)
        elif r.endswith(_JS_EXTS):
            targets = {t for s in js_import_specifiers(src)
                       if (t := resolve_js_specifier(s, r, known)) and t != r}
        else:
            continue
        edges.extend(GraphEdge(from_path=r, to_path=t, edge_type="import", project_id=project_id)
                     for t in sorted(targets))
    return nodes, edges


def one_hop_neighbors(paths: set[str], edges: list[dict], cap: int) -> list[str]:
    """1-hop import neighbors (both directions) of `paths` over raw edge dicts — the retrieval-expansion
    primitive (deliberately NOT the transitive dependents_of/dependencies_of BFS)."""
    nbrs: set[str] = set()
    for e in edges:
        a, b = e.get("from_path"), e.get("to_path")
        if a in paths and b and b not in paths:
            nbrs.add(b)
        if b in paths and a and a not in paths:
            nbrs.add(a)
    return sorted(nbrs)[: max(cap, 0)]


def _adjacency(edges: list[GraphEdge], reverse: bool = False) -> dict[str, set[str]]:
    adj: dict[str, set[str]] = {}
    for e in edges:
        a, b = (e.to_path, e.from_path) if reverse else (e.from_path, e.to_path)
        adj.setdefault(a, set()).add(b)
    return adj


def find_cycles(edges: list[GraphEdge]) -> list[list[str]]:
    """Return import cycles (each a path list), deduped by their node set. DFS back-edge detection."""
    adj = _adjacency(edges)
    color: dict[str, int] = {}  # 0 unseen, 1 in-stack, 2 done
    stack: list[str] = []
    cycles: list[list[str]] = []
    seen_sets: set[frozenset[str]] = set()

    def dfs(u: str) -> None:
        color[u], _ = 1, stack.append(u)
        for v in sorted(adj.get(u, ())):
            if color.get(v, 0) == 1:
                cyc = stack[stack.index(v):]
                key = frozenset(cyc)
                if key not in seen_sets:
                    seen_sets.add(key)
                    cycles.append([*cyc, v])
            elif color.get(v, 0) == 0:
                dfs(v)
        color[u] = 2
        stack.pop()

    for node in list(adj):
        if color.get(node, 0) == 0:
            dfs(node)
    return cycles


def _bfs(start: str, adj: dict[str, set[str]]) -> list[str]:
    seen: set[str] = set()
    queue = [start]
    while queue:
        x = queue.pop()
        for nb in adj.get(x, ()):
            if nb not in seen:
                seen.add(nb)
                queue.append(nb)
    return sorted(seen)


def dependents_of(path: str, edges: list[GraphEdge]) -> list[str]:
    """Files that (transitively) import `path` — who breaks if it changes."""
    return _bfs(path, _adjacency(edges, reverse=True))


def dependencies_of(path: str, edges: list[GraphEdge]) -> list[str]:
    """Files `path` (transitively) imports — the focus-branch set for work touching it."""
    return _bfs(path, _adjacency(edges))


def check_governance(nodes: list[GraphNode], edges: list[GraphEdge],
                     rules: list[GovernanceRule]) -> list[DriftReport]:
    """Graph A × Graph B: flag files OUTSIDE a governed pattern that import a governed file."""
    paths = [n.path for n in nodes]
    out: list[DriftReport] = []
    for r in rules:
        governed = {p for p in paths if fnmatch.fnmatch(p, r.governs_pattern)}
        if not governed or not r.forbid_importers_outside:
            continue
        violators = sorted({
            e.from_path for e in edges
            if e.to_path in governed and e.from_path not in governed
            and not fnmatch.fnmatch(e.from_path, r.governs_pattern)
        })
        if violators:
            out.append(DriftReport(
                severity="drift", drift_from_decision_id=r.decision_id,
                drift_from_description=r.constraint or f"governed scope {r.governs_pattern}",
                affected_files=violators,
                violation=f"{len(violators)} file(s) reach into {r.governs_pattern} from outside"[:50],
                suggested_fix=f"Route through the {r.domain} module boundary"[:100],
                effort="medium", domain=r.domain))
    return out


def drift_reports(nodes: list[GraphNode], edges: list[GraphEdge],
                  rules: list[GovernanceRule]) -> list[DriftReport]:
    """All drift: import cycles (blocking) + governance violations (drift)."""
    reports: list[DriftReport] = []
    for cyc in find_cycles(edges):
        reports.append(DriftReport(
            severity="blocking", drift_from_description="circular import dependency",
            affected_files=sorted(set(cyc)), violation=(" → ".join(cyc))[:50],
            suggested_fix="Break the cycle (extract shared code or invert a dependency)"[:100],
            effort="medium", domain=_domain_of(cyc[0]) if cyc else "backend"))
    reports.extend(check_governance(nodes, edges, rules))
    return reports
