"""Idea 2 — Handoff slices (the relay mechanic), built on GitLab REST.

- `commit_context_branches`: per issue, a branch with a `.vscode/settings.json`
  micro-context artifact — makes "only these 3 files matter" real, not just UI.
- `create_qa_issue`: a QA-only issue (staging URL + checklist, no source needed).
- `reroute`: QA reject → reopen + route back to the responsible-layer runner.
(Passport-increment-on-merge is a MongoDB write — see app.rag.record_merge.)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re

from app import demo, gitlab as gl
from app.const import QA_ROLE_LABEL, STAGING_URL
from app.contracts import PlanJSON

# Per-issue focus token (the access control for the /api/focus bootstrap, which serves reused code).
# Derived (not stored) so the command builder + the endpoint agree without coordination. A real deploy
# sets FOCUS_SECRET; the dev default keeps local runs working (tokens are predictable then — demo-grade).
_FOCUS_SECRET = os.getenv("FOCUS_SECRET", "sprint0-focus-dev-secret")


def _slug(text: str) -> str:
    """A conventional branch slug: lowercase, [a-z0-9] runs joined by '-', trimmed, capped."""
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:40].strip("-")


def branch_for(title: str, issue_id: str) -> str:
    """The dev's focus branch — conventional `feat/<task-title-slug>` (was `sprint0/<id>`)."""
    s = _slug(title)
    return f"feat/{s}" if s else f"feat/task-{issue_id.lower()}"


def branch_name(issue) -> str:
    return branch_for(issue.title, issue.id)


def focus_token(issue_id: str) -> str:
    return hmac.new(_FOCUS_SECRET.encode(), issue_id.encode(), hashlib.sha256).hexdigest()[:16]


def render_focus_docs(issue, pointers: list[dict]) -> dict:
    """The DOC files the /api/focus bootstrap materializes locally as UNTRACKED files: the agent docs + the
    .vscode noise-hiding. Reused CODE is NOT here — the endpoint fetches each pointer's raw file LIVE and adds
    it. `pointers` carry only metadata (path + source_project), used for the CONTEXT 'Similar code' list."""
    return {
        "AGENTS.md": _agents_md(issue),
        "CLAUDE.md": "@AGENTS.md\n",
        "CONTEXT.md": _context_md(issue, pointers),
        "CONTRACT.md": _contract_md(issue),
        ".vscode/settings.json": _vscode_settings(issue.context_scope.files, issue.id, issue.context_scope.note),
    }


def reuse_manifest(pointers: list[dict]) -> str:
    """Public: the /api/focus endpoint builds the manifest from the stored pointers (metadata only)."""
    return _reuse_manifest(pointers)


def focus_script(generate: dict) -> str:
    """The one-shot bash the gateway serves: writes the generate map locally (UNTRACKED) then keeps it out of
    git via .git/info/exclude. Branch-swap safe — it cleans the PREVIOUS run's own files (tracked in
    `.sprint0/.materialized`) before writing, and never overwrites a file the project actually tracks. Payload
    inlined as base64 so arbitrary content survives shell quoting. Replaces the old committed `.sprint0/focus.sh`."""
    blob = base64.b64encode(json.dumps(generate).encode()).decode()
    return (
        "#!/usr/bin/env bash\n"
        "set -e\n"
        '[ -d .git ] || { echo "sprint0: run from the repo root (no .git here)"; exit 1; }\n'
        "python3 - <<'PY'\n"
        "import base64, json, os, subprocess\n"
        f'gen = json.loads(base64.b64decode("{blob}").decode())\n'
        'MAT = ".sprint0/.materialized"\n'
        "def safe(p):\n"
        '    return p and not os.path.isabs(p) and ".." not in p.split("/")\n'
        "# 1) remove the PREVIOUS run\'s own droppings (so a same-dir branch swap leaves nothing stale)\n"
        "if os.path.exists(MAT):\n"
        "    for old in open(MAT).read().splitlines():\n"
        "        if safe(old):\n"
        "            try: os.remove(old)\n"
        "            except OSError: pass\n"
        "def tracked(p):\n"
        '    return subprocess.run(["git", "ls-files", "--error-unmatch", p], capture_output=True).returncode == 0\n'
        "written = []\n"
        "for path, content in gen.items():\n"
        "    if not safe(path) or tracked(path):\n"  # never overwrite a real committed file (e.g. the project's own AGENTS.md)
        "        continue\n"
        "    d = os.path.dirname(path)\n"
        "    if d:\n"
        "        os.makedirs(d, exist_ok=True)\n"
        '    with open(path, "w") as fh:\n'
        "        fh.write(content)\n"
        '    written.append(path); print("  +", path)\n'
        'os.makedirs(".sprint0", exist_ok=True)\n'
        '_ = open(MAT, "w").write("\\n".join(written))\n'
        "PY\n"
        "EXCLUDE=.git/info/exclude\n"
        '[ -f "$EXCLUDE" ] && ! grep -q "sprint0 generated context" "$EXCLUDE" && '
        "printf '\\n# sprint0 generated context (local only, never commit)\\n"
        "/AGENTS.md\\n/CLAUDE.md\\n/CONTEXT.md\\n/CONTRACT.md\\n/.vscode/\\n/.sprint0/\\n' >> \"$EXCLUDE\"\n"
        'echo "sprint0: context ready. All files on disk; run/test normally. AGENTS.md + CONTEXT.md describe your slice."\n'
    )

