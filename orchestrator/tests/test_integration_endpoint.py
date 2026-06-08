"""Endpoint layer of the integration gate: authority (consumer / producer / qa-owner / orphan
manager), producer routing + ambiguity, and the blocked-gate ratify guard. The endpoints are async;
we drive them directly with asyncio.run and an explicit `member` (bypassing the auth Depends), and
monkeypatch `team` so no Atlas/Vertex/GitLab is touched."""
import asyncio

import pytest
from fastapi import HTTPException

from app import main, relay
from app.contracts import (ContextScope, ContractProposalSet, DeveloperProfile, Epic, Issue, InterfaceDraft,
                           InterfaceProposal, PlanJSON, RatifyRequest, SchemaField, TechStack)
from app.main import IntegrationFlagRequest, RejectRequest


def _dev(username, discipline, role="developer"):
    return DeveloperProfile(name=username, gitlab_username=username, skills_text="",
                            username=username, role=role, discipline=discipline)


ROSTER = [
    _dev("sprint0-fe", "frontend"),
    _dev("sprint0-se", "backend"),
    _dev("gabinvr", "qa"),
    _dev("flori", "devops"),
    _dev("Onsraa", None, role="manager"),
]


def _by(username):
    return next(m for m in ROSTER if m.username == username)


def _issue(i, t, assignee=None, deps=None, contract=None):
    return Issue(id=i, title=i.upper(), description="d", type=t, estimate_days=2, risk="low",
                 required_skill="", context_scope=ContextScope(files=[f"{i}.py"]),
                 assignee=assignee, depends_on=deps or [], api_contract=contract)


def _plan(issues):
    return PlanJSON(project_name="HomeHero", client_summary="", grounded_on=[], timeline_weeks=4,
                    tech_stack=TechStack(frontend="R", backend="P", db="PG", infra="-"),
                    epics=[Epic(id="e1", title="E", issues=issues)])


def _be_fe():
    return [_issue("b1", "backend", assignee="sprint0-se", contract='{"ok": 1}'),
            _issue("f1", "frontend", assignee="sprint0-fe", deps=["b1"])]


def _status(state, disc):
    return next(g.status for g in state.gates if g.discipline == disc)


@pytest.fixture(autouse=True)
def _patch_team(monkeypatch):
    async def _noop():
        return None
    monkeypatch.setattr(main.team, "all_members", lambda: ROSTER)
    monkeypatch.setattr(main.team, "ensure_loaded", _noop)


def _seed(pid, issues):
    """Seed the in-memory stores and ratify backend+frontend so qa is the active gate."""
    plan = _plan(issues)
    state = relay.build_relay(plan)
    main.PLANS[pid], main.RELAYS[pid] = plan, state
    relay.ratify(state, plan, "backend", None, True, "")
    relay.ratify(state, plan, "frontend", None, True, "")
    return plan, state


def _flag(pid, member, **body):
    return asyncio.run(main.flag_integration(pid, IntegrationFlagRequest(**body), member=member))


def test_consumer_flags_failing_blocks_qa():
    _, state = _seed("p1", _be_fe())
    res = _flag("p1", _by("sprint0-fe"), state="failing", reporter_issue_id="f1")   # consumer self-report
    assert "gates" in res                                                           # RelayState returned
    assert _status(state, "qa") == "blocked"
    assert [s.target_issue_id for s in relay.open_integration_failures(state)] == ["b1"]
    assert _status(state, "backend") == "ratified" and _status(state, "frontend") == "ratified"  # no cascade


def test_unauthorized_dev_gets_403():
    _seed("p2", _be_fe())
    with pytest.raises(HTTPException) as ei:                                         # devops dev: not assignee/qa/mgr
        _flag("p2", _by("flori"), state="failing", reporter_issue_id="f1")
    assert ei.value.status_code == 403


