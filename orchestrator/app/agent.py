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

from app.contracts import ArchitectureOptions, ParsedCV, PlanJSON

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "0")

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
(security/payments/data-loss skew higher), required_skill as "area:topic", and context_scope \
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


INSTRUCTION_ONBOARD = """You parse a developer's CV/resume into a profile for an agency \
roster. Extract their real `name`, a sensible lowercase `gitlab_username` derived from the \
name (e.g. "nia-petrova"), and a rich `skills_text` summary (languages, frameworks, domains, \
tools, seniority cues) suitable for vector skill-matching. Be faithful to the CV; never \
invent skills. Return only the structured profile."""

onboard_agent = Agent(name="sprint0_onboard", model=MODEL, instruction=INSTRUCTION_ONBOARD, output_schema=ParsedCV)


async def generate_cv_profile(cv_text: str) -> ParsedCV:
    return ParsedCV.model_validate_json(await _run_agent(onboard_agent, cv_text))
