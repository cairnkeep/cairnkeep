# Phase 8: Operating-Layer Wiring - Research

**Researched:** 2026-07-05
**Domain:** Command/prompt-file wiring over an existing MCP tool (no new libraries, no server code)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: Direct inline MCP call — no paired sub-agent.** The command lists the
  tool in its allowed-tools/`tools` block and calls `context_explore` directly,
  then surfaces the citations. Mirrors `recall.md` (both harnesses), NOT the
  agent-dispatch `wiki-query`→`wiki-query-analyst` pattern. The Phase-7 tool is
  already thin and returns *final* citations — a sub-agent would only relay
  them, adding an agent file to sync for no work. The OpenCode command is
  **self-contained** (like `opencode/command/recall.md`) — no `workflows/*.md`
  file and no `opencode/agents/*` file for this feature.

- **D-02: Citations only.** Surface the compact `path:line-range` list; the
  main agent decides what to `Read` next. Do NOT auto-read the cited ranges or
  pre-synthesize per-citation summaries — that spends the exact tokens the tool
  exists to save (this is precisely what Phase 9 / CTX-07 A/B measures). The
  tool still returns full `Evidence` in `structuredContent` for any
  programmatic caller; the command's *response* stays lean.

- **D-03: Command name `/context-explore`.** Resolve the target repo via
  `git rev-parse --show-toplevel` → optional path arg override, and pass it
  **explicitly** as the tool's `repo_root` (Phase 7 D-01: the MCP server's cwd
  is `infraRoot`, not the target repo, so the command MUST pass `repo_root` —
  it cannot rely on cwd). The tool still fails closed if `repo_root` is
  unresolvable.

- **D-04: Dedicated `scripts/sync-opencode-explore-assets.sh`** mirroring
  `sync-opencode-wiki-assets.sh` (ASSETS array, `--check`/`--apply`,
  `--live-root`, source-of-truth under `./opencode/`). Wire its `--check` into
  CI the same way the other `sync-opencode-*-assets.sh --check` runs are
  invoked. The Claude command is installed through the existing
  `sync-claude-assets.sh`. Keeps the one-script-per-feature convention and the
  drift guard every other feature already has.

### Claude's Discretion

- Tool-name conventions in frontmatter: `mcp__cairn-memory__context_explore`
  (Claude `allowed-tools`) vs `cairn-memory_context_explore: true` (OpenCode
  `tools`) — pattern already visible in `recall.md` pairs.
- How the command relays the tool's fail-closed error (Phase 7 D-04) — likely
  a one-line "exploration not configured / binary missing" pass-through; do
  not re-implement the tool's error handling.
- Exact `$ARGUMENTS`/flag parsing (query required; optional repo path), the
  `ASSETS=(...)` contents, and the precise CI hook location for the new
  `--check` — resolve during planning against the existing scripts.

### Deferred Ideas (OUT OF SCOPE)

- **Pre-task hook auto-invoke of exploration (CTX-F2)** — explicitly out of
  scope this phase; SC-3 mandates on-demand/agent-invoked, not automatic.
  Future milestone (reuses OCP-01/02 hook infra), fresh-task-only per
  token-miser's invariant.
- **Memory-aware citation annotation (CTX-F1)** and **result caching
  (CTX-F3)** — future differentiators, deferred until the base command is
  proven useful.
- **Token-savings A/B measurement (CTX-07)** — Phase 9.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CTX-04 | User can invoke context exploration on demand from a Claude Code command | `claude/commands/recall.md` skeleton confirmed as the direct-call template; frontmatter tool-name format confirmed (`allowed-tools: ..., mcp__cairn-memory__context_explore`); `scripts/sync-claude-assets.sh` auto-discovers new `claude/commands/*.md` files — no script edit needed to install it |
| CTX-05 | User can invoke context exploration on demand from an OpenCode command, installed via a `sync-opencode-*-assets.sh` script (parity with Claude) | `opencode/command/recall.md` skeleton confirmed as the direct-call template; frontmatter tool-name format confirmed (`tools: { cairn-memory_context_explore: true }`); `scripts/sync-opencode-wiki-assets.sh` confirmed as the exact template to copy/narrow for `sync-opencode-explore-assets.sh` |

</phase_requirements>

## Summary

