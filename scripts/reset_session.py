"""Wipe the LIVE *session* — your test relays / briefs / plans / tasks / agreements / notifications — while
KEEPING the agency corpus (PastProjects / CodeChunks / Decisions / DeveloperProfiles / Graph*) — though
session GROWTH on kept profiles (merge history + promoted trust) is reverted to the seed. This is the
fast clean between test runs; a corpus reseed is `scripts/seed_agency.py`. Run via `scripts/reset.sh`.
"""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

REPO = Path(__file__).resolve().parents[1]
load_dotenv(REPO / ".env")
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

# Reuse lineage is SESSION state too — its nodes reference dispatched projects this reset just deleted
# from GitLab, so keeping it leaves stale "derived from this" entries pointing at dead boards.
ln = db["GraphNodes"].delete_many({"project_id": "lineage"}).deleted_count
le = db["GraphEdges"].delete_many({"project_id": "lineage"}).deleted_count
print(f"  wiped lineage graph: {ln} nodes, {le} edges")

# DeveloperProfiles are KEPT corpus but rag.record_merge MUTATES them during a session: it $pushes
# via:"sprint0-merge" history entries (the Passport merge table) and promotes trust tiers. Strip the
# session merges (seeded entries carry no `via`; seed_team starts history at []) and restore the seeded
# trust from team.json. Grown skills_text/skill_embedding (merged-into-a-NEW-discipline edge case) needs
# Voyage to re-embed → that's `--full` reseed territory, not touched here.
mh = db["DeveloperProfiles"].update_many({}, {"$pull": {"history": {"via": "sprint0-merge"}}}).modified_count
team = json.loads((REPO / "seed" / "team.json").read_text())
_rank = {"low": 0, "medium": 1, "high": 2}
for m in [team["manager"], *team["members"]]:
    trust = m.get("trust", {})
    db["DeveloperProfiles"].update_many(
        {"gitlab_username": m["gitlab_username"]},
        {"$set": {"trust": trust, "trust_level": max(trust.values(), key=lambda t: _rank[t], default="low")}})
print(f"  wiped merge history: {mh} profile(s) had session merges; seeded trust tiers restored")

# PastProjects: `Close` post-mortems a shipped project INTO memory (via: "sprint0-postmortem") — the compound
# loop. Great in a session; across a session reset it pollutes the curated agency corpus (the memory judge
# starts offering your closed TEST project as reuse). Seeded repos carry no `via` → untouched.
pp = db["PastProjects"].delete_many({"via": "sprint0-postmortem"}).deleted_count
print(f"  wiped post-mortem PastProjects (test only): {pp}")

print("  corpus kept: " + ", ".join(
    f"{c}={db[c].count_documents({})}" for c in ["PastProjects", "CodeChunks", "Decisions", "DeveloperProfiles"]))
