"""Spine routing tier — unit tests for the pure confidence×blast router (no I/O, no LLM)."""
from app import routing
from app.contracts import ContextScope, GraphEdge, Issue


def _iss(i="x", typ="backend", risk="low", assignee="dev", files=None):
    return Issue(id=i, title=i, description="d", type=typ, estimate_days=1, risk=risk,
                 required_skill="", context_scope=ContextScope(files=files or [f"{i}.py"]),
                 assignee=assignee)


HIGH = {"dev": {"trust": {}, "trust_level": "high"}}
LOW = {"dev": {"trust": {}, "trust_level": "low"}}


# ── legacy reduction: no edges + no confidence ⇒ today's trust×risk×dial behavior ──
def test_legacy_auto_pass_when_trust_clears():
    tier, cost, _, _ = routing.route_gate([_iss(risk="low")], None, HIGH, 100)
    assert tier == "auto_pass" and cost is None


def test_legacy_one_expert_when_trust_short():
    tier, _, _, _ = routing.route_gate([_iss(risk="high")], None, LOW, 100)
    assert tier == "one_expert"


def test_low_dial_forces_expert():
    tier, _, _, _ = routing.route_gate([_iss(risk="low")], None, HIGH, 0)
    assert tier == "one_expert"


# ── blast: the measured (or fallback) structural half ──
def test_blast_escalates_tier():
    big = _iss(files=[f"f{n}.py" for n in range(40)])
    tier, _, blast, note = routing.route_gate([big], [], HIGH, 100, confidence=90)
    assert blast == 40 and note == "blast estimated — no graph"
    assert tier in ("one_expert", "two_expert")


def test_blast_radius_measured_from_graph():
    edges = [GraphEdge(from_path="b.py", to_path="a.py"), GraphEdge(from_path="c.py", to_path="b.py")]
    blast, measured = routing.blast_radius(_iss(files=["a.py"]), edges)
    assert measured and blast == 2  # b imports a, c imports b → both break


def test_blast_radius_fallback_when_not_in_graph():
    edges = [GraphEdge(from_path="b.py", to_path="a.py")]
    blast, measured = routing.blast_radius(_iss(files=["z.py", "y.py"]), edges)
    assert not measured and blast == 2  # file-count fallback


# ── confidence: the epistemic half ──
def test_high_confidence_low_blast_auto_passes():
    tier, cost, _, _ = routing.route_gate([_iss()], [], HIGH, 100, confidence=95)
    assert tier == "auto_pass" and cost is not None


def test_low_confidence_escalates():
    files = [f"f{n}.py" for n in range(12)]
    hi = routing.route_gate([_iss(files=files)], [], HIGH, 70, confidence=95)
    lo = routing.route_gate([_iss(files=files)], [], HIGH, 70, confidence=20)
    assert routing._ORDER[lo[0]] > routing._ORDER[hi[0]]  # lower confidence ⇒ higher tier


# ── grounding is asymmetric (decision 2): orange raises, green/grey never lower ──
def test_orange_override_raises_floor():
    auto = routing.route_gate([_iss()], [], HIGH, 100, confidence=95)
    org = routing.route_gate([_iss()], [], HIGH, 100, confidence=95, signal="orange")
    assert auto[0] == "auto_pass" and org[0] == "one_expert"


def test_green_does_not_lower():
    base = routing.route_gate([_iss(risk="high")], None, LOW, 100)
    green = routing.route_gate([_iss(risk="high")], None, LOW, 100, signal="green")
    assert base[0] == green[0] == "one_expert"


# ── the trust floor always applies — never auto-pass un-cleared trust, however confident ──
def test_trust_floor_blocks_auto_pass():
    tier, _, _, _ = routing.route_gate([_iss(risk="high")], [], LOW, 100, confidence=99)
    assert tier != "auto_pass"
