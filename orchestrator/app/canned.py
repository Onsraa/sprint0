"""Canned fixtures for Phase 1 stubs. Real RAG/Gemini output replaces these in
Phase 3. Kept schema-valid so the frontend + tests exercise the real contract.
"""
from app.contracts import (
    ArchitectureOptions, ClarifiedSpec, ConflictVerdict, ContractProposalSet, Decision, DecisionCardPass1,
    DeveloperProfile, InterfaceDraft, InterfaceProposal, MemoryCandidate, MemoryJudgment, Notification, ParsedCV, PlanJSON,
    ProjectRecord, QAReport, RegeneratedSlice, RescheduleStrategy, SchemaField, SolutionSet,
)

CANNED_PLAN = PlanJSON.model_validate(
    {
        "project_name": "FinTrack",
        "client_summary": "A personal-finance SaaS: bank-sync, budgets, and a "
        "spending dashboard. Brief was a 9-page PDF with vague NFRs.",
        "tech_stack": {
            "frontend": "React + TypeScript",
            "backend": "FastAPI (Python)",
            "db": "PostgreSQL",
            "infra": "Docker + GitLab CI",
        },
        "grounded_on": ["LedgerLite (2024)", "BudgetBuddy (2023)"],
        "timeline_weeks": 6,
        "epics": [
            {
                "id": "E1",
                "title": "Authentication & Accounts",
                "issues": [
                    {
                        "id": "E1-1",
                        "title": "JWT login + refresh endpoint",
                        "description": "Email/password login issuing short-lived "
                        "JWTs with refresh rotation.",
                        "type": "backend",
                        "estimate_days": 2,
                        "risk": "medium",
                        "required_skill": "backend:auth",
                        "context_scope": {
                            "files": ["src/api/auth.py", "src/models/user.py"],
                            "note": "Ignore frontend + infra. Only these 2 files.",
                        },
                        "assignee": "maria",
                    },
                    {
                        "id": "E1-2",
                        "title": "Login screen UI",
                        "description": "Responsive login form wired to the auth API.",
                        "type": "frontend",
                        "estimate_days": 1,
                        "risk": "low",
                        "required_skill": "frontend:forms",
                        "context_scope": {
                            "files": ["src/pages/Login.tsx", "src/api/client.ts"],
                            "note": "Consumes the auth API (E1-1) — needs the interface contract.",
                        },
                        "depends_on": ["E1-1"],
                        "assignee": "sam",
                    },
                ],
            },
            {
                "id": "E2",
                "title": "Bank Sync",
                "issues": [
                    {
                        "id": "E2-1",
                        "title": "Plaid webhook ingestion",
                        "description": "Verify + persist incoming Plaid transaction "
                        "webhooks. High blast radius — payment data.",
                        "type": "backend",
                        "estimate_days": 3,
                        "risk": "high",
                        "required_skill": "backend:integrations",
                        "context_scope": {
                            "files": [
                                "src/api/webhooks.py",
                                "src/services/plaid.py",
                                "src/models/transaction.py",
                            ],
                            "note": "Security-sensitive. Stay in these 3 files.",
                        },
                        "assignee": "maria",
                    },
                    {
                        "id": "E2-2",
                        "title": "Transactions table migration",
                        "description": "Schema + migration for synced transactions.",
                        "type": "db",
                        "estimate_days": 1,
                        "risk": "low",
                        "required_skill": "db:migrations",
                        "context_scope": {
                            "files": ["migrations/0003_transactions.sql"],
                            "note": "One file.",
                        },
                        "assignee": "priya",
                    },
                ],
            },
            {
                "id": "E3",
                "title": "Spending Dashboard",
                "issues": [
                    {
                        "id": "E3-1",
                        "title": "Monthly spend chart",
                        "description": "Category-grouped spend chart on the dashboard.",
                        "type": "frontend",
                        "estimate_days": 2,
                        "risk": "low",
                        "required_skill": "frontend:dataviz",
                        "context_scope": {
                            "files": ["src/pages/Dashboard.tsx", "src/components/SpendChart.tsx"],
                            "note": "Chart only.",
                        },
                        "assignee": "sam",
                    },
                    {
                        "id": "E3-2",
                        "title": "CI pipeline + Docker build",
                        "description": "GitLab CI: lint, test, build image.",
                        "type": "devops",
                        "estimate_days": 2,
                        "risk": "medium",
                        "required_skill": "devops:ci",
                        "context_scope": {
                            "files": [".gitlab-ci.yml", "Dockerfile"],
                            "note": "Pipeline config only.",
                        },
                        "assignee": "priya",
                    },
                ],
            },
        ],
    }
)

