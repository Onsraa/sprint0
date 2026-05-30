"""ADK agents (Phase 3 + Idea 1).

- `planner_agent` → schema-validated PlanJSON (the brief→plan brain).
- `architect_agent` → ArchitectureOptions (Idea 1: 2-3 grounded stack cards).

Both: Gemini, structured output_schema, no tools (RAG is injected — the LLM can't
embed). ADK forbids tools + output_schema together, which is our reason/execute split.
Local dev: Gemini API key (flash-lite). Deploy: Vertex Gemini 3 via attached SA.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from google.adk.agents import Agent
from google.adk.runners import InMemoryRunner
from google.genai import types

from app.contracts import (
    ArchitectureOptions, ClarifiedSpec, ConflictVerdict, DecisionCardPass1, ParsedCV, PlanJSON,
    QAReport, RescheduleStrategy,
)

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

# Backend select: Vertex (uses GCP credit, NO 20/day Developer-API cap, allows additionalProperties)
# vs Gemini Developer API (an API key). Flip with GOOGLE_GENAI_USE_VERTEXAI=true in .env
# (+ GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION + ADC or a service-account key).
_USE_VERTEX = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").strip().lower() in ("1", "true", "yes")
if _USE_VERTEX:
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "true"
    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "us-central1")
    for _k in ("GOOGLE_API_KEY", "GEMINI_API_KEY"):
        os.environ.pop(_k, None)  # a stray key would force Developer-API mode — drop it
else:
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "0"
    if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

MODEL = os.getenv("VERTEX_GEMINI_MODEL", "gemini-2.5-flash-lite")
_APP = "orchestrator"

INSTRUCTION_PLAN = """You are an elite engineering manager producing a "Sprint Zero" \
delivery plan from a messy client brief.

You are given the BRIEF and SIMILAR PAST PROJECTS retrieved from agency memory. Ground \
your plan in them: reuse proven tech-stack choices, and let their estimate-vs-actual notes \
calibrate your numbers. If a CHOSEN STACK is given, use it EXACTLY. List the past-project \
names you used in `grounded_on`.

Produce 2-4 epics, each 2-4 issues. Every issue: a clear title, short markdown description, \
type in {backend, frontend, db, devops, design}, estimate_days, risk in {low, medium, high} \
(security/payments/data-loss skew higher), required_skill as "area:topic", capability_tags as \
1-3 fine-grained kebab-case capability labels (e.g. "stripe-webhooks", "map-clustering"; REUSE a \
tag from KNOWN CAPABILITY PROFILES when one fits, else coin a new one), and context_scope \
naming the 2-3 files that matter. Leave assignee null. Choose project_name, a one-sentence \
client_summary, and a realistic timeline_weeks."""

INSTRUCTION_ARCH = """You are a principal software architect. Given a client BRIEF, the \
manager's CONSTRAINTS (time-to-market / scalability / reliability), SIMILAR PAST PROJECTS \
from agency memory, and the DEV ROSTER, propose **2-3 genuinely distinct architecture \
options** ("cards") — different trade-offs (e.g. fast/managed vs scalable/custom).

