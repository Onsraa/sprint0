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
