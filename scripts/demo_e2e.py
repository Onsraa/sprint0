"""Live end-to-end demo driver for the sprint0 relay workflow — exercises the gateway endpoints
against a running server (localhost:8000) and LEAVES the GitLab project up.

Run (with the gateway up):  uv run python scripts/demo_e2e.py
  Point it at a DEMO_MODE gateway for a no-cost stubbed walk, or a LIVE one for the real thing.

Walks the CURRENT two-phase flow:
  onboard → brief → clarify → architecture → plan → RESERVE (empty repo, relay stays OPEN) →
  ratify EVERY gate (no auto-approval — the human clears each) → the LAST ratify AUTO-SCAFFOLDS the
  real GitLab project + re-keys the draft tasks → merge + passport promotion → mid-prod feature delta
  → reuse-lineage propagation → post-mortem write-back to agency memory.
"""
import pathlib

import httpx

BASE = "http://localhost:8000"
MANAGER = "Onsraa"                                            # the manager drives intake / reserve / ratify
CONSTRAINTS = {"time_to_market": "fast", "scalability": "medium", "reliability": "standard"}
_BRIEF_FILE = pathlib.Path(__file__).resolve().parents[1] / "seed/sample_briefs/hearthlist.md"
BRIEF = _BRIEF_FILE.read_text() if _BRIEF_FILE.exists() else "Real-estate marketplace; map search; agent CRM; fuzzy new features."
c = httpx.Client(base_url=BASE, timeout=180, headers={"X-Sprint0-User": MANAGER})

_DONE = {"ratified", "auto_passed"}


def _gates(relay: dict) -> str:
    return " · ".join(f"{g['discipline']}:{g['status']}" for g in relay.get("gates", []))


def ratify_all(pid: str) -> dict:
    """Ratify EVERY gate in baton order until the relay clears. No auto-pass — the human clears each;
    the last ratify auto-scaffolds (new project) or extends (delta)."""
    relay = c.get(f"/api/plans/{pid}/relay").json()
    guard = 0
    while relay.get("gates") and not all(g["status"] in _DONE for g in relay["gates"]) and guard < 15:
        for disc in list(relay.get("baton", [])):
            r = c.post(f"/api/plans/{pid}/ratify/{disc}", json={"approve": True, "note": f"{disc} ratified"})
            if r.status_code >= 300:
                print(f"   ⚠ ratify {disc} → {r.status_code} {r.text[:90]}")
                return relay
            relay = r.json()
            print(f"   ✋ {disc} ratified → baton {relay.get('baton') or '(cleared)'}")
        guard += 1
    return relay


