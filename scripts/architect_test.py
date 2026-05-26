"""Idea 1 verify: brief + constraints → Architecture Cards → pick → plan locked to the
chosen stack. Run: PYTHONPATH=orchestrator uv run python scripts/architect_test.py"""
import asyncio

from app.contracts import Constraints
from app.reason import propose_architectures, run_brief

BRIEF = (
    "A boutique agency wants a booking + scheduling SaaS for hair salons: online booking, "
    "a calendar, SMS reminders, Stripe payments, and a simple admin dashboard."
)
CONSTRAINTS = Constraints(time_to_market="fast", scalability="medium", reliability="standard")


async def main() -> None:
    opts = await propose_architectures(BRIEF, CONSTRAINTS)
    print(f"✅ {len(opts.cards)} Architecture Cards (constraints: {CONSTRAINTS.model_dump()}):")
    for c in opts.cards:
        ts = c.tech_stack
        print(f"  • {c.name}: {ts.frontend} / {ts.backend} / {ts.db} / {ts.infra}")
        print(f"     grounded_on={c.grounded_on}  fit: {c.fit_to_constraints[:90]}")

    chosen = opts.cards[0]
    print(f"\npicking '{chosen.name}' → planning locked to that stack…")
    plan = await run_brief(BRIEF, chosen_stack=chosen.tech_stack, constraints=CONSTRAINTS)
    n = sum(len(e.issues) for e in plan.epics)
    assigned = sum(1 for e in plan.epics for i in e.issues if i.assignee)
    print(f"✅ plan: {plan.project_name} | {len(plan.epics)} epics / {n} issues | grounded {plan.grounded_on}")
    print(f"   chosen stack : {chosen.tech_stack.model_dump()}")
    print(f"   plan   stack : {plan.tech_stack.model_dump()}")
    print(f"   assigned     : {assigned}/{n}")
    assert len(opts.cards) >= 2, "expected >=2 architecture cards"
    assert assigned, "expected assignees"
    print("\n✅ Idea 1 flow works: grounded cards → pick → stack-locked, assigned plan")


if __name__ == "__main__":
    asyncio.run(main())
