"""Reason pipeline (Phase 3 + Idea 1).

- `propose_architectures(brief, constraints)` → 2-3 grounded Architecture Cards.
- `run_brief(brief, chosen_stack, constraints)` → grounded, assigned PlanJSON.

REASON only (RAG via MongoDB MCP + Gemini). Execution is the separate, human-gated step.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from app.agent import (
    generate_architectures, generate_clarification, generate_contract_options, generate_cv_profile, generate_plan,
    generate_qa_report, generate_regen, generate_solutions,
)
from app.assign import assign_developers
from app.contracts import ArchitectureOptions, CapabilityProfile, ClarifiedSpec, Constraints, ContractProposalSet, PlanJSON, QAReport, RegeneratedSlice, SolutionSet, TechStack
from app.rag import (
    DEV_COLL, PP_COLL, PP_INDEX, PP_TEXT_INDEX, MongoMCP,
    all_profiles, cosine_score, decisions_for_project, embed_document, embed_queries, embed_query,
    record_postmortem, save_profile,
)

log = logging.getLogger(__name__)

_PP_PROJECTION = {"name": 1, "tech_stack": 1, "total_estimate_days": 1, "actual_days": 1, "outcome_notes": 1}
_DEV_PROJECTION = {"_id": 0, "name": 1, "gitlab_username": 1, "skills_text": 1, "trust_level": 1}
# Match needs the scoring fields + the stored vector (we rank locally over the tiny roster, not per-skill in Atlas).
_DEV_MATCH_PROJECTION = {"_id": 0, "name": 1, "gitlab_username": 1, "username": 1, "trust_level": 1, "trust": 1,
                         "discipline": 1, "load": 1, "role": 1, "seniority": 1, "history": 1, "skill_embedding": 1}


def _format_past(projects: list[dict]) -> str:
    lines = []
    for p in projects:
        ts = p.get("tech_stack", {})
        stack = " / ".join(str(v) for v in ts.values()) if isinstance(ts, dict) else ""
        lines.append(
            f"- {p.get('name')} | {stack} | est {p.get('total_estimate_days', '?')}d, "
            f"actual {p.get('actual_days', '?')}d | {(p.get('outcome_notes', '') or '')[:160]}"
        )
    return "\n".join(lines) or "(no close matches)"


def _format_code(chunks: list[dict]) -> str:
    lines = [
        f"- {c.get('project')} · {c.get('file_path')} → {c.get('web_url', '')}\n    {(c.get('excerpt', '') or '')[:240].strip()}"
        for c in chunks
    ]
    return "\n".join(lines) or "(no reusable code found)"


def _format_decisions(decisions: list[dict]) -> str:
    lines = [f"- [{d.get('grade', 'proposed')}] {d.get('recommendation', '')} (on {d.get('project_name', '?')})"
             for d in decisions]
    return "\n".join(lines) or "(no standing team decisions for this gate)"


def _format_roster(devs: list[dict]) -> str:
    return "\n".join(
        f"- @{d.get('gitlab_username')} ({d.get('trust_level')}): {d.get('skills_text', '')}" for d in devs
    ) or "(roster unavailable)"


def _format_constraints(c: Constraints | None) -> str:
    if not c:
        return "(none specified — use sensible defaults)"
    return f"time-to-market: {c.time_to_market} · scalability: {c.scalability} · reliability: {c.reliability}"


def _normalize_plan_ids(plan: PlanJSON) -> None:
    """Server-own every epic/issue id: the LLM proposes content, never keys. Reassign deterministic
    ids (`epic-N`, `epic-N-M`) and remap `depends_on` through the same map — silently dropping any
    cross-ref the planner invented that points nowhere. Mirrors solutions.finalize_solution_set."""
    id_map: dict[str, str] = {}
    for ei, epic in enumerate(plan.epics, 1):
        new_eid = f"epic-{ei}"
        for ii, iss in enumerate(epic.issues, 1):
            id_map[iss.id] = f"{new_eid}-{ii}"   # capture old→new BEFORE overwriting
            iss.id = id_map[iss.id]
        epic.id = new_eid
    for epic in plan.epics:                       # 2nd pass: remap refs once every id is final
        for iss in epic.issues:
            iss.depends_on = [id_map[d] for d in iss.depends_on if d in id_map]


def _safe_username(raw: str) -> str:
    """A server-owned slug from the LLM's proposed handle — the handle is content, not a trusted key.
    Lowercase, kebab, strip anything that isn't [a-z0-9-] so it's safe as an id / GitLab lookup."""
    slug = re.sub(r"[^a-z0-9-]", "", raw.lower().replace(" ", "-")).strip("-")
    return slug or "dev"


async def propose_architectures(brief_text: str, constraints: Constraints | None = None) -> ArchitectureOptions:
    async with MongoMCP() as m:
        past = await m.hybrid_search(PP_COLL, PP_INDEX, PP_TEXT_INDEX, "brief_embedding", embed_query(brief_text), brief_text, k=3, projection=_PP_PROJECTION)
        roster = await m.find(DEV_COLL, projection=_DEV_PROJECTION, limit=20)
    prompt = (
        f"<client_brief>\n{brief_text}\n</client_brief>\n\n"
        f"MANAGER CONSTRAINTS:\n{_format_constraints(constraints)}\n\n"
        f"SIMILAR PAST PROJECTS (agency memory):\n{_format_past(past)}\n\n"
        f"DEV ROSTER:\n{_format_roster(roster)}\n\n"
        f"Propose 2-3 distinct, grounded architecture cards."
    )
    return await generate_architectures(prompt)


async def clarify_brief(brief_text: str, constraints: Constraints | None = None) -> ClarifiedSpec:
    """Intake step: extract the spec, flag unclear *features* as ambiguity cards, and propose
    memory-grounded reuse — the manager's first panel, before architecture + planning."""
    qv = embed_query(brief_text)
    async with MongoMCP() as m:
        past = await m.hybrid_search(
            PP_COLL, PP_INDEX, PP_TEXT_INDEX, "brief_embedding", qv, brief_text, k=3, projection=_PP_PROJECTION
        )
        try:
            code = await m.code_search(qv, k=5)
        except Exception:
            code = []  # code-RAG index not present yet (pre-reseed) → skip the reuse-code section
    prompt = (
        f"<client_brief>\n{brief_text}\n</client_brief>\n\n"
        f"MANAGER CONSTRAINTS:\n{_format_constraints(constraints)}\n\n"
        f"SIMILAR PAST PROJECTS (agency memory):\n{_format_past(past)}\n\n"
        f"REUSABLE CODE (chunk-level code-RAG over agency repos — cite specific files in reuse proposals):\n{_format_code(code)}\n\n"
        f"Produce the clarified spec: extraction, 2-4 ambiguity cards, and reuse proposals."
    )
    return await generate_clarification(prompt)


