"""Agreement engine — pure logic for the coordination spine (no I/O). An Agreement is AI-drafted, routed to
its MINIMAL ratifier set, ratified async, and compounds. This module computes who must sign, builds the mock
from an interface contract, advances the state machine, and verifies a merged payload against a ratified
contract. The caller persists (rag.save_agreement). Pure + deterministic + testable.
"""
from __future__ import annotations

from app.contracts import Agreement, DeveloperProfile, InterfaceDraft, SchemaField

_TRUST = {"low": 0, "medium": 1, "high": 2}
_SENIORITY = {"junior": 0, "mid": 1, "senior": 2}


def lead_of(discipline: str, members: list[DeveloperProfile]) -> str | None:
    """The lead who signs a discipline's agreements: the highest-trust (then most-senior) developer in that
    lane — deterministic, not roster-order. Falls back to the manager when the lane is an orphan (no dev)."""
    devs = [m for m in members if m.role == "developer" and m.discipline == discipline]
    if devs:
        best = max(devs, key=lambda m: (_TRUST.get(m.trust_in(discipline), 0), _SENIORITY.get(m.seniority, 1)))
        return best.username
    mgr = next((m for m in members if m.role == "manager"), None)
    return mgr.username if mgr else None


def ratifiers_for(agreement: Agreement, members: list[DeveloperProfile]) -> list[str]:
    """The MINIMAL set who must consent — never broadcast. interface → both lane leads; subteam/handoff/
    reuse/assign → the lane lead; priority/reschedule/default → the manager."""
    t = agreement.type
    out: list[str] = []
    if t == "interface":
        for disc in (agreement.producer_discipline, agreement.consumer_discipline):
            lead = lead_of(disc, members) if disc else None
            if lead and lead not in out:
                out.append(lead)
    elif t in ("subteam", "handoff", "reuse", "assign"):
        lead = lead_of(agreement.producer_discipline or agreement.consumer_discipline or "", members)
        if lead:
            out.append(lead)
    else:  # priority / reschedule / default → the manager arbitrates
        mgr = next((m for m in members if m.role == "manager"), None)
        if mgr:
            out.append(mgr.username)
    return out


_SAMPLE = {"string": "text", "number": 1.0, "integer": 1, "boolean": True, "object": {}, "array": [], "null": None}


def mock_from_schema(fields: list[SchemaField]) -> dict:
    """A representative payload from an interface's response fields — what the FE builds against. Emits the
    required fields (the contract's guaranteed surface)."""
    return {f.name: _SAMPLE.get(f.type, "text") for f in fields if f.required and f.name}


def apply_ratification(agreement: Agreement, by: str, decision: str, note: str, now: str) -> Agreement:
    """Record one ratifier's call + advance the state. Any reject → rejected; every ratifier ratified → ratified."""
    agreement.ratifications = [r for r in agreement.ratifications if r.get("by") != by]
    agreement.ratifications.append({"by": by, "decision": decision, "at": now, "note": note})
    agreement.updated_at = now
    if any(r["decision"] == "rejected" for r in agreement.ratifications):
        agreement.state = "rejected"
    elif agreement.ratifiers and all(
        any(r["by"] == u and r["decision"] == "ratified" for r in agreement.ratifications)
        for u in agreement.ratifiers
    ):
        agreement.state = "ratified"
    return agreement


def _type_ok(value, t: str) -> bool:
    if t == "null":
        return value is None
    py = {"string": str, "number": (int, float), "integer": int, "boolean": bool,
          "object": dict, "array": list}.get(t)
    return isinstance(value, py) if py else True


def _iface_sig(a: dict) -> tuple:
    """The compounding signature of an interface agreement — disciplines + path + the response field set.
    Two agreements with the same signature are the SAME coordination decision."""
    iface = a.get("interface") or {}
    names = tuple(sorted(f.get("name", "") for f in (iface.get("response_fields") or [])))
    return (a.get("producer_discipline"), a.get("consumer_discipline"), iface.get("path", ""), names)


def find_precedent(new: dict, past: list[dict]) -> str | None:
    """A past *ratified* interface agreement with the same signature — the team already agreed on this
    shape, so the new one can **auto-pass** + compound from it (coordination cost drops as the agency
    ships). Returns the precedent's id, or None. Both args are model_dump() dicts."""
    if new.get("type") != "interface":
        return None
    sig = _iface_sig(new)
    for p in past:
        if (p.get("type") == "interface" and p.get("state") in ("ratified", "auto_passed")
                and p.get("id") != new.get("id") and _iface_sig(p) == sig):
            return p.get("id")
    return None


def verify_against(contract: InterfaceDraft, payload: dict) -> list[str]:
    """Shape-check a merged producer payload against the ratified response contract. Returns the list of
    violations (empty = clean) — a non-empty list IS the contract violation the verify beat escalates."""
    violations: list[str] = []
    for f in contract.response_fields:
        if f.required and f.name not in payload:
            violations.append(f"missing required `{f.name}`")
        elif f.name in payload and not _type_ok(payload[f.name], f.type):
            violations.append(f"`{f.name}` should be {f.type}")
    return violations
