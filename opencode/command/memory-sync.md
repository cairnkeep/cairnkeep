---
description: Sync project memory (AgentFS, AnythingLLM) with current MR/PR state from your git provider
argument-hint: "[--dry-run] [--force]"
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
Sync all memory tools with the current state of tracked MRs and PRs.

Output artifacts:
- Updated AgentFS keys: `internal-mrs-status`, `upstream-prs-status`
- Optional AnythingLLM sync if new docs were created

Flag handling:
- `--dry-run` — show what would change without writing
- `--force` — sync even if nothing appears changed (useful after manual edits)

This is an operational command. It reads live API state and writes to memory stores.
</objective>

<context>
Arguments: $ARGUMENTS

Default behavior:
1. Read `.opencode/memory.json` to determine project scope and workspaces
2. Read AgentFS key `internal-mrs-status` to get tracked MR list
3. For each tracked MR, query the git-provider MCP for current state
4. Read AgentFS key `upstream-prs-status` to get tracked PR list
5. For each tracked PR, query the git-provider MCP for current state
6. Compare live state against stored state
7. If changed (or --force):
   - Update AgentFS keys with current state
   - If anythingllm_workspaces is configured and new docs exist, offer sync
8. Print summary of changes

Important rules:
- Never delete memory entries — only update them
- Preserve historical context (merged dates, close reasons) in updated entries
- If an API call fails, skip that item and continue with others
- Log the sync timestamp in updated entries
</context>

<process>
## 1. Read memory configuration
Read `.opencode/memory.json` to get scopes and anythingllm_workspaces.

## 2. Extract tracked MRs and PRs from AgentFS
Read AgentFS keys `internal-mrs-status` and `upstream-prs-status` from the `project` scope.
Parse the markdown to extract tracked items:
- MRs: `project_id` and `iid` (format: `!IID` in project `ID` or `PATH`)
- PRs: `owner/repo#NUMBER`

## 3. Query live state
For each tracked MR:
- Call the git-provider `get_merge_request` with `project_id` and `merge_request_iid`
- Capture: state, draft, assignees, merge_status, updated_at, latest discussion notes (last 3)

For each tracked PR:
- Call the git-provider `get_pull_request` (or your provider's equivalent) for the PR
- Capture: state, merged, updated_at, comments count

## 4. Compare and diff
Compare each item's live state against the stored AgentFS state:
- State changes (open→merged, open→closed, etc.)
- Assignee changes
- New discussion notes / comments
- Draft status changes
- Merge status changes

## 5. Write updates
If `--dry-run`, print the diff and stop.

Otherwise:
- Update AgentFS `internal-mrs-status` with current state (preserve historical notes)
- Update AgentFS `upstream-prs-status` with current state
- If `anythingllm_workspaces` is configured, check if any new `.md` files exist in the repo root that aren't yet synced. If so, offer to sync (don't auto-sync).

## 6. Print summary
Output a compact table of:
- Each tracked item
- Current state
- Changed? (yes/no)
- Notable change (if any)
</process>
