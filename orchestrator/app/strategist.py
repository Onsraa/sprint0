"""AI Strategist — the reflow engine's neuro-symbolic layer.

Fires ONLY when the deterministic reflow can't decide on its own: an over-constrained reschedule or
a semantic (spec/scope) change. It sees ONLY the delta — the change, the impacted tasks, and the
candidate people — never the whole plan, roster, or memory (token-efficient by construction). It
emits a typed `RescheduleStrategy` the deterministic solver executes; it NEVER places dates itself.
Low-impact strategies auto-apply (Trust Dial); high-impact ones are proposed to the manager.
"""
from __future__ import annotations

from app.contracts import ChangeEvent, DeveloperProfile, RescheduleStrategy, Task

AUTO_APPLY_ACTIONS = {"right_shift"}     # purely temporal, no owner/scope change → safe to apply silently
_AUTO_APPLY_MIN_CONFIDENCE = 70


def candidate_people(impacted: list[Task], members: list[DeveloperProfile]) -> list[DeveloperProfile]:
    """The people relevant to this reschedule: those in the impacted tasks' disciplines (plus the
    manager, who can always reassign). Keeps the prompt small — never the full roster."""
    disciplines = {t.discipline for t in impacted}
    return [m for m in members if m.discipline in disciplines or m.role == "manager"]


def build_strategy_prompt(event: ChangeEvent, impacted: list[Task],
                          candidates: list[DeveloperProfile]) -> str:
    """The delta-only prompt: the change + ONLY the impacted tasks + ONLY the candidate people."""
    ev = f"CHANGE: kind={event.kind}"
    if event.user_id:
        ev += f" person=@{event.user_id}"
    if event.task_id:
        ev += f" task={event.task_id}"
    if event.start:
        ev += f" window={event.start}..{event.end or event.start}"
    if event.payload:
        ev += f" details={event.payload}"
    tasks = "\n".join(
        f'- {t.id} [{t.discipline}] "{t.title}" assignee=@{t.assignee or "—"} '
        f"pri={t.priority} est={t.estimate_days}d sched={t.scheduled_start}→{t.scheduled_end}"
        for t in impacted
    ) or "(none)"
    cands = "\n".join(
        f"- @{m.username} [{m.discipline or 'mgr'}] {m.seniority} load={m.load}" for m in candidates
    ) or "(none)"
    return (
        f"{ev}\n\n"
        f"IMPACTED TASKS (only these — the delta):\n{tasks}\n\n"
        f"CANDIDATE PEOPLE:\n{cands}\n\n"
        f"Pick ONE strategy to resolve the impact. Prefer the LEAST disruptive that still protects the deadline."
    )


def should_auto_apply(strategy: RescheduleStrategy) -> bool:
    """Trust Dial: only a confident, purely-temporal right_shift applies silently; everything that
    changes ownership or scope is proposed to a human first."""
    return strategy.action in AUTO_APPLY_ACTIONS and strategy.confidence >= _AUTO_APPLY_MIN_CONFIDENCE


def impact_notifications(impacted: list[Task], event: ChangeEvent) -> list[dict]:
    """Per-individual impact: one notification payload per affected assignee — 'your tasks moved
    because <change>'. Grouped by owner so each person sees only their own impact."""
    by_person: dict[str, list[Task]] = {}
    for t in impacted:
        if t.assignee:
            by_person.setdefault(t.assignee, []).append(t)
    out = []
    for person, tasks in by_person.items():
        titles = ", ".join(f'"{t.title}"' for t in tasks)
        cause = event.kind + (f" (@{event.user_id})" if event.user_id else "")
        out.append({
            "user_id": person,
            "title": f"{len(tasks)} task(s) re-flowed",
            "body": f"{titles} affected by {cause}.",
        })
    return out


async def judge(event: ChangeEvent, impacted: list[Task],
                members: list[DeveloperProfile]) -> RescheduleStrategy:
    """Run the Strategist: build the delta-only prompt and ask Gemini for a typed strategy.
    Lazy import keeps the pure helpers above import-light (no ADK) for unit tests."""
    from app.agent import generate_strategy
    candidates = candidate_people(impacted, members)
    strat = await generate_strategy(build_strategy_prompt(event, impacted, candidates))
    # Referential integrity: the prompt OFFERS candidates but can't BIND the model to them. Never route
    # work to someone we didn't offer — fail closed to a human decision rather than a hallucinated handle.
    if strat.action == "reassign" and strat.reassign_to not in {m.username for m in candidates}:
        strat.action, strat.reassign_to = "escalate", None
        strat.impact_summary = "AI named an assignee outside the candidate set — escalated for a human decision."
    return strat
