from app.contracts import ChangeEvent, ImpactedTask, RescheduleProposal, RescheduleStrategy


def _ev():
    return ChangeEvent(id="e1", kind="sick", user_id="sprint0-se", created_at="t")


def _strat():
    return RescheduleStrategy(action="reassign", target_task_ids=["t2"], reassign_to="sprint0-fe",
                              rationale="se is out; fe has slack", confidence=82,
                              impact_summary="Move API task to fe to protect the deadline")


def test_proposal_roundtrips():
    p = RescheduleProposal(
        id="rsp_1", project_id=42, event=_ev(), strategy=_strat(),
        impacted=[ImpactedTask(task_id="t2", title="API", assignee="sprint0-se",
                               scheduled_start="2026-06-10", scheduled_end="2026-06-12")],
        affected_users=["sprint0-se"], created_at="t",
    )
    again = RescheduleProposal(**p.model_dump())
    assert again.strategy.action == "reassign" and again.status == "proposed"
    assert again.impacted[0].task_id == "t2" and again.event.kind == "sick"