def test_qa_lead_can_flag():
    _, state = _seed("p3", _be_fe())
    res = _flag("p3", _by("gabinvr"), state="failing", reporter_issue_id="f1")       # qa-gate owner
    assert "gates" in res and _status(state, "qa") == "blocked"


def test_manager_inherits_orphan_qa(monkeypatch):
    roster_noqa = [m for m in ROSTER if m.discipline != "qa"]                        # no qa dev → orphan
    monkeypatch.setattr(main.team, "all_members", lambda: roster_noqa)
    _, state = _seed("p4", _be_fe())
    res = _flag("p4", _by("Onsraa"), state="failing", reporter_issue_id="f1")        # manager owns orphan qa
    assert "gates" in res and _status(state, "qa") == "blocked"
    with pytest.raises(HTTPException) as ei:                                         # plain dev still blocked
        _flag("p4", _by("flori"), state="failing", reporter_issue_id="f1")
    assert ei.value.status_code == 403


def test_blocked_qa_cannot_be_ratified():
    _, state = _seed("p5", _be_fe())
    _flag("p5", _by("sprint0-fe"), state="failing", reporter_issue_id="f1")
    assert _status(state, "qa") == "blocked"
    with pytest.raises(HTTPException) as ei:
        asyncio.run(main.ratify_gate("p5", "qa", RatifyRequest(approve=True), member=_by("gabinvr")))
    assert ei.value.status_code == 409                                              # must resolve the failure first


def test_ambiguous_producers_returns_candidates():
    issues = [_issue("b1", "backend", assignee="sprint0-se", contract='{"a": 1}'),
              _issue("d1", "db", assignee="sprint0-se"),
              _issue("f1", "frontend", assignee="sprint0-fe", deps=["b1", "d1"])]
    _seed("p6", issues)
    res = _flag("p6", _by("sprint0-fe"), state="failing", reporter_issue_id="f1")
    assert res.get("need_target") is True
    assert [c["id"] for c in res["candidates"]] == ["b1", "d1"]                     # contract-bearing first
    assert relay.open_integration_failures(main.RELAYS["p6"]) == []                 # no signal recorded yet


def test_producer_marks_ok_unblocks_qa():
    _, state = _seed("p7", _be_fe())
    _flag("p7", _by("sprint0-fe"), state="failing", reporter_issue_id="f1")
    assert _status(state, "qa") == "blocked"
    res = _flag("p7", _by("sprint0-se"), state="ok", target_issue_id="b1")          # producer (target assignee) clears
    assert "gates" in res and _status(state, "qa") == "pending"


# --- verify-on-merge: the contract-violation beat at the only listened action (MERGE) ---

def _iface_raw(pid, producer_issue_id, state="ratified"):
    """A ratified interface agreement requiring an integer `id` + a number `amount` on the producer."""
    return {"id": "ag1", "type": "interface", "plan_id": pid, "state": state,
            "subject": "backend↔frontend · /api/x", "producer_issue_id": producer_issue_id,
            "interface": {"method": "GET", "path": "/api/x", "request_fields": [], "errors": [],
                          "response_fields": [{"name": "id", "type": "integer", "required": True},
                                              {"name": "amount", "type": "number", "required": True}]}}


def _merge(pid, monkeypatch, agreements_list, **body):
    """Drive /api/merge with Atlas-touching deps stubbed; returns (response, [pinged users])."""
    async def _afp(_plan_id):
        return agreements_list
    async def _rec(*a, **k):
        return {"merged": True}
    pings = []
    async def _notify(user, *a, **k):
        pings.append(user)
    monkeypatch.setattr(main.demo, "is_demo", lambda: False)
    monkeypatch.setattr(main, "agreements_for_plan", _afp)
    monkeypatch.setattr(main, "record_merge", _rec)
    monkeypatch.setattr(main, "notify", _notify)
    res = asyncio.run(main.merge(main.MergeRequest(gitlab_username="sprint0-se", task_type="backend", **body),
                                 _by("sprint0-se")))
    return res, pings