_VSCODE_NOISE = {
    "**/.git": True, "**/node_modules": True, "**/dist": True, "**/build": True,
    "**/.venv": True, "**/__pycache__": True, "**/*.lock": True, "**/coverage": True,
}


def _vscode_settings(context_files: list[str], issue_id: str, note: str) -> str:
    return json.dumps(
        {
            "// sprint0": f"Micro-context for {issue_id}. Only these files matter; the rest is noise.",
            "sprint0.contextScope": context_files,
            "sprint0.note": note,
            "files.exclude": _VSCODE_NOISE,
            "search.exclude": {"**/node_modules": True, "**/dist": True},
        },
        indent=2,
    )


_BRANCH_KINDS = {"code", "infra"}  # only these get a repo branch; design/audit/content live as issues + attachments


def _reuse_manifest(seeds: list[dict]) -> str:
    """The `REUSE_MANIFEST.md` that explains the seeded files + cites their origin (provenance)."""
    lines = [
        "# Reused from agency memory\n",
        "sprint0 fetched battle-tested code from prior projects as raw reference (the original, not adapted). "
        "Adapt it to this stack. The sources are linked below.\n",
        "| file | from | source |",
        "| --- | --- | --- |",
    ]
    for s in seeds:
        lines.append(f"| `{s['path']}` | {s.get('source_project', 'memory')} | [original]({s.get('source_url', '')}) |")
    lines.append("\n> sprint0 reuse: it was built before, so start from the proven version.")
    return "\n".join(lines)


def _humanize(s: str) -> str:
    """Prose fields ONLY — keep the docs human-readable: no semicolons, no emdashes (the doc convention).
    Never run over api_contract, file paths, or directives (they may carry code that these swaps would mangle)."""
    return (s or "").replace("—", "-").replace("–", "-").replace(";", ",").strip()


def _context_md(issue, seeds: list[dict]) -> str:
    """`.sprint0/CONTEXT.md` — the human brief: what the feature is, what it does, and the scope fence."""
    feat = _humanize(issue.feature) or issue.title
    lines = [f"# {issue.title}", "", f"**Feature:** {feat}", ""]
    if issue.description:
        lines += [_humanize(issue.description), ""]
    lines += ["## Scope", "", f"**Do:** {_humanize(issue.does) or 'see the feature description above.'}", ""]
    if issue.not_does:
        lines += [f"**Do not:** {_humanize(issue.not_does)}", ""]
    lines += ["## Done when", "", f"- [ ] {_humanize(acceptance_line(issue))}", ""]
    if seeds:
        lines += ["## Similar code (raw reference under .sprint0/reused — adapt it to this stack)", ""]
        lines += [f"- `{s['path']}` from {s.get('source_project', 'memory')}" for s in seeds]
        lines += [""]
    lines += ["## Run / build", "",
              "Every project file is on disk, so run and test the program normally. The editor hides "
              "noise via `.vscode`. Nothing is removed from the working tree.", ""]
    lines.append(f"> sprint0 task {issue.id} · your scope is the files in `.sprint0/focus.json`.")
    return "\n".join(lines)


