"""Reuse-or-Innovate — pure helpers for the Contract solution flow (no I/O, deterministic, testable).

The LLM proposes memory/ai solutions (reason.propose_solutions); these functions do the deterministic
server-side finishing: which files a gate touches, the impacted set (slice ∪ graph dependents), finalizing
a solution set (ids + the write-your-own slot), and the cross-gate overlap that flags a re-ratify.
"""
from __future__ import annotations

from app.contracts import FileChange, PlanJSON, SolutionSet


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


def classify_file_changes(impacted: list[str], existing: set[str] | None) -> list[FileChange]:
    """Per-file change kind, decided against the FEATURE repo's CURRENT tree (`existing`) — a path already
    in the repo = `modify`, a path that isn't there yet = `add`. A brand-new project passes an empty
    `existing`, so every slice file is an `add` (never the old all-`modify` default). Deterministic — the
    server classifies against ground truth, never the LLM guessing. `remove` is left to explicit intent."""
    have = existing or frozenset()
    return [FileChange(path=p, change=("modify" if p in have else "add")) for p in impacted]


def finalize_solution_set(sset: SolutionSet, discipline: str, impacted: list[str],
                          existing: set[str] | None = None) -> SolutionSet:
    """Assign ids, force LLM `source` to memory|ai (never `user`), attach the gate's impacted files + each
    file's change KIND classified against the feature repo (`existing`). The write-your-own slot is the
    FRONTEND's own (RatifyPanel renders it), so the set stays AI/memory-only — the server no longer appends
    a `user` card (that produced a duplicate slot in the gate)."""
    changes = classify_file_changes(impacted, existing)
    have = existing or frozenset()
    for n, s in enumerate(sset.solutions):
        s.id = f"sol_{discipline}_{n}"
        if s.source == "user":
            s.source = "ai"
        s.impacted_files = impacted
        if s.file_changes:
            # RECLASSIFY the card's own paths against the repo's real tree — a brand-new project → every file
            # is `add` (never a demo-authored "modify"/"remove"). Reuse is INSPIRATION: the dev creates/edits
            # the files, the program never auto-modifies or removes them, so we only ever show add | modify.
            s.file_changes = [c.model_copy(update={"change": ("modify" if c.path in have else "add")}) for c in s.file_changes]
        else:
            s.file_changes = [c.model_copy() for c in changes]
    sset.discipline = discipline
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
