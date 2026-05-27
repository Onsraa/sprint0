"""Phase 4 verify: take a PlanJSON and scaffold REAL GitLab infra, then reset.
Uses the canned plan, so it exercises GitLab independently of Mongo/Voyage.
Run: PYTHONPATH=orchestrator uv run python scripts/scaffold_test.py [--keep]"""
import sys
import time

from app.canned import CANNED_PLAN
from app.execute import execute_plan
from app import gitlab as gl


def main() -> None:
    name = f"sprint0-scaffold-{int(time.time())}"
    print(f"scaffolding '{name}' from canned plan ({CANNED_PLAN.project_name})…")
    res = execute_plan(CANNED_PLAN, project_name=name)
    print(f"✅ project: {res['web_url']}")
    print(f"✅ issues created: {res['issues_created']}")

    if "--keep" in sys.argv:
        print("(--keep) leaving the project up for inspection")
        return
    print("resetting demo group…")
    print(f"✅ reset: {gl.reset_demo()}")


if __name__ == "__main__":
    main()