def test_merge_contract_violation_raises_signal(monkeypatch):
    _, state = _seed("m1", _be_fe())                                                 # b1 = backend producer, assignee sprint0-se
    res, pings = _merge("m1", monkeypatch, [_iface_raw("m1", "b1")],
                        plan_id="m1", issue_id="b1", output_sample={"id": 1})         # missing required `amount`
    assert res["contract"]["ok"] is False
    assert any("amount" in v for v in res["contract"]["violations"])
    assert [s.target_issue_id for s in relay.open_integration_failures(state)] == ["b1"]
    assert _status(state, "qa") == "blocked"                                          # the existing gate enforces it
    assert pings == ["sprint0-se"]                                                    # producer pinged to fix


def test_merge_contract_clean_no_signal(monkeypatch):
    _, state = _seed("m2", _be_fe())
    res, pings = _merge("m2", monkeypatch, [_iface_raw("m2", "b1")],
                        plan_id="m2", issue_id="b1", output_sample={"id": 1, "amount": 9.5})
    assert res["contract"]["ok"] is True and res["contract"]["violations"] == []
    assert relay.open_integration_failures(state) == [] and pings == []


def test_merge_without_sample_skips_verify(monkeypatch):
    _, state = _seed("m3", _be_fe())
    res, _pings = _merge("m3", monkeypatch, [_iface_raw("m3", "b1")])                 # no plan_id/issue_id/output_sample
    assert "contract" not in res                                                      # graceful: nothing to check
    assert relay.open_integration_failures(state) == []


def test_merge_unratified_contract_not_enforced(monkeypatch):
    _, state = _seed("m4", _be_fe())
    res, pings = _merge("m4", monkeypatch, [_iface_raw("m4", "b1", state="proposed")],  # not yet ratified
                        plan_id="m4", issue_id="b1", output_sample={"id": 1})          # would violate IF enforced
    assert res.get("contract") is None                                               # only ratified/auto_passed contracts bind
    assert relay.open_integration_failures(state) == [] and pings == []


def test_merge_verifies_all_contracts_for_a_producer(monkeypatch):
    _, state = _seed("m5", _be_fe())                                      # b1 = backend producer
    two = [_iface_raw("m5", "b1"), {**_iface_raw("m5", "b1"), "id": "ag2", "subject": "backend↔devops · /api/y"}]
    res, _pings = _merge("m5", monkeypatch, two, plan_id="m5", issue_id="b1", output_sample={"id": 1})  # missing `amount` → both violate
    c = res["contract"]
    assert len(c["results"]) == 2                                         # BOTH contracts checked, not just the first
    assert c["ok"] is False and all(not r["ok"] for r in c["results"])


# --- reject_issue: a real GitLab reopen must be demo-guarded AND authorized (the public/real-world boundary) ---

def _reject(member, monkeypatch, *, demo, iid=5, to_runner=None):
    """Drive /reject with the GitLab call + demo flag stubbed; returns (response, [reopen calls])."""
    calls = []
    monkeypatch.setattr(main.handoff.demo, "is_demo", lambda: demo)
    monkeypatch.setattr(main.handoff.gl, "reopen_issue", lambda *a, **k: calls.append(a) or {"iid": iid})
    res = asyncio.run(main.reject_issue(1, iid, RejectRequest(comment="bad"), member=member))
    return res, calls


def test_reject_in_demo_makes_no_gitlab_call(monkeypatch):
    res, calls = _reject(_by("gabinvr"), monkeypatch, demo=True, iid=51)  # qa owner, but demo
    assert calls == []                                                    # the public demo never mutates real GitLab
    assert 51 in main.REQA.get(1, set())                                  # in-mem re-QA flag still set


def test_reject_live_qa_owner_reopens(monkeypatch):
    res, calls = _reject(_by("gabinvr"), monkeypatch, demo=False, iid=52)  # authorized + live
    assert len(calls) == 1                                                 # the real reopen fired