async def propose_solutions(plan: PlanJSON, discipline: str, constraints: Constraints | None = None) -> SolutionSet:
    """Reuse-or-innovate for ONE gate: a memory-grounded option + 1-2 fresh (dedup-checked) options, in a
    SINGLE LLM call. The server adds ids, impacted files, and the user write-your-own slot."""
    slice_issues = [i for e in plan.epics for i in e.issues if i.discipline == discipline]
    if not slice_issues:
        return SolutionSet(discipline=discipline, solutions=[])
    from app import demo, canned
    if demo.is_demo():  # no Vertex on the public tier → discipline-appropriate canned set (not the auth set for all)
        return canned.solutions_for(discipline)
    slice_text = "\n".join(
        f"- {i.title}: {(i.description or '')[:160]} (files: {', '.join(i.context_scope.files)})"
        for i in slice_issues
    )
    query = f"{plan.project_name} · {discipline}: " + "; ".join(i.title for i in slice_issues)
    qv = embed_query(query)
    async with MongoMCP() as m:
        past = await m.hybrid_search(PP_COLL, PP_INDEX, PP_TEXT_INDEX, "brief_embedding", qv, query, k=3, projection=_PP_PROJECTION)
        try:
            code = await m.code_search(qv, k=5)
        except Exception:
            code = []
    try:  # #33 — feed past TEAM decisions so the LLM can ground a `conflict` flag (not hallucinate it)
        from app.rag import all_decisions
        team_decisions = [d for d in await all_decisions()
                          if d.get("visibility") == "team" and d.get("domain") == discipline]
    except Exception:
        team_decisions = []
    prompt = (
        f"FEATURE: {plan.project_name}\n"
        f"GATE DISCIPLINE: {discipline}\n\n"
        f"THE SLICE (issues this gate delivers):\n{slice_text}\n\n"
        f"MANAGER CONSTRAINTS:\n{_format_constraints(constraints)}\n\n"
        f"SIMILAR PAST PROJECTS (agency memory — reuse what worked):\n{_format_past(past)}\n\n"
        f"REUSABLE CODE (chunk-level):\n{_format_code(code)}\n\n"
        f"PAST TEAM DECISIONS (set conflict=true + name it in conflict_reason ONLY if an option genuinely "
        f"contradicts one; else conflict=false):\n{_format_decisions(team_decisions)}\n\n"
        f"Propose 2-3 grounded solutions for THIS gate."
    )
    sset = await generate_solutions(prompt)
    sset.discipline = discipline
    return sset