CANNED_DEVELOPERS = [
    DeveloperProfile(
        name="Maria Chen", gitlab_username="maria",
        skills_text="Python, FastAPI, auth, OAuth, payment integrations",
        trust_level="high",
        history=[{"task_type": "backend:auth", "score": 0.92}],
    ),
    DeveloperProfile(
        name="Sam Okafor", gitlab_username="sam",
        skills_text="React, TypeScript, forms, dataviz, accessibility",
        trust_level="medium",
        history=[{"task_type": "frontend:forms", "score": 0.81}],
    ),
    DeveloperProfile(
        name="Priya Nair", gitlab_username="priya",
        skills_text="Postgres, migrations, Docker, GitLab CI",
        trust_level="medium",
        history=[{"task_type": "devops:ci", "score": 0.77}],
    ),
    DeveloperProfile(
        name="Dev Newhire", gitlab_username="newhire",
        skills_text="Junior — claims React + Node from CV. Unproven.",
        trust_level="low",
        history=[],
    ),
]

# The DEMO_MODE login roster — mirrors the 5 real seed accounts the frontend picker offers, so login,
# assignee resolution, and relay-lead resolution all line up. uiux stays an orphan gap (no uiux dev),
# which keeps the Team staffing banner truthful.
CANNED_ROSTER = [
    DeveloperProfile(
        name="Teddy", username="Onsraa", gitlab_username="Onsraa",
        skills_text="Delivery management, planning, stakeholder comms.",
        role="manager", seniority="senior", trust_level="high",
    ),
    DeveloperProfile(
        name="Jean Gabriel", username="sprint0-se", gitlab_username="sprint0-se",
        skills_text="Python, FastAPI, auth, OAuth/JWT, payment integrations, Postgres",
        role="developer", discipline="backend", seniority="senior", trust_level="high",
        trust={"backend": "high", "devops": "medium"}, load=60,
        history=[{"task_type": "backend:auth", "score": 0.92}],
    ),
    DeveloperProfile(
        name="Tony Stark", username="sprint0-sse", gitlab_username="sprint0-sse",
        skills_text="Docker, GitLab CI, Kubernetes, observability, Postgres migrations",
        role="developer", discipline="devops", seniority="senior", trust_level="high",
        trust={"devops": "high", "backend": "high"}, load=20,
        history=[{"task_type": "devops:ci", "score": 0.88}],
    ),
    DeveloperProfile(
        name="Sam Dupont", username="sprint0-fe", gitlab_username="sprint0-fe",
        skills_text="React, TypeScript, forms, dataviz, accessibility",
        role="developer", discipline="frontend", seniority="mid", trust_level="medium",
        trust={"frontend": "medium"}, load=30,
        history=[{"task_type": "frontend:forms", "score": 0.81}],
    ),
    DeveloperProfile(
        name="Pascal Alice", username="sprint0-qa", gitlab_username="sprint0-qa",
        skills_text="QA automation, Playwright, acceptance testing, edge cases",
        role="developer", discipline="qa", seniority="mid", trust_level="medium",
        trust={"qa": "medium"}, load=10,
        history=[{"task_type": "qa:acceptance", "score": 0.80}],
    ),
]


def _seat_plan(plan: PlanJSON) -> PlanJSON:
    """Map a plan's draft assignees onto the demo login roster by discipline, so the plan, the relay,
    and the Work board all show the same people (the canned plan ships maria/sam/priya placeholders)."""
    p = plan.model_copy(deep=True)
    owner = {m.discipline: m.username for m in CANNED_ROSTER if m.role == "developer" and m.discipline}
    for epic in p.epics:
        for i in epic.issues:
            if owner.get(i.discipline):
                i.assignee = owner[i.discipline]
    return p


DEMO_PLAN = _seat_plan(CANNED_PLAN)  # the roster-seated working copy seed_demo + CANNED_PROJECTS both use
DEMO_PLAN.project_name = "Atlas Billing"  # the seeded in-progress board — a DISTINCT name from the wizard's FinTrack (so they never collide)

