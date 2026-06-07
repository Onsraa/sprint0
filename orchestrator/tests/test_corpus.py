"""Living Project Graph P7 — living corpus: re-embed only content-changed chunks (pure gating)."""
from app import corpus


def test_plan_reembed_skips_unchanged_content_addressed():
    chunks = {
        "a.py": {"file_path": "a.py", "content_hash": corpus.normalize_and_hash("def a(): return 1")},
        "b.py": {"file_path": "b.py", "content_hash": corpus.normalize_and_hash("def b(): return 2")},
    }
    content = {
        "a.py": "def  a():\treturn 1",   # same after normalize → skip (no wasted Voyage call)
        "b.py": "def b(): return 99",      # changed → re-embed
        "c.py": "def c(): return 3",       # brand new file → re-embed
    }
    to_embed, unchanged = corpus.plan_reembed(["a.py", "b.py", "c.py"], content, chunks)
    assert unchanged == ["a.py"]
    assert sorted(to_embed) == ["b.py", "c.py"]


def test_plan_reembed_ignores_unfetchable_files():
    # a file with no fetched content (deleted / permission) is neither re-embedded nor counted
    to_embed, unchanged = corpus.plan_reembed(["x.py"], {}, {})
    assert to_embed == [] and unchanged == []