async def propose_contract_options(plan: PlanJSON, prod, cons, chosen=None) -> ContractProposalSet:
    """JIT contract options for ONE producer→consumer edge, grounded on the producer's CHOSEN gate solution.
    The AI returns either `needed=false` (no real API boundary — no contract) or 1-2 pickable shape options
    (reuse/fresh). The server assigns each proposal an id. Called when the producer ratifies its gate."""
    from app import demo, canned
    if demo.is_demo():  # no Vertex on the public tier → the discipline's canned contract options (necessity-aware)
        opts = canned.contract_options_for(prod.discipline)
        for n, p in enumerate(opts.proposals):
            if not p.id:
                p.id = f"p{n + 1}"
        return opts
    choice = f"\nPRODUCER CHOSE: {chosen.title} — {(chosen.summary or '')[:160]}" if chosen and chosen.title else ""
    prompt = (
        f"FEATURE: {plan.project_name}\n"
        f"PRODUCER ({prod.discipline}): {prod.title} — {(prod.description or '')[:200]}{choice}\n"
        f"CONSUMER ({cons.discipline}): {cons.title} — {(cons.description or '')[:200]}\n"
        f"Give the API shape options the consumer needs from the producer, or say none is needed."
    )
    opts = await generate_contract_options(prompt)
    for n, p in enumerate(opts.proposals):
        if not p.id:
            p.id = f"p{n + 1}"
    return opts


async def regenerate_slice(issues: list, discipline: str, user_solution) -> RegeneratedSlice:
    """Rewrite a gate's issues to match a user-WRITTEN solution (no memory — just the user's intent). One
    LLM call; the caller applies the patches to the plan and recomputes impacted files."""
    cur = "\n".join(
        f"- id={i.id} | {i.title}: {(i.description or '')[:140]} (files: {', '.join(i.context_scope.files)})"
        for i in issues
    )
    prompt = (
        f"GATE DISCIPLINE: {discipline}\n\n"
        f"CURRENT ISSUES:\n{cur}\n\n"
        f"USER'S SOLUTION: {user_solution.title} — {user_solution.summary}\n{user_solution.rationale}\n\n"
        f"Rewrite each issue to implement the user's solution. Keep each id."
    )
    return await generate_regen(prompt)