# ── Demo-mode fixtures (Phase 6 hybrid deploy) ──────────────────────────
# Returned by the gated `generate_*` agents when DEMO_MODE is on, so the public URL
# runs the full real path (FastAPI → MongoDB MCP retrieval) with canned Gemini output.
# All themed to the same FinTrack narrative as CANNED_PLAN for a coherent walkthrough.

CANNED_ARCHITECTURES = ArchitectureOptions.model_validate(
    {
        "cards": [
            {
                "name": "Fast Managed SaaS",
                "tech_stack": {
                    "frontend": "React + TypeScript",
                    "backend": "FastAPI (Python)",
                    "db": "PostgreSQL (managed)",
                    "infra": "Docker + GitLab CI",
                },
                "summary": "Ship quickly on managed services; least ops, fastest to first demo.",
                "rationale": "Mirrors LedgerLite (2024) which shipped in 6 weeks; Maria fits auth, Sam fits the dashboard.",
                "grounded_on": ["LedgerLite (2024)", "BudgetBuddy (2023)"],
                "fit_to_constraints": "Fast time-to-market, standard reliability, medium scale.",
                "pros": ["Fastest to ship", "Least ops", "Proven path"],
                "cons": ["Less headroom at scale"],
                "reuse": [
                    {"from_project": "LedgerLite (2024)", "feature": "JWT auth + refresh", "action": "reuse"},
                    {"from_project": "BudgetBuddy (2023)", "feature": "Plaid webhook ingestion", "action": "adapt"},
                ],
            },
            {
                "name": "Scalable Event Core",
                "tech_stack": {
                    "frontend": "React + TypeScript",
                    "backend": "FastAPI + event queue",
                    "db": "PostgreSQL + Redis",
                    "infra": "Kubernetes + GitLab CI",
                },
                "summary": "Queue-backed ingestion for bank-sync spikes; more ops for higher headroom.",
                "rationale": "BudgetBuddy's webhook backlog hurt under load; a queue absorbs Plaid bursts. Priya fits the infra.",
                "grounded_on": ["BudgetBuddy (2023)"],
                "fit_to_constraints": "Higher scalability + reliability; slower to first ship.",
                "pros": ["Absorbs traffic spikes", "Higher headroom"],
                "cons": ["More ops", "Slower to ship"],
                "reuse": [
                    {"from_project": "BudgetBuddy (2023)", "feature": "Queue-backed ingestion", "action": "reuse"},
                ],
            },
        ],
        # the AI's OWN pick DIVERGES from the deterministic 'most reuse' badge (Fast Managed) → shows the tension
        "ai_pick_name": "Scalable Event Core",
        "ai_pick_why": "The brief's bank-sync spikes will outgrow the managed path within a quarter — build for it now.",
    }
)

CANNED_SPEC = ClarifiedSpec.model_validate(
    {
        "goal": "A personal-finance SaaS with bank-sync, budgets, and a spending dashboard.",
        "users": ["Individual savers", "Household budgeters"],
        "must_haves": [
            "Secure email/password login",
            "Bank account sync (Plaid)",
            "Category-grouped spending dashboard",
        ],
        "constraints": ["6-week timeline", "Web-first", "Handles payment data — security-sensitive"],
        "ambiguities": [
            {
                "id": "amb-1",
                "feature": "Bank sync",
                "question": "Real bank connectivity or a sandbox for the first release?",
                "options": ["Plaid production", "Plaid sandbox only", "Manual CSV import"],
                "resolution": None,
            },
            {
                "id": "amb-2",
                "feature": "Budgets",
                "question": "Are budgets per-category, a single overall cap, or both?",
                "options": ["Per-category", "Single overall cap", "Both"],
                "resolution": None,
            },
        ],
        "reuse": [
            {"from_project": "LedgerLite (2024)", "feature": "JWT auth + refresh", "action": "reuse"},
            {"from_project": "BudgetBuddy (2023)", "feature": "Plaid webhook ingestion", "action": "adapt"},
        ],
    }
)

