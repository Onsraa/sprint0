"""Phase 3 end-to-end verify: real brief → RAG (MongoDB MCP) → ADK planner →
vector-matched, trust-gated assignment. Run:
PYTHONPATH=orchestrator uv run python scripts/reason_test.py"""
import asyncio

from app.reason import run_brief

BRIEF = """A courier startup needs a last-mile delivery tracking app: customers see
the driver's live location on a map with an ETA, drivers upload a proof-of-delivery
photo, and dispatchers get a console to reassign jobs in real time. Realtime is the
whole point. They sent a messy Google Doc."""


async def main() -> None:
    plan = await run_brief(BRIEF)
    n = sum(len(e.issues) for e in plan.epics)
    print(f"✅ {plan.project_name!r} — {len(plan.epics)} epics / {n} issues / {plan.timeline_weeks}w")
    print(f"   grounded_on: {plan.grounded_on}")
    print(f"   tech_stack:  {plan.tech_stack.model_dump()}")
    print("   assignments (issue → assignee · risk · skill):")
    for e in plan.epics:
        for iss in e.issues:
            print(f"     [{iss.id}] {iss.title[:42]:42} → {str(iss.assignee):8} · {iss.risk:6} · {iss.required_skill}")
    assigned = [iss.assignee for e in plan.epics for iss in e.issues if iss.assignee]
    assert plan.grounded_on, "expected grounded_on"
    assert assigned, "expected at least some assignees"
    print(f"\n✅ grounded + {len(assigned)}/{n} issues assigned (vector-matched, trust-gated)")


if __name__ == "__main__":
    asyncio.run(main())