def _build_plan_prompt(brief: str, past: list[dict], chosen_stack: TechStack | None,
                       constraints: Constraints | None, vocab: list[str] | None = None) -> str:
    chosen = ""
    if chosen_stack:
        s = chosen_stack
        chosen = f"\nCHOSEN STACK (use EXACTLY this):\n- frontend: {s.frontend}\n- backend: {s.backend}\n- db: {s.db}\n- infra: {s.infra}\n"
    vocab_line = ""
    if vocab:
        vocab_line = ("KNOWN CAPABILITY PROFILES (reuse these capability_tags when one fits; only coin "
                      f"a new kebab-case tag if none match):\n{', '.join(vocab)}\n\n")
    return (
        f"<client_brief>\n{brief}\n</client_brief>\n\n"
        f"MANAGER CONSTRAINTS:\n{_format_constraints(constraints)}\n"
        f"{chosen}\n"
        f"{vocab_line}"
        f"SIMILAR PAST PROJECTS (ground your plan in these):\n{_format_past(past)}\n\nProduce the Sprint-0 plan."
    )


async def run_brief(
    brief_text: str, chosen_stack: TechStack | None = None, constraints: Constraints | None = None
) -> PlanJSON:
    vocab = await _known_profile_labels()  # own MCP context — fetch BEFORE the main one (no re-entrancy)
    async with MongoMCP() as m:
        past = await m.hybrid_search(PP_COLL, PP_INDEX, PP_TEXT_INDEX, "brief_embedding", embed_query(brief_text), brief_text, k=3, projection=_PP_PROJECTION)
        plan = await generate_plan(_build_plan_prompt(brief_text, past, chosen_stack, constraints, vocab))
        _normalize_plan_ids(plan)   # never trust LLM-minted ids — own them server-side
        plan.grounded_on = plan.grounded_on or [p["name"] for p in past]
        await _match_and_assign(plan, m)
    await _discover_profiles(plan)  # own MCP context — AFTER the main one (no re-entrancy)
    return plan


async def _known_profile_labels() -> list[str]:
    """The confirmed/proposed capability vocabulary, injected into the planner so it reuses tags."""
    try:
        return sorted(p.get("label") or p.get("id", "") for p in await all_profiles())
    except Exception:
        return []


def _norm_tag(raw: str) -> str:
    """Normalize a capability tag to a stable id — lowercase kebab, punctuation→hyphen, collapse hyphens.
    So 'Stripe Webhooks', 'stripe_webhooks', and 'stripe-webhooks!' all map to ONE profile (bounds the
    otherwise-unbounded taxonomy: no near-duplicate profiles per spelling)."""
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", raw.lower())).strip("-")


async def _discover_profiles(plan: PlanJSON) -> None:
    """Any capability_tag the planner emitted that isn't already a known profile becomes a `proposed`
    CapabilityProfile (the growing dictionary). A manager confirms it before it can shape the lanes.
    Tags are normalized + matched against existing ids AND labels, so spelling variants don't each spawn a
    profile (bounds unbounded growth)."""
    try:
        profs = await all_profiles()
        known = {_norm_tag(p.get("id") or "") for p in profs} | {_norm_tag(p.get("label") or "") for p in profs}
        known.discard("")
        tags = sorted({t for e in plan.epics for i in e.issues for t in i.capability_tags})
        for tag in tags:
            pid = _norm_tag(tag)
            if pid and pid not in known:
                await save_profile(CapabilityProfile(id=pid, label=tag, status="proposed").model_dump())
                known.add(pid)
    except Exception:
        pass  # best-effort, mirrors the rest of grounding


