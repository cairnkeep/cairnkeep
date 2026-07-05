# Phase 8: Operating-Layer Wiring - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Add an on-demand `/context-explore` command to **both** operating layers — Claude
Code and OpenCode — that invokes the already-built `context_explore` MCP tool
(Phase 7) and surfaces its compact `path:line-range` citations in the response.
The OpenCode command is installed via a new dedicated
`sync-opencode-explore-assets.sh` mirroring the existing per-feature sync scripts.

**This phase does NOT** build any exploration logic (Phase 7 owns the tool), add
an automatic pre-task hook (that is deferred CTX-F2; SC-3 requires on-demand,
agent-invoked entry points only), or measure token savings (Phase 9). It is thin
operating-layer wiring over an existing tool.

Requirements: **CTX-04** (Claude Code command) · **CTX-05** (OpenCode command +
`sync-opencode-*-assets.sh`).

</domain>

<decisions>
## Implementation Decisions

### Command architecture
- **D-01:** **Direct inline MCP call — no paired sub-agent.** The command lists
  the tool in its allowed-tools/`tools` block and calls `context_explore`
  directly, then surfaces the citations. Mirrors `recall.md` (both harnesses),
  NOT the agent-dispatch `wiki-query`→`wiki-query-analyst` pattern. Rationale: the
  Phase-7 tool is already thin and returns *final* citations — a sub-agent would
  only relay them, adding an agent file to sync for no work. This also means the
  OpenCode command is **self-contained** (like `opencode/command/recall.md`) — no
  `workflows/*.md` file and no `opencode/agents/*` file for this feature.

### Response surface
- **D-02:** **Citations only.** Surface the compact `path:line-range` list; the
  main agent decides what to `Read` next. Do NOT auto-read the cited ranges or
  pre-synthesize per-citation summaries — that spends the exact tokens the tool
  exists to save (this is precisely what Phase 9 / CTX-07 A/B measures). The tool
  still returns full `Evidence` in `structuredContent` for any programmatic
  caller; the command's *response* stays lean.

### Repo targeting & command name
- **D-03:** Command name **`/context-explore`** (matches ROADMAP SC wording).
  Resolve the target repo via **`git rev-parse --show-toplevel` → optional path
  arg override**, and pass it **explicitly** as the tool's `repo_root` (Phase 7
  D-01: the MCP server's cwd is `infraRoot`, not the target repo, so the command
  MUST pass `repo_root` — it cannot rely on cwd). Zero-friction common case; the
  tool still fails closed if `repo_root` is unresolvable.

### Sync & CI parity
- **D-04:** **Dedicated `scripts/sync-opencode-explore-assets.sh`** mirroring
  `sync-opencode-wiki-assets.sh` (ASSETS array, `--check`/`--apply`,
  `--live-root`, source-of-truth under `./opencode/`). Wire its `--check` into CI
  the same way the other `sync-opencode-*-assets.sh --check` runs are invoked.
  The Claude command is installed through the existing `sync-claude-assets.sh`.
  Keeps the one-script-per-feature convention and the drift guard every other
  feature already has.

### Claude's Discretion
- Tool-name conventions in frontmatter: `mcp__cairn-memory__context_explore`
  (Claude `allowed-tools`) vs `cairn-memory_context_explore: true` (OpenCode
  `tools`) — pattern already visible in `recall.md` pairs.
- How the command relays the tool's fail-closed error (Phase 7 D-04) — likely a
  one-line "exploration not configured / binary missing" pass-through; do not
  re-implement the tool's error handling.
- Exact `$ARGUMENTS`/flag parsing (query required; optional repo path), the
  `ASSETS=(...)` contents, and the precise CI hook location for the new
  `--check` — resolve during planning against the existing scripts.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — CTX-04 (Claude Code command), CTX-05 (OpenCode
  command installed via `sync-opencode-*-assets.sh`, parity with Claude).
- `.planning/ROADMAP.md` §"Phase 8" — goal + 3 success criteria (incl. SC-3:
  on-demand/agent-invoked, NOT an automatic hook).

