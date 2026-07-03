# Phase 4: OpenCode parity operating layer - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

> ⚠ **Decisions below were made on best judgment while the user was away** (gray-area
> selection timed out). They follow the established Claude reference implementation
> and the ponytail/minimal-diff principle. Every decision is revisable — re-run
> `/gsd-discuss-phase 4` to confirm or change any of them before planning locks them in.

<domain>
## Phase Boundary

Port the verified Claude memory lifecycle and memory commands to OpenCode's plugin
model so OpenCode reaches drop-in parity, standing on its own with **no Claude assets
present on disk**. Five deliverables map 1:1 to requirements:

- **OCP-05 wakeup** — rewrite `opencode/plugins/memory-wakeup.ts` to be self-sufficient (today it shells out to `~/.claude/hooks/memory-wakeup.sh`).
- **OCP-01 capture** — new OpenCode plugin: on session end, extract candidates → the shared `.planning/memory-staging/` (parity with `memory-capture.sh`).
- **OCP-02 recall** — new OpenCode plugin: before an edit/write, inject file-specific memory (parity with `memory-recall.sh`).
- **OCP-03 remember** — new `opencode/command/remember.md`.
- **OCP-04 recall command** — new `opencode/command/recall.md`.

Plus install wiring: extend the existing `sync-opencode-plugin-assets.sh` and
`sync-opencode-memory-assets.sh` to carry the new assets.

**Not in scope (parity-only milestone):** no new memory/wiki/security capabilities,
no changes to the `cairn-memory` MCP server contract (v1.0-validated), no third harness.
Live end-to-end verification is Phase 5 (OCP-06), not here.

</domain>

<decisions>
## Implementation Decisions

### Logic-sharing strategy
- **D-01:** The heavy logic already lives in the `cairn-memory` MCP server — it exposes `wakeup` and `extract` subcommands (`node mcp-memory-server/dist/index.js wakeup|extract <model>`). That server binary IS the shared source of truth both harnesses already call. The Claude `.sh` hooks are thin glue around it.
- **D-02:** Port the thin glue **natively into TypeScript** inside each OpenCode plugin (call the server subcommands + read/write the same `.planning/` files). Do **not** introduce a new harness-neutral shell-script layer, and do **not** shell out to any `~/.claude` path. Rationale: the shared logic is the server, not the glue; a native TS port removes the Claude dependency with the smallest diff and no new artifact. (Revisit only if the glue turns out to be large enough that duplication hurts.)
- **D-03:** Every plugin is **fail-open**: a missing server binary, missing `.agentfs`/`.planning`, or a failed subcommand must never wedge an OpenCode session (matches the existing wakeup plugin's `try/catch` and the hooks' `exit 0` discipline).

### Wakeup self-sufficiency (OCP-05)
- **D-04:** Reimplement `memory-wakeup.ts` to surface, natively, the same four things `memory-wakeup.sh` does: (1) AgentFS project memory via `node <server> wakeup`, (2) the wiki index `.planning/wiki/index.md`, (3) open **HARD** contradictions from `.planning/wiki/CONTRADICTIONS.md`, (4) a staged-candidates count from `.planning/memory-staging/`. Guard: no-op unless `.agentfs/project.db` or `.planning/wiki/index.md` exists. Keep the once-per-session dedupe and `experimental.chat.system.transform` injection already in the plugin.
- **D-05:** The server's `INFRA_ROOT` (path to `mcp-memory-server/dist/index.js`) is resolved for OpenCode independently of `~/.claude` — the install/sync step is responsible for making the plugin point at the real server path. (Researcher: confirm how the current plugin/install resolves INFRA_ROOT for OpenCode without the Claude token substitution.)

### remember / recall command layers
- **D-06:** **Drop the Claude-only file-memory layer.** Claude's `remember` writes AgentFS + `~/.claude/projects/<encoded-cwd>/memory/`; that directory is a Claude-runtime artifact, not part of the shared parity contract. AgentFS (via `mcp__cairn-memory__memory_write`) is the shared, cross-harness durable store — that is what makes wakeup/recall/capture round-trip. OpenCode `remember` = dedupe (`memory_search`) → write/supersede AgentFS (project scope) → *flag only* the doc layers (wiki via `/wiki-ingest`, AnythingLLM via `domain_knowledge_sync`), never auto-run them. OpenCode `recall` = read AgentFS + wiki index + optional `domain_knowledge_query`.
- **D-07:** Preserve the Claude command semantics verbatim where they are layer-agnostic: empty-argument guard, dedupe-before-write, absolute-date conversion, no em/double-hyphen dashes, doc-layer flag-don't-run. Only the frontmatter and the file-memory step change for OpenCode.

### Capture trigger (OCP-01)
- **D-08:** The capture plugin writes to the **identical** staging contract the Claude hook uses: one `.planning/memory-staging/<UTCstamp>.json` file per session-end, the same `node <server> extract <EXTRACT_MODEL>` candidate JSON, the same 5-session retention cap, and the same env guards (`CAIRN_LLM_API_KEY`, `CAIRN_LLM_EXTRACTION_MODEL` both required, else no-op). This keeps `/memory-review` (already cross-harness) and the wakeup surfacing working unchanged.
- **D-09:** The OpenCode lifecycle event that stands in for Claude's SessionEnd, and the mechanism for obtaining the session transcript/messages to feed `extract`, are **research items** (OpenCode does not hand a plugin a `transcript_path` the way Claude's hook JSON does). Reuse `scripts/transcript-to-text.mjs` if the session content is available as JSONL; otherwise adapt to whatever message shape the plugin API exposes.

