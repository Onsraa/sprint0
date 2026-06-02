"""Phase 0 smoke test — verifies access to the 3 mandatory services.

Reads `.env`. Each check is INDEPENDENT: an unconfigured service SKIPs (yellow),
so you can re-run after provisioning each one to watch progress.
Phase 0 gate = all three PASS.

Run: uv run python scripts/smoke_test.py
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

load_dotenv()

GREEN, YEL, RED, RST = "\033[32m", "\033[33m", "\033[31m", "\033[0m"


def ok(m: str) -> None:
    print(f"{GREEN}✅ {m}{RST}")


def skip(m: str) -> None:
    print(f"{YEL}⏭  {m}{RST}")


def fail(m: str) -> None:
    print(f"{RED}❌ {m}{RST}")


def check_gitlab() -> str:
    base = os.getenv("GITLAB_BASE_URL", "https://gitlab.com")
    token = os.getenv("GITLAB_TOKEN", "")
    group = os.getenv("GITLAB_DEMO_GROUP", "")
    if not token:
        skip("GitLab: GITLAB_TOKEN not set")
        return "skip"
    import httpx

    try:
        h = {"PRIVATE-TOKEN": token}
        r = httpx.get(f"{base}/api/v4/user", headers=h, timeout=15)
        r.raise_for_status()
        u = r.json()
        ok(f"GitLab: authed as @{u['username']} ({u['name']})")
        if group:
            gr = httpx.get(f"{base}/api/v4/groups/{group}", headers=h, timeout=15)
            if gr.status_code == 200:
                ok(f"GitLab: demo group '{group}' reachable (id {gr.json()['id']})")
            else:
                fail(f"GitLab: group '{group}' not found (HTTP {gr.status_code}) — create it or fix GITLAB_DEMO_GROUP")
                return "fail"
        return "pass"
    except Exception as e:
        fail(f"GitLab: {e}")
        return "fail"


def check_mongo() -> str:
    uri = os.getenv("MONGODB_URI", "")
    if not uri:
        skip("MongoDB: MONGODB_URI not set")
        return "skip"
    db = os.getenv("MONGODB_DB", "sprint0")
    try:
        from pymongo import MongoClient

        c = MongoClient(uri, serverSelectionTimeoutMS=8000)
        c.admin.command("ping")
        cols = c[db].list_collection_names()
        ok(f"MongoDB: ping OK; db '{db}' collections: {cols or '(none yet)'}")
        return "pass"
    except Exception as e:
        fail(f"MongoDB: {e}")
        return "fail"


def check_gemini() -> str:
    # Local dev: Gemini API key (no gcloud / no SA key). Deploy: Vertex via attached SA.
    api_key = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    use_vertex = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in ("1", "true", "yes")
    gen_model = os.getenv("VERTEX_GEMINI_MODEL", "gemini-2.5-flash")
    try:
        from google import genai

        if api_key and not use_vertex:
            mode = "API key"
            client = genai.Client(api_key=api_key)
        elif project:
            mode = "Vertex/ADC"
            client = genai.Client(
                vertexai=True, project=project, location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
            )
        else:
            skip("Gemini: set GEMINI_API_KEY (local) or GOOGLE_CLOUD_PROJECT (Vertex)")
            return "skip"
        g = client.models.generate_content(model=gen_model, contents="Reply with the single word OK.")
        ok(f"Gemini OK [{mode}] ({gen_model}) -> {(g.text or '').strip()[:40]!r}")
        return "pass"
    except Exception as e:
        fail(f"Gemini: {e}")
        return "fail"
    # (embeddings are validated in Phase 2 with the chosen Voyage/Vertex model)


def main() -> int:
    print("-- Phase 0 smoke test --")
    results = {
        "GitLab": check_gitlab(),
        "MongoDB": check_mongo(),
        "Gemini": check_gemini(),
    }
    print("\n-- summary --")
    for k, v in results.items():
        print(f"  {k:8} {v.upper()}")
    failed = [k for k, v in results.items() if v == "fail"]
    skipped = [k for k, v in results.items() if v == "skip"]
    if failed:
        print(f"\n{RED}Phase 0 NOT done — fix: {', '.join(failed)}{RST}")
        return 1
    if skipped:
        print(f"\n{YEL}Partial — still to provision: {', '.join(skipped)}{RST}")
        return 0
    print(f"\n{GREEN}Phase 0 COMPLETE — all three services reachable. Feature work unblocked.{RST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