# Demo judgment for judge_memory — capability-level, graded on the RESOLVED spec (after ambiguities).
CANNED_MEMORY = MemoryJudgment(
    candidates=[
        MemoryCandidate(ref="LedgerLite", project="LedgerLite", year="2024", capability="JWT auth + refresh",
                        what="Token issue and refresh with session handling for secure login.",
                        reason="Personal-finance domain match. The auth flow fits secure login as is.", fit="strong",
                        pros=["Battle-tested in production", "Drop-in for the login feature"],
                        cons=["Tied to its own user model"], used=True),
        MemoryCandidate(ref="BudgetBuddy", project="BudgetBuddy", year="2023", capability="Plaid webhook ingestion",
                        what="Bank-sync ingestion via Plaid webhooks with retry.",
                        reason="Bank sync is relevant but this brief's budgets model differs.", fit="partial",
                        pros=["Saves the Plaid wiring"], cons=["Budgets schema differs", "Needs a re-map"], used=False),
    ]
)

CANNED_SOLUTIONS = SolutionSet.model_validate(
    {
        "discipline": "",  # the server (propose_solutions) stamps the real gate discipline
        "solutions": [
            {  # memory + grounded + high conf → GREEN (grade derived from the seeded QuantaPay decision)
                "source": "memory",
                "title": "Reuse QuantaPay JWT+TOTP auth",
                "summary": "Lift the battle-tested JWT login + TOTP + refresh-rotation slice from QuantaPay.",
                "rationale": "Shipped and prod-survived in QuantaPay (2024); least risk for a security-sensitive gate.",
                "pros": ["Battle-tested", "Fastest path", "Security reviewed"],
                "cons": ["Slightly dated deps"],
                "confidence": 84,
                "grounded_on": ["QuantaPay (2024)"],
                # reused files exist in agency memory → modify; only the new route is an add (honest demo change-types)
                "file_changes": [{"path": "services/auth/jwt.py", "change": "modify"}, {"path": "services/auth/totp.py", "change": "modify"}, {"path": "api/routes/auth.py", "change": "add"}],
                "grade": "prod_survived",  # demo: pre-set (all canned data is fabricated); LIVE derives from real decisions
            },
            {  # fresh option that CONTRADICTS the standing reuse decision → ORANGE (conflict + warning)
                "source": "ai",
                "title": "Adopt Auth0 managed identity",
                "summary": "Outsource auth entirely to Auth0 instead of the in-house module.",
                "rationale": "Less to maintain, but a new vendor dependency that cuts against the proven reuse path.",
                "pros": ["No auth code to own", "SSO out of the box"],
                "cons": ["New vendor lock-in", "Migration + data residency"],
                # swap to a vendor → new client, drop the in-house module (remove is honest: legacy_jwt exists)
                "file_changes": [{"path": "services/auth/auth0_client.py", "change": "add"}, {"path": "api/routes/auth.py", "change": "add"}, {"path": "services/auth/legacy_jwt.py", "change": "remove"}],
                "confidence": 66,
                "grounded_on": [],
                "conflict": True,
                "conflict_reason": "Contradicts the team decision to reuse the QuantaPay JWT+TOTP module (prod-survived).",
            },
            {  # fresh + ungrounded → GREY (no memory backing it, the AI's own bet)
                "source": "ai",
                "title": "Greenfield passkeys + WebAuthn",
                "summary": "Build passwordless auth from scratch with WebAuthn passkeys.",
                "rationale": "Modern UX and fewer passwords, but unproven in our codebase and longer to harden.",
                "pros": ["Modern UX", "Fewer passwords"],
                "cons": ["Unproven here", "Longer to harden"],
                # greenfield → all new files (add)
                "file_changes": [{"path": "services/auth/webauthn.py", "change": "add"}, {"path": "api/routes/auth.py", "change": "add"}, {"path": "models/credential.py", "change": "add"}],
                "confidence": 58,
                "grounded_on": [],
            },
        ],
    }
)

