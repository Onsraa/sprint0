"""Cold-Start onboarding verify: CV → parse → embed → upsert DeveloperProfile (Trust: Low)
in Atlas via the MCP. Cleans up the test profile after. Run:
PYTHONPATH=orchestrator uv run python scripts/onboard_test.py"""
import asyncio
from pathlib import Path

from app.rag import DEV_COLL, MongoMCP
from app.reason import onboard_developer

CV = Path("seed/sample_cvs/nia-petrova.md").read_text()


async def main() -> None:
    prof = await onboard_developer(CV)
    print(f"✅ onboarded: {prof['name']} (@{prof['gitlab_username']}) — trust: {prof['trust_level']}")
    print(f"   skills: {prof['skills_text'][:110]}…")

    async with MongoMCP() as m:
        rows = await m.find(
            DEV_COLL, projection={"_id": 0, "name": 1, "gitlab_username": 1, "trust_level": 1},
            query={"gitlab_username": prof["gitlab_username"]},
        )
        print(f"   in Atlas: {rows}")
        await m.delete_many(DEV_COLL, {"gitlab_username": prof["gitlab_username"]})  # idempotent cleanup
        print("   (cleaned up the test profile)")

    assert rows and rows[0]["trust_level"] == "low", "expected a low-trust profile in Atlas"
    print("\n✅ CV onboarding works: parse → embed → MongoDB insert (Trust: Low)")


if __name__ == "__main__":
    asyncio.run(main())
