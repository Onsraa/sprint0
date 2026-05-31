"""Code Graph (roadmap System 4) — pure static analysis, no DB.

Graph A: parse Python `import`s with the stdlib `ast` into a dependency graph (nodes + edges).
Helpers: cycle detection, transitive dependents/dependencies (planning-time focus branches), and
governance checks (Graph B) → DriftReports. Persistence + endpoints live in rag.py / main.py.

Scope note: Python-only here (TS/tree-sitter deferred); traversal is in-memory BFS (no $graphLookup
needed at demo scale)."""
from __future__ import annotations

import ast
import fnmatch
import os

from app.contracts import DriftReport, GovernanceRule, GraphEdge, GraphNode


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
