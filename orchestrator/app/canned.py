"""Canned fixtures for Phase 1 stubs. Real RAG/Gemini output replaces these in
Phase 3. Kept schema-valid so the frontend + tests exercise the real contract.
"""
from app.contracts import (
    ArchitectureOptions, ClarifiedSpec, DeveloperProfile, ParsedCV, PlanJSON, SolutionSet,
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
            {
                "source": "memory",
                "title": "Reuse LedgerLite JWT auth",
                "summary": "Lift the proven JWT login + refresh-rotation slice from LedgerLite.",
                "rationale": "Shipped and prod-survived in LedgerLite (2024); least risk for a security-sensitive gate.",
                "pros": ["Battle-tested", "Fastest path", "Security reviewed"],
                "cons": ["Slightly dated deps"],
                "confidence": 82,
                "grounded_on": ["LedgerLite (2024)"],
            },
            {
                "source": "ai",
                "title": "Fresh OAuth + passkeys",
                "summary": "Greenfield auth with social OAuth and WebAuthn passkeys.",
                "rationale": "Modern UX and fewer passwords, but unproven in our codebase and longer to harden.",
                "pros": ["Modern UX", "Fewer passwords"],
                "cons": ["Unproven here", "Longer to harden"],
                "confidence": 64,
                "grounded_on": [],
                "delta_note": "variant of LedgerLite + passkeys",
            },
        ],
    }
)

CANNED_CV = ParsedCV(
    name="Nia Petrova",
    gitlab_username="nia-petrova",
    skills_text="Python, FastAPI, PostgreSQL, payment integrations, OAuth/JWT auth, Docker, GitLab CI; "
    "5 years backend, fintech domain.",
)
