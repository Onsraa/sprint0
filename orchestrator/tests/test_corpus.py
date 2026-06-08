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


def test_language_of():
    assert corpus.language_of("app/db.py") == "python"
    assert corpus.language_of("src/App.TSX") == "typescript"
    assert corpus.language_of("server.js") == "javascript"
    assert corpus.language_of("styles/main.css") == "css"
    assert corpus.language_of("Dockerfile") == "text"


def test_discipline_of_path():
    assert corpus.discipline_of_path("styles/main.css") == "uiux"
    assert corpus.discipline_of_path("public/index.html") == "uiux"
    assert corpus.discipline_of_path("src/App.tsx") == "frontend"
    assert corpus.discipline_of_path("app/db.py") == "backend"
    assert corpus.discipline_of_path("tests/test_db.py") == "qa"
    assert corpus.discipline_of_path("infra/docker-compose.yml") == "devops"


def test_chunk_embed_text_with_and_without_summary():
    with_s = corpus.chunk_embed_text("quantapay-2024", "payments/stripe.js", "backend", "javascript",
                                     "Stripe Connect payout client.", "const stripe = ...")
    assert with_s.splitlines()[0] == "quantapay-2024 · payments/stripe.js · backend/javascript"
    assert "SUMMARY: Stripe Connect payout client." in with_s
    without = corpus.chunk_embed_text("p", "f.py", "backend", "python", "", "x = 1")
    assert "SUMMARY" not in without
    long = corpus.chunk_embed_text("p", "f.py", "backend", "python", "", "a" * 5000)
    assert len(long.splitlines()[-1]) == 1200  # excerpt capped
