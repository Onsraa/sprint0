"""Role policy — the deterministic table the app consults for repo ACCESS + WORKTYPE.

Two axes, kept separate (see contracts.py):
  - Role / craft = WHAT you do (backend/frontend/uiux/qa/devops/marketing/content/pm/manager).
                   Drives access + which issue `kind`s + the relay gate. Defined HERE.
  - Rating       = HOW trusted (seniority + per-discipline trust). Drives autonomy. NOT here.
    ("junior" is a rating, not a role.)

Access is a TABLE, never an AI guess: auditable, least-privilege, instant. The AI's job is
upstream STAFFING (which roles a brief needs); this table only sets what each role may touch.
Code crafts map to a relay gate (a Discipline); non-code crafts (marketing/content) don't yet
— non-code relay gates are deferred, so those rows are forward-looking.
"""
from __future__ import annotations

# craft → {access: write|read|none, kinds: [issue kinds], gate: Discipline|None}
# Edit this table to change access; never infer access anywhere else.
_POLICY: dict[str, dict] = {
    "backend":   {"access": "write", "kinds": ["code", "infra"], "gate": "backend"},
    "frontend":  {"access": "write", "kinds": ["code"],          "gate": "frontend"},
    "devops":    {"access": "write", "kinds": ["infra"],         "gate": "devops"},
    "uiux":      {"access": "read",  "kinds": ["design"],        "gate": "uiux"},
    "qa":        {"access": "read",  "kinds": ["audit"],         "gate": "qa"},
    "marketing": {"access": "none",  "kinds": ["content"],       "gate": None},
    "content":   {"access": "none",  "kinds": ["content"],       "gate": None},
    "pm":        {"access": "read",  "kinds": [],                "gate": None},
    "manager":   {"access": "read",  "kinds": [],                "gate": None},
}
_DEFAULT = {"access": "read", "kinds": ["code"], "gate": None}


def policy_for(craft: str | None) -> dict:
    return _POLICY.get(craft or "", _DEFAULT)


def repo_access(craft: str | None) -> str:
    return policy_for(craft)["access"]


def needs_repo(craft: str | None) -> bool:
    """True if this craft should be invited to the repo (write or read access)."""
    return policy_for(craft)["access"] != "none"


def gate_for(craft: str | None):
    """The relay gate (Discipline) this craft owns, or None for non-code crafts."""
    return policy_for(craft)["gate"]