def main() -> None:
    # 1) Cold-start onboarding — drop a CV (tolerant: skips if the sample/endpoint is unavailable, or the
    #    GitLab free-tier 5-member cap is hit in LIVE).
    runner = "sprint0-fe"
    cv_file = pathlib.Path("seed/sample_cvs/nia-petrova.md")
    if cv_file.exists():
        try:
            dev = c.post("/api/developers", data={"text": cv_file.read_text()}).json()
            runner = dev.get("gitlab_username", runner)
            print(f"1) onboarded: {dev.get('name')} (@{runner}) — trust: {dev.get('trust_level')}")
        except Exception as e:
            print(f"1) onboard skipped: {str(e)[:80]}")

    # 2) Brief
    bid = c.post("/api/briefs", data={"text": BRIEF}).json()["brief_id"]
    print(f"2) brief: {bid}  ({len(BRIEF)} chars)")

    # 3) Clarify + resolve the ambiguity cards
    spec = c.post(f"/api/briefs/{bid}/clarify", json=CONSTRAINTS).json()
    print(f"3) clarified — goal: {spec.get('goal', '')[:80]}")
    answers = {a["id"]: (a.get("options") or ["(manager specifies)"])[0] for a in spec.get("ambiguities", [])}
    if answers:
        c.post(f"/api/briefs/{bid}/clarify/resolve", json={"answers": answers})
        print(f"   resolved {len(answers)} ambiguity card(s)")

    # 4) Architecture Cards (grounded on past projects) → manager picks one
    cards = c.post(f"/api/briefs/{bid}/architectures", json=CONSTRAINTS).json()["cards"]
    chosen = cards[0]
    print(f"4) {len(cards)} Architecture Cards · picked: {chosen['name']}")

    # 5) Plan DRAFT + the relay
    pr = c.post(f"/api/briefs/{bid}/plan", json={"chosen_stack": chosen["tech_stack"], "constraints": CONSTRAINTS}).json()
    pid, pl = pr["plan_id"], pr["plan"]
    n = sum(len(e["issues"]) for e in pl["epics"])
    print(f"5) plan {pid}: {pl['project_name']} — {len(pl['epics'])} epics / {n} issues")
    print(f"   relay gates: {_gates(pr['relay'])}")

    # 6) RESERVE — phase 1: an empty GitLab repo, the relay stays OPEN (nothing auto-approved)
    rv = c.post(f"/api/plans/{pid}/reserve", json={"project_name": pl["project_name"]}).json()
    gpid = rv["project_id"]
    assert rv.get("relay_open") is True, f"reserve should keep the relay open: {rv}"
    print(f"6) reserved project {gpid} · relay OPEN ({rv.get('web_url', '')})")

    # 7) Ratify every gate — the LAST ratify auto-scaffolds the real GitLab project
    print("7) relay ratification (no auto-approval):")
    ratify_all(pid)

    # 8) Assert the auto-scaffold fired on relay-close
    relay_after = c.get(f"/api/plans/{pid}/relay")
    assert relay_after.status_code == 404, f"relay should be gone after the last ratify, got {relay_after.status_code}"
    proj = next((p for p in c.get("/api/projects").json()["projects"] if p["project_id"] == gpid), None)
    assert proj and proj["status"] in ("in_progress", "active", "shipped"), f"project should have scaffolded: {proj}"
    tasks = [t for t in c.get("/api/work?scope=team").json()["tasks"] if t.get("project_id") == gpid]
    assert tasks, f"work tasks should be re-keyed to the real project {gpid}"
    print(f"8) ✅ auto-scaffolded: relay gone · project '{proj['name']}' → {proj['status']} · {len(tasks)} work tasks re-keyed")

    # 9) Passport promotion — merges grow the runner's per-skill trust
    mg = {}
    for _ in range(3):
        mg = c.post("/api/merge", json={"gitlab_username": runner, "task_type": "frontend:booking", "score": 0.9}).json()
    print(f"9) @{runner} after {len(mg.get('history', []))} merges → trust: {mg.get('trust_level')}"
          + ("  ⬆ PROMOTED" if mg.get("promoted") else ""))

    # 10) Mid-prod feature delta — grounded on the live project; its own relay extends the repo on close
    try:
        feat = c.post(f"/api/projects/{gpid}/features", json={"text": "Add a commission-split calculator with tiered rates.", "constraints": CONSTRAINTS}).json()
        if "plan_id" in feat:
            dpid = feat["plan_id"]
            dn = sum(len(e["issues"]) for e in feat["plan"]["epics"])
            print(f"10) mid-prod delta {dpid}: +{dn} issues, grounded on {feat['plan'].get('grounded_on')}")
            ratify_all(dpid)
            print("    delta relay cleared → extended the existing project")
        else:
            print(f"10) mid-prod skipped: {feat}")
    except Exception as e:
        print(f"10) mid-prod skipped: {str(e)[:90]}")

    # 11) Reuse-lineage — simulate a source change on a reused feature → sync tasks propagate to dependents
    try:
        g = c.get("/api/graph?project_id=lineage").json()
        src = next((nd["path"] for nd in g.get("nodes", []) if nd.get("node_type") == "feature" and not nd.get("ref_project_id")), None)
        if src:
            sim = c.post("/api/lineage/simulate-change", json={"feature_node": src, "summary": "e2e upstream change"}).json()
            print(f"11) lineage: source change on {src} → {sim.get('dependents')} dependents, {len(sim.get('proposed', []))} sync tasks proposed")
    except Exception as e:
        print(f"11) lineage skipped: {str(e)[:90]}")

    # 12) Post-mortem — write the shipped project back into agency memory
    try:
        cl = c.post(f"/api/projects/{gpid}/close", json={"outcome_notes": "Shipped in 9 weeks; map + saved-search reused from memory."}).json()
        print(f"12) post-mortem → agency memory: {cl}")
    except Exception as e:
        print(f"12) post-mortem skipped: {str(e)[:90]}")

    print(f"\n✅ A→Z walk complete. Project {gpid} ({proj['name']}) scaffolded + left up.")
    print("   (clean later: PYTHONPATH=orchestrator uv run python -c \"from app import gitlab; print(gitlab.reset_demo())\")")


if __name__ == "__main__":
    main()
