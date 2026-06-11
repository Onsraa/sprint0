"""Shared semantic constants — every cross-module rule lives ONCE here, never as a scattered literal.

Three lifecycle sets encode different semantics (easy to drift when hand-rolled inline):
- DONE: a gate/agreement that cleared (human-ratified or auto-passed).
- AGREEMENT_BINDING: shapes a producer has SIGNED — what verify-on-merge enforces.
- AGREEMENT_LIVE: anything not dead (superseded/rejected) — what idempotency + visibility filter on.
"""
from __future__ import annotations

import os
from enum import StrEnum

DONE: tuple[str, ...] = ("ratified", "auto_passed")
AGREEMENT_BINDING: tuple[str, ...] = ("active", "ratified", "auto_passed")
AGREEMENT_LIVE: tuple[str, ...] = ("proposed", "active", "ratified", "auto_passed")

# Only these disciplines SERVE a consumed API → only they produce an interface contract. frontend/uiux serve
# UI, devops serves infra — none expose an API another slice calls, so a "frontend→x" API contract is nonsense
# (the AI would invent one). The edge filter in _draft_contracts gates on this.
API_PRODUCER_DISCIPLINES = frozenset({"backend", "db"})

# GitLab label routing the post-dispatch QA flow keys on (the acceptance checklist issue)
QA_ROLE_LABEL = "role:qa"
# The staging URL the acceptance checklist points the Tester at (env-overridable per deploy)
STAGING_URL = os.getenv("SPRINT0_STAGING_URL", "https://staging.example.com")


def persist_key(plan_id: str, discipline: str) -> str:
    """The SessionState composite key for per-(plan, gate) rows (solutions/chosen)."""
    return f"{plan_id}|{discipline}"


def split_persist_key(key: str) -> tuple[str, str]:
    pid, disc = key.split("|", 1)
    return pid, disc


class EventKind(StrEnum):
    """The unified change-event log's kinds — replay + routing match on these EXACT strings, so a typo in
    a literal silently breaks event-sourcing; emit through the enum only. (GitLab webhook events are the
    dynamic `gitlab_<kind>` family, prefixed at the emit site.)"""
    PLAN_CREATED = "plan_created"
    GATE_RATIFIED = "gate_ratified"
    PLAN_SCAFFOLDED = "plan_scaffolded"
    PROJECT_RESERVED = "project_reserved"
    SOURCE_CHANGED = "source_changed"
    REUSE_RECORDED = "reuse_recorded"
    NODE_RETIRED = "node_retired"
    CORPUS_REEMBEDDED = "corpus_reembedded"
