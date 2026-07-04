# Phase 7: context_explore MCP Tool - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

`cairn-memory` exposes a **thin** `context_explore` MCP tool that delegates a
natural-language exploration query to the external `token_miser explore` binary
(via the existing `runCommand` subprocess pattern), parses its `Evidence` JSON
into compact `path:line-range` citations, and fails closed on every error path.
Configuration is env-only and provider-neutral — no FastContext endpoint/model/
API-key, and no host/IP/vendor default, committed anywhere in `src/` or docs.

**This phase does NOT** wire the tool into any Claude Code / OpenCode command
(Phase 8) or measure token savings (Phase 9). It builds and offline-tests the
tool only.

</domain>

<decisions>
## Implementation Decisions

### Repo-root resolution
- **D-01:** Resolve the target repo via **per-call `repo_root` param → env
  `CAIRN_EXPLORE_REPO_ROOT` → error**. The MCP server's cwd is `infraRoot`, not
  the target repo, so a cwd default would explore the wrong tree. The optional
  per-call param satisfies the common case (caller knows the repo); the env
  override satisfies CTX-03's "optional repo-root override" and unattended use.
  If neither resolves to an existing directory, fail closed (see D-04).

### Citation richness
- **D-02:** Dual output. **`content` (text) = compact `path:line-range` list**
  (lean for the agent — this is the token-economy lever the milestone exists
  for). **`structuredContent` = full `Evidence` passthrough** (lossless for
  programmatic callers). Mirrors the existing tools' text+structured convention.

### Tool input surface
- **D-03:** Input schema = **`query` (required, non-empty string), optional
  `repo_root`, optional `timeout_seconds`**. `timeout_seconds` because
  exploration can be slow and existing tools already expose it. **No `top_k`** —
  defer until `token_miser explore` is confirmed to support it (YAGNI; avoid a
  dead param). Match the min/max bounds convention from `domain_knowledge_sync`.

### Error-return contract (fail-closed)
- **D-04:** Hybrid, matching both patterns already in `index.ts`:
  - **Throw** on precondition/config errors (binary path not configured, binary
    missing, `repo_root` unresolvable) — mirrors `callLLM`'s env-guard throws.
  - **Return structured `{ ok: false, error, stderr, exitCode }`** on execution
    failures (non-zero exit, timeout, malformed/unparseable `Evidence` JSON) —
    mirrors `domain_knowledge_sync`.
  - Never a silent empty-success: an empty citation list from a *successful*
    exploration is distinct from a failure and must be reported as `ok: true`
    with an empty list, not conflated with an error.

### Claude's Discretion
- Exact `token_miser explore` CLI argument shape (positional query vs flags,
  `--json`/`--repo`) — resolve during research against the sibling
  `~/PARA/Projects/token-miser` (`src/explore/*.rs`), then plan.
- How the `Evidence` block is located in stdout (whole-stdout JSON vs
  log-prefixed) — implementation detail for the researcher/planner.
- Env var name for the binary path (e.g. `CAIRN_EXPLORE_BINARY` /
  `TOKEN_MISER_BIN`) — pick a name consistent with existing `CAIRN_*`
  conventions; not a user-facing decision.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — CTX-01 (delegate to `token_miser explore`, parse
  `Evidence` JSON, return `path:line-range`), CTX-02 (fail-closed on missing/
  misconfigured/timeout/malformed), CTX-03 (env-only config, no vendor defaults).
- `.planning/ROADMAP.md` §"Phase 7" — goal + 4 success criteria (incl. the
  offline "not configured" / "binary missing" smoke test that must pass in CI).

### Prior-phase decisions (carried forward, LOCKED)
- `.planning/phases/06-fastcontext-reliability-spike/06-CONTEXT.md` §D-02 —
  config-by-env / no host/IP/vendor default committed; operator supplies the real
  endpoint from the ambient shell / gitignored `.ai/.env`. Same precedent applies
  to `context_explore`'s config surface.
- `.planning/PROJECT.md` — DEC-no-private-references invariant; provider-neutral
  core; verify-by-execution bar against the registered `cairn-memory` MCP.

### token-miser integration (ground truth for the binary contract)
- `~/PARA/Projects/token-miser` — `docs/OVERVIEW.md` and `src/explore/*.rs`:
  the `explore` subcommand, the FastContext-emits-only / token-miser-executes
  split, and the `Evidence` JSON shape that D-02 parses.

### Code pattern to mirror
- `mcp-memory-server/src/index.ts` — `runCommand` (lines ~406–446, `spawn` with
  timeout + stdout/stderr capture); `domain_knowledge_sync` registration (lines
  ~919–975, the subprocess-tool template with `{ ok, ...result }` structured
  output); `callLLM` env-guard throws (lines ~342–354, the precondition-throw
  pattern for D-04).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `runCommand(command, args, timeoutMs)` — the exact spawn/timeout/capture helper
  `context_explore` should call to invoke the binary. Returns
  `{ exitCode, stdout, stderr, timedOut }` already truncated.
- `domain_knowledge_sync` tool — closest analog: a `runCommand`-backed tool with a
  zod `inputSchema`, `timeout_seconds` knob, and dual `content`/`structuredContent`
  output. New tool should follow its shape.
- `asToolText(...)` / dual-output convention — for D-02's compact-text +
  structured passthrough.

### Established Patterns
- `server.registerTool(name, { description, inputSchema: z.object({...}) }, handler)`
  — the registration signature. **Pitfall (project memory
  [[mcp-sdk-zodeffects-empty-schema]]):** do NOT use `z.object().refine()` as
  `inputSchema` — it publishes an empty schema. Any cross-field validation
  (e.g. repo_root fallback logic) belongs in the handler, not a schema refinement.
- Env-var config read directly from `process.env.CAIRN_*` with explicit throws
  when required and unset (`callLLM`) — the D-04 precondition-throw model.
- `runCommand` currently hardcodes `cwd: infraRoot`. For `context_explore` the
  spawn must run in the resolved `repo_root` (D-01) — this likely needs a `cwd`
  parameter added to `runCommand`, or a variant. Flag for the planner.

### Integration Points
- New tool registered alongside the existing ~10 tools in
  `mcp-memory-server/src/index.ts` (single-file server).
- Offline smoke test (CTX-02 / ROADMAP SC-4) exercises "not configured" and
  "binary missing" paths — no live model dependency. Follow existing test setup
  in `mcp-memory-server/`.

</code_context>

<specifics>
## Specific Ideas

- "Thin" is the operative word (ROADMAP + PROJECT): the tool is a
  subprocess-delegating adapter, not a re-implementation of exploration logic.
  token-miser does the work; `context_explore` marshals args, spawns, parses,
  and fails closed.
- Empty-but-successful exploration (valid run, zero citations) must be a
  first-class `ok: true` result — explicitly called out so it is never collapsed
  into the fail-closed error path (D-04).

</specifics>

<deferred>
## Deferred Ideas

- `top_k` / result-count knob on the tool input — deferred until `token_miser
  explore` is confirmed to support it (D-03). Revisit in Phase 7 research or a
  later phase.
- Operating-layer wiring (Claude Code + OpenCode commands invoking the tool) —
  Phase 8 (CTX-04, CTX-05).
- Token-savings A/B measurement — Phase 9 (CTX-07).

_Discussion otherwise stayed within phase scope — no scope creep raised._

</deferred>

---

*Phase: 7-context-explore-mcp-tool*
*Context gathered: 2026-07-04*
