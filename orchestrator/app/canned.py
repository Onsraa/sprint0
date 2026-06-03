"""Canned fixtures for Phase 1 stubs. Real RAG/Gemini output replaces these in
Phase 3. Kept schema-valid so the frontend + tests exercise the real contract.
"""
from app.contracts import (
    ArchitectureOptions, ClarifiedSpec, ConflictVerdict, Decision, DecisionCardPass1, DeveloperProfile,
    Notification, ParsedCV, PlanJSON, ProjectRecord, QAReport, RegeneratedSlice, RescheduleStrategy, SolutionSet,
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
                            "note": "No backend context needed.",
                        },
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
            },
        ]
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
                "grade": "prod_survived",  # demo: pre-set (all canned data is fabricated); LIVE derives from real decisions
            },
            {  # fresh option that CONTRADICTS the standing reuse decision → ORANGE (conflict + warning)
                "source": "ai",
                "title": "Adopt Auth0 managed identity",
                "summary": "Outsource auth entirely to Auth0 instead of the in-house module.",
                "rationale": "Less to maintain, but a new vendor dependency that cuts against the proven reuse path.",
                "pros": ["No auth code to own", "SSO out of the box"],
                "cons": ["New vendor lock-in", "Migration + data residency"],
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
                "confidence": 58,
                "grounded_on": [],
            },
        ],
    }
)

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
    project_id=DEMO_PROJECT_ID, name="FinTrack",
    web_url="https://gitlab.com/sprint0-demo/fintrack",
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

CANNED_DECISIONS = [
    Decision(
        id="dec_demo_1", owner_id="Onsraa", domain="backend",
        context_tags=["auth", "jwt"], recommendation="Reuse LedgerLite JWT auth + refresh rotation",
        reasoning="Security-sensitive gate; LedgerLite's slice shipped and survived prod, so reuse beats a rebuild.",
        project_id=DEMO_PLAN_ID, project_name="FinTrack", issue_ids=["E1-1", "E1-2"],
        outcome_validated=True, visibility="team", grade="prod_survived",
        merged=True, qa_passed=True, days_clean=21,
        created_at="2026-05-20T10:00:00Z", updated_at="2026-05-31T10:00:00Z",
    ).model_dump(),
    Decision(
        id="dec_demo_2", owner_id="Onsraa", domain="frontend",
        context_tags=["dataviz"], recommendation="Fresh category spend chart (no reuse fit)",
        reasoning="No past dashboard slice matched the brief, so a focused category chart was built from scratch.",
        project_id=DEMO_PLAN_ID, project_name="FinTrack", issue_ids=["E3-1"],
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
        title="FinTrack reached the acceptance gate",
        body="The relay cleared build + integration; QA holds the baton.",
        ref={"plan_id": DEMO_PLAN_ID}, read=False, created_at="2026-05-31T15:30:00Z").model_dump(),
    Notification(id="ntf_demo_2", user_id="Onsraa", type="task_completed",
        title="Maria Chen completed JWT login + refresh",
        ref={"project_id": DEMO_PROJECT_ID}, read=False, created_at="2026-05-31T14:00:00Z").model_dump(),
    Notification(id="ntf_demo_3", user_id="Onsraa", type="reschedule_proposed",
        title="AI proposed a right-shift after a re-estimate", actionable=True,
        ref={}, read=True, created_at="2026-05-30T09:00:00Z").model_dump(),
]
