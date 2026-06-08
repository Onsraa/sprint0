"""Living Project Graph P5 — semantic near-duplicate detection (pure cosine + pairing)."""
from app import dedup


def test_cosine():
    assert dedup.cosine([1, 0, 0], [1, 0, 0]) == 1.0
    assert dedup.cosine([1, 0, 0], [0, 1, 0]) == 0.0
    assert dedup.cosine([], [1, 2]) == 0.0
    assert round(dedup.cosine([1, 1, 0], [1, 0, 0]), 4) == 0.7071


def test_near_duplicate_pairs_flags_similar_distinct_hashes():
    items = [
        {"path": "feat:a", "title": "QuantaPay JWT auth", "content_hash": "h1", "vector": [1.0, 0.05, 0.0]},
        {"path": "feat:b", "title": "Auth0 OIDC login", "content_hash": "h2", "vector": [0.98, 0.10, 0.0]},  # near a
        {"path": "feat:c", "title": "Plaid ingestion", "content_hash": "h3", "vector": [0.0, 0.0, 1.0]},      # far
    ]
    pairs = dedup.near_duplicate_pairs(items, threshold=0.82)
    assert len(pairs) == 1                                   # only the auth pair
    assert {pairs[0]["a"], pairs[0]["b"]} == {"feat:a", "feat:b"}
    assert pairs[0]["similarity"] >= 0.82


def test_exact_hash_is_not_a_semantic_dup():
    # identical content_hash + identical vector → NOT flagged (content-addressing already collapsed it)
    items = [
        {"path": "p1", "content_hash": "same", "vector": [1.0, 0.0]},
        {"path": "p2", "content_hash": "same", "vector": [1.0, 0.0]},
    ]
    assert dedup.near_duplicate_pairs(items, threshold=0.5) == []
