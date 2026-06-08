"""Living corpus (Living Project Graph P7) — keep the CodeChunks recall corpus FRESH after ship.

Today the corpus is embedded ONCE at seed time and never updated, so memory grounds future plans on stale
code. When a repo changes (a GitLab push/merge), we re-embed only the chunks whose CONTENT actually changed —
content-addressing makes that gating free: same normalized content → same hash → skip the (paid) Voyage call.
The pure planner lives here; the live re-embed + supersede orchestration lives in main.py (it needs GitLab +
Voyage + Atlas, all no-ops in demo).
"""
from __future__ import annotations

import posixpath

from app.graph import _domain_of, normalize_and_hash

# Per-file retrieval metadata (code-RAG routing): language from the extension, discipline from the
# path heuristic — so code_search can filter "backend chunks for the backend gate" server-side.
_LANG_BY_EXT = {
    ".py": "python", ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".css": "css", ".scss": "css", ".html": "html", ".json": "json",
    ".md": "markdown", ".sh": "shell", ".yml": "yaml", ".yaml": "yaml", ".sql": "sql",
}


def language_of(path: str) -> str:
    return _LANG_BY_EXT.get(posixpath.splitext(path.lower())[1], "text")


def discipline_of_path(path: str) -> str:
    """Discipline a file belongs to. css/scss/html → uiux (presentation); everything else inherits the
    graph's domain heuristic (ts/tsx/jsx → frontend, test → qa, docker/infra → devops, else backend)."""
    if path.lower().endswith((".css", ".scss", ".html")):
        return "uiux"
    return _domain_of(path)


def chunk_embed_text(project: str, file_path: str, discipline: str, language: str,
                     summary: str, excerpt: str) -> str:
    """The text a CodeChunk's vector is computed from: metadata header + (optional) prose summary +
    raw-code prefix. Summary first so prose↔prose similarity with the brief dominates; excerpt trimmed
    so total size stays flat vs the old 1500-char composition."""
    lines = [f"{project} · {file_path} · {discipline}/{language}"]
    if summary:
        lines.append(f"SUMMARY: {summary}")
    lines.append(excerpt[:1200])
    return "\n".join(lines)


def plan_reembed(changed_files: list[str], content_by_path: dict[str, str],
                 chunks_by_path: dict[str, dict]) -> tuple[list[str], list[str]]:
    """Decide which changed files need a re-embed. A file is re-embedded only if its new content_hash differs
    from the stored chunk's (or there's no stored chunk); identical content is skipped → no wasted Voyage call,
    no duplicate chunk. Returns (to_embed, unchanged). Pure."""
    to_embed: list[str] = []
    unchanged: list[str] = []
    for f in changed_files:
        content = content_by_path.get(f)
        if content is None:
            continue  # couldn't fetch (deleted / permission) — caller handles via tombstone, not re-embed
        new_hash = normalize_and_hash(content)
        old = chunks_by_path.get(f)
        if old and old.get("content_hash") == new_hash:
            unchanged.append(f)
        else:
            to_embed.append(f)
    return to_embed, unchanged