def test_reject_live_manager_allowed(monkeypatch):
    _, calls = _reject(_by("Onsraa"), monkeypatch, demo=False, iid=53)
    assert len(calls) == 1


def test_reject_unauthorized_dev_gets_403(monkeypatch):
    with pytest.raises(HTTPException) as ei:                               # backend dev: not qa owner / manager
        _reject(_by("sprint0-se"), monkeypatch, demo=False, iid=54)
    assert ei.value.status_code == 403


# --- JIT contracts: the producer's ratified gate choice (re)generates the interface contracts its slice produces ---

def _iface_old(aid, producer_id, consumer_id, state, path="/api/old", fields=()):
    return {"id": aid, "type": "interface", "plan_id": "p1", "state": state,
            "producer_issue_id": producer_id, "consumer_issue_id": consumer_id,
            "producer_discipline": "backend", "consumer_discipline": "frontend",
            "interface": {"method": "POST", "path": path, "request_fields": [],
                          "response_fields": [{"name": n, "type": "string", "required": True} for n in fields], "errors": []}}


def _opts(needed=True, path="/api/v2/auth", fields=("token",)):
    if not needed:
        return ContractProposalSet(needed=False, skip_reason="shared model, no API call")
    iface = InterfaceDraft(method="POST", path=path,
                           response_fields=[SchemaField(name=n, type="string", required=True) for n in fields])
    return ContractProposalSet(needed=True, proposals=[
        InterfaceProposal(id="p1", source="ai", interface=iface, why="standard token login", confidence=70)])


def _genlane(monkeypatch, opts, existing=None, pool=None):
    """Drive _generate_contracts_for_lane (backend slice b1 → frontend consumer f1) with the AI + rag deps
    stubbed; returns (saved, updated, pings, applied)."""
    saved, updated, pings, applied = [], [], [], []
    async def _afp(_pid):
        return existing or []
    async def _all():
        return pool or []
    async def _pco(_plan, _prod, _cons, _chosen):
        return opts
    async def _save(doc):
        saved.append(doc)
    async def _upd(aid, patch):
        updated.append((aid, patch))
    async def _notify(u, *a, **k):
        pings.append(u)
    monkeypatch.setattr(main.demo, "is_demo", lambda: False)
    monkeypatch.setattr(main, "agreements_for_plan", _afp)
    monkeypatch.setattr(main, "all_agreements", _all)
    monkeypatch.setattr(main, "propose_contract_options", _pco)
    monkeypatch.setattr(main, "save_agreement", _save)
    monkeypatch.setattr(main, "update_agreement", _upd)
    monkeypatch.setattr(main, "notify", _notify)
    monkeypatch.setattr(main, "_apply_api_contract", lambda pid, iid, c: applied.append((pid, iid, c)))
    plan = _plan([_issue("b1", "backend"), _issue("f1", "frontend", deps=["b1"])])
    asyncio.run(main._generate_contracts_for_lane("p1", plan, "backend", None, "sprint0-se"))
    return saved, updated, pings, applied


def test_jit_generates_contract_from_choice(monkeypatch):
    saved, updated, pings, _ap = _genlane(monkeypatch, _opts())
    assert len(saved) == 1                                                # one contract per producer→consumer edge
    assert saved[0]["state"] == "proposed" and saved[0]["producer_issue_id"] == "b1"
    assert saved[0]["consumer_discipline"] == "frontend"
    assert saved[0]["interface"]["path"] == "/api/v2/auth"                # the shape generated from the choice
    assert len(saved[0]["proposals"]) == 1                                # the producer picks from the offered shapes
    assert updated == []                                                  # nothing to supersede
    assert pings == ["sprint0-se"]                                        # routed to the producer to pick + sign