For each card: a short `name`, a full `tech_stack` (frontend/backend/db/infra), a one-line \
`summary`, a `rationale` that CITES specific past projects AND names which roster developers \
fit (by skill + trust), `grounded_on` (the past-project names you used), and \
`fit_to_constraints` (how it satisfies the manager's sliders). Be concrete and grounded — \
never invent a stack the brief/memory doesn't support. Return only the structured options."""

planner_agent = Agent(name="sprint0_planner", model=MODEL, instruction=INSTRUCTION_PLAN, output_schema=PlanJSON)
architect_agent = Agent(name="sprint0_architect", model=MODEL, instruction=INSTRUCTION_ARCH, output_schema=ArchitectureOptions)


async def _run_agent(agent: Agent, prompt: str) -> str:
    runner = InMemoryRunner(agent=agent, app_name=_APP)
    session = await runner.session_service.create_session(app_name=_APP, user_id="local")
    msg = types.Content(role="user", parts=[types.Part(text=prompt)])
    final: str | None = None
    async for ev in runner.run_async(user_id="local", session_id=session.id, new_message=msg):
        if ev.is_final_response() and ev.content and ev.content.parts:
            final = ev.content.parts[0].text
    if not final:
        raise RuntimeError(f"agent {agent.name} produced no final response")
    return final


async def generate_plan(prompt: str) -> PlanJSON:
    return PlanJSON.model_validate_json(await _run_agent(planner_agent, prompt))


async def generate_architectures(prompt: str) -> ArchitectureOptions:
    return ArchitectureOptions.model_validate_json(await _run_agent(architect_agent, prompt))


INSTRUCTION_CLARIFY = """You read a messy client BRIEF and produce a clarified spec for a \
project manager — the manager's first interaction before any planning.

Extract: a one-sentence `goal`; the `users` (roles who use it); the `must_haves` (concrete \
features the brief states clearly); and explicit `constraints` (deadline, platform, budget, \
performance vibes). Then surface 2-4 `ambiguities`: features the brief mentions but leaves \
genuinely unclear at the PRODUCT level — never technical/stack questions. Each ambiguity: a \
stable `id` ("amb-1", "amb-2", …), the `feature` name, a crisp `question`, and 2-3 plausible \
`options` (interpretations) to choose from. Leave each `resolution` null.

You are also given SIMILAR PAST PROJECTS from agency memory. In `reuse`, propose which \
capabilities to reuse/adapt/drop and from which project (`from_project` = its name, `feature` \
= the capability, `action` ∈ {reuse, adapt, drop}). Never invent features the brief doesn't \
support. Return only the structured spec."""

clarify_agent = Agent(name="sprint0_clarify", model=MODEL, instruction=INSTRUCTION_CLARIFY, output_schema=ClarifiedSpec)


async def generate_clarification(prompt: str) -> ClarifiedSpec:
    return ClarifiedSpec.model_validate_json(await _run_agent(clarify_agent, prompt))


INSTRUCTION_ONBOARD = """You parse a developer's CV/resume into a profile for an agency \
roster. Extract their real `name`, a sensible lowercase `gitlab_username` derived from the \
name (e.g. "nia-petrova"), and a rich `skills_text` summary (languages, frameworks, domains, \
tools, seniority cues) suitable for vector skill-matching. Be faithful to the CV; never \
invent skills. Return only the structured profile."""

onboard_agent = Agent(name="sprint0_onboard", model=MODEL, instruction=INSTRUCTION_ONBOARD, output_schema=ParsedCV)


async def generate_cv_profile(cv_text: str) -> ParsedCV:
    return ParsedCV.model_validate_json(await _run_agent(onboard_agent, cv_text))


INSTRUCTION_QA = """You are a QA engineer doing a first-pass acceptance review of a delivered \
sprint, BEFORE the human QA tester signs off — your job is to do the grunt work so the human \
only adjudicates what matters. You are given the ISSUES (id, title, type, risk, description). \
For EACH issue return a QAItemResult with its `issue_id`, `title`, and a `verdict`:
- "pass" — straightforward, low-risk, clearly satisfiable by a competent implementation.
- "needs_human" — security/payments/data, high risk, or acceptance that truly needs a human to \
eyeball on staging.
- "fail" — only if the issue as written is internally contradictory or clearly under-specified.
Add a one-line `note` per item. Be conservative: route risk to humans. Return only the \
structured QAReport; leave `reopened` empty."""

qa_agent = Agent(name="sprint0_qa", model=MODEL, instruction=INSTRUCTION_QA, output_schema=QAReport)


async def generate_qa_report(prompt: str) -> QAReport:
    return QAReport.model_validate_json(await _run_agent(qa_agent, prompt))


INSTRUCTION_STRATEGY = """You are a delivery Strategist for an engineering agency. A change just hit \
the schedule (someone out sick, a task re-estimated heavier, a spec changed). You are given ONLY the \
delta — the CHANGE, the IMPACTED TASKS, and CANDIDATE PEOPLE. You never see the whole plan.

Choose exactly ONE `action` to resolve the impact, preferring the LEAST disruptive that still protects \
the deadline:
- right_shift — let the affected tasks slide later; no owner/scope change. The default for a minor slip.
- reassign — move a task to another candidate (set `reassign_to` to their username); use when the owner \
is blocked/out and someone qualified is free.
- compress — parallelize or split work to recover time.
- descope — drop/defer lower-value tasks (list them in `target_task_ids`).
- re_estimate — the estimate itself is wrong and should be corrected.
- re_plan — the change is structural (stack/scope) and needs a fresh plan from the planner.
- escalate — a human manager must decide.

Set `target_task_ids` to the tasks the action applies to; `reassign_to` ONLY for reassign; a one-line \
`rationale`; a 0-100 `confidence`; and a one-line, human-facing `impact_summary` naming who is affected \
and how. Return only the structured strategy."""

strategist_agent = Agent(name="sprint0_strategist", model=MODEL, instruction=INSTRUCTION_STRATEGY, output_schema=RescheduleStrategy)


async def generate_strategy(prompt: str) -> RescheduleStrategy:
    return RescheduleStrategy.model_validate_json(await _run_agent(strategist_agent, prompt))


# ── Decision Cards (System 2): two-pass adversarial evaluation ──
DECISION_DOMAIN_CONSTRAINTS = {
    "backend": "performance, data integrity, API contracts, security surface, scalability",
    "frontend": "component reusability, state management, bundle size, accessibility, rendering strategy",
    "devops": "deployment reliability, cost efficiency, scaling behavior, observability, failure recovery",
    "qa": "edge cases, failure modes, testability, regression risk, coverage gaps",
    "uiux": "user mental model, interaction clarity, accessibility, design consistency",
}

INSTRUCTION_CARD = """You are a senior engineer evaluating a delivery decision for ONE discipline. The \
prompt names your DOMAIN and the only CONSTRAINTS you may reason about — stay strictly inside them; never \
comment outside your domain. Be skeptical, never sycophantic. Output an HONEST confidence 0-100 — do NOT \
inflate; uncertainty is valuable, below 60 is valid when you are unsure. Be extremely concise: \
recommendation <=10 words, <=3 pros and <=3 cons, each <=8 words. Output structured data only, no prose."""

card_agent = Agent(name="sprint0_card", model=MODEL, instruction=INSTRUCTION_CARD, output_schema=DecisionCardPass1)


async def generate_decision_card(prompt: str) -> DecisionCardPass1:
    return DecisionCardPass1.model_validate_json(await _run_agent(card_agent, prompt))


INSTRUCTION_CONFLICT = """You are an adversarial reviewer comparing two positions on the same decision: \
Position A (an AI recommendation) and Position B (the team's past decision). Find the STRONGEST argument \
against each — be adversarial, not diplomatic — then decide whether they genuinely CONFLICT. Output \
`conflict` (bool) and, only if true, a `conflict_reason` of at most 15 words. Change neither position."""

conflict_agent = Agent(name="sprint0_conflict", model=MODEL, instruction=INSTRUCTION_CONFLICT, output_schema=ConflictVerdict)


async def generate_conflict(prompt: str) -> ConflictVerdict:
    return ConflictVerdict.model_validate_json(await _run_agent(conflict_agent, prompt))