async def _match_and_assign(plan: PlanJSON, m: MongoMCP) -> None:
    """Vector-match each issue's required_skill to developers; fill assignees (trust-gated).
    One roster fetch + local cosine rank (the roster is ≤ a handful) instead of a $vectorSearch
    round-trip per skill — same cosine score, N+1 → 1 MCP call."""
    skills = sorted({iss.required_skill for e in plan.epics for iss in e.issues})
    if not skills:
        return
    skill_vecs = embed_queries(skills)  # ONE Voyage request
    roster = await m.find(DEV_COLL, projection=_DEV_MATCH_PROJECTION, limit=50)
    skill_dev: dict[str, list[dict]] = {}
    for skill, vec in zip(skills, skill_vecs):
        ranked = []
        for d in roster:
            emb = d.get("skill_embedding")
            if not emb:
                continue
            row = {k: v for k, v in d.items() if k != "skill_embedding"}  # drop the 1024-float vector downstream
            row["score"] = cosine_score(vec, emb)
            ranked.append(row)
        ranked.sort(key=lambda r: r["score"], reverse=True)
        skill_dev[skill] = ranked[:5]
    # Availability overlay — route new work to whoever can start SOONEST (real schedule, not static load).
    # Best-effort: if the task store / roster is unreachable, scoring falls back to the static `load` factor.
    try:
        from app import scheduler, team
        from app.contracts import Task
        from app.rag import all_tasks
        avail = scheduler.availability(
            team.all_members(), [Task(**d) for d in await all_tasks()],
            datetime.now(timezone.utc).isoformat())
        for rows in skill_dev.values():
            for c in rows:
                a = avail.get(c.get("gitlab_username") or c.get("username", ""))
                if a:
                    c["free_in_days"] = a.free_in_days
    except Exception:
        pass
    assign_developers(plan, skill_dev)


async def delta_brief(feature_text: str, record: dict, constraints: Constraints | None = None) -> PlanJSON:
    """Mid-prod: a feature brief grounded against the EXISTING project (locked stack + its
    issues + key modules) AND agency memory. Reuses the stack; proposes only incremental work."""
    stack = TechStack(**record["tech_stack"]) if record.get("tech_stack") else None
    existing = record.get("plan", {}) or {}
    existing_titles = [i.get("title", "") for e in existing.get("epics", []) for i in e.get("issues", [])]
    manifest = record.get("module_manifest", [])
    try:  # the "compound" grounding: prior ratified decisions ON THIS project (own MCP context, no re-entrancy)
        decisions = (await decisions_for_project(record.get("name", "")))[:8]
    except Exception:
        decisions = []
    async with MongoMCP() as m:
        past = await m.hybrid_search(
            PP_COLL, PP_INDEX, PP_TEXT_INDEX, "brief_embedding", embed_query(feature_text), feature_text, k=3, projection=_PP_PROJECTION
        )
        plan = await generate_plan(_build_delta_prompt(feature_text, record, existing_titles, manifest, past, stack, constraints, decisions))
        _normalize_plan_ids(plan)   # never trust LLM-minted ids — own them server-side
        plan.grounded_on = plan.grounded_on or [record.get("name", "this project"), *(p["name"] for p in past)]
        await _match_and_assign(plan, m)
    return plan


def _build_delta_prompt(
    feature: str, record: dict, existing_titles: list[str], manifest: list[str],
    past: list[dict], stack: TechStack | None, constraints: Constraints | None,
    decisions: list[dict] | None = None,
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
        f"PRIOR DECISIONS ON THIS PROJECT (respect these — do NOT contradict a shipped/validated call):\n"
        f"{_format_decisions(decisions or [])}\n\n"
        f"SIMILAR PAST PROJECTS (agency memory):\n{_format_past(past)}\n\n"
        f"MANAGER CONSTRAINTS:\n{_format_constraints(constraints)}\n\n"
        f"<feature_request>\n{feature}\n</feature_request>\n\n"
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
    report = await generate_qa_report(prompt)
    # Stamp the responsible runner + gate onto each item (the model only echoes the id). The reject
    # flow reroutes to `runner`; the QA route pills group by `disc`.
    owners = {i.id: (i.assignee, i.discipline) for e in plan.epics for i in e.issues}
    for item in report.items:
        runner, disc = owners.get(item.issue_id, (None, None))
        item.runner, item.disc = runner, disc
    return report


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
        "outcome_notes": outcome_notes or "shipped via sprint0 relay",
        "via": "sprint0-postmortem",
    }
    await record_postmortem(doc)
    return {"name": doc["name"], "added_to_memory": True}


