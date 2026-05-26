"""Hard interface contracts (spec §5). The single source of truth for the
shape of data flowing Gemini → frontend → executor. Changing anything here
means notifying every dependent slice.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

IssueType = Literal["backend", "frontend", "db", "devops", "design"]
Risk = Literal["low", "medium", "high"]
TrustLevel = Literal["low", "medium", "high"]


# ── PlanJSON (spec §5.1) ─────────────────────────────────────────────
class ContextScope(BaseModel):
    files: list[str]
    note: str = ""


class Issue(BaseModel):
    id: str
    title: str
    description: str
    type: IssueType
    estimate_days: float
    risk: Risk
    required_skill: str
    context_scope: ContextScope
    assignee: Optional[str] = None  # gitlab_username, filled by assignment engine


class Epic(BaseModel):
    id: str
    title: str
    issues: list[Issue]


class TechStack(BaseModel):
    frontend: str
    backend: str
    db: str
    infra: str


class PlanJSON(BaseModel):
    project_name: str
    client_summary: str
    tech_stack: TechStack
    grounded_on: list[str] = Field(default_factory=list)
    timeline_weeks: int
    epics: list[Epic]


# ── Developer profiles (spec §4, API view — embedding stays server-side) ──
class DeveloperProfile(BaseModel):
    name: str
    gitlab_username: str
    skills_text: str
    trust_level: TrustLevel = "low"
    history: list[dict] = Field(default_factory=list)


# ── REST request/response helpers (spec §5.4) ───────────────────────
class BriefCreated(BaseModel):
    brief_id: str


class PlanCreated(BaseModel):
    plan_id: str


class ApproveRequest(BaseModel):
    mode: Literal["copilot", "autonomous"]
    edits: Optional[PlanJSON] = None


# ── Idea 1: constraint sliders + Architecture Cards ──
class Constraints(BaseModel):
    time_to_market: Literal["fast", "balanced", "thorough"] = "balanced"
    scalability: Literal["small", "medium", "large"] = "medium"
    reliability: Literal["low-cost", "standard", "high-availability"] = "standard"


class ArchitectureCard(BaseModel):
    name: str
    tech_stack: TechStack
    summary: str
    rationale: str  # cites past projects + notes which roster devs fit
    grounded_on: list[str] = Field(default_factory=list)
    fit_to_constraints: str


class ArchitectureOptions(BaseModel):
    cards: list[ArchitectureCard]


class ParsedCV(BaseModel):
    name: str
    gitlab_username: str
    skills_text: str


class PlanRequest(BaseModel):
    constraints: Optional[Constraints] = None
    chosen_stack: Optional[TechStack] = None