This phase is pure operating-layer glue: two prompt files (`claude/commands/context-explore.md`, `opencode/command/context-explore.md`) and one new shell script (`scripts/sync-opencode-explore-assets.sh`). No server code changes, no new dependencies, no new architecture. CONTEXT.md already locked the shape (D-01..D-04) and named the exact files to mirror. Research here closes the two gaps CONTEXT.md explicitly deferred to planning, plus one gap CONTEXT.md's own premise got wrong: there is **no existing CI aggregation point** that runs `sync-opencode-*-assets.sh --check` today — those scripts are documented in `docs/operating.md` as manual developer commands, invoked individually, never wired into `.github/workflows/ci.yml`. The planner must decide whether to (a) add the first such CI check as part of this phase, matching the existing `sync-claude-assets.sh --check` sanity-check convention in `docs/operating.md`, or (b) simply document the manual `--check` command like its four siblings and treat "CI parity" as already satisfied by matching that existing (non-CI) pattern. Given D-04 explicitly says "wire ... into CI the same way the other ... runs are invoked" and those runs are *not* currently invoked by CI, the honest fulfillment of D-04's intent is: **there is nothing to join** — document it in `docs/operating.md` next to `sync-claude-assets.sh --check`, consistent with its four siblings, and flag the "CI wiring" framing as based on a premise that doesn't hold in this codebase.

The Claude harness distinguishes two MCP tool-call failure tiers on `context_explore` (Phase 7 D-04): a **thrown** precondition error (binary missing/unset, `repo_root` unresolvable) surfaces to the calling agent as an MCP tool error (`isError: true`, message = the thrown string); an **execution-tier** failure (non-zero exit, timeout, malformed JSON) returns normally with `structuredContent = { ok: false, error, stderr, exitCode, timedOut? }` and a JSON-dump `content[0].text`. The command body should tell the agent to treat both uniformly for the user-facing reply: a one-line pass-through of the error string, never a raw JSON dump and never a retry/re-implementation of the tool's own error handling.

**Primary recommendation:** Copy `claude/commands/recall.md` and `opencode/command/recall.md` structurally (frontmatter shape + `<objective>/<context>/<process>` skeleton), swap the tool list to `context_explore`, add the `git rev-parse --show-toplevel` block from `wiki-query.md` §0 (drop its Task-dispatch and its `--writeback`/wiki-index logic — irrelevant here per D-01), and write `scripts/sync-opencode-explore-assets.sh` as a copy of `sync-opencode-wiki-assets.sh` with `ASSETS=("command/context-explore.md")` and no `LEGACY_ASSETS`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Repo-root resolution (`git rev-parse --show-toplevel` + arg override) | Command (prompt file, runs as agent-issued Bash) | — | The command runs in the *target* repo's agent session; only it knows the CWD the user is working in. The MCP server's own cwd is `infraRoot` (Phase 7 D-01), so this resolution cannot move server-side. |
| `context_explore` tool call (subprocess delegation to `token_miser explore`) | API/Backend (`mcp-memory-server`, already built in Phase 7) | — | Owned entirely by Phase 7; this phase only invokes it, never re-implements it. |
| Citation surfacing (compact `path:line-range` text) | Command (prompt file) | MCP tool (`content` field, Phase 7 D-02) | The tool already renders the compact text (`renderCitations`); the command's job is to relay it verbatim, not reformat or enrich it (D-02 — auto-reading citations would defeat the token-economy purpose). |
| Asset installation / drift detection | Build/Ops tooling (`scripts/sync-*-assets.sh`) | — | Same tier as every other feature's install path (`sync-claude-assets.sh` auto-discovery; new `sync-opencode-explore-assets.sh`) — no new tier introduced. |
| Fail-closed error relay | Command (prompt file) | MCP tool (throws / `ok:false`, Phase 7 D-04) | The tool already classifies and shapes the error; the command must not duplicate that logic — just detect which shape it got and pass the message through in one line. |

## Standard Stack

No new libraries, runtimes, or packages. This phase adds only Markdown prompt
files and a Bash shell script, both following patterns 100% present in this
repository already.

### Core
| Asset | Format | Purpose | Why Standard |
|-------|--------|---------|--------------|
| `claude/commands/context-explore.md` | Markdown + YAML frontmatter | Claude Code slash command | Identical shape to every other command in `claude/commands/` — `sync-claude-assets.sh` auto-discovers any `*.md` under `claude/` |
| `opencode/command/context-explore.md` | Markdown + YAML frontmatter | OpenCode slash command | Identical shape to `opencode/command/recall.md`; installed by the new per-feature sync script (repo convention: one sync script per OpenCode feature) |
| `scripts/sync-opencode-explore-assets.sh` | Bash | Installs/verifies the OpenCode command against the live OpenCode config tree | Verbatim structural copy of `scripts/sync-opencode-wiki-assets.sh`, narrowed `ASSETS` array — matches memory/wiki/security/graphify/plugin siblings exactly |