### Recall injection (OCP-02)
- **D-10:** Preserve the **high-signal / low-noise** rule: derive the target file's basename + stem (skip stems < 4 chars), match against the AgentFS wakeup index (grep by stem) and wiki source pages, and inject context **only** when there is a specific match — inject nothing on routine edits. Fail-open on any error.
- **D-11:** The concrete injection mechanism (Claude returns `additionalContext` from a `PreToolUse` hook; OpenCode uses a `tool.execute.before`-style hook scoped to edit/write tools) is a **research item** — confirm OpenCode can inject model-visible context before the tool runs, and the exact hook name + payload shape.

### Install / sync wiring
- **D-12:** Add `plugins/memory-capture.ts` and `plugins/memory-recall.ts` to the `ASSETS` array in `scripts/sync-opencode-plugin-assets.sh`; add `command/remember.md` and `command/recall.md` to the `ASSETS` array in `scripts/sync-opencode-memory-assets.sh`. No new sync script — the two existing ones already own these asset families and are idempotent (`--check`/`--apply`).

### Claude's Discretion
- Exact TS structure/naming inside the plugins, the wording of the injected context strings, and the command markdown prose — all left to the executor, constrained by matching the Claude reference behavior and OpenCode's existing `memory-wakeup.ts` / `command/*.md` house style.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Parity reference — Claude source of truth (behavior to replicate)
- `claude/hooks/memory-wakeup.sh` — the SessionStart surfacing logic to reimplement natively (OCP-05).
- `claude/hooks/memory-capture.sh` — SessionEnd extract→stage protocol, env guards, 5-session cap (OCP-01).
- `claude/hooks/memory-recall.sh` — PreToolUse file-specific injection, stem matching, high-signal rule (OCP-02).
- `claude/commands/remember.md` — the write-half command semantics to port (OCP-03).
- `claude/commands/recall.md` — the read-half command semantics to port (OCP-04).

### OpenCode target — existing patterns to follow
- `opencode/plugins/memory-wakeup.ts` — the ONLY existing plugin; the pattern for `Plugin` type, fail-open, once-per-session dedupe, and system-prompt injection. Also the file to rewrite for OCP-05.
- `opencode/command/memory-sync.md` — house style for OpenCode command frontmatter (`tools: {read,write,...}` — NOT Claude's `allowed-tools:`); reference for how MCP-backed commands are written for OpenCode.
- `scripts/sync-opencode-plugin-assets.sh` — plugin install/sync mechanism (extend its `ASSETS`).
- `scripts/sync-opencode-memory-assets.sh` — command/agent install/sync mechanism (extend its `ASSETS`).
- `scripts/transcript-to-text.mjs` — transcript→text helper the capture flow may reuse.
- `mcp-memory-server/dist/index.js` — the server binary; subcommands `wakeup` and `extract <model>` are the shared logic both harnesses call.

### Requirements & constraints
- `.planning/ROADMAP.md` §"Phase 4" — goal, success criteria, OCP-01..05 mapping.
- `.planning/REQUIREMENTS.md` — OCP-01..05 wording + explicit Out-of-Scope (no new capabilities, no server-contract change).
- `.planning/PROJECT.md` decisions block — DEC-no-private-references / DEC-no-ai-authorship / DEC-commit-scanning (LOCKED); the v1.1 decision "memory-wakeup must be self-sufficient of Claude-rendered assets."

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `mcp-memory-server` `wakeup` + `extract <model>` subcommands — the real shared logic; plugins are thin callers, no logic duplication.
- `opencode/plugins/memory-wakeup.ts` — reusable plugin skeleton (Plugin type, `$` shell handle, fail-open, session dedupe set).
- `.planning/memory-staging/` staging contract + `/memory-review` accept gate — already cross-harness; capture just has to write the same file shape.
- `scripts/transcript-to-text.mjs` — transcript JSONL→text converter.
- The two `sync-opencode-*-assets.sh` scripts — idempotent install; extend `ASSETS` arrays only.

### Established Patterns
- Fail-open everywhere (hooks `exit 0`, plugin `try/catch`) — never wedge a session.
- Env-guarded, repo-guarded no-op (bail unless `.agentfs`/`.planning` present + required env set) — safe as a global plugin.
- High-signal/low-noise recall — inject only on a specific file match.
- AgentFS = the shared durable structured store; wiki/AnythingLLM = doc layers that are *flagged*, never auto-written.

### Integration Points
- OpenCode plugin lifecycle events (session-end, tool.execute.before, chat.system.transform) — the injection/trigger surface; exact event names are the primary research target.
- `cairn-memory` MCP tools (`memory_write`, `memory_search`, `memory_supersede`, `memory_read`, `domain_knowledge_query`) referenced from OpenCode command frontmatter — confirm OpenCode's permission/reference syntax for MCP tools.

</code_context>

<specifics>
## Specific Ideas

- "Self-sufficient of Claude assets" is the hard bar for OCP-05: after install, delete `~/.claude` and the OpenCode wakeup must still surface memory. That is the acceptance test to design toward.
- Same staging directory, same server subcommands, same env-var names as the Claude path — parity is achieved in the operating layer, not by forking the shared contract.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Live end-to-end round-trip proof is Phase 5 / OCP-06, already roadmapped; token-miser and the enterprise overlay remain future milestones.)

</deferred>

---

*Phase: 4-OpenCode parity operating layer*
*Context gathered: 2026-07-03*
