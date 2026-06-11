"""Wipe the LIVE *session* — your test relays / briefs / plans / tasks / agreements / notifications — while
KEEPING the agency corpus (PastProjects / CodeChunks / Decisions / DeveloperProfiles / Graph*). This is the
fast clean between test runs; a corpus reseed is `scripts/seed_agency.py`. Run via `scripts/reset.sh`.
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
db = MongoClient(os.environ["MONGODB_URI"])[os.getenv("MONGODB_DB", "sprint0")]

# every collection that holds RUNTIME session state (not seeded corpus). SessionState is the rehydration
# source the gateway reads on startup — wiping it is what actually clears the board.
SESSION = ["SessionState", "Tasks", "Agreements", "ChangeEvents", "Notifications",
           "AccessGrants", "RescheduleProposals", "Subscriptions", "ProjectRecords"]
for c in SESSION:
    print(f"  wiped {c}: {db[c].delete_many({}).deleted_count}")

# Decisions: a ratify creates one per gate. Drop YOUR test decisions (project_id is a plan id) but keep the
# seeded graded ones (project_id starts with "seed-") — grade_for grounds memory cards on those.
n = db["Decisions"].delete_many({"project_id": {"$not": {"$regex": "^seed-"}}}).deleted_count
print(f"  wiped Decisions (test only): {n}")

print("  corpus kept: " + ", ".join(
    f"{c}={db[c].count_documents({})}" for c in ["PastProjects", "CodeChunks", "Decisions", "DeveloperProfiles"]))
