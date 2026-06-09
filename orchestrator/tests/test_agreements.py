"""Agreement engine — pure logic (no I/O, no LLM): ratifier routing, mock, state machine, contract verify."""
from app import agreements as A
from app.contracts import Agreement, DeveloperProfile, InterfaceDraft, SchemaField


def _dev(username, disc, trust="medium", seniority="mid", role="developer"):
    return DeveloperProfile(name=username, gitlab_username=username, username=username, skills_text="",
                            role=role, discipline=disc, trust={disc: trust} if disc else {}, seniority=seniority)


ROSTER = [
    _dev("mgr", None, role="manager"),
    _dev("be-sr", "backend", trust="high", seniority="senior"),
    _dev("be-jr", "backend", trust="low", seniority="junior"),
    _dev("fe", "frontend", trust="medium"),
]


def _agr(**kw):
    base = dict(id="a1", type="interface", plan_id="p1")
    base.update(kw)
    return Agreement(**base)


def test_lead_of_picks_highest_trust_then_senior():
    assert A.lead_of("backend", ROSTER) == "be-sr"      # high-trust senior beats the low-trust junior
    assert A.lead_of("frontend", ROSTER) == "fe"


def test_lead_of_orphan_falls_back_to_manager():
    assert A.lead_of("uiux", ROSTER) == "mgr"           # no uiux dev → the manager


def test_ratifiers_interface_is_both_lane_leads():
    a = _agr(producer_discipline="backend", consumer_discipline="frontend")
    assert A.ratifiers_for(a, ROSTER) == ["be-sr", "fe"]


def test_ratifiers_prefer_the_gate_ratifier_over_the_lane_lead():
    # the gate's ratifier (delegate ?? owner — possibly out-of-discipline) signs the lane's contracts;
    # lead_of is only the fallback. (The live bug: nobody could act when the owner was out-of-discipline.)
    a = _agr(producer_discipline="backend", consumer_discipline="frontend")
    out = A.ratifiers_for(a, ROSTER, gate_ratifiers={"backend": "devops-guy"})
    assert out == ["devops-guy", "fe"]                  # producer = the gate ratifier; consumer = lead fallback


def test_ratifiers_subteam_is_the_lane_lead():
    a = _agr(type="subteam", producer_discipline="backend")
    assert A.ratifiers_for(a, ROSTER) == ["be-sr"]


def test_ratifiers_priority_is_the_manager():
    assert A.ratifiers_for(_agr(type="priority"), ROSTER) == ["mgr"]


def test_mock_from_schema_emits_required_by_type():
    fields = [SchemaField(name="id", type="integer"), SchemaField(name="title", type="string"),
              SchemaField(name="draft", type="string", required=False)]
    m = A.mock_from_schema(fields)
    assert m == {"id": 1, "title": "text"}              # optional `draft` omitted


def test_apply_ratification_state_machine():
    a = _agr(producer_discipline="backend", consumer_discipline="frontend")
    a.ratifiers = ["be-sr", "fe"]
    A.apply_ratification(a, "be-sr", "ratified", "", "t")
    assert a.state == "proposed"                        # only one of two
    A.apply_ratification(a, "fe", "ratified", "", "t")
    assert a.state == "ratified"                        # both signed
    A.apply_ratification(a, "fe", "rejected", "no", "t")
    assert a.state == "rejected"                        # any reject wins


def test_verify_against_flags_violations():
    c = InterfaceDraft(response_fields=[SchemaField(name="id", type="integer"),
                                        SchemaField(name="name", type="string")])
    assert A.verify_against(c, {"id": 1, "name": "x"}) == []                  # clean
    assert A.verify_against(c, {"id": 1}) == ["missing required `name`"]      # missing
    assert A.verify_against(c, {"id": "oops", "name": "x"}) == ["`id` should be integer"]  # type mismatch


# ── P3 compounding: auto-pass from a ratified precedent ──────────────────────
def test_find_precedent_matches_same_signature_when_ratified():
    past = [{"id": "old", "type": "interface", "state": "ratified", "producer_discipline": "backend",
             "consumer_discipline": "frontend",
             "interface": {"path": "/api/x", "response_fields": [{"name": "id"}, {"name": "amount"}]}}]
    new = {"id": "new", "type": "interface", "producer_discipline": "backend", "consumer_discipline": "frontend",
           "interface": {"path": "/api/x", "response_fields": [{"name": "amount"}, {"name": "id"}]}}  # same set, any order
    assert A.find_precedent(new, past) == "old"


def test_find_precedent_none_when_unratified_or_different():
    new = {"id": "n", "type": "interface", "producer_discipline": "backend", "consumer_discipline": "frontend",
           "interface": {"path": "/api/x", "response_fields": [{"name": "id"}]}}
    unratified = [{"id": "p", "type": "interface", "state": "proposed", "producer_discipline": "backend",
                   "consumer_discipline": "frontend", "interface": {"path": "/api/x", "response_fields": [{"name": "id"}]}}]
    assert A.find_precedent(new, unratified) is None                         # precedent not ratified → no auto-pass
    diff_path = [{**unratified[0], "state": "ratified", "interface": {"path": "/api/y", "response_fields": [{"name": "id"}]}}]
    assert A.find_precedent(new, diff_path) is None                          # different shape → no match


# ── P4 sub-team: pair/split for 2+ devs on one lane ──────────────────────────
from app.contracts import PlanJSON, Epic, Issue, ContextScope, TechStack
def _plan(issues):
    return PlanJSON(id="p", project_name="X", client_summary="", timeline_weeks=4,
                    epics=[Epic(id="e", title="e", issues=issues)],
                    tech_stack=TechStack(frontend="R", backend="F", db="P", infra="D"))
def _iss(id, assignee, risk="low", disc="backend"):
    return Issue(id=id, title=id, description="", type="backend", estimate_days=2, risk=risk,
                 required_skill="backend:x", discipline=disc, context_scope=ContextScope(files=[], note=""),
                 depends_on=[], assignee=assignee)

def test_propose_subteams_pairs_on_mixed_seniority():
    plan = _plan([_iss("i1", "sr"), _iss("i2", "jr")])
    roster = [_dev("sr", "backend", seniority="senior"), _dev("jr", "backend", seniority="junior")]
    ags = A.propose_subteams(plan, roster)
    assert len(ags) == 1 and ags[0].type == "subteam"
    assert ags[0].subteam.mode == "pair" and set(ags[0].subteam.members) == {"sr", "jr"}

def test_propose_subteams_splits_comparable_low_risk():
    plan = _plan([_iss("i1", "a"), _iss("i2", "b")])
    roster = [_dev("a", "backend", seniority="mid"), _dev("b", "backend", seniority="mid")]
    assert A.propose_subteams(plan, roster)[0].subteam.mode == "split"

def test_propose_subteams_none_for_solo_lane():
    assert A.propose_subteams(_plan([_iss("i", "solo")]), [_dev("solo", "backend")]) == []