# DEMO: discipline-appropriate solution sets so each gate's reuse-or-innovate reads coherently. ONLY the
# backend set (the auth set above) reuses from memory — the agency genuinely has QuantaPay auth code. The
# agency has NO CI/UI/e2e precedent, so devops/frontend/qa are honestly FRESH (innovate) — no `memory`
# source / `grounded_on`, so no (mismatched) reuse pack is shown.
_DEVOPS_SOLUTIONS = SolutionSet.model_validate({"discipline": "", "solutions": [
    {"source": "ai", "title": "GitLab CI + multi-stage Docker", "summary": "Lint → test → build → push on GitLab CI, with a cached multi-stage Dockerfile.",
     "rationale": "No CI precedent in agency memory; a fresh-but-conventional pipeline on the team's stack.",
     "pros": ["Conventional", "Cache-warm builds", "One registry"], "cons": ["Tied to GitLab CI"], "confidence": 78, "grounded_on": [],
     "file_changes": [{"path": ".gitlab-ci.yml", "change": "add"}, {"path": "Dockerfile", "change": "add"}]},
    {"source": "ai", "title": "GitHub Actions matrix", "summary": "Re-platform CI onto a GitHub Actions build matrix (Py 3.11/3.12).",
     "rationale": "More marketplace actions, but a re-platform away from the team's GitLab runners.",
     "pros": ["Rich action ecosystem", "Matrix builds"], "cons": ["Re-platform cost", "Two CI systems"], "confidence": 60, "grounded_on": [],
     "file_changes": [{"path": ".github/workflows/ci.yml", "change": "add"}, {"path": ".gitlab-ci.yml", "change": "remove"}]},
    {"source": "ai", "title": "Self-hosted k8s runners", "summary": "Run CI on autoscaling self-hosted Kubernetes runners.",
     "rationale": "Cheaper at scale, unproven here and more to operate.", "pros": ["Cheaper at scale"], "cons": ["Ops burden", "Unproven here"], "confidence": 52, "grounded_on": [],
     "file_changes": [{"path": ".gitlab-ci.yml", "change": "add"}, {"path": "k8s/runners.yaml", "change": "add"}]},
]})
_FRONTEND_SOLUTIONS = SolutionSet.model_validate({"discipline": "", "solutions": [
    {"source": "ai", "title": "Build on the design system", "summary": "Build the login screen + spend chart on the in-house design-system tokens + recharts.",
     "rationale": "No reusable UI in agency memory; a fresh build on the design system keeps it consistent.",
     "pros": ["Token-consistent", "A11y baseline", "No new deps"], "cons": ["Components to write"], "confidence": 76, "grounded_on": [],
     "file_changes": [{"path": "src/views/Login.tsx", "change": "add"}, {"path": "src/views/SpendChart.tsx", "change": "add"}]},
    {"source": "ai", "title": "Greenfield with shadcn/ui", "summary": "Rebuild the login + chart screens fresh on shadcn/ui + Tailwind.",
     "rationale": "Cleaner modern components, but a fresh build vs the proven reuse path.",
     "pros": ["Modern components", "Full control"], "cons": ["Longer to build", "No memory backing"], "confidence": 61, "grounded_on": [],
     "file_changes": [{"path": "src/views/Login.tsx", "change": "add"}, {"path": "src/components/ui/button.tsx", "change": "add"}]},
    {"source": "ai", "title": "Server-driven UI", "summary": "Render the dashboard from a server-described layout JSON.",
     "rationale": "Flexible later, over-engineered for two screens and unproven here.", "pros": ["Config-driven"], "cons": ["Over-engineered here", "Unproven"], "confidence": 49, "grounded_on": [],
     "file_changes": [{"path": "src/views/Dashboard.tsx", "change": "modify"}, {"path": "src/lib/layoutSchema.ts", "change": "add"}]},
]})
_QA_SOLUTIONS = SolutionSet.model_validate({"discipline": "", "solutions": [
    {"source": "ai", "title": "Playwright e2e on critical paths", "summary": "A fresh Playwright suite over login + bank-sync, wired into CI.",
     "rationale": "No acceptance suite in agency memory; build the critical-path coverage fresh.",
     "pros": ["Real browser flows", "CI-wired"], "cons": ["Selectors to maintain"], "confidence": 75, "grounded_on": [],
     "file_changes": [{"path": "e2e/login.spec.ts", "change": "add"}, {"path": "e2e/banksync.spec.ts", "change": "add"}]},
    {"source": "ai", "title": "Contract tests with Pact", "summary": "Add consumer-driven contract tests on the auth + transactions APIs.",
     "rationale": "Stronger interface guarantees, new tooling for the team.", "pros": ["Contract safety net"], "cons": ["New tooling", "Setup cost"], "confidence": 57, "grounded_on": [],
     "file_changes": [{"path": "tests/pact/auth.pact.ts", "change": "add"}, {"path": "tests/pact/transactions.pact.ts", "change": "add"}]},
]})
CANNED_SOLUTIONS_BY_DISC: dict[str, SolutionSet] = {
    "backend": CANNED_SOLUTIONS, "devops": _DEVOPS_SOLUTIONS, "frontend": _FRONTEND_SOLUTIONS, "qa": _QA_SOLUTIONS,
}


