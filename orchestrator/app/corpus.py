"""Living corpus (Living Project Graph P7) — keep the CodeChunks recall corpus FRESH after ship.

Today the corpus is embedded ONCE at seed time and never updated, so memory grounds future plans on stale
code. When a repo changes (a GitLab push/merge), we re-embed only the chunks whose CONTENT actually changed —
content-addressing makes that gating free: same normalized content → same hash → skip the (paid) Voyage call.
The pure planner lives here; the live re-embed + supersede orchestration lives in main.py (it needs GitLab +
Voyage + Atlas, all no-ops in demo).
"""
from __future__ import annotations

from app.graph import normalize_and_hash


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