### Supporting
None — no test framework, HTTP client, or parsing library is needed; the tool
being invoked already exists and is fully owned by Phase 7.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct inline MCP call (D-01, locked) | Agent-dispatch (`wiki-query`→`wiki-query-analyst` pattern) | Rejected in CONTEXT.md: the Phase-7 tool already returns final citations; a sub-agent would only relay them, adding a file to sync for zero added work. |
| One shared `sync-opencode-explore-assets.sh` | Extending `sync-opencode-wiki-assets.sh`'s `ASSETS` array | Rejected: breaks the one-script-per-feature convention every other capability (memory/wiki/security/graphify/plugin) already follows; would also force an unrelated feature's sync script to fail if `context-explore.md` goes missing. |

**Installation:** N/A — no package manager involved. Files are placed directly
in the repo tree and copied to the live config roots by the sync scripts.

**Version verification:** N/A — no npm/pip/cargo packages introduced this phase.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero external packages — it adds two
Markdown prompt files and one Bash script, all sourced from patterns already
present in this repository. The Package Legitimacy Gate is skipped; no
`package-legitimacy check` run was needed.

## Architecture Patterns

### System Architecture Diagram

```
User (Claude Code session)                 User (OpenCode session)
        |                                           |
        v                                           v
 claude/commands/                          opencode/command/
 context-explore.md  <-- installed by -->  context-explore.md
    (sync-claude-assets.sh,                  (sync-opencode-explore-assets.sh,
     auto-discovers claude/**/*.md)           new dedicated script)
        |                                           |
        | 1. git rev-parse --show-toplevel          | (same resolution block)
        |    (+ optional path arg override)         |
        v                                           v
        +-------------------+-----------------------+
                             |
                             | 2. call context_explore
                             |    { query, repo_root }
                             v
                 mcp-memory-server (cairn-memory MCP)
                 context_explore tool (Phase 7, unchanged)
                             |
                             | 3. subprocess: token_miser explore
                             |    --query ... --repo-root ...
                             v
                    external token-miser binary
                    (FastContext explore loop, owned by token-miser)
                             |
                             v
                 Evidence JSON (citations, stats)
                             |
              +--------------+---------------+
              | success: ok:true              | failure:
              | content = compact              | - thrown (precondition) -> isError:true
              |   "path:start-end" lines       | - ok:false (execution)   -> structuredContent
              | structuredContent = full       |   { error, stderr, exitCode, timedOut? }
              |   Evidence passthrough         |
              v                                v
     4. Command relays citations       4. Command relays ONE-LINE
        verbatim to the user               error message, no JSON dump,
        (D-02: no auto-read,               no re-implementation of the
         no summarization)                 tool's own error handling
```

### Recommended Project Structure
```
claude/commands/
└── context-explore.md              # new — direct-call Claude command

opencode/command/
└── context-explore.md              # new — direct-call, self-contained OpenCode command

scripts/
└── sync-opencode-explore-assets.sh # new — dedicated sync script (D-04)
```
No new directories, no `opencode/agents/*`, no `opencode/workflows/*` (D-01).

### Pattern 1: Direct-call command frontmatter (Claude)
**What:** List the exact MCP tool name(s) needed under `allowed-tools`; no `Task` tool (no sub-agent dispatch).
**When to use:** Any command that calls a tool itself and reports the result inline — this repo's convention for `recall.md`.
**Example (verified against the live file):**
```markdown
---
description: <one line>
argument-hint: "<query> [repo path]"
allowed-tools: Read, mcp__cairn-memory__context_explore
---
```
Source: `claude/commands/recall.md` frontmatter, adapted (`recall.md` lists `Read, Grep, Glob, mcp__cairn-memory__memory_read, mcp__cairn-memory__memory_search, mcp__cairn-memory__domain_knowledge_query` — the naming convention `mcp__cairn-memory__<tool>` is what matters, not the specific tool names).

### Pattern 2: Direct-call command frontmatter (OpenCode)
**What:** OpenCode uses a `tools:` map with `<mcp-server>_<tool>: true` boolean entries, not a comma list.
**When to use:** Same command shape, OpenCode harness.
**Example (verified against the live file):**
```markdown
---
description: <one line>
argument-hint: "<query> [repo path]"
tools:
  cairn-memory_context_explore: true
---
```
Source: `opencode/command/recall.md` frontmatter (`tools: { read: true, grep: true, glob: true, cairn-memory_memory_read: true, cairn-memory_memory_search: true, cairn-memory_domain_knowledge_query: true }` — confirms `<server>_<tool>: true` shape with underscore, not double-underscore, and no `mcp__` prefix).

