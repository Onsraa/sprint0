"""Phase 3 de-risk: does the ADK planner emit a valid PlanJSON? Uses FAKE grounding
(real RAG wired separately in app.rag). Run: PYTHONPATH=orchestrator uv run python scripts/agent_smoke.py"""
import asyncio

from app.agent import generate_plan

PROMPT = """CLIENT BRIEF:
Build a real-estate listings marketplace: buyers browse listings on a map and book
viewings; agents get a CRM; Stripe for premium agent subscriptions. (Messy 14-page PDF.)

SIMILAR PAST PROJECTS (from agency memory):
- zillow-clone-2024 | Next.js / Node / Postgres+PostGIS | est 30d, actual 34d | note: PostGIS geo-queries + map clustering ran long.
- propspot-mvp-2025 | Next.js / Node / Postgres | est 24d, actual 24d | note: reused Stripe deposit holds.

Produce the Sprint-0 plan, grounded in these."""


async def main() -> None:
    plan = await generate_plan(PROMPT)
    n_issues = sum(len(e.issues) for e in plan.epics)
    print(f"✅ project: {plan.project_name!r}")
    print(f"   grounded_on: {plan.grounded_on}")
    print(f"   tech_stack: {plan.tech_stack.model_dump()}")
    print(f"   {len(plan.epics)} epics / {n_issues} issues / timeline {plan.timeline_weeks}w")
    i = plan.epics[0].issues[0]
    print(f"   sample issue: [{i.id}] {i.title} | {i.type}/{i.risk} | skill={i.required_skill}")
    print(f"                 context_scope={i.context_scope.files}")
    assert plan.grounded_on, "expected grounded_on to cite a past project"
    assert all(iss.context_scope.files for e in plan.epics for iss in e.issues), "every issue needs context files"
    print("✅ PlanJSON valid + grounded + micro-contexted")


if __name__ == "__main__":
    asyncio.run(main())