def test_jit_regenerates_and_supersedes_on_change(monkeypatch):
    # a changed gate choice → supersede the prior live contract for the edge and recreate from the new choice
    saved, updated, pings, _ap = _genlane(monkeypatch, _opts(path="/api/v3/auth"),
                                          existing=[_iface_old("agOLD", "b1", "f1", "active")])
    assert len(saved) == 1 and saved[0]["interface"]["path"] == "/api/v3/auth"
    assert len(updated) == 1 and updated[0][0] == "agOLD"
    assert updated[0][1]["state"] == "superseded" and updated[0][1]["superseded_by"] == saved[0]["id"]


def test_jit_skips_when_not_needed(monkeypatch):
    # necessity-aware: the AI says no real API boundary → no contract is created (no noise), prior is retired
    saved, updated, pings, applied = _genlane(monkeypatch, _opts(needed=False),
                                              existing=[_iface_old("agOLD", "b1", "f1", "active")])
    assert saved == [] and pings == [] and applied == []                 # nothing created, nobody pinged
    assert len(updated) == 1 and updated[0][1]["state"] == "superseded"  # the stale contract is superseded


def test_jit_compounds_on_precedent(monkeypatch):
    # a past plan ratified this exact shape → a RECOMMENDATION (precedent_id badge), NOT auto-pass. No auto-approval:
    # the producer still signs, so state stays proposed + no mock is seeded until they do.
    precedent = _iface_old("agPAST", "x", "y", "ratified", path="/api/v2/auth", fields=("token",))
    saved, updated, pings, applied = _genlane(monkeypatch, _opts(path="/api/v2/auth", fields=("token",)),
                                              pool=[precedent])
    assert len(saved) == 1 and saved[0]["state"] == "proposed" and saved[0]["precedent_id"] == "agPAST"
    assert applied == []                                                 # no mock until the human signs
    assert pings == ["sprint0-se"]                                       # the producer is still asked to sign


def test_jit_leaves_superseded_contracts_alone(monkeypatch):
    # an already-superseded prior is not re-touched; the edge still gets a fresh contract from the new choice
    saved, updated, _p, _ap = _genlane(monkeypatch, _opts(),
                                       existing=[_iface_old("agOLD", "b1", "f1", "superseded")])
    assert len(saved) == 1                                               # the edge still gets a contract
    assert updated == []                                                 # the already-superseded one is left alone


def test_demo_solutions_have_distinct_per_card_file_changes():
    # each gate solution carries its OWN file_changes (so "files match the choice" holds in the demo)
    from app import canned
    for disc in ("backend", "devops", "frontend", "qa"):
        cards = canned.solutions_for(disc).solutions
        fsets = [tuple((f.path, f.change) for f in c.file_changes) for c in cards]
        assert all(fsets), f"{disc}: a card has no file_changes"          # every card has files
        assert len(set(fsets)) == len(fsets), f"{disc}: cards share a file set"  # distinct per choice
        for c in cards:
            for f in c.file_changes:
                assert f.change in ("add", "modify", "remove")            # closed enum (Gemini-safe)


def test_demo_contract_options_canned_and_necessity_aware():
    from app import canned
    co = canned.contract_options_for("backend")
    assert co.needed and {p.id for p in co.proposals} == {"p-reuse", "p-fresh"}
    assert co.proposals[0].interface.path == "/api/auth/login"             # the contract is the API shape (no files)
    assert co.proposals[0].interface.response_fields                       # response schema is what the consumer builds against
    assert canned.contract_options_for("frontend").needed is False        # no cross-discipline API → no contract


# --- JIT contract routing: producer signs at their gate → provisional mock + ping the consumer (no creation broadcast) ---

