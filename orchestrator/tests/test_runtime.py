"""Living Project Graph P8 — durable runtime: rebuild in-flight plans + relays from the event spine."""
from app import canned, runtime


def test_rebuild_runtime_reconstructs_relay_progress():
    plan = canned.DEMO_PLAN
    events = [
        {"seq": 1, "kind": "plan_created", "payload": {"plan_id": "p1", "plan": plan.model_dump()}},
        {"seq": 2, "kind": "gate_ratified",
         "payload": {"plan_id": "p1", "discipline": "backend", "approve": True, "note": ""}},
    ]
    plans, relays = runtime.rebuild_runtime(events)
    assert "p1" in plans and "p1" in relays                       # the in-flight plan + relay are back
    g = next(x for x in relays["p1"].gates if x.discipline == "backend")
    assert g.status == "ratified"                                 # and the ratification was replayed


def test_rebuild_runtime_drops_dispatched():
    events = [
        {"seq": 1, "kind": "plan_created", "payload": {"plan_id": "p2", "plan": canned.DEMO_PLAN.model_dump()}},
        {"seq": 2, "kind": "plan_dispatched", "payload": {"plan_id": "p2"}},
    ]
    plans, relays = runtime.rebuild_runtime(events)
    assert "p2" not in plans and "p2" not in relays               # dispatched → finished → not in-flight


def test_reserved_stays_inflight_until_scaffolded():
    plan = canned.DEMO_PLAN.model_dump()
    evs = [{"seq": 1, "kind": "plan_created", "payload": {"plan_id": "r1", "plan": plan}},
           {"seq": 2, "kind": "project_reserved", "payload": {"plan_id": "r1", "reserved": {"project_id": 9001}}}]
    plans, relays = runtime.rebuild_runtime(evs)
    assert "r1" in plans and "r1" in relays          # reserved (empty repo, relay open) = still in-flight
    evs.append({"seq": 3, "kind": "plan_scaffolded", "payload": {"plan_id": "r1"}})
    plans, relays = runtime.rebuild_runtime(evs)
    assert "r1" not in plans and "r1" not in relays   # relay closed → scaffolded → drops out


def test_rebuild_runtime_ignores_orphan_ratify():
    events = [{"seq": 1, "kind": "gate_ratified", "payload": {"plan_id": "ghost", "discipline": "backend"}}]
    assert runtime.rebuild_runtime(events) == ({}, {})            # ratify with no plan_created → no-op