def _contract_md(issue) -> str:
    """`.sprint0/CONTRACT.md` — the signed terms in full: name, type, owner, risk, files, acceptance."""
    deps = ", ".join(issue.depends_on) if issue.depends_on else "none"
    files = ", ".join(f"`{f}`" for f in issue.context_scope.files) or "none"
    lines = [
        f"# Contract: {issue.title}", "",
        "| field | value |", "| --- | --- |",
        f"| name | {issue.title} |",
        f"| type | {issue.kind} |",
        f"| discipline | {issue.discipline} |",
        f"| owner | @{issue.assignee or 'unassigned'} |",
        f"| risk | {issue.risk} |",
        f"| estimate | {issue.estimate_days}d |",
        f"| depends on | {deps} |",
        "",
        "## Focus files", "", files, "",
        "## Acceptance", "", _humanize(acceptance_line(issue)), "",
    ]
    if issue.api_contract:  # code, not prose — never humanized
        lines += ["## API contract", "```json", issue.api_contract, "```", ""]
    if issue.directives:    # may carry code — left verbatim
        lines += ["## Directives", *[f"- {d}" for d in issue.directives], ""]
    lines.append(f"> sprint0 task {issue.id}")
    return "\n".join(lines)


def _agents_md(issue) -> str:
    """Root `AGENTS.md` — auto-read by coding agents (Cursor / Claude Code). A one-screen briefing that
    inlines the scope + done-when + the file list, and points at the full contract. `CLAUDE.md` imports it."""
    feat = _humanize(issue.feature) or issue.title
    files = "\n".join(f"- `{f}`" for f in issue.context_scope.files) or "- (none listed)"
    lines = [
        f"# Agent briefing — sprint0 task {issue.id}", "",
        f"You are working on **{feat}** (task {issue.id}).", "",
        f"**Do:** {_humanize(issue.does) or 'see .sprint0/CONTEXT.md.'}",
    ]
    if issue.not_does:
        lines.append(f"**Do not:** {_humanize(issue.not_does)}")
    lines += [
        f"**Done when:** {_humanize(acceptance_line(issue))}", "",
        "## Files in scope (touch only these)", files, "",
        "Read `CONTRACT.md` for the full contract and `CONTEXT.md` for background. Every project file is "
        "on disk so you can run and test the program. The editor just hides noise. Stay within the files "
        "listed above and do not edit outside this scope.",
    ]
    return "\n".join(lines)


