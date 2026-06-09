"""ReAct trace — record the agent's REAL Reason→Action steps per run (Gemini reasoning · MongoDB MCP
vector search · GitLab REST), so the UI can replay them as a live loop instead of a fake spinner. This is
the demo-video headline: it makes the agentic, tool-using, MCP-grounded work VISIBLE.

In-mem, per-run, best-effort — a trace failure must NEVER break the actual work. The run is selected via a
contextvar (the endpoint calls `begin(brief_id)`; the instrumented functions just call `step(...)`), so the
orchestration code stays clean and `step()` is a no-op outside a traced run (e.g. tests, the e2e).
"""
from __future__ import annotations

import time
from contextvars import ContextVar

ACTORS = ("gemini", "mongodb", "gitlab", "voyage", "server")   # who acted
KINDS = ("thought", "action", "result")                        # the Reason→Action shape

_RUNS: dict[str, list[dict]] = {}
_RUN: ContextVar[str | None] = ContextVar("react_run", default=None)
_MAX_RUNS = 64          # keep only the most-recent runs in memory
_MAX_STEPS = 200        # and cap a single run's trace


def begin(run_id: str) -> None:
    """Point subsequent step()s at this run (accumulating across the wizard's phases). Evicts old runs."""
    _RUN.set(run_id)
    _RUNS.setdefault(run_id, [])
    if len(_RUNS) > _MAX_RUNS:
        for k in list(_RUNS)[: len(_RUNS) - _MAX_RUNS]:
            _RUNS.pop(k, None)


def step(actor: str, kind: str, label: str, detail: str = "") -> None:
    """Record one Reason→Action step on the current run. No-op when no run is active (untraced calls)."""
    run = _RUN.get()
    if not run:
        return
    steps = _RUNS.setdefault(run, [])
    if len(steps) >= _MAX_STEPS:
        return
    steps.append({"seq": len(steps), "actor": actor, "kind": kind,
                  "label": label, "detail": (detail or "")[:200], "ts": time.time()})


def end() -> None:
    """Stop recording to any run — subsequent step()s are no-ops until the next begin()."""
    _RUN.set(None)


def get(run_id: str) -> list[dict]:
    return list(_RUNS.get(run_id, []))


def clear(run_id: str | None = None) -> None:
    if run_id is None:
        _RUNS.clear()
    else:
        _RUNS.pop(run_id, None)
