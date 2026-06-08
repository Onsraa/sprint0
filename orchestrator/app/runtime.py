"""Durable runtime (Living Project Graph P8): rebuild the in-flight PLANS + RELAYS from the event spine.

sprint0's relay/plan state lives in process memory, so a restart loses an in-flight relay. Here we fold the
event log (plan_created / gate_ratified / plan_dispatched) back into runtime state — a deterministic projection
(like reflow) — so a relay awaiting ratification survives a gateway restart.

Fidelity note: issue-level edits made DURING a ratify aren't replayed (only gate status + baton); the plan is
restored as created. A bounded, documented gap — the durability-critical state (which gates are ratified, where
the baton sits) is reconstructed exactly.
"""
from __future__ import annotations

from app import relay
from app.contracts import PlanJSON, RelayState


def rebuild_runtime(events: list[dict]) -> tuple[dict[str, PlanJSON], dict[str, RelayState]]:
    """Fold the event log → (plans, relays) for plans still IN-FLIGHT (created, not yet dispatched). Pure."""
    plans: dict[str, PlanJSON] = {}
    relays: dict[str, RelayState] = {}
    for ev in sorted(events, key=lambda e: e.get("seq", 0)):
        kind = ev.get("kind")
        p = ev.get("payload") or {}
        pid = p.get("plan_id")
        if kind == "plan_created" and pid and p.get("plan"):
            try:
                plan = PlanJSON(**p["plan"])
            except Exception:
                continue
            plans[pid] = plan
            relays[pid] = relay.build_relay(plan)
        elif kind == "gate_ratified" and pid in relays and pid in plans:
            try:
                relay.ratify(relays[pid], plans[pid], p.get("discipline"), None,
                             bool(p.get("approve", True)), str(p.get("note", "")))
            except Exception:
                continue
        elif kind in ("plan_dispatched", "plan_scaffolded") and pid:
            plans.pop(pid, None)        # scaffolded/dispatched → finished → leaves the in-flight pool (PROJECTS owns it)
            relays.pop(pid, None)
        # project_reserved: no-op — the plan is already in-flight from plan_created; reserve only adds an empty repo
    return plans, relays