### Prior-phase contract (the tool these commands call — LOCKED)
- `.planning/phases/07-context-explore-mcp-tool/07-CONTEXT.md` — D-01 (repo_root
  must be passed explicitly), D-02 (dual compact-text + structured Evidence
  output), D-04 (fail-closed contract). The command wires over this, unchanged.
- `mcp-memory-server/src/index.ts` — the registered `context_explore` tool
  (input schema `query`/`repo_root`/`timeout_seconds`; compact `content` +
  structured `Evidence`) that both commands invoke.

### Code patterns to mirror
- `claude/commands/recall.md` — the direct-call Claude command shape (frontmatter
  `allowed-tools` with an `mcp__cairn-memory__*` tool; body describes the tool
  call + report). The skeleton for the Claude `/context-explore`.
- `opencode/command/recall.md` — the self-contained direct-call OpenCode command
  shape (`tools:` block enabling `cairn-memory_*`; no workflow/agent file).
- `claude/commands/wiki-query.md` §0 — the `git rev-parse --show-toplevel`
  repo-root resolution block for D-03 (adopt the resolution; reject its
  agent-dispatch structure per D-01).
- `scripts/sync-opencode-wiki-assets.sh` — the exact sync-script template to copy
  for `sync-opencode-explore-assets.sh` (ASSETS array, check/apply, extra/legacy
  asset reporting).
- `scripts/sync-claude-assets.sh` — how the Claude command reaches the live tree.

### Constraint
- `.planning/PROJECT.md` §Constraints — **DEC-no-private-references [LOCKED]**: no
  endpoint/model/host/IP in either command or the sync script.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `recall.md` (Claude + OpenCode) — near-exact skeleton for a direct-call,
  single-MCP-tool command; copy structure, swap tool + body.
- `sync-opencode-wiki-assets.sh` — copy-and-narrow template for the new explore
  sync script; the ASSETS array shrinks to just `command/context-explore.md`
  (no agents/workflows/templates, per D-01).
- The `git rev-parse --show-toplevel` guard from `wiki-query.md` §0 for D-03.

### Established Patterns
- Per-feature `sync-opencode-<feature>-assets.sh` with `ASSETS=(...)`,
  `--check` (default) / `--apply` / `--live-root`, source-of-truth `./opencode/`,
  live root `${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}`. Existing scripts:
  memory, wiki, graphify, security, plugin.
- Claude tool ref `mcp__cairn-memory__<tool>` vs OpenCode `cairn-memory_<tool>:
  true` — same tool, harness-specific naming (visible in the `recall.md` pair).
- Commands are prompt files; the agent performs the tool call described in the
  body ($ARGUMENTS = user query).

### Integration Points
- `context_explore` is already registered in `mcp-memory-server/src/index.ts` —
  no server change needed; this phase only adds command + sync assets.
- New `command/context-explore.md` under `./opencode/`; new
  `claude/commands/context-explore.md`; new `scripts/sync-opencode-explore-assets.sh`.
- CI: the new sync script's `--check` joins the existing
  `sync-opencode-*-assets.sh --check` invocations (planner to locate the exact
  aggregation point; `test:smoke` / CI workflow).

</code_context>

<specifics>
## Specific Ideas

- "Thin wiring" is the operative constraint — same spirit as Phase 7's "thin"
  tool. Two command files + one sync script + one CI check line. No new agent, no
  workflow file, no server change.
- Token economy is the whole point (D-02): the command surfaces citations, it
  does not spend tokens reading or summarizing them — Phase 9 measures exactly
  that delta.

</specifics>

<deferred>
## Deferred Ideas

- **Pre-task hook auto-invoke of exploration (CTX-F2)** — explicitly out of scope
  this phase; SC-3 mandates on-demand/agent-invoked, not automatic. Future
  milestone (reuses OCP-01/02 hook infra), fresh-task-only per token-miser's
  invariant.
- **Memory-aware citation annotation (CTX-F1)** and **result caching (CTX-F3)** —
  future differentiators, deferred until the base command is proven useful.
- **Token-savings A/B measurement (CTX-07)** — Phase 9.

_Discussion stayed within phase scope — no scope creep raised._

</deferred>

---

*Phase: 8-operating-layer-wiring*
*Context gathered: 2026-07-05*
