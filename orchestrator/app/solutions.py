"""Reuse-or-Innovate — pure helpers for the Contract solution flow (no I/O, deterministic, testable).

The LLM proposes memory/ai solutions (reason.propose_solutions); these functions do the deterministic
server-side finishing: which files a gate touches, the impacted set (slice ∪ graph dependents), finalizing
a solution set (ids + the write-your-own slot), and the cross-gate overlap that flags a re-ratify.
"""
from __future__ import annotations

from app.contracts import PlanJSON, SolutionCard, SolutionSet


def gate_slice_files(plan: PlanJSON, discipline: str) -> set[str]:
    """The files the issues in this discipline's slice touch (context_scope)."""
    return {f for e in plan.epics for i in e.issues if i.discipline == discipline
            for f in (i.context_scope.files or [])}


def impacted_files(slice_files: set[str], dependents: dict[str, list[str]] | None = None) -> list[str]:
    """slice files ∪ their graph dependents (dependents: file → files that import it). Sorted, deduped."""
    out = set(slice_files)
    for f in slice_files:
        out.update((dependents or {}).get(f, []))
    return sorted(out)


def finalize_solution_set(sset: SolutionSet, discipline: str, impacted: list[str]) -> SolutionSet:
    """Assign ids, force LLM `source` to memory|ai (never `user`), attach the gate's impacted files, and
    append the write-your-own slot. The LLM's memory/ai labelling is trusted; only `user` is server-built."""
    for n, s in enumerate(sset.solutions):
        s.id = f"sol_{discipline}_{n}"
        if s.source == "user":
            s.source = "ai"
        s.impacted_files = impacted
    sset.discipline = discipline
    sset.solutions.append(SolutionCard(
        id=f"sol_{discipline}_user", source="user",
        title="Write your own", summary="Propose a solution the AI didn't.", impacted_files=[],
    ))
    return sset


def cross_gate_overlap(plan: PlanJSON, discipline: str, impacted: list[str]) -> list[str]:
    """Other disciplines whose slice files intersect `impacted` — they should re-ratify (we never
    auto-rewrite another discipline's slice; the manager is flagged instead)."""
    imp = set(impacted)
    others: set[str] = set()
    for e in plan.epics:
        for i in e.issues:
            if i.discipline != discipline and imp.intersection(i.context_scope.files or []):
                others.add(i.discipline)
    return sorted(others)
