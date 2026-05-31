"""Live end-to-end demo driver for the sprint0 RELAY workflow — exercises every gateway
endpoint against a running server (localhost:8000) and LEAVES the GitLab project up.

Run (with the gateway up):  uv run python scripts/demo_e2e.py

Walks the full brief→ship relay: onboard → brief → CLARIFY → architecture → plan DRAFT →
Trust-Dial auto-pass → per-discipline ratification → dispatch (real GitLab + focus branches)
→ layered QA (agent prefill + reject→re-QA loop) → merge + passport promotion → mid-prod
feature add (delta) → post-mortem write-back to agency memory.
"""
import pathlib

import httpx

BASE = "http://localhost:8000"
CONSTRAINTS = {"time_to_market": "fast", "scalability": "medium", "reliability": "standard"}
_BRIEF_FILE = pathlib.Path(__file__).resolve().parents[1] / "seed/sample_briefs/hearthlist.md"
BRIEF = _BRIEF_FILE.read_text() if _BRIEF_FILE.exists() else "Real-estate marketplace; map search; agent CRM; fuzzy new features."
c = httpx.Client(base_url=BASE, timeout=180)

_DONE = {"ratified", "auto_passed"}


def _gates(relay: dict) -> str:
    return " · ".join(f"{g['discipline']}:{g['status']}" for g in relay["gates"])


def drive_relay(pid: str, dial: int = 70) -> dict:
    """Set the Trust Dial (auto-pass safe gates), then ratify whatever still holds the baton."""
    relay = c.post(f"/api/plans/{pid}/relay/auto", json={"dial": dial}).json()
    print(f"   dial={dial} → {_gates(relay)}")
    auto = [g["discipline"] for g in relay["gates"] if g["status"] == "auto_passed"]
    if auto:
        print(f"   auto-passed (trust cleared risk): {auto}")
    guard = 0
    while not all(g["status"] in _DONE for g in relay["gates"]) and guard < 12:
        for disc in list(relay["baton"]):
            relay = c.post(f"/api/plans/{pid}/ratify/{disc}", json={"approve": True, "note": f"{disc} lead ratified"}).json()
            print(f"   ✋ {disc} lead ratified → baton now {relay['baton'] or '(cleared)'}")
        guard += 1
    return relay


