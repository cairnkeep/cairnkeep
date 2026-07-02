---
description: Review staged memory candidates extracted from prior sessions and accept (write to AgentFS) or discard them
argument-hint: "[--all]"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

<objective>
Review memory candidates that the SessionEnd hook (memory-capture.sh) extracted
automatically from prior sessions and staged under `.planning/memory-staging/`.
This is the accept gate between autonomous extraction and durable AgentFS writes:
no candidate becomes a memory fact until you accept it here.

Accepted candidates are written via the cairn-memory MCP (`memory_write`).
Discarded ones are deleted from staging. This keeps writes agent-gated (no
premature or auto writes) while making extraction fully automatic.

Argument handling:
- no args: review candidates from the most recent staged session
- `--all`: review candidates across all staged sessions
</objective>

<context>
Arguments: $ARGUMENTS
</context>

<process>

## 0. Initialize repo context

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT"
```

Resolve the staging dir: `$ROOT/.planning/memory-staging/`. If it does not exist or contains no `*.json`, report "No staged memory candidates to review" and stop.

## 1. Load staged candidates

- default: read the newest `*.json` file only
- `--all`: read every `*.json` file, oldest first

Each staged file is the JSON emitted by `mcp-memory-server extract`:
```json
{ "model": "...", "count": N, "candidates": [ { "key": "...", "value": "...", "category": "...", "importance": N, "rationale": "..." }, ... ] }
```

Parse every candidate's `key`, `value`, `category`, `importance`, and `rationale`.

## 2. Review each candidate (judgment gate)

For each candidate, apply these acceptance rules:
- **Accept** when the claim is a durable, branch-safe, short fact/decision/pitfall/convention that future sessions would benefit from and that is not already in AgentFS. Check for duplicates by reading the existing project memory (use `memory_search` with the candidate's key/terms).
- **Skip/discard** when it is: branch-local or speculative, a restatement of code/config already canonical in the repo, trivial/transient, or already present in AgentFS.

For accepted candidates, classify the AgentFS scope:
- `project` for repo-specific facts (the default)
- `domain-engineering` for reusable engineering patterns/conventions
- `identity` only for user/identity facts

## 3. Write accepted candidates

For each accepted candidate, call the cairn-memory MCP:
```
memory_write(scope="<scope>", key="<candidate.key>", value="<candidate.value>", promote_to="<category if applicable>")
```
If a candidate supersedes an existing entry (same key, updated value), use `memory_supersede` instead of `memory_write`, with a `reason`.

## 4. Clear staging

- delete the staged files whose candidates have been fully reviewed (accepted or discarded)
- if `--all` was passed, clear the entire staging dir once review is complete

## 5. Report

Display a summary: N reviewed, N accepted (→ AgentFS), N discarded, N superseded. Note that accepted facts are now durable across both harnesses.

</process>

<success_criteria>
- [ ] Staging dir read; candidates parsed
- [ ] Each candidate judged against the acceptance rules (durable, branch-safe, non-duplicate)
- [ ] Accepted candidates written via memory_write / memory_supersede
- [ ] Reviewed staging files cleared
- [ ] No speculative, branch-local, or trivial claims written to AgentFS
</success_criteria>
