# Phase 12: Context Exploration Maturation - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 12 matures the existing v1.2 `context_explore` tool along three axes:
its output **flags which cited ranges have related memory/wiki hits** (CTX-08),
a **pre-task hook auto-invokes it** for a task's query with no manual
`/context-explore` call (CTX-09), and results are **cached keyed on
(query, repo HEAD + dirty-state)** so an unchanged repo never re-pays
token-miser's cost on a repeat query (CTX-10).

This is HOW to mature the existing tool — token-miser's exploration logic is
untouched (LOCKED thin-delegate boundary), and no new exploration capabilities
are added. All three features live on cairnkeep's side of the seam.

</domain>

<decisions>
## Implementation Decisions

The user selected all four gray areas and delegated the design decisions
("discuss all the points and decide autonomously what's best"). All decisions
below are Claude's calls, grounded in the LOCKED constraints and the proven
Phase 4/7/10 patterns. The planner has latitude on naming and exact thresholds
but MUST preserve: thin-delegate boundary, env-only opt-in config, fail-open
enrichment/hooks, fail-closed tool tiers, and verify-by-execution proofs.

### Cross-reference mechanics (CTX-08)
- **D-01: Enrichment runs inside the `context_explore` handler** in
  `mcp-memory-server/src/index.ts`, after the Evidence JSON parse and before
  output shaping. In-process calls only — no MCP round-trip, no new
  subprocess. token-miser is untouched: cross-referencing is cairnkeep-side
  output enrichment, not exploration logic (thin-delegate preserved).