def solutions_for(discipline: str) -> SolutionSet:
    """DEMO: the discipline's canned reuse-or-innovate set (deep copy — gate_solutions mutates grade/signal).
    Fallback = a single neutral 'Define this slice' card so an unmapped lane never shows another lane's set."""
    base = CANNED_SOLUTIONS_BY_DISC.get(discipline) or SolutionSet.model_validate(
        {"discipline": "", "solutions": [{"source": "ai", "title": "Define this slice",
         "summary": "Describe the approach for this gate, or write your own.", "confidence": 50}]})
    s = base.model_copy(deep=True)
    s.discipline = discipline
    return s


# DEMO: the contract shape options a producer discipline offers — generated JIT when its gate is ratified
# (_generate_contracts_for_lane). Only backend produces a cross-discipline API in the demo (E1-1 auth → E1-2
# frontend); other lanes have no real boundary → needed=False (the necessity-aware "no contract, no noise").
def contract_options_for(discipline: str) -> ContractProposalSet:
    if discipline != "backend":
        return ContractProposalSet(needed=False, skip_reason="no cross-discipline API on this slice")
    jwt = InterfaceDraft(
        method="POST", path="/api/auth/login",
        request_fields=[SchemaField(name="email"), SchemaField(name="password")],
        response_fields=[SchemaField(name="access_token"), SchemaField(name="refresh_token"), SchemaField(name="expires_in", type="integer")],
        errors=["401 invalid_credentials", "429 rate_limited"], note="Token in the body — the frontend stores + refreshes it.")
    session = InterfaceDraft(
        method="POST", path="/api/auth/session",
        request_fields=[SchemaField(name="email"), SchemaField(name="password")],
        response_fields=[SchemaField(name="user_id"), SchemaField(name="expires_in", type="integer")],
        errors=["401 invalid_credentials"], note="Cookie session — no token handling in the frontend.")
    return ContractProposalSet(needed=True, proposals=[
        InterfaceProposal(id="p-reuse", source="memory", interface=jwt,
            why="Reuse QuantaPay's proven login response", pros=["Battle-tested", "Fields the FE already knows"],
            cons=["Token handling on the FE"], grounded_on=["QuantaPay (2024)"], confidence=84),
        InterfaceProposal(id="p-fresh", source="ai", interface=session,
            why="Cookie session instead of a token in the body", pros=["No token handling on the FE"],
            cons=["Needs CSRF protection"], confidence=62),
    ])


def shape_from_desc(desc: str) -> InterfaceDraft:
    """DEMO: a stub interface draft seeded from a one-line description — the human edits it in the editor."""
    return InterfaceDraft(
        method="POST", path="/api/endpoint",
        request_fields=[SchemaField(name="input")],
        response_fields=[SchemaField(name="result")],
        note=(desc or "")[:140])


CANNED_CV = ParsedCV(
    name="Nia Petrova",
    gitlab_username="nia-petrova",
    skills_text="Python, FastAPI, PostgreSQL, payment integrations, OAuth/JWT auth, Docker, GitLab CI; "
    "5 years backend, fintech domain.",
    suggested_discipline="backend",
)

# The 5 agents reachable from the public UI that were hitting Vertex live (QA gate, reschedule
# strategist, Decision Card, conflict pass, user-solution regen). Themed to the FinTrack narrative.
CANNED_QA_REPORT = QAReport.model_validate(
    {
        "items": [
            {"issue_id": "E1-1", "title": "JWT login + refresh endpoint", "verdict": "needs_human",
             "note": "Auth on payment data — a human should eyeball token rotation on staging.",
             "runner": "sprint0-se", "disc": "backend"},
            {"issue_id": "E3-1", "title": "Monthly spend chart", "verdict": "pass",
             "note": "Straightforward dataviz, low risk.", "runner": "sprint0-fe", "disc": "frontend"},
            {"issue_id": "E3-2", "title": "CI pipeline + Docker build", "verdict": "pass",
             "note": "Standard GitLab CI: lint, test, build image.", "runner": "sprint0-sse", "disc": "devops"},
        ],
        "reopened": [],
        "tester": {"username": "sprint0-qa", "name": "Pascal Alice", "discipline": "qa",
                   "score": 0.86, "reason": "owns the accept lane — verification trust medium"},
    }
)