### Pattern 3: Repo-root resolution block (D-03)
**What:** Resolve to the git repo root before doing anything else; fail fast with a clear message if not in a repo.
**When to use:** Any command whose behavior depends on operating against "the current project," not the harness's own installation directory.
**Example (verified against the live file, `claude/commands/wiki-query.md` §0):**
```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository. /context-explore must run from a project repo."
  exit 1
fi
cd "$ROOT"
```
Adopt this resolution block verbatim (swap the command name in the message); reject the rest of `wiki-query.md` (its Task-dispatch to `wiki-query-analyst`, its `--writeback` flag, its wiki scaffold) — none of it applies here per D-01/D-02. For the optional path-arg override mentioned in D-03, parse a second `$ARGUMENTS` token as an explicit repo path that overrides `$ROOT` when present, then pass whichever value wins as `repo_root` to the tool call — never rely on the tool's own `CAIRN_EXPLORE_REPO_ROOT` env fallback, since D-03 requires the command to always pass `repo_root` explicitly.

### Pattern 4: Sync-script template (D-04)
**What:** Per-feature `sync-opencode-<feature>-assets.sh` with a narrow `ASSETS` array, `--check`(default)/`--apply`/`--live-root`, comparing repo-managed `./opencode/<path>` against `${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/<path>`.
**When to use:** Every OpenCode-installable feature in this repo (memory, wiki, security, graphify, plugin — five existing instances, this phase adds a sixth).
**Example:** Copy `scripts/sync-opencode-wiki-assets.sh` verbatim and reduce:
```bash
ASSETS=(
  "command/context-explore.md"
)
# No LEGACY_ASSETS array — nothing to migrate away from.
# report_legacy_live_assets() and the LEGACY_ASSETS loop can be dropped entirely,
# or kept as a no-op empty array for structural parity with the wiki script.
```
The `collect_extra_live_assets` glob-scan section in the wiki script scans multiple asset kinds (command/agents/workflows/templates); since this feature only ships one command file, narrow it to a single `find "$root/command" ... -name 'context-explore*.md'` scan (or drop the "extra assets" warning entirely if D-01's single-file scope makes it not worth the code — Claude's discretion, but keeping the warning costs one `find` line and matches every sibling script's shape).

### Anti-Patterns to Avoid
- **Re-implementing citation formatting in the command body:** the tool's `content[0].text` is already the exact compact `path:start-end` list (or the `(no citations found; turns=N, tool_calls=N)` sentence for a genuine empty result) — the command must relay it as-is, not re-parse `structuredContent` and re-render it.
- **Auto-reading cited files:** D-02 explicitly forbids this — it is the one thing that would silently defeat the entire token-economy premise the milestone (and Phase 9's A/B measurement) exists to prove.
- **Relying on `cwd` or `CAIRN_EXPLORE_REPO_ROOT` instead of passing `repo_root` explicitly:** the MCP server's process cwd is `infraRoot`, never the target repo (Phase 7 D-01) — a command that omits `repo_root` will explore the wrong tree or hit the "repo_root unresolvable" fail-closed throw, depending on whether the env var happens to be set.
- **Extending an existing sync script's `ASSETS` array instead of adding a new script:** breaks the one-script-per-feature convention and couples an unrelated feature's `--check` result to this one.
- **Dumping the tool's raw JSON error payload to the user:** on an execution-tier failure the tool's `content[0].text` is a pretty-printed `{ok:false, error, stderr, exitCode, timedOut}` JSON blob — useful for debugging, not for a one-line user-facing relay; the command should pull just the `error` (and optionally `stderr` if short) rather than paste the whole block.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Repo-root resolution | A custom path-walking script | `git rev-parse --show-toplevel` (already the pattern in `wiki-query.md` §0) | One battle-tested git subcommand; reinventing it risks missing worktree/submodule edge cases git already handles |
| Asset drift detection | A new diffing mechanism | The existing `cmp -s` + `ASSETS` array loop from `sync-opencode-wiki-assets.sh` | Five other features already use this exact loop; a new mechanism would be an unrequested abstraction for identical behavior |
| Citation rendering | Any new formatting/parsing logic in the command | The tool's own `renderCitations()` output (`content[0].text`), verified in `mcp-memory-server/src/index.ts` | The tool already does this (Phase 7 D-02); the command's only job is to relay it |

**Key insight:** Every piece this phase needs already exists somewhere in the
repo in near-final form (`recall.md` × 2, `wiki-query.md`'s repo-root block,
`sync-opencode-wiki-assets.sh`). The work is narrowing and recombining, not
inventing.

## Common Pitfalls

### Pitfall 1: Assuming a CI aggregation point exists for `sync-opencode-*-assets.sh --check`
**What goes wrong:** D-04 says "wire its `--check` into CI the same way the other `sync-opencode-*-assets.sh --check` runs are invoked" — a planner could search briefly, find nothing obvious, and either skip the CI step silently or invent a new CI job structure that doesn't match anything else in the repo.
**Why it happens:** No such aggregation point exists today. `.github/workflows/ci.yml` has exactly one job (`memory-server`) that runs `npm ci && npm run build && npm test` inside `mcp-memory-server/` — it never touches `scripts/sync-opencode-*.sh`. `docs/operating.md`'s "Sanity checks" section documents `sync-claude-assets.sh --check` as a manual command; it does **not** list any `sync-opencode-*.sh --check` invocation at all, automated or manual, in that section (the OpenCode sync scripts are documented only in the earlier "Setup order (OpenCode)" section as one-time `--apply` install commands, with a passing mention that re-running with `--check` shows drift).
**How to avoid:** Verified directly — `grep -rn "sync-opencode" .github/workflows/` returns nothing; `.github/workflows/ci.yml` has no OpenCode-related step. The planner should either (a) treat D-04's "CI" framing as aspirational and instead add `scripts/sync-opencode-explore-assets.sh --check` next to `sync-claude-assets.sh --check` in `docs/operating.md`'s "Sanity checks" list (documented manual parity, matching the current de facto state of every sibling script), or (b) if the user wants actual CI automation, that is new scope beyond what any existing script does today and should be flagged back rather than silently invented. Given "thin wiring" is the phase's explicit constraint, (a) is the lower-risk default — add the one doc line, note in the plan that no prior sync script has real CI wiring either.
**Warning signs:** A plan task that says "add sync-opencode-explore-assets.sh --check to ci.yml" without also touching the other five scripts is a sign the aggregation-point premise was taken as true without verification — either all six scripts get a real CI job in this phase (scope increase, needs explicit sign-off) or none do (match existing state).

### Pitfall 2: Getting the frontmatter tool-name syntax backwards between harnesses
**What goes wrong:** Using `mcp__cairn-memory__context_explore` in the OpenCode `tools:` block, or `cairn-memory_context_explore: true` in the Claude `allowed-tools` list — either one silently fails to grant the tool (Claude ignores unrecognized allowed-tools entries; OpenCode's `tools:` map is keyed, so a wrong key is simply absent).
**Why it happens:** The two harnesses use different naming conventions for the same underlying MCP tool (double-underscore + comma-list vs single-underscore + boolean map), and the difference is easy to typo under time pressure since both encode "server + tool."
**How to avoid:** Copy the exact live values from the `recall.md` pair (verified above): Claude uses `mcp__cairn-memory__<tool>` inside a comma-separated `allowed-tools:` string; OpenCode uses `cairn-memory_<tool>: true` inside a YAML `tools:` map. Never invent a third form.
**Warning signs:** The command runs but the agent reports the tool isn't available, or silently never calls it.

### Pitfall 3: Command omits `repo_root` and relies on the MCP server's cwd
**What goes wrong:** The tool explores `infraRoot` (the cairnkeep repo where the MCP server runs) instead of the user's actual target project.
**Why it happens:** It's tempting to assume the tool call runs "in the current directory" the way a local CLI would; MCP tool calls run inside the server process, whose cwd is fixed at server-launch time (Phase 7 D-01).
**How to avoid:** Always resolve `repo_root` in the command body (via `git rev-parse --show-toplevel` + optional override) and pass it as an explicit tool argument on every call, per D-03. Never depend on `CAIRN_EXPLORE_REPO_ROOT` being set in the deployment env as a substitute.
**Warning signs:** Citations point at cairnkeep's own source tree (`mcp-memory-server/src/index.ts`, `scripts/*.sh`, etc.) regardless of which project the user is actually working in.

### Pitfall 4: Command re-implements or over-explains the tool's fail-closed errors
**What goes wrong:** The command tries to detect *why* the tool failed (parse stderr, guess at missing env vars) and constructs its own diagnostic message, duplicating logic Phase 7 already owns and potentially giving stale/wrong advice if the tool's error contract changes later.
**Why it happens:** Natural instinct to be "helpful" when a tool call fails.
**How to avoid:** Per CONTEXT.md's discretion note, treat this as a one-line pass-through: if the tool call errors (thrown/`isError`), surface the thrown message as-is (it is already descriptive — e.g. "CAIRN_EXPLORE_BINARY is not set."); if it returns `ok:false`, surface `error` (and `exitCode`/`timedOut` if useful for a human) but not the full JSON dump or `stderr` unless short. Do not add new phrasing that could drift from the tool's actual behavior.
**Warning signs:** The command body contains conditional branches enumerating specific failure causes ("if the binary path looks wrong, try...") — that logic belongs in the tool (Phase 7), not the command.

## Code Examples

Verified patterns from this repository (no external sources needed):

### Claude command frontmatter + repo-root resolution + tool call description
```markdown
---
description: On-demand token-efficient repo exploration via context_explore (FastContext-backed)
argument-hint: "<query> [repo path]"
allowed-tools: Bash, mcp__cairn-memory__context_explore
---

<objective>
On-demand repo exploration. Calls the `context_explore` MCP tool directly and
reports its compact citations — this command does not read or summarize the
cited ranges itself; that decision belongs to the calling agent.
</objective>

<process>
## 0. Resolve repo root
\`\`\`bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository. /context-explore must run from a project repo."
  exit 1
fi
\`\`\`
If an explicit repo path is given as a second argument, use it instead of $ROOT.

## 1. Call the tool
Call `context_explore` with `query` = the question text from $ARGUMENTS and
`repo_root` = the resolved path from step 0.

## 2. Report
On success: relay the tool's citation list verbatim (or its "no citations
found" note). On failure: relay a one-line pass-through of the tool's error
message — do not re-diagnose the cause.
</process>
```
Source: composed from `claude/commands/recall.md` (frontmatter + `<objective>`/`<process>` skeleton) and `claude/commands/wiki-query.md` §0 (repo-root resolution block), both read directly from this repo.

### OpenCode command frontmatter equivalent
```markdown
---
description: On-demand token-efficient repo exploration via context_explore (FastContext-backed)
argument-hint: "<query> [repo path]"
tools:
  bash: true
  cairn-memory_context_explore: true
---
```
Source: `opencode/command/recall.md` frontmatter shape, read directly from this repo.

### Tool output shapes the command must handle (verified from source)
```typescript
// mcp-memory-server/src/index.ts — success text (content[0].text):
// either compact citations:
"path/to/file.ts:120-145\nother/file.rs:10-22"
// or, for a genuine zero-citation success:
"(no citations found; turns=3, tool_calls=2)"

// structuredContent on success:
{ ok: true, citations: [...], expanded_snippets: [...], stats: { turns, tool_calls } }

// structuredContent on execution-tier failure (tool call returns normally, isError:false):
{ ok: false, error: "token_miser explore timed out" | "token_miser explore exited non-zero" | "malformed Evidence JSON", stderr, exitCode, timedOut? }

// precondition-tier failure surfaces as an MCP tool error (isError:true), e.g.:
// thrown Error("CAIRN_EXPLORE_BINARY is not set.")
// thrown Error("CAIRN_EXPLORE_BINARY does not exist: <path>")
// thrown Error("No repo_root provided and CAIRN_EXPLORE_REPO_ROOT is not set.")
// thrown Error("repo_root does not exist: <resolved path>")
```
Source: `mcp-memory-server/src/index.ts` lines ~1001-1085 (`context_explore` registration) and ~602-615 (`renderCitations`), read directly.

## State of the Art

Not applicable — no external framework/library versioning is involved. The
only "state of the art" question is internal-repo convention consistency,
which is fully covered above (five existing `sync-opencode-*-assets.sh`
scripts, one existing `recall.md` pair, all read directly this session).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Extra live assets" glob-scan warning (`collect_extra_live_assets` in the wiki sync script) is worth keeping in the new narrowed script for structural parity, even though this feature has only one asset file | Architecture Patterns / Pattern 4 | Low — purely cosmetic; omitting it only loses an unmanaged-file warning that has near-zero chance of firing for a single-file feature |
| A2 | The optional repo-path override token is the second positional value in `$ARGUMENTS` (query first, path second) | Architecture Patterns / Pattern 3 | Low-medium — if the planner picks a different flag convention (e.g. `--repo <path>`), it's a naming choice, not a functional risk, since D-03 leaves exact flag parsing to Claude's discretion |

No assumption in this log concerns a locked decision, a compliance/security
requirement, or an external package — both are internal convention choices
explicitly left to "Claude's Discretion" by CONTEXT.md.

## Open Questions

1. **Does D-04's "wire into CI" require adding a *new* CI job, or is documenting `--check` next to `sync-claude-assets.sh --check` in `docs/operating.md` sufficient?**
   - What we know: no `sync-opencode-*-assets.sh --check` is invoked anywhere in `.github/workflows/ci.yml` today; `docs/operating.md` documents these scripts as manual, developer-run commands only.
   - What's unclear: whether the user's intent behind D-04 was "match the *existing* CI pattern" (which, for OpenCode scripts, is "none — manual only") or "this is the first script to actually get CI wiring."
   - Recommendation: default to documentation parity (add the `--check` line to `docs/operating.md`'s sanity-checks list, matching the five siblings' de facto manual-only state) since that's the lower-risk, "thin wiring" reading; flag explicitly in the plan that no sibling script has real CI automation either, so the user can override if they actually want new CI scope.

2. **Should the command surface `stderr` on execution-tier failures, or only `error`?**
   - What we know: the tool's `ok:false` payload includes `stderr` (potentially long/noisy subprocess output) alongside a short `error` string.
   - What's unclear: whether a long `stderr` blob helps or clutters the one-line relay CONTEXT.md's discretion note describes.
   - Recommendation: surface `error` always; include `stderr` only if it is short (e.g. under ~200 chars) or omit it entirely and point the user to re-running with more context if needed — keep the default response lean per D-02's overall "citations only / no bloat" spirit.

## Environment Availability

Skipped — this phase has no new external tool/service/runtime dependency.
Everything it touches (`git`, `bash`, the already-configured `cairn-memory`
MCP server, the already-verified `token_miser` binary from Phase 6/7) is a
precondition of *prior* phases, not this one.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node smoke-test scripts (`mcp-memory-server/scripts/smoke-*.mjs`, offline, no framework/runner dependency) for the MCP tool layer; plain shell `--check` invocation for the sync script layer |
| Config file | none — `mcp-memory-server/package.json` `scripts.test` chain; sync scripts are self-contained Bash |
| Quick run command | `scripts/sync-claude-assets.sh --check` (Claude asset drift); `scripts/sync-opencode-explore-assets.sh --check` (new OpenCode asset drift) |
| Full suite command | `cd mcp-memory-server && npm test` (unaffected by this phase — no server code changes) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CTX-04 | Claude command frontmatter/body installs cleanly and matches repo source | smoke (drift check) | `scripts/sync-claude-assets.sh --check` | ✅ (existing script, auto-discovers the new file) |
| CTX-04 | Command invokes `context_explore` and surfaces citations in a live session | manual-only (requires a live Claude Code session + configured `token_miser`/FastContext, same class as Phase 5/6's live-only checks) | `/context-explore <query>` run interactively | N/A — manual, no automated harness for live agent-invoked slash commands exists in this repo |
| CTX-05 | OpenCode command installs cleanly via the new dedicated sync script | smoke (drift check) | `scripts/sync-opencode-explore-assets.sh --check` | ❌ Wave 0 — new script, write it in this phase |
| CTX-05 | OpenCode command invokes the same tool and surfaces citations | manual-only (same live-session class as CTX-04) | `/context-explore <query>` run interactively in OpenCode | N/A — manual |
| SC-3 (on-demand only, no hook) | No new automatic hook is registered for this feature | inspection | `grep -c 'context.explore' claude/hooks/*.sh scripts/sync-claude-assets.sh` expect 0 hits outside the command files themselves | N/A — negative-check, not a runnable assertion; verify by code review during plan-checker/verify-work |

### Sampling Rate
- **Per task commit:** `scripts/sync-claude-assets.sh --check` and `scripts/sync-opencode-explore-assets.sh --check` (both fast, offline, no live model needed)
- **Per wave merge:** same two `--check` commands plus `cd mcp-memory-server && npm test` (confirms this phase didn't regress the untouched Phase 7 tool)
- **Phase gate:** both sync scripts green (`--check` reports "in sync") before `/gsd-verify-work`; live `/context-explore` invocation in at least one harness is the human-verify checkpoint for SC-1/SC-2 (mirrors how Phase 5/6 handled live-model-dependent checks — cannot be scripted without a running FastContext endpoint)

### Wave 0 Gaps
- [ ] `scripts/sync-opencode-explore-assets.sh` — does not exist yet; write it this phase (copy-and-narrow `sync-opencode-wiki-assets.sh`, per D-04)
- [ ] No automated test can exercise a live slash-command invocation end-to-end (same limitation as every other command in this repo — `recall.md`, `wiki-query.md`, etc. are all verified live/manually, never via a scripted harness). This is a pre-existing repo-wide gap, not new to this phase; do not attempt to build one just for `/context-explore`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Command runs inside an already-authenticated agent session; no new auth surface |
| V3 Session Management | No | No new session state introduced |
| V4 Access Control | No | No new access boundary — the command only exposes a tool call the agent could already be granted via the existing MCP registration |
| V5 Input Validation | Yes | `$ARGUMENTS` (the user's query and optional repo path) is passed as an MCP tool argument, not interpolated into a shell command that gets `eval`'d — the tool itself (`z.object({query: z.string().min(1), repo_root: z.string().min(1).optional(), ...})`, Phase 7 D-03) validates and the subprocess call uses `spawn` with an argv array (`runCommand`), not a shell string, so there is no injection surface via query content. The only shell code this phase adds is the `git rev-parse --show-toplevel` resolution block, which takes no user input. |
| V6 Cryptography | No | No cryptographic operation in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via an attacker-supplied "optional repo path" argument pointing outside intended scope | Tampering | Already mitigated at the tool layer: `resolve(expandHome(rawRoot))` plus `existsSync` check in `context_explore` (Phase 7); the command does not need its own path-sanitization layer, it just needs to pass whatever it resolves as `repo_root` — the tool fails closed on a nonexistent path and has no privilege boundary to cross since the calling agent already has whatever filesystem access the harness grants it |
| Shell-injection via query text if a future implementation mistakenly builds a shell string | Tampering | Not applicable here since the command relays `$ARGUMENTS` as an MCP tool *argument* (structured JSON-RPC), never as literal shell text — the one shell block in this phase (`git rev-parse --show-toplevel`) takes no interpolated user input at all |

**DEC-no-private-references constraint (from PROJECT.md, LOCKED):** neither
command file nor the new sync script may reference any specific
employer/vendor/internal host/IP/private repo name — consistent with every
other file in `claude/commands/` and `opencode/command/`, none of which
contain such references today (verified by inspection of `recall.md` pairs).

## Sources

### Primary (HIGH confidence — verified this session by direct file read)
- `.planning/phases/08-operating-layer-wiring/08-CONTEXT.md` — locked decisions D-01..D-04, canonical refs
- `.planning/phases/07-context-explore-mcp-tool/07-CONTEXT.md` — prior-phase D-01/D-02/D-04 contract this phase wires over
- `mcp-memory-server/src/index.ts` (lines ~602-615, ~1001-1088) — `context_explore` registration, `renderCitations`, error/success payload shapes
- `claude/commands/recall.md`, `opencode/command/recall.md` — direct-call command skeleton for both harnesses
- `claude/commands/wiki-query.md` §0 — repo-root resolution block
- `scripts/sync-opencode-wiki-assets.sh`, `scripts/sync-claude-assets.sh` — sync-script templates
- `mcp-memory-server/scripts/smoke-explore-guard.mjs`, `mcp-memory-server/package.json` — existing offline test conventions for the tool this phase wires into
- `.github/workflows/ci.yml`, `docs/operating.md`, `scripts/verify-opencode-live-parity.sh` — verified absence of any existing `sync-opencode-*-assets.sh --check` CI aggregation point (Pitfall 1 / Open Question 1)
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/PROJECT.md` — requirement text, project decisions, DEC-no-private-references wording

### Secondary (MEDIUM confidence)
None — no findings required web/docs lookup this session; the entire domain is internal-repo pattern mirroring, and the available search providers were all disabled (`brave_search: false, firecrawl: false, exa_search: false` from `gsd-tools query init.phase-op`), which is consistent with this phase needing none.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no external packages; all patterns copied from files read directly this session
- Architecture: HIGH — CONTEXT.md locked the shape; verified against live `recall.md`/sync-script source
- Pitfalls: HIGH — Pitfall 1 (no CI aggregation point) is a direct, verified negative finding, not a guess; Pitfalls 2-4 follow directly from reading the live frontmatter/tool source

**Research date:** 2026-07-05
**Valid until:** No expiry driver — this research is tied to the current state of this repo's files, not to any external library version. Re-verify only if Phase 7's tool contract (`mcp-memory-server/src/index.ts`) or the sync-script convention changes before Phase 8 is planned/executed.
