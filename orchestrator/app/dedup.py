"""Semantic near-duplicate detection (Living Project Graph P5) — pure cosine over embeddings.

Exact-hash dedup (content-addressing, pillar 2) collapses IDENTICAL code into one node for free. This catches
the other half: two features that do the same thing with DIFFERENT code (different content_hash) — flagged by
embedding similarity so a human can decide to merge. We never auto-merge (no-auto-approval); we propose.
"""
from __future__ import annotations


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


def near_duplicate_pairs(items: list[dict], threshold: float = 0.85) -> list[dict]:
    """items: [{path, title, content_hash, vector}]. Return DISTINCT-content_hash pairs with cosine >=
    threshold, sorted by similarity desc. Exact-hash matches are excluded — those are handled by
    content-addressing, not semantics (this is for same-intent / different-code)."""
    out: list[dict] = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a, b = items[i], items[j]
            ha, hb = a.get("content_hash"), b.get("content_hash")
            if ha and ha == hb:
                continue  # exact duplicate — not a SEMANTIC near-dup
            sim = cosine(a.get("vector") or [], b.get("vector") or [])
            if sim >= threshold:
                out.append({"a": a["path"], "a_title": a.get("title"), "b": b["path"],
                            "b_title": b.get("title"), "similarity": round(sim, 4)})
    return sorted(out, key=lambda p: p["similarity"], reverse=True)