CANNED_STRATEGY = RescheduleStrategy(
    action="right_shift",
    target_task_ids=[],
    rationale="Minor slip; let the affected tasks slide rather than reassign mid-flight.",
    confidence=74,
    impact_summary="The dashboard chart shifts about two days; no owner or scope change.",
)

CANNED_DECISION_CARD = DecisionCardPass1.model_validate(
    {
        "domain": "backend",
        "context": "JWT auth for payment data",
        "recommendation": "Reuse LedgerLite JWT with refresh rotation",
        "confidence": 78,
        "pros": ["Battle-tested in prod", "Fastest secure path", "Already security reviewed"],
        "cons": ["Slightly dated deps", "Less modern UX"],
    }
)

CANNED_CONFLICT = ConflictVerdict(conflict=False, conflict_reason="")

CANNED_REGEN = RegeneratedSlice.model_validate(
    {
        "issues": [
            {"id": "E1-1", "title": "Custom session auth (team-written)",
             "description": "Implement the lead's own session-cookie auth in place of the AI options.",
             "files": ["src/api/auth.py", "src/api/session.py"]},
        ]
    }
)

# ── Demo workspace data (served by the gated read endpoints when DEMO_MODE is on) ──
# seed_demo() materializes CANNED_PLAN under this id so the active project, its relay, and its
# tasks all line up; CANNED_PROJECTS surfaces the same project + the two memory references it reused.
DEMO_PROJECT_ID = 4201
DEMO_PLAN_ID = "demo-fintrack"

_FINTRACK_RECORD = ProjectRecord(
    project_id=DEMO_PROJECT_ID, name="Atlas Billing",
    web_url="https://gitlab.com/sprint0-demo/atlas-billing",
    tech_stack=DEMO_PLAN.tech_stack, grounded_on=DEMO_PLAN.grounded_on,
    plan=DEMO_PLAN, status="in_progress",
)

CANNED_PROJECTS = [
    {**_FINTRACK_RECORD.model_dump(), "kind": "active", "last_activity_at": "2026-05-31T16:00:00Z"},
    {"project_id": 4187, "name": "LedgerLite", "web_url": "https://gitlab.com/sprint0-demo/ledgerlite",
     "kind": "reference", "status": "shipped",
     "tech_stack": {"frontend": "React + TypeScript", "backend": "FastAPI (Python)", "db": "PostgreSQL",
                    "infra": "Docker + GitLab CI"},
     "tags": ["fintech", "auth", "jwt"],
     "summary": "Personal ledger; JWT auth + refresh-rotation shipped in 6 weeks. Reused by FinTrack.",
     "last_activity_at": "2026-04-12T10:00:00Z"},
    {"project_id": 4163, "name": "BudgetBuddy", "web_url": "https://gitlab.com/sprint0-demo/budgetbuddy",
     "kind": "reference", "status": "shipped",
     "tech_stack": {"frontend": "React", "backend": "FastAPI + event queue", "db": "PostgreSQL + Redis",
                    "infra": "Kubernetes + GitLab CI"},
     "tags": ["fintech", "plaid", "ingestion"],
     "summary": "Budgeting app; Plaid webhook ingestion (queue-backed). Adapted by FinTrack.",
     "last_activity_at": "2026-03-02T10:00:00Z"},
]

