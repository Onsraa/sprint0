"""Reason pipeline (Phase 3 + Idea 1).

- `propose_architectures(brief, constraints)` → 2-3 grounded Architecture Cards.
- `run_brief(brief, chosen_stack, constraints)` → grounded, assigned PlanJSON.

REASON only (RAG via MongoDB MCP + Gemini). Execution is the separate, human-gated step.
"""
from __future__ import annotations

from app.agent import (
    generate_architectures, generate_clarification, generate_cv_profile, generate_plan, generate_qa_report,
)
from app.assign import assign_developers
from app.contracts import ArchitectureOptions, ClarifiedSpec, Constraints, PlanJSON, QAReport, TechStack
from app.rag import (
    DEV_COLL, DEV_INDEX, PP_COLL, PP_INDEX, MongoMCP,
    embed_document, embed_queries, embed_query, record_postmortem,
)

_PP_PROJECTION = {"name": 1, "tech_stack": 1, "total_estimate_days": 1, "actual_days": 1, "outcome_notes": 1}
_DEV_PROJECTION = {"_id": 0, "name": 1, "gitlab_username": 1, "skills_text": 1, "trust_level": 1}


def _format_past(projects: list[dict]) -> str:
    lines = []
    for p in projects:
        ts = p.get("tech_stack", {})
        stack = " / ".join(str(v) for v in ts.values()) if isinstance(ts, dict) else ""
        lines.append(
            f"- {p.get('name')} | {stack} | est {p.get('total_estimate_days', '?')}d, "
            f"actual {p.get('actual_days', '?')}d | {p.get('outcome_notes', '')}"
        )
    return "\n".join(lines) or "(no close matches)"


def _format_roster(devs: list[dict]) -> str:
    return "\n".join(
        f"- @{d.get('gitlab_username')} ({d.get('trust_level')}): {d.get('skills_text', '')}" for d in devs
    ) or "(roster unavailable)"


def _format_constraints(c: Constraints | None) -> str:
    if not c:
        return "(none specified — use sensible defaults)"
    return f"time-to-market: {c.time_to_market} · scalability: {c.scalability} · reliability: {c.reliability}"


async def propose_architectures(brief_text: str, constraints: Constraints | None = None) -> ArchitectureOptions:
    async with MongoMCP() as m:
        past = await m.vector_search(PP_COLL, PP_INDEX, "brief_embedding", embed_query(brief_text), k=3, projection=_PP_PROJECTION)
        roster = await m.find(DEV_COLL, projection=_DEV_PROJECTION, limit=20)
    prompt = (
        f"CLIENT BRIEF:\n{brief_text}\n\n"
        f"MANAGER CONSTRAINTS:\n{_format_constraints(constraints)}\n\n"
        f"SIMILAR PAST PROJECTS (agency memory):\n{_format_past(past)}\n\n"
        f"DEV ROSTER:\n{_format_roster(roster)}\n\n"
        f"Propose 2-3 distinct, grounded architecture cards."
    )
    return await generate_architectures(prompt)


async def clarify_brief(brief_text: str, constraints: Constraints | None = None) -> ClarifiedSpec:
    """Intake step: extract the spec, flag unclear *features* as ambiguity cards, and propose
    memory-grounded reuse — the manager's first panel, before architecture + planning."""
    async with MongoMCP() as m:
        past = await m.vector_search(
            PP_COLL, PP_INDEX, "brief_embedding", embed_query(brief_text), k=3, projection=_PP_PROJECTION
        )
    prompt = (
        f"CLIENT BRIEF:\n{brief_text}\n\n"
        f"MANAGER CONSTRAINTS:\n{_format_constraints(constraints)}\n\n"
        f"SIMILAR PAST PROJECTS (agency memory):\n{_format_past(past)}\n\n"
        f"Produce the clarified spec: extraction, 2-4 ambiguity cards, and reuse proposals."
    )
    return await generate_clarification(prompt)


def _build_plan_prompt(brief: str, past: list[dict], chosen_stack: TechStack | None, constraints: Constraints | None) -> str:
    chosen = ""
    if chosen_stack:
        s = chosen_stack
        chosen = f"\nCHOSEN STACK (use EXACTLY this):\n- frontend: {s.frontend}\n- backend: {s.backend}\n- db: {s.db}\n- infra: {s.infra}\n"
    return (
        f"CLIENT BRIEF:\n{brief}\n\n"
        f"MANAGER CONSTRAINTS:\n{_format_constraints(constraints)}\n"
        f"{chosen}\n"
        f"SIMILAR PAST PROJECTS (ground your plan in these):\n{_format_past(past)}\n\nProduce the Sprint-0 plan."
    )


async def run_brief(
    brief_text: str, chosen_stack: TechStack | None = None, constraints: Constraints | None = None
) -> PlanJSON:
    async with MongoMCP() as m:
        past = await m.vector_search(PP_COLL, PP_INDEX, "brief_embedding", embed_query(brief_text), k=3, projection=_PP_PROJECTION)
        plan = await generate_plan(_build_plan_prompt(brief_text, past, chosen_stack, constraints))
        plan.grounded_on = plan.grounded_on or [p["name"] for p in past]
        await _match_and_assign(plan, m)
    return plan