def main() -> None:
    # 1) Cold-start onboarding — drop a CV (real MongoDB write via the MCP)
    cv = pathlib.Path("seed/sample_cvs/nia-petrova.md").read_text()
    dev = c.post("/api/developers", data={"text": cv}).json()
    runner = dev["gitlab_username"]
    print(f"1) onboarded: {dev['name']} (@{runner}) — trust: {dev['trust_level']}")

    # 2) Brief (HearthList — a loose concept, no stack)
    bid = c.post("/api/briefs", data={"text": BRIEF}).json()["brief_id"]
    print(f"2) brief: {bid}  ({len(BRIEF)} chars)")

    # 3) CLARIFY — extract + flag unclear features as ambiguity cards, then resolve them
    spec = c.post(f"/api/briefs/{bid}/clarify", json=CONSTRAINTS).json()
    print(f"3) clarified — goal: {spec['goal'][:80]}")
    print(f"   reuse from memory: {[(r['from_project'], r['action']) for r in spec.get('reuse', [])]}")
    answers = {}
    for a in spec.get("ambiguities", []):
        pick = (a.get("options") or ["(manager specifies)"])[0]
        answers[a["id"]] = pick
        print(f"   ❓ {a['feature']}: {a['question']}  →  manager picks: {pick}")
    if answers:
        c.post(f"/api/briefs/{bid}/clarify/resolve", json={"answers": answers})
        print(f"   resolved {len(answers)} ambiguity card(s)")

    # 4) Architecture Cards (grounded on past projects), manager picks one → stack locks
    cards = c.post(f"/api/briefs/{bid}/architectures", json=CONSTRAINTS).json()["cards"]
    print(f"4) {len(cards)} Architecture Cards:")
    for cd in cards:
        ts = cd["tech_stack"]
        print(f"   • {cd['name']}: {ts['frontend']}/{ts['backend']}/{ts['db']} | grounded {cd['grounded_on']}")
    chosen = cards[0]

    # 5) Plan DRAFT + relay state (the one-shot is now a draft entering the relay)
    pr = c.post(f"/api/briefs/{bid}/plan", json={"chosen_stack": chosen["tech_stack"], "constraints": CONSTRAINTS}).json()
    pid, pl = pr["plan_id"], pr["plan"]
    n = sum(len(e["issues"]) for e in pl["epics"])
    kinds = sorted({i["kind"] for e in pl["epics"] for i in e["issues"]})
    print(f"5) plan DRAFT {pid}: {pl['project_name']} — {len(pl['epics'])} epics / {n} issues · kinds {kinds}")
    print(f"   relay gates: {_gates(pr['relay'])}")

    # 6) Relay ratification — dial auto-passes safe gates; leads ratify the rest
    print("6) relay ratification:")
    drive_relay(pid, dial=70)

    # 7) Dispatch → real GitLab scaffold (only after the relay clears)
    ap = c.post(f"/api/plans/{pid}/dispatch", json={"mode": "copilot"}).json()
    if "web_url" not in ap:
        print(f"   dispatch blocked: {ap}")
        return
    print(f"7) dispatched: {ap['web_url']}")
    print(f"   issues {ap['issues_created']} · code focus-branches {ap.get('context_branches')} · QA issue iid {ap.get('qa_issue_iid')}")
    gpid, qa = ap["project_id"], ap.get("qa_issue_iid")

    # 8) Layered QA — the QA-agent prefills the acceptance checklist
    report = c.post(f"/api/projects/{gpid}/qa/run").json()
    verdicts = {}
    for it in report["items"]:
        verdicts[it["verdict"]] = verdicts.get(it["verdict"], 0) + 1
    print(f"8) QA-agent checklist: {verdicts}  (human only adjudicates fail/needs_human)")

    # 9) QA reject → baton back to the responsible runner → re-QA queue
    if qa:
        rj = c.post(f"/api/projects/{gpid}/issues/{qa}/reject", json={"comment": "Tour booking 500s on submit", "to_runner": runner}).json()
        print(f"9) QA reject → rerouted to @{rj.get('rerouted_to')} · awaiting re-QA: {rj.get('awaiting_reqa')}")

        # 10) Fix merged → clears the re-QA flag (loop closed) + passport increment
        mg = c.post("/api/merge", json={"gitlab_username": runner, "task_type": "frontend:booking", "score": 0.9, "project_id": gpid, "issue_iid": qa}).json()
        print(f"10) fix merged → @{mg.get('gitlab_username')} trust {mg.get('trust_level')} · legs {len(mg.get('history', []))}")
        report2 = c.post(f"/api/projects/{gpid}/qa/run").json()
        print(f"    re-QA: reopened now {report2.get('reopened')}  (loop closed)")

    # 11) Passport promotion — a few more merges tip trust low → medium
    for i in range(2):
        mg = c.post("/api/merge", json={"gitlab_username": runner, "task_type": "backend:api", "score": 0.88}).json()
    print(f"11) @{runner} after {len(mg.get('history', []))} merges → trust: {mg.get('trust_level')}"
          + ("  ⬆ PROMOTED" if mg.get("promoted") else ""))

    # 12) Mid-prod feature add — delta grounded on the live project, its own relay
    try:
        feat = c.post(f"/api/projects/{gpid}/features", json={"text": "Add a commission-split calculator with tiered rates, visible to agent and brokerage.", "constraints": CONSTRAINTS}).json()
        if "plan_id" in feat:
            dpid = feat["plan_id"]
            dn = sum(len(e["issues"]) for e in feat["plan"]["epics"])
            print(f"12) mid-prod delta {dpid}: +{dn} new issues, grounded on {feat['plan']['grounded_on']}")
            drive_relay(dpid, dial=70)
            dap = c.post(f"/api/plans/{dpid}/dispatch", json={"mode": "copilot"}).json()
            print(f"    extended project {dap.get('project_id')} (same repo): +{dap.get('issues_created')} issues, +{dap.get('context_branches')} branches")
        else:
            print(f"12) mid-prod skipped (no persisted project record): {feat}")
    except Exception as e:
        print(f"12) mid-prod skipped: {e}")

    # 13) Post-mortem — write the shipped project back into agency memory
    cl = c.post(f"/api/projects/{gpid}/close", json={"outcome_notes": "Shipped HearthList in 9 weeks; map + saved-search reused from memory."}).json()
    print(f"13) post-mortem → agency memory: {cl}")

    print(f"\n🔗 OPEN IN BROWSER → {ap['web_url']}")
    print("   (left up on purpose; clean later with: PYTHONPATH=orchestrator uv run python -c \"from app import gitlab; print(gitlab.reset_demo())\")")


if __name__ == "__main__":
    main()