# ── Living Project Graph (reuse lineage) demo seed ──
# QuantaPay's JWT+TOTP auth (the same battle-tested slice CANNED_SOLUTIONS lifts) is ONE content-addressed
# feature node reused by all 3 workspace projects → 3 `derived_from` edges to ONE node (dedup: 1 node, N
# edges, not N copies). A `source_changed` event on it proposes a sync task in each dependent. project_id
# "lineage" isolates this graph so a /api/graph/build on "local" can never clobber it.
LINEAGE_PID = "lineage"
LINEAGE_FEATURE = {
    "path": "feat:qpauth0001", "node_type": "feature", "project_id": LINEAGE_PID, "domain": "backend",
    "title": "QuantaPay JWT+TOTP auth", "content_hash": "sha256:qpauth0001", "loc": 180,
    "source_project_id": 5001,  # the GitLab repo the canonical source lives in → a real merge webhook maps here (P6)
}
LINEAGE_DEPENDENTS = [  # each project's auth INSTANCE — same content_hash (identical reused code), real ref_project_id
    {"path": "proj:atlas/auth", "node_type": "feature", "project_id": LINEAGE_PID, "domain": "backend",
     "title": "Atlas Billing · auth", "content_hash": "sha256:qpauth0001", "ref_project_id": 4201},
    {"path": "proj:ledgerlite/auth", "node_type": "feature", "project_id": LINEAGE_PID, "domain": "backend",
     "title": "LedgerLite · auth", "content_hash": "sha256:qpauth0001", "ref_project_id": 4187},
    {"path": "proj:budgetbuddy/auth", "node_type": "feature", "project_id": LINEAGE_PID, "domain": "backend",
     "title": "BudgetBuddy · auth", "content_hash": "sha256:qpauth0001", "ref_project_id": 4163},
]
LINEAGE_FEATURE_ALT = {  # a SEMANTIC near-dup of QuantaPay auth (same intent, different impl + hash) — P5 dedup demo
    "path": "feat:auth0oidc01", "node_type": "feature", "project_id": LINEAGE_PID, "domain": "backend",
    "title": "Auth0 social + OIDC login", "content_hash": "sha256:auth0oidc01", "loc": 140, "ref_project_id": None,
}
LINEAGE_NODES = [LINEAGE_FEATURE, LINEAGE_FEATURE_ALT, *LINEAGE_DEPENDENTS]
LINEAGE_EDGES = [
    {"from_path": d["path"], "to_path": LINEAGE_FEATURE["path"], "edge_type": "derived_from", "project_id": LINEAGE_PID}
    for d in LINEAGE_DEPENDENTS
]

CANNED_DECISIONS = [
    Decision(
        id="dec_demo_1", owner_id="Onsraa", domain="backend",
        context_tags=["auth", "jwt"], recommendation="Reuse LedgerLite JWT auth + refresh rotation",
        reasoning="Security-sensitive gate; LedgerLite's slice shipped and survived prod, so reuse beats a rebuild.",
        project_id=DEMO_PLAN_ID, project_name="Atlas Billing", issue_ids=["E1-1", "E1-2"],
        outcome_validated=True, visibility="team", grade="prod_survived",
        merged=True, qa_passed=True, days_clean=21,
        created_at="2026-05-20T10:00:00Z", updated_at="2026-05-31T10:00:00Z",
    ).model_dump(),
    Decision(
        id="dec_demo_2", owner_id="Onsraa", domain="frontend",
        context_tags=["dataviz"], recommendation="Fresh category spend chart (no reuse fit)",
        reasoning="No past dashboard slice matched the brief, so a focused category chart was built from scratch.",
        project_id=DEMO_PLAN_ID, project_name="Atlas Billing", issue_ids=["E3-1"],
        outcome_validated=True, visibility="team", grade="shipped",
        merged=True, qa_passed=True, days_clean=4,
        created_at="2026-05-25T10:00:00Z", updated_at="2026-05-30T10:00:00Z",
    ).model_dump(),
    Decision(  # #33 — graded reference on the REUSED past project, so the canned auth Contract earns its green
        id="dec_demo_3", owner_id="sprint0-se", domain="backend",
        context_tags=["auth", "jwt", "totp"], recommendation="Reuse the QuantaPay JWT+TOTP auth module",
        reasoning="Battle-tested and reused since QuantaPay; least risk for a security gate.",
        project_id="seed-quantapay", project_name="QuantaPay (2024)", issue_ids=[],
        outcome_validated=True, visibility="team", grade="prod_survived",
        merged=True, qa_passed=True, days_clean=30,
        created_at="2024-08-01T00:00:00Z", updated_at="2024-08-01T00:00:00Z",
    ).model_dump(),
]

CANNED_INBOX = [
    Notification(id="ntf_demo_1", user_id="Onsraa", type="project_shipped",
        title="Atlas Billing reached the acceptance gate",
        body="The relay cleared build + integration; QA holds the baton.",
        ref={"plan_id": DEMO_PLAN_ID}, read=False, created_at="2026-05-31T15:30:00Z").model_dump(),
    Notification(id="ntf_demo_2", user_id="Onsraa", type="task_completed",
        title="Maria Chen completed JWT login + refresh",
        ref={"project_id": DEMO_PROJECT_ID}, read=False, created_at="2026-05-31T14:00:00Z").model_dump(),
    Notification(id="ntf_demo_3", user_id="Onsraa", type="reschedule_proposed",
        title="AI proposed a right-shift after a re-estimate", actionable=True,
        ref={}, read=True, created_at="2026-05-30T09:00:00Z").model_dump(),
]