def _iface_agreement(state="proposed", ratifications=None):
    return {"id": "agI", "type": "interface", "plan_id": "p1", "state": state,
            "subject": "backend→frontend · /api/x", "ratifiers": ["sprint0-se", "sprint0-fe"],
            "ratifications": ratifications or [],
            "producer_issue_id": "b1", "producer_discipline": "backend", "consumer_discipline": "frontend",
            "interface": {"method": "GET", "path": "/api/x", "request_fields": [], "errors": [],
                          "response_fields": [{"name": "id", "type": "integer", "required": True}]}}


def _ratify_agreement(raw, member, monkeypatch, decision="ratified"):
    applied, pings = [], []
    async def _get(_id):
        return dict(raw)
    async def _upd(_id, patch):
        pass
    async def _notify(u, *a, **k):
        pings.append(u)
    monkeypatch.setattr(main, "get_agreement", _get)
    monkeypatch.setattr(main, "update_agreement", _upd)
    monkeypatch.setattr(main, "notify", _notify)
    monkeypatch.setattr(main, "_apply_api_contract", lambda pid, iid, c: applied.append((pid, iid, c)))
    res = asyncio.run(main.ratify_agreement("agI", main.RatifyAgreementBody(decision=decision), member=member))
    return res, applied, pings


def test_jit_producer_sign_seeds_provisional_mock_and_pings_consumer(monkeypatch):
    res, applied, pings = _ratify_agreement(_iface_agreement(), _by("sprint0-se"), monkeypatch)  # backend = producer
    assert res["state"] == "active"                                      # sign-async: producer signed → sent to consumer
    assert len(applied) == 1 and applied[0][1] == "b1"                   # provisional mock seeded on producer-sign
    assert pings == ["sprint0-fe"]                                       # consumer pinged JIT (not at creation)


def test_jit_consumer_completes_finalizes_mock(monkeypatch):
    raw = _iface_agreement(ratifications=[{"by": "sprint0-se", "decision": "ratified", "at": "t"}])  # producer already signed
    res, applied, pings = _ratify_agreement(raw, _by("sprint0-fe"), monkeypatch)  # frontend = consumer completes it
    assert res["state"] == "ratified"
    assert len(applied) == 1 and applied[0][1] == "b1"                   # the mock is finalized
    assert pings == []                                                   # both signed — no further ping


def test_producer_signs_a_write_your_own_shape(monkeypatch):
    # the producer authors the interface (no proposal id) → their shape becomes the agreed contract
    raw = _iface_agreement()
    async def _get(_id): return dict(raw)
    monkeypatch.setattr(main, "get_agreement", _get)
    monkeypatch.setattr(main, "update_agreement", lambda *a, **k: None)
    async def _noop(*a, **k): pass
    monkeypatch.setattr(main, "update_agreement", _noop)
    monkeypatch.setattr(main, "notify", _noop)
    monkeypatch.setattr(main, "_apply_api_contract", lambda *a, **k: None)
    custom = InterfaceDraft(method="POST", path="/api/auth/custom",
                            response_fields=[SchemaField(name="token", type="string", required=True)])
    body = main.RatifyAgreementBody(decision="ratified", interface=custom)
    res = asyncio.run(main.ratify_agreement("agI", body, member=_by("sprint0-se")))  # backend = producer
    assert res["state"] == "active"
    assert res["interface"]["path"] == "/api/auth/custom"               # the written shape is the agreed interface
    assert res["chosen_proposal_id"] == "user"


def test_draft_shape_seeds_the_editor(monkeypatch):
    # the author-assist endpoint returns a draft shape to seed the write-own / counter editor (demo = a stub)
    raw = _iface_agreement()
    async def _get(_id): return dict(raw)
    monkeypatch.setattr(main, "get_agreement", _get)
    monkeypatch.setattr(main.demo, "is_demo", lambda: True)            # shared app.demo → generate_shape returns the canned stub
    body = main.DraftShapeBody(description="login returns a jwt + refresh")
    res = asyncio.run(main.draft_agreement_shape("agI", body, member=_by("sprint0-se")))
    assert res["method"] and "path" in res and "response_fields" in res  # a usable draft came back
