"""Canned fixtures for Phase 1 stubs. Real RAG/Gemini output replaces these in
Phase 3. Kept schema-valid so the frontend + tests exercise the real contract.
"""
from app.contracts import DeveloperProfile, PlanJSON

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