async def _match_and_assign(plan: PlanJSON, m: MongoMCP) -> None:
    """Vector-match each issue's required_skill to developers; fill assignees (trust-gated)."""
    skills = sorted({iss.required_skill for e in plan.epics for iss in e.issues})
    skill_vecs = embed_queries(skills)  # ONE Voyage request
    skill_dev: dict[str, list[dict]] = {}
    for skill, vec in zip(skills, skill_vecs):
        skill_dev[skill] = await m.vector_search(
            DEV_COLL, DEV_INDEX, "skill_embedding", vec, k=3, projection={"name": 1, "gitlab_username": 1, "trust_level": 1}
        )
    assign_developers(plan, skill_dev)


async def delta_brief(feature_text: str, record: dict, constraints: Constraints | None = None) -> PlanJSON:
    """Mid-prod: a feature brief grounded against the EXISTING project (locked stack + its
    issues + key modules) AND agency memory. Reuses the stack; proposes only incremental work."""
    stack = TechStack(**record["tech_stack"]) if record.get("tech_stack") else None
    existing = record.get("plan", {}) or {}
    existing_titles = [i.get("title", "") for e in existing.get("epics", []) for i in e.get("issues", [])]
    manifest = record.get("module_manifest", [])
    async with MongoMCP() as m:
        past = await m.vector_search(
            PP_COLL, PP_INDEX, "brief_embedding", embed_query(feature_text), k=3, projection=_PP_PROJECTION
        )
        plan = await generate_plan(_build_delta_prompt(feature_text, record, existing_titles, manifest, past, stack, constraints))
        plan.grounded_on = plan.grounded_on or [record.get("name", "this project"), *(p["name"] for p in past)]
        await _match_and_assign(plan, m)
    return plan


def _build_delta_prompt(
    feature: str, record: dict, existing_titles: list[str], manifest: list[str],
    past: list[dict], stack: TechStack | None, constraints: Constraints | None,
) -> str:
    locked = ""
    if stack:
        locked = (
            f"LOCKED STACK (use EXACTLY — do NOT re-architect):\n- frontend: {stack.frontend}\n"
            f"- backend: {stack.backend}\n- db: {stack.db}\n- infra: {stack.infra}\n\n"
        )
    existing = "\n".join(f"- {t}" for t in existing_titles) or "(none)"
    mods = "\n".join(f"- `{mod}`" for mod in manifest) or "(unknown)"
    return (
        f"You are EXTENDING an existing, shipped project named '{record.get('name', '')}' with a NEW feature.\n\n"
        f"{locked}"
        f"EXISTING ISSUES (do NOT duplicate; integrate with these):\n{existing}\n\n"
        f"KEY MODULES already in the codebase (reference these in context_scope where relevant):\n{mods}\n\n"
        f"SIMILAR PAST PROJECTS (agency memory):\n{_format_past(past)}\n\n"
        f"MANAGER CONSTRAINTS:\n{_format_constraints(constraints)}\n\n"
        f"NEW FEATURE REQUEST:\n{feature}\n\n"
        f"Produce ONLY the incremental plan: 1-3 epics of new issues that integrate with the existing code."
    )


async def qa_review(plan: PlanJSON) -> QAReport:
    """QA-agent first pass: prefill the acceptance checklist (pass / fail / needs-human) so the
    human QA tester only adjudicates the flagged + risky items."""
    lines = [
        f"- id={i.id} | {i.title} | type={i.type} risk={i.risk} | {i.description[:160]}"
        for e in plan.epics for i in e.issues
    ]
    prompt = "ISSUES:\n" + "\n".join(lines) + "\n\nReturn exactly one QAItemResult per issue (echo its id)."
    return await generate_qa_report(prompt)


async def close_project(record: dict, outcome_notes: str = "") -> dict:
    """Post-mortem: write the finished project into agency memory (PastProjects) so future
    briefs ground on it — the loop that makes the agency smarter each sprint."""
    plan = record.get("plan", {}) or {}
    summary = f"{record.get('name', '')}: {plan.get('client_summary', '')}"
    total_est = sum(i.get("estimate_days", 0) for e in plan.get("epics", []) for i in e.get("issues", []))
    doc = {
        "name": record.get("name", ""),
        "tech_stack": record.get("tech_stack", {}),
        "brief_embedding": embed_document(summary),
        "total_estimate_days": total_est,
        "actual_days": total_est,  # demo: assume shipped on-estimate
        "outcome_notes": outcome_notes or "shipped via baton relay",
        "via": "baton-postmortem",
    }
    await record_postmortem(doc)
    return {"name": doc["name"], "added_to_memory": True}


async def onboard_developer(cv_text: str) -> dict:
    """Cold-Start onboarding (Idea: add a runner): CV → Gemini parse → upsert a
    DeveloperProfile (Trust: Low) into Atlas via the MCP."""
    profile = await generate_cv_profile(cv_text)
    doc = {
        "name": profile.name,
        "gitlab_username": profile.gitlab_username,
        "skills_text": profile.skills_text,
        "skill_embedding": embed_document(profile.skills_text),
        "trust_level": "low",
        "history": [],
    }
    async with MongoMCP() as m:
        await m.insert_many(DEV_COLL, [doc])
    return {k: v for k, v in doc.items() if k != "skill_embedding"}