# ── per-file stubs: create missing focus files, header-prepend existing ones (never overwrite) ──
_HASH = {".py", ".sh", ".bash", ".rb", ".yml", ".yaml", ".toml"}
_SLASH = {".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".scss"}
_CSTYLE = {".css"}
_XML = {".md", ".html", ".htm", ".xml", ".vue", ".svg"}


def _comment_style(path: str):
    """How to safely comment a header into this file type: ('line', prefix) | ('block', open, close) | None.
    None = no safe comment syntax (e.g. .json) — we never inject a header there."""
    ext = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
    if ext in _HASH:
        return ("line", "#")
    if ext in _SLASH:
        return ("line", "//")
    if ext in _CSTYLE:
        return ("block", "/*", "*/")
    if ext in _XML:
        return ("block", "<!--", "-->")
    return None


def _stub_header_lines(issue) -> list[str]:
    """The header block (plain text, comment-agnostic). First line carries the idempotency sentinel."""
    feat = _humanize(issue.feature) or _humanize(issue.title)
    lines = [f"sprint0 task {issue.id} - {feat}"]
    if issue.does:
        lines.append(f"Do: {_humanize(issue.does)}")
    if issue.not_does:
        lines.append(f"Do not: {_humanize(issue.not_does)}")
    lines.append(f"Done when: {_humanize(acceptance_line(issue))}")
    lines.append("Full contract: CONTRACT.md  ·  scope: .sprint0/focus.json")
    lines.append("TODO: implement.")
    return lines


def _render_header(lines: list[str], style) -> str:
    if style[0] == "line":
        pre = style[1]
        return "\n".join(f"{pre} {ln}".rstrip() for ln in lines)
    body = "\n".join(f"  {ln}".rstrip() for ln in lines)
    return f"{style[1]}\n{body}\n{style[2]}"


def _prepend_header(original: str, block: str) -> str:
    """Insert the header AFTER a leading shebang / `<?php` / `<?xml` line, else at the very top."""
    head, sep, rest = original.partition("\n")
    h = head.lstrip()
    if head.startswith("#!") or h.startswith("<?php") or h.startswith("<?xml"):
        return f"{head}\n{block}\n{rest}" if sep else f"{head}\n{block}"
    return f"{block}\n{original}"


def _stub_files(project_id: int, issue, default_branch: str, tree: set[str], seeded_paths: set[str]) -> list[dict]:
    """Per focus file: create it with a header if missing, prepend a header if it already exists (NEVER
    overwrite the body), skip when a reuse seed already provides it or the header is already there (idempotent)."""
    out: list[dict] = []
    header_lines = _stub_header_lines(issue)
    sentinel = f"sprint0 task {issue.id}"
    for path in issue.context_scope.files:
        if path in seeded_paths:
            continue  # a reuse seed provides real adapted code here — don't stub over it (would collide)
        style = _comment_style(path)
        if path not in tree:  # new file → create it with the header (or an empty placeholder if uncommentable)
            content = (_render_header(header_lines, style) + "\n") if style else ""
            out.append({"path": path, "content": content, "action": "create"})
            continue
        if style is None:
            continue  # exists + no safe comment syntax (e.g. .json) → leave it untouched
        try:
            original = gl.get_file_raw(project_id, path, ref=default_branch)
        except Exception:
            continue  # can't read it → best-effort skip
        if sentinel in original:
            continue  # already headered (idempotent re-dispatch)
        out.append({"path": path, "content": _prepend_header(original, _render_header(header_lines, style)), "action": "update"})
    return out


def commit_context_branches(
    project_id: int, plan: PlanJSON, default_branch: str = "main", reuse_seeds: dict[str, list[dict]] | None = None
) -> list[str]:
    """One branch per CODE/INFRA issue, named `feat/<task-title-slug>`. Commits ONLY the file stubs (created
    if missing, header-prepended if they already exist, never overwritten). The agent docs + reused code are
    NOT committed — they ride in the server-side FOCUS_CONTEXTS payload and are materialized locally by the
    `/api/focus` bootstrap on checkout, so a merge into main carries nothing sprint0. Best-effort + deterministic."""
    reuse_seeds = reuse_seeds or {}
    try:
        tree = gl.list_repo_tree(project_id, ref=default_branch)  # CURRENT files → classify create vs header-prepend
    except Exception:
        tree = set()  # empty/uninitialized repo (or mocked GL) → every focus file is new
    made: list[str] = []
    for epic in plan.epics:
        for issue in epic.issues:
            if (issue.kind or "code") not in _BRANCH_KINDS:
                continue
            branch = branch_name(issue)
            try:
                gl.create_branch(project_id, branch, ref=default_branch)
                seeds = reuse_seeds.get(issue.id) or []
                files = _stub_files(project_id, issue, default_branch, tree, {s["path"] for s in seeds})
                if files:  # an all-existing-or-uncommentable slice yields no stubs → branch is just a ref off main
                    gl.commit_files(project_id, files, branch=branch, message=f"chore(sprint0): scaffold {issue.id} files")
                made.append(branch)
            except Exception:
                pass  # skip branch/commit conflicts; best-effort for the demo
    return made


def acceptance_line(issue) -> str:
    """The acceptance pass-condition for an issue: the Tester's authored criterion (the definition of done),
    or the generic line when they haven't sharpened it. Single source for the QA checklist + the editor seed."""
    return issue.acceptance.strip() if issue.acceptance.strip() else f"works end-to-end ({issue.type})"


def create_qa_issue(project_id: int, plan: PlanJSON, staging_url: str = STAGING_URL) -> dict:
    items = [
        f"- [ ] **{i.title}** — acceptance: {acceptance_line(i)}"
        for e in plan.epics
        for i in e.issues
    ]
    body = (
        "**Tester pass — no source access needed.**\n\n"
        f"Staging: {staging_url}\nLogin: `demo` / `demo`\n\n"
        "## Acceptance checklist\n" + "\n".join(items) + "\n\n"
        "> Reject any item with a comment; sprint0 routes it back to the responsible runner."
    )
    return gl.create_issues(project_id, [{"title": "Tester — Acceptance checklist", "description": body, "labels": [QA_ROLE_LABEL]}])[0]


def reroute(project_id: int, issue_iid: int, comment: str, to_runner: str | None = None) -> dict:
    note = (
        f"❌ **QA reject:** {comment}\n\n"
        f"sprint0 → re-routing to @{to_runner or 'responsible runner'} (the responsible layer), "
        f"reopened with the failing context."
    )
    if not demo.is_demo():  # the public demo never mutates real GitLab (DEMO_MODE is the real boundary)
        gl.reopen_issue(project_id, issue_iid, comment=note)
    return {"issue_iid": issue_iid, "rerouted_to": to_runner}
