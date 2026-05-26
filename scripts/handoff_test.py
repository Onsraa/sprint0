"""Idea 2 verify: scaffold WITH handoff (per-issue .vscode micro-context branches +
QA-only issue), reroute a QA reject, and write a passport-merge to MongoDB. Then reset.
Run: PYTHONPATH=orchestrator uv run python scripts/handoff_test.py"""
import asyncio
import time

from app import gitlab as gl
from app import handoff
from app.canned import CANNED_PLAN
from app.execute import execute_plan
from app.rag import record_merge


async def main() -> None:
    name = f"baton-handoff-{int(time.time())}"
    print(f"scaffolding '{name}' with handoff…")
    res = execute_plan(CANNED_PLAN, project_name=name)  # with_handoff=True
    pid = res["project_id"]
    print(f"✅ {res['web_url']}")
    print(f"   issues: {res['issues_created']} · .vscode context branches: {res['context_branches']} · QA issue iid: {res['qa_issue_iid']}")
    assert res["context_branches"] > 0, "expected per-issue micro-context branches"
    assert res["qa_issue_iid"], "expected a QA-only issue"

    print("simulating a QA reject → re-route…")
    rr = handoff.reroute(pid, res["qa_issue_iid"], "Checkout spins forever on click", to_runner="kira")
    print(f"✅ reroute: {rr}")

    print("recording a merge for @kira (MongoDB WRITE via the MCP)…")
    rec = await record_merge("kira", "backend:websockets", 0.9)
    hist = rec.get("history", [])
    print(f"✅ passport @{rec.get('gitlab_username')} ({rec.get('trust_level')}): {len(hist)} legs, last = {hist[-1] if hist else '—'}")
    assert any(h.get("via") == "baton-merge" for h in hist), "expected the merge to be recorded"

    print(f"reset: {gl.reset_demo()}")
    print("\n✅ Idea 2 slices work: .vscode micro-context branches · QA-only issue · reject→re-route · passport-on-merge")


if __name__ == "__main__":
    asyncio.run(main())
