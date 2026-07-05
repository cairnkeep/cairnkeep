---
description: On-demand token-efficient repo exploration via context_explore, returning compact citations
argument-hint: "<query> [repo path]"
allowed-tools: Bash, mcp__cairn-memory__context_explore
---

<objective>
Answer a repo-exploration question with compact `path:line-range` citations from `context_explore`, without reading or summarizing the cited ranges yourself — that expansion is the caller's decision, not this command's.
</objective>

<context>
Arguments: $ARGUMENTS

The first token (or the full string if no path is given) is the query. An optional trailing path argument overrides the resolved repo root.
</context>

<process>
## 0. Resolve repo root

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository. /context-explore must run from a project repo."
  exit 1
fi
cd "$ROOT"
```

If `$ARGUMENTS` carries an optional trailing path token that is a valid path, use it to override `$ROOT`. The winning value becomes the explicit `repo_root` argument in step 1.

## 1. Call the tool

Call `context_explore` with `query` set to the question text from `$ARGUMENTS` (path override stripped) and `repo_root` set to the resolved path from step 0. `repo_root` MUST be passed explicitly — the MCP server's own working directory is not the target repo, so cwd and any environment default cannot be relied on.

## 2. Report

On success, relay the tool's `content[0].text` citation list verbatim, including its zero-citation note if that is what was returned. Do not read or summarize the cited ranges.

On failure, relay a one-line pass-through of the tool's error message (the thrown message, or `structuredContent.error`) — never a raw JSON dump, never a re-diagnosis of the cause.
</process>