async def onboard_developer(cv_text: str) -> dict:
    """Cold-Start onboarding (Idea: add a runner): CV → Gemini parse → upsert a
    DeveloperProfile (Trust: Low) into Atlas via the MCP."""
    profile = await generate_cv_profile(cv_text)
    username = _safe_username(profile.gitlab_username or profile.name)  # server owns the key, not the LLM
    gl_user = None
    try:
        from app import gitlab as gl
        gl_user = gl.search_user(username)  # link the real GitLab account (native assignee)
    except Exception as e:
        log.warning("onboard: gitlab link failed for @%s: %s", username, e)  # surfaced via link_status, not silent
    doc = {
        "name": profile.name,
        "gitlab_username": username,
        "username": username,
        "email": "",
        "skills_text": profile.skills_text,
        "skill_embedding": embed_document(profile.skills_text),
        "role": "developer",
        "discipline": None,          # manager may set; None → out-of-discipline work is flagged stretch
        "seniority": "junior",
        "load": 0,
        "gitlab_user_id": gl_user["id"] if gl_user else None,
        # fail closed: an unlinked handle is NOT a real assignable account — say so, don't pretend it linked
        "link_status": "linked" if gl_user else "unlinked",
        "trust_level": "low",
        "trust": {},
        "joined": datetime.now(timezone.utc).strftime("%Y-%m"),  # a CV hire joins today
        "history": [],
    }
    async with MongoMCP() as m:
        await m.insert_many(DEV_COLL, [doc])
    out = {k: v for k, v in doc.items() if k != "skill_embedding"}
    out["gitlab_linked"] = gl_user is not None
    out["suggested_discipline"] = profile.suggested_discipline
    return out


async def link_gitlab(username: str) -> dict:
    """Resolve a member's intended gitlab_username to a real GitLab user id (manual Link button).
    Returns {username, gitlab_username, gitlab_user_id, linked}."""
    from app import gitlab as gl
    async with MongoMCP() as m:
        rows = await m.find(DEV_COLL, projection={"_id": 0, "gitlab_username": 1}, query={"username": username})
        if not rows:
            return {"username": username, "gitlab_user_id": None, "linked": False}
        gl_username = rows[0].get("gitlab_username") or username
        try:
            u = gl.search_user(gl_username)
        except Exception:
            u = None
        uid = u["id"] if u else None
        if uid:
            await m.update_many(DEV_COLL, {"username": username}, {"$set": {"gitlab_user_id": uid}})
        return {"username": username, "gitlab_username": gl_username, "gitlab_user_id": uid, "linked": uid is not None}


async def reconcile_links() -> dict:
    """Member-sync: link every still-unlinked member to its GitLab account (e.g. after the dev
    team finally seats someone). Returns {linked: [...], unresolved: [...]}."""
    from app import gitlab as gl
    linked: list[str] = []
    unresolved: list[str] = []
    async with MongoMCP() as m:
        rows = await m.find(
            DEV_COLL, projection={"_id": 0, "username": 1, "gitlab_username": 1, "gitlab_user_id": 1}, limit=100,
        )
        for r in rows:
            if r.get("gitlab_user_id"):
                continue
            gl_username = r.get("gitlab_username") or r.get("username")
            try:
                u = gl.search_user(gl_username)
            except Exception:
                u = None
            if u:
                await m.update_many(DEV_COLL, {"username": r["username"]}, {"$set": {"gitlab_user_id": u["id"]}})
                linked.append(r["username"])
            else:
                unresolved.append(r["username"])
    return {"linked": linked, "unresolved": unresolved}
