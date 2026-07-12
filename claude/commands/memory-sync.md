---
description: Sync project memory (AgentFS via cairn-memory MCP, AnythingLLM) with current MR/PR state from your git provider
argument-hint: "[--dry-run] [--force]"
allowed-tools: Read, Grep, Glob, Bash, mcp__cairn-memory__memory_read, mcp__cairn-memory__memory_write, mcp__cairn-memory__memory_list, mcp__cairn-memory__domain_knowledge_sync
---

Git provider: these steps use the git host set by `CAIRN_GIT_PROVIDER` (`github`/`gitlab`/`codeberg`/`forgejo`/`none`); resolve the operation-to-tool mapping from `docs/git-providers.md`. If it is `none` or unset, or no provider MCP is registered, skip the provider steps and continue locally.

<objective>
Sync durable memory with the current state of tracked MRs and PRs.

Output artifacts:
- Updated AgentFS keys (project scope): `internal-mrs-status`, `upstream-prs-status`
- Optional AnythingLLM sync if new docs were created

Flag handling:
- `--dry-run` — show what would change without writing
- `--force` — sync even if nothing appears changed (useful after manual edits)

This is an operational command. It reads live API state and writes to the memory store.
</objective>

<context>
Arguments: $ARGUMENTS

Default behavior:
1. Read the project memory config (`.agent/memory.json`, `.opencode/memory.json`, or `.claude/memory.json`) to determine scope and workspaces
2. Read AgentFS key `internal-mrs-status` (project scope) via the cairn-memory `memory_read` tool to get the tracked MR list
3. For each tracked MR, query the git-provider MCP for current state
4. Read AgentFS key `upstream-prs-status` via `memory_read` to get the tracked PR list
5. For each tracked PR, query the git-provider MCP for current state
6. Compare live state against stored state
7. If changed (or --force):
   - Update AgentFS keys with current state via `memory_write`
   - If `anythingllm_workspaces` is configured and new docs exist, offer `domain_knowledge_sync`
8. Print a summary of changes

Important rules:
- Never delete memory entries — only update them
- Preserve historical context (merged dates, close reasons) in updated entries
- If an API call fails, skip that item and continue with others
- Log the sync timestamp in updated entries
</context>

<process>
## 1. Read memory configuration
Read the project memory config to get scopes and `anythingllm_workspaces`. If no config file exists, default to scope `project` with no workspaces.

## 2. Extract tracked MRs and PRs from AgentFS
Use `memory_read` with scope `project` for keys `internal-mrs-status` and `upstream-prs-status`.
Parse the markdown to extract tracked items:
- MRs: `project_id` and `iid` (format: `!IID` in project `ID` or `PATH`)
- PRs: `owner/repo#NUMBER`

## 3. Query live state
For each tracked MR, use the git-provider MCP tools to capture: state, draft, assignees, merge_status, updated_at, latest discussion notes (last 3).
For each tracked PR, call the provider's "get change state" tool from the operation map (e.g. `get_pull_request`) and capture: state, merged, updated_at, comments count.

## 4. Compare and diff
Compare each item's live state against the stored AgentFS state: state changes (open→merged, open→closed), assignee changes, new discussion notes/comments, draft status changes, merge status changes.

## 5. Write updates
If `--dry-run`, print the diff and stop.

Otherwise:
- Update AgentFS `internal-mrs-status` and `upstream-prs-status` via `memory_write` (preserve historical notes)
- If `anythingllm_workspaces` is configured and new `.md` files exist in the repo that are not yet synced, offer `domain_knowledge_sync` (do not auto-sync)

## 6. Print summary
Output a compact table: each tracked item, current state, changed (yes/no), notable change.
</process>