- **D-02: Deterministic stem matching, mirroring `memory-recall.sh`.** For
  each unique cited path: derive the basename stem (skip stems < 4 chars —
  the recall hook's noise guard); memory match = case-insensitive substring
  hit against the explored repo's project-scope memory entries; wiki match =
  stem hit over `<repo_root>/.planning/wiki/sources/*.md` page names/content.
  No embeddings for path matching (paths aren't natural language; determinism
  keeps it verifiable). Semantic memory_search on the *original query* is a
  deferred enrichment, not in this phase.
- **D-03: Flags render per-citation, silent when empty.** In
  `structuredContent`, each citation gains optional `memory_refs` (keys /
  preview lines) and `wiki_refs` (page names). Rendered text appends a compact
  marker to flagged citation lines (e.g. `⟵ memory: <key> · wiki: <page>`) or
  a short cross-refs block under the citations — planner picks the exact
  rendering. Citations with no hits get NO annotation; a result with zero
  hits looks identical to today's output.
- **D-04: Fail-open enrichment against the explored repo.** Cross-refs are
  computed against the `repo_root` passed to the tool (its `.agentfs` db and
  `.planning/wiki/sources`), not the server's cwd. Missing db/wiki dir or any
  enrichment error → return the result without cross-refs; never fail or
  degrade the exploration result itself. (The fail-closed precondition/
  execution tiers of the existing tool are unchanged.)

### Pre-task hook (CTX-09)
- **D-05: Claude Code `UserPromptSubmit` hook is the verified path.** New
  bash hook `claude/hooks/context-explore-pretask.sh`, registered via the
  existing filename→event map in `scripts/sync-claude-assets.sh` (same
  mechanism as `memory-wakeup.sh`/`memory-recall.sh`). The submitted prompt
  text (stdin JSON) is the task's query.
- **D-06: The hook invokes a new server CLI subcommand** (e.g.
  `node dist/index.js explore "<query>"`) alongside the existing `wakeup` and
  `extract` CLI modes — sharing the same code path as the MCP tool handler so
  cache (CTX-10) and cross-refs (CTX-08) apply identically to hook and tool
  invocations. No MCP session needed from bash.
- **D-07: Double opt-in + high-signal gating.** The hook is inert unless
  `CAIRN_EXPLORE_BINARY` is configured AND an explicit
  `CAIRN_EXPLORE_AUTOINVOKE=1` (name per the `CAIRN_*` idiom) is set. Skip
  low-signal prompts: shorter than a minimum length, slash commands, obvious
  non-task replies (exact heuristics = planner discretion). Inject only when
  the result is `ok:true` with non-empty citations. Always fail-open
  (`exit 0`) — mirrors `memory-recall.sh`.
- **D-08: OpenCode parity is conditional, not required.** CTX-09's success
  criterion is satisfied by the Claude Code path. The researcher checks
  whether OpenCode's plugin API exposes a natural prompt-submit event
  (the v1.1 plugins use `session.idle`/`tool.execute.before`; the known
  injection limitation anomalyco/opencode#5894 applies). If a clean event
  exists, add a parity plugin; if not, defer with a documented note in the
  operating docs.

### Cache design (CTX-10)
- **D-09: Cache lives in the `context_explore` handler**, checked before
  spawning token_miser, storing the raw parsed Evidence JSON. Cairnkeep-side
  invocation management — token-miser stays unmodified and unaware.
- **D-10: Content-sensitive key.** Key = hash over (normalized query,
  resolved repo_root, `git rev-parse HEAD`, dirty-state hash). The dirty hash
  MUST reflect content, not just file lists — two different edits to the same
  file must produce different keys. Basis: `git diff HEAD` output plus
  untracked-files listing with size/mtime (exact incantation = planner
  discretion; must catch tracked edits, staged changes, and new untracked
  files).
- **D-11: File-based cache outside the explored repo.** JSON entries under
  `${XDG_CACHE_HOME:-~/.cache}/cairn/explore/` — never write into the
  explored repo (repo_root may be any repo, not necessarily cairnkeep-managed).
  Simple oldest-first prune at write time (cap ~200 entries, planner
  discretion). Default ON once shipped (the success criterion demands hits);
  `CAIRN_EXPLORE_CACHE=0` as the kill-switch. No other new required config.
- **D-12: Cache stores raw evidence only; cross-refs recompute every return.**
  Memory and wiki evolve independently of repo HEAD, so CTX-08 flags are
  computed fresh on both hits and misses. The payload carries `cached: true|false`
  so callers and the verify script can prove cache behavior.

### Auto-invoke latency & output budget
- **D-13: Synchronous with a bounded timeout.** The pre-task hook runs
  explore blocking, with a timeout comfortably inside Claude Code's hook
  timeout budget; on timeout or any failure it injects nothing. Blocking is
  acceptable because the feature is double-opt-in (D-07) and the cache makes
  repeat queries near-instant. Async/background cache warming is deferred.
- **D-14: Inject compact citations + cross-ref flags only.** Never
  `expanded_snippets`. Cap the injected block (line/byte cap in the spirit of
  the recall hook's `head -40`). The injected text identifies itself as
  auto-invoked exploration context so the model knows its provenance.

### Claude's Discretion
- Exact rendering of cross-ref markers, hook skip-heuristics, cache entry
  format/prune cap, dirty-hash incantation, CLI subcommand name, and verify
  script naming/structure — preserve the invariants at the top of this block.
- Verification approach (recorded here as intent): a re-runnable
  `scripts/verify-*.sh` proving (1) a seeded memory/wiki entry produces a
  cross-ref flag on a matching citation, (2) a second identical run returns
  `cached:true` without invoking the binary (wrapper/logging binary trick per
  the A/B script), (3) a repo change triggers a fresh invocation, (4) the
  hook injects on a scripted UserPromptSubmit JSON and stays silent when
  gated off.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 12: Context Exploration Maturation" — goal +
  the 3 success criteria gating this phase.
- `.planning/REQUIREMENTS.md` — **CTX-08** (citation cross-referencing),
  **CTX-09** (pre-task auto-invoke), **CTX-10** (cache keyed on query + HEAD +
  dirty-state).
- `.planning/PROJECT.md` §Constraints — **DEC-no-private-references [LOCKED]**,
  **DEC-no-ai-authorship [LOCKED]**, **DEC-commit-scanning [LOCKED]**, and the
  LOCKED v1.2 thin-delegate boundary (§Out of Scope).

### The code being extended
- `mcp-memory-server/src/index.ts:1000` — the `context_explore` tool: cache
  check (D-09) wraps its `runCommand` call; cross-refs (D-01) slot in after
  the Evidence JSON parse; fail-closed tiers stay as-is.
- `mcp-memory-server/src/index.ts:1152` — existing CLI subcommands (`wakeup`,
  `extract`): the pattern the new `explore` CLI mode (D-06) extends.
- `mcp-memory-server/src/index.ts:773` — `memory_search` / `semanticSearch`
  and the scope machinery (`resolveScopePath`, `listEntries`) reused
  in-process for memory matching (D-02); note cross-refs target the explored
  `repo_root`, not the server cwd (D-04).

### The patterns to mirror
- `claude/hooks/memory-recall.sh` — the high-signal/low-noise hook template:
  stem derivation + <4-char guard, wakeup-index substring matching, wiki
  `sources/*.md` grep, inject-only-on-match, fail-open `exit 0`, and the
  `hookSpecificOutput.additionalContext` JSON shape.
- `scripts/sync-claude-assets.sh:98-102` — the hook filename→event
  registration map the new `UserPromptSubmit` hook is added to.
- `opencode/plugins/memory-recall.ts` — OpenCode plugin event precedent and
  the documented injection limitation (anomalyco/opencode#5894) relevant to
  the D-08 parity check.

### Contract surfaces that must stay consistent
- `docs/operating.md` §Configuration + §The workflow — new env keys
  (`CAIRN_EXPLORE_AUTOINVOKE`, `CAIRN_EXPLORE_CACHE`) and the auto-invoke/
  cache behavior must land in the docs; Phase 11 shipped
  `scripts/verify-docs-parity.sh`, which will FAIL if code adds `CAIRN_*`
  keys the docs don't name — update docs in the same phase.
- `claude/commands/context-explore.md` + `opencode/command/context-explore.md`
  — the manual command remains; auto-invoke supplements, not replaces, it.

### Verify-by-execution precedent
- `scripts/verify-token-savings-ab.sh` — invokes the real binary and measures;
  the wrapper/logging technique for proving "binary was NOT invoked" on a
  cache hit.
- `scripts/verify-no-private-references.sh`, `scripts/verify-docs-parity.sh` —
  Phase 11 gates that must stay green after this phase's changes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`context_explore` handler** (`index.ts:1000`): all three features wrap or
  extend it — cache check before `runCommand`, cross-ref enrichment after the
  JSON parse, `cached` flag in the payload.
- **Server CLI mode** (`index.ts:1152`, `wakeup`/`extract`): proven pattern
  for hook→server invocation without an MCP session; the new `explore`
  subcommand reuses it.
- **`memory-recall.sh`**: stem matching, noise guards, injection JSON, and
  fail-open discipline — the pre-task hook and the cross-ref matcher both
  copy its semantics.
- **In-process memory machinery** (`listEntries`, `semanticSearch`,
  `resolveScopePath`): cross-refs call these directly instead of shelling out.

### Established Patterns
- **Thin-delegate [LOCKED v1.2]**: token-miser owns exploration; every Phase
  12 feature is cairnkeep-side wrapping (cache, enrichment, invocation).
- **Env-only `CAIRN_*` opt-in config, no committed defaults** (Phases 7/10/11).
- **Fail-closed tool tiers / fail-open hooks**: config problems throw in the
  tool; hooks always `exit 0` and inject nothing on error.
- **Verify-by-execution**: every success criterion gets a re-runnable script
  with recorded output.
- **Docs-parity gate (Phase 11)**: new env keys must be documented in the
  same phase or `verify-docs-parity.sh` fails.

### Integration Points
- `mcp-memory-server/src/index.ts` — handler changes + new CLI subcommand.
- `claude/hooks/` + `scripts/sync-claude-assets.sh` — new hook + registration.
- `opencode/plugins/` — conditional parity plugin (D-08).
- `docs/operating.md`, `README.md` config tables — new env keys + behavior.
- `scripts/` — new verify script(s) alongside the existing family.
- CI smoke suite (`mcp-memory-server` build + smoke) — must stay green.

</code_context>

<specifics>
## Specific Ideas

- CTX-08/09/10 compose: the hook (09) is only ergonomic because the cache
  (10) makes repeats instant, and the injected context is only trustworthy
  because cross-refs (08) surface what memory already knows. Plan order
  should let the cache land before or with the hook.
- A cache hit must be *provable*, not asserted: `cached:true` in the payload
  plus a verify script that demonstrates the binary was not spawned (wrapper
  binary that logs invocations, per the A/B script's technique).
- The output contract with existing consumers must not break: a result with
  zero cross-ref hits renders identically to today's output (D-03).

</specifics>

<deferred>
## Deferred Ideas

- **Semantic cross-referencing on the original query** (embedding-backed
  memory_search of the query text, not just path stems) — deterministic stem
  matching ships first; revisit if stem matching proves too coarse.
- **Async/background cache warming** (hook returns immediately, explore
  populates the cache for the next prompt) — deliberately not now (D-13);
  revisit if blocking latency annoys in practice.
- **OpenCode auto-invoke parity** — conditional in-phase (D-08); if the
  plugin API lacks a clean prompt-submit event, it becomes a documented
  known gap alongside the existing #5894 limitation.
- **Cache-aware `/context-explore` command UX** (e.g. a `--fresh` flag
  surfaced in the command docs) — the env kill-switch covers v1.3; add
  per-call ergonomics only if requested.

</deferred>

---

*Phase: 12-context-exploration-maturation*
*Context gathered: 2026-07-07*
