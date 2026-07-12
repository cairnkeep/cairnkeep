---
description: Review code for bugs, security issues, and maintainability concerns
argument-hint: "[--full | --staged | --branch <name> | --mr <project>!iid | --since <ref> | --focus <pattern> | --post-to-mr | --block-on <severity>]"
tools:
  read: true
  write: true
  edit: true
  bash: true
  grep: true
  glob: true
  agent: true
  question: true
---

Git provider: these steps use the git host set by `CAIRN_GIT_PROVIDER` (`github`/`gitlab`/`codeberg`/`forgejo`/`none`); resolve the operation-to-tool mapping from `docs/git-providers.md`. If it is `none` or no provider MCP is registered, skip the provider steps and continue locally.

<objective>
Review code for bugs, security issues, maintainability problems, and style violations.

Output: `REVIEW.md` in the repo root (or `.planning/reviews/` if it exists).

Flag handling:
- `--full` — review all tracked files in the repository (entire codebase)
- `--staged` — review only git-staged changes
- `--branch <name>` — review `<name>` vs default branch
- `--mr <project>!iid` — review MR diff via the git-provider MCP
- `--since <ref>` — review changes since `<ref>` (e.g. `HEAD~1`)
- `--focus <pattern>` — restrict to files matching glob pattern
- `--post-to-mr` — post findings as MR/PR diff comments (requires `--mr`)
- `--block-on <severity>` — fail if findings at or above severity exist (critical/high/medium)
- Default (no flags) — review working tree + staged changes

This is an advisory command. Findings are structured by severity and dimension.
</objective>

<context>
Arguments: $ARGUMENTS

Default behavior:
1. Detect review scope from flags (or default to working tree + staged)
2. Collect diff and relevant context files
3. Spawn code-reviewer subagent with diff + project context
4. Write structured REVIEW.md with findings
5. Optionally post findings to the MR/PR
6. Enforce block gate if `--block-on` is set

Important rules:
- The reviewer is READ-ONLY on source code — only creates REVIEW.md
- Findings must cite exact file paths and line numbers
- Each finding includes: severity, dimension, description, and suggested fix
- Don't flag style issues that match existing project conventions
- Review dimensions include `simplicity` — flag over-engineering (unnecessary abstractions, speculative scaffolding/YAGNI, avoidable dependencies or boilerplate); a shortcut tagged with a `ponytail:` comment is acceptable, not a finding
</context>

<process>

## 1. Detect Review Scope

Parse arguments to determine review mode:

### Full codebase mode (`--full`)
```bash
REVIEW_MODE=full
FILE_LIST=$(git ls-files | grep -vE '\.(md|txt|yml|yaml|json|toml|lock|cfg|ini|env|gitignore)$' | grep -E "$FOCUS_PATTERN" 2>/dev/null || git ls-files)
```
The reviewer receives the full file list and reads each file directly (no diff).

### Diff-based modes

| Flag | Diff Command |
|---|---|
| `--staged` | `git diff --cached` |
| `--branch <name>` | `git diff "${DEFAULT_BRANCH}...<name>"` |
| `--mr <project>!iid` | git-provider MCP: `get_merge_request_diffs` |
| `--since <ref>` | `git diff <ref>..HEAD` |
| (none) | `git diff` + `git diff --cached` |

If `--focus <pattern>` is set, filter files to matching paths.

## 2. Collect Context

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
DEFAULT_BRANCH=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)
if [ -z "$DEFAULT_BRANCH" ]; then
  if git rev-parse --verify origin/main >/dev/null 2>&1 || git rev-parse --verify main >/dev/null 2>&1; then
    DEFAULT_BRANCH=main
  elif git rev-parse --verify origin/master >/dev/null 2>&1 || git rev-parse --verify master >/dev/null 2>&1; then
    DEFAULT_BRANCH=master
  else
    DEFAULT_BRANCH=HEAD
  fi
fi
```

Collect project context for the reviewer:
- Language detection (from file extensions in diff)
- Existing conventions (read 1-2 analogous files not in diff)
- Project skills (`.claude/skills/` or `.agents/skills/` if present)
- Lint/test config (`.eslintrc`, `pyproject.toml`, `Cargo.toml`, etc.)

## 3. Build Review Input

### Full mode (`--full`)
Build a file list from tracked source files (excluding docs, config, lock files). The reviewer reads each file directly. For large repos, prioritize:
- Entry points and public APIs
- Auth, security, and data-access layers
- Recently changed files (last 30 days by `git log --since=30-days-ago`)

### Diff-based modes
Combine:
- Full unified diff (from step 1)
- Project context (from step 2)
- File list with paths and languages

For MR mode, also capture:
- MR title, description, assignees, reviewers
- Existing discussion notes (to avoid duplicating findings)

## 4. Spawn code-reviewer

**Full mode:** Pass `<mode>full</mode>` and `<files>{tracked file list}</files>`. The reviewer reads files directly.

**Diff mode:** Pass `<mode>diff</mode>` and `<diff>{full diff}</diff>`.

```
Agent(
  prompt="Read agent instructions for code review.\n\n" +
    "<mode>{full|diff}</mode>" +
    "<diff>{full diff — only for diff mode}</diff>" +
    "<files>{file list with paths}</files>" +
    "<project_context>{language, conventions, skills, lint config}</project_context>" +
    "<config>block_on: {BLOCK_ON_SEVERITY}, focus: {FOCUS_PATTERN}</config>" +
    "<constraints>Read-only on source. Cite file:line for every finding. Skip style issues matching project conventions.</constraints>",
  subagent_type="code-reviewer",
  description="Code review: {scope description}"
)
```

Handle return:
- `## CLEAN` — no findings, write brief REVIEW.md
- `## FINDINGS` — structured findings, write REVIEW.md with table
- `## ESCALATE` — critical issues, write REVIEW.md and block

## 5. Write REVIEW.md

Create/update `REVIEW.md` (or `.planning/reviews/REVIEW.md` if directory exists):

```markdown
# Code Review — {date}

**Scope:** {full | staged | branch | MR | since}
**Files:** {count}
**Findings:** {total} ({critical} critical, {high} high, {medium} medium, {low} low)

## Findings by Severity

### Critical
| # | File:Line | Dimension | Description | Suggested Fix |
|---|---|---|---|---|

### High
...

### Medium
...

### Low
...

## Summary
{brief assessment}
```

## 6. Optional: Post to MR

If `--post-to-mr` and `--mr` are set:
- For each finding with file:line, create a diff discussion note
- Group findings by file
- Reference REVIEW.md in a top-level MR note

## 7. Block Gate

If `--block-on <severity>` is set and findings at or above that severity exist:

```
REVIEW BLOCKED: {N} findings at or above {severity}
▶ Fix findings or remove --block-on to continue
```

Stop here. Otherwise:

```
REVIEW COMPLETE: {total} findings ({critical} critical, {high} high)
▶ Review REVIEW.md for details
▶ /code-review --post-to-mr to comment on MR
```

</process>
