# Phase 7: context_explore MCP Tool - Research

**Researched:** 2026-07-05
**Domain:** Node.js MCP tool wrapping an external Rust CLI subprocess (`token_miser explore`)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Repo-root resolution**
- **D-01:** Resolve the target repo via **per-call `repo_root` param → env
  `CAIRN_EXPLORE_REPO_ROOT` → error**. The MCP server's cwd is `infraRoot`, not
  the target repo, so a cwd default would explore the wrong tree. The optional
  per-call param satisfies the common case (caller knows the repo); the env
  override satisfies CTX-03's "optional repo-root override" and unattended use.
  If neither resolves to an existing directory, fail closed (see D-04).

**Citation richness**
- **D-02:** Dual output. **`content` (text) = compact `path:line-range` list**
  (lean for the agent — this is the token-economy lever the milestone exists
  for). **`structuredContent` = full `Evidence` passthrough** (lossless for
  programmatic callers). Mirrors the existing tools' text+structured convention.

**Tool input surface**
- **D-03:** Input schema = **`query` (required, non-empty string), optional
  `repo_root`, optional `timeout_seconds`**. `timeout_seconds` because
  exploration can be slow and existing tools already expose it. **No `top_k`** —
  deferred until `token_miser explore` is confirmed to support it (YAGNI; avoid a
  dead param). Match the min/max bounds convention from `domain_knowledge_sync`.
  **Research confirms `token_miser explore`'s CLI has no result-count / `top_k`
  flag at all** (see "Confirmed: no top_k knob" below) — the deferral is correct
  and durable, not merely provisional.

**Error-return contract (fail-closed)**
- **D-04:** Hybrid, matching both patterns already in `index.ts`:
  - **Throw** on precondition/config errors (binary path not configured, binary
    missing, `repo_root` unresolvable) — mirrors `callLLM`'s env-guard throws.
  - **Return structured `{ ok: false, error, stderr, exitCode }`** on execution
    failures (non-zero exit, timeout, malformed/unparseable `Evidence` JSON) —
    mirrors `domain_knowledge_sync`.
  - Never a silent empty-success: an empty citation list from a *successful*
    exploration is distinct from a failure and must be reported as `ok: true`
    with an empty list, not conflated with an error.
  - **Research finding that sharpens this contract:** `token_miser explore`
    itself treats a reachable-but-failing FastContext endpoint as best-effort,
    not a hard error (exit 0, empty Evidence) — see "Critical pitfall: token-miser
    swallows endpoint failures as empty success" below. This is a limitation
    `context_explore` inherits and cannot fully close without re-implementing the
    explorer loop (out of phase scope) — flagged for the planner as a residual
    gap in CTX-02, not a defect in this design.

### Claude's Discretion — RESOLVED by this research
- **CLI argument shape:** `token_miser explore --query <text> --repo-root <path>`
  (long flags; short forms `-q`/`-r` also accepted). No `--json` flag exists or is
  needed — stdout is unconditionally the `Evidence` JSON (pretty-printed), with
  all logging routed to stderr. `[VERIFIED: ~/PARA/Projects/token-miser/src/main.rs
  lines 131-169, read directly; confirmed by direct execution this session]`
- **Locating the Evidence block in stdout:** stdout is whole-JSON, never
  log-prefixed — `token_miser`'s tracing subscriber is explicitly configured to
  write to stderr only (`main.rs` line 46 comment: "Logs go to stderr so stdout
  stays clean"). `JSON.parse(result.stdout.trim())` is sufficient; no scanning
  or brace-matching needed (unlike `parseJsonResponse` in `index.ts`, which exists
  for a different reason — stripping markdown fences from an LLM's chat
  response, not applicable here). `[VERIFIED: direct execution this session]`
- **Env var name for the binary path:** recommend **`CAIRN_EXPLORE_BINARY`** —
  matches the existing `CAIRN_<AREA>_<THING>` convention (`CAIRN_AGENTFS_BASE_DIR`,
  `CAIRN_MEMORY_HTTP_TOKEN`) and the `explore` namespace `CAIRN_EXPLORE_REPO_ROOT`
  already locked by D-01. `[ASSUMED — naming choice, not verified against any
  external source; consistent with in-repo convention only]`

### Deferred Ideas (OUT OF SCOPE)
- `top_k` / result-count knob on the tool input — deferred until `token_miser
  explore` is confirmed to support it (D-03). **Now confirmed it does NOT
  support one** — see CLI argument-parsing loop in `main.rs`, which only
  recognizes `--query`/`-q` and `--repo-root`/`-r` (any other flag errors with
  `unknown explore argument: {other}`). Revisit only if a future token-miser
  version adds the flag.
- Operating-layer wiring (Claude Code + OpenCode commands invoking the tool) —
  Phase 8 (CTX-04, CTX-05).
- Token-savings A/B measurement — Phase 9 (CTX-07).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CTX-01 | `context_explore` takes a natural-language query, delegates to `token_miser explore`, parses `Evidence` JSON, returns compact `path:line-range` citations | CLI invocation shape and `Evidence` JSON schema both pinned by direct source read + empirical execution (see "Standard Stack" / "Code Examples" below) |
| CTX-02 | Fails closed on missing/misconfigured/timeout/malformed — never silent empty-success | D-04 hybrid throw/return contract mapped to the exact failure modes `token_miser explore` actually produces (empirically verified exit codes, stderr shapes); one residual gap documented (endpoint-down-but-binary-present is NOT distinguishable from genuine empty result — see Common Pitfalls #1) |
| CTX-03 | Env-only config (binary path + optional repo-root override); no FastContext endpoint/model/API-key or vendor default committed | Confirmed by design: `cairn-memory` never reads or sets any `fastcontext.*` field — that config lives entirely in token-miser's own TOML (`TOKEN_MISER_CONFIG` env or `./config.toml`, resolved by token-miser itself, invisible to and untouched by cairn-memory) |

</phase_requirements>

## Summary

`context_explore` is a thin adapter: it shells out to an already-built external
binary (`token_miser`, from the sibling Rust project `~/PARA/Projects/token-miser`)
using the exact same `runCommand` spawn/timeout/capture helper `domain_knowledge_sync`
already uses, parses one well-defined JSON struct (`Evidence`) from stdout, and
returns a lean text citation list plus the full structured passthrough. No new
npm packages, no new architecture, no reimplementation of any exploration logic —
the entire value-add is precondition validation, subprocess invocation, JSON
parsing, and fail-closed error shaping.

Ground truth for the binary contract was obtained by reading
`~/PARA/Projects/token-miser/src/explore/mod.rs`, `src/main.rs`,
`src/config.rs`, and `docs/architecture/FASTCONTEXT-EXPLORE.md` directly, **and**
by building/running the actual `token_miser` binary against synthetic configs
this session to empirically observe exit codes, stdout/stderr shapes, and one
previously-undocumented failure mode (see Common Pitfalls #1). This upgrades
the CLI contract and error-handling design from CONTEXT.md's "Claude's
Discretion" placeholders to HIGH-confidence, execution-verified findings.

**Primary recommendation:** Add one new `server.registerTool("context_explore", ...)`
block to `mcp-memory-server/src/index.ts`, reusing `runCommand` unmodified (do
NOT change its hardcoded `cwd: infraRoot` — resolve `repo_root` to an absolute
path in JS and pass it via `--repo-root <absolute-path>` instead; token-miser's
own sandbox keys off that CLI argument, not the child process's OS cwd). Do all
precondition checks (`CAIRN_EXPLORE_BINARY` set + exists, `repo_root` resolves to
an existing directory) as synchronous throws before spawning; treat every
post-spawn failure (non-zero exit, timeout, unparseable JSON) as an `{ ok: false,
... }` return, never a throw.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Natural-language repo exploration (agentic READ/GLOB/GREP loop, remote model inference) | External process (`token_miser` Rust binary, FastContext model) | — | Owned entirely by the sibling project; cairnkeep never re-derives this logic (Out of Scope table, REQUIREMENTS.md) |
| Subprocess invocation, timeout, output capture | API/Backend (`cairn-memory` MCP server, Node.js) | — | `runCommand` already exists for exactly this job (`domain_knowledge_sync`); `context_explore` is a second caller, not a new subsystem |
| `Evidence` JSON parsing → compact citations | API/Backend (`cairn-memory`, new tool handler) | — | The only real "logic" this phase adds; must not reinterpret or filter citations, only reshape them (dual text/structured output) |
| Repo-root / binary-path resolution & validation | API/Backend (`cairn-memory`, precondition checks) | — | Must happen before spawn — token-miser has no way to signal "wrong repo" distinct from "found nothing" (see Common Pitfalls #1), so cairn-memory's own precondition layer is the only defense against an obviously wrong/missing root |
| FastContext endpoint/model/credential configuration | External process (`token_miser`'s own `config.toml` / `TOKEN_MISER_CONFIG`) | — | Never touched by cairn-memory at any tier — this is what makes CTX-03 ("provider-neutral, env-only, no vendor default committed") true by construction rather than by discipline |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` (`spawn`) | Node.js builtin (project targets Node ≥18 per `@types/node ^22`) | Process invocation via the existing `runCommand` helper | Already the exact mechanism `domain_knowledge_sync` uses for its own subprocess (`python3 anythingllm/sync_to_anythingllm.py`); no new dependency |
| `zod` | `^3.25.76` (already a dependency, confirmed in `package.json`) | `inputSchema` validation for the new tool | Matches every other tool's registration in `index.ts` |
| `@modelcontextprotocol/sdk` | `^1.29.0` (already a dependency) | `server.registerTool` | Existing MCP server framework, unchanged |
| `node:fs` (`existsSync`) | Node.js builtin | Precondition checks: binary path exists, `repo_root` exists | Already imported in `index.ts` for other purposes |
| `node:path` (`resolve`, `isAbsolute`) | Node.js builtin | Resolve `repo_root` (param or env) to an absolute path before passing `--repo-root` | Already imported in `index.ts`; avoids ambiguity from a relative path resolved against an unrelated process cwd |

**No new packages are required for this phase.** `[VERIFIED: mcp-memory-server/package.json read directly this session]`

### External runtime dependency (not an npm package)

| Component | Version/Build | Purpose | Provenance |
|-----------|---------------|---------|------------|
| `token_miser` binary | Built from `~/PARA/Projects/token-miser` via `cargo build --release` | The actual exploration engine `context_explore` delegates to | `[VERIFIED: binary built and executed directly this session — target/release/token_miser, 12.9M]`. **Confirmed absent from `PATH`** on this machine (matches Phase 6 research finding); the operator must build it and point `CAIRN_EXPLORE_BINARY` at the resulting absolute path — there is no install-to-PATH step this phase can assume. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Spawning `token_miser explore` as a one-shot CLI subprocess | Talk to token-miser's HTTP `/v1/chat/completions` proxy directly and drive the agentic loop from Node | Explicitly out of scope (REQUIREMENTS.md Out-of-Scope table: "Reimplementing the FastContext agentic loop... in TypeScript"); the CLI subcommand exists precisely so callers don't have to |
| `existsSync` precondition check on the binary path | Rely solely on `child_process`'s `ENOENT` error event from `spawn` | A precondition check gives a clear, immediate throw with a stable cairnkeep-authored message before any subprocess is spawned; relying only on the spawn-time error event means the failure surfaces asynchronously inside `runCommand`'s Promise and must be caught/re-thrown to preserve D-04's "throw" bucket for binary-missing |

**Installation:** None — no new packages to install this phase.

**Version verification:** N/A (no new npm/pip/cargo packages recommended in Standard Stack).

## Package Legitimacy Audit

**Not applicable.** This phase introduces zero new external packages in any
ecosystem. It reuses `node:child_process`, `node:fs`, `node:path` (Node.js
builtins), and the already-installed `zod` / `@modelcontextprotocol/sdk`
(both already present in `mcp-memory-server/package.json` and used by every
other tool in `index.ts`). The `token_miser` binary is not an npm/pip/cargo
dependency of this Node project — it is an out-of-repo Rust binary referenced
only by absolute filesystem path via `CAIRN_EXPLORE_BINARY`, exactly as
`domain_knowledge_sync` references `python3` by command name.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
MCP client (Claude Code / OpenCode, via stdio or HTTP transport)
        │  calls tool "context_explore"
        │  { query, repo_root?, timeout_seconds? }
        ▼
┌───────────────────────────────────────────────────────────────┐
│ cairn-memory MCP server (mcp-memory-server/src/index.ts)       │
│                                                                 │
│  1. Resolve repo_root:                                         │
│       param → env CAIRN_EXPLORE_REPO_ROOT → THROW (D-01)       │
│     Resolve to absolute path; existsSync check → THROW if not  │
│                                                                 │
│  2. Resolve binary path:                                        │
│       env CAIRN_EXPLORE_BINARY → THROW if unset (D-04)         │
│     existsSync check → THROW if missing (D-04)                 │
│                                                                 │
│  3. Spawn via runCommand(binaryPath,                            │
│       ["explore", "--query", query, "--repo-root", repoRoot],  │
│       (timeout_seconds ?? DEFAULT) * 1000)                      │
│     — cwd unchanged (infraRoot); sandbox is enforced by         │
│       token-miser via the --repo-root ARGUMENT, not by cwd      │
│                                                                 │
│  4. On non-zero exit / timeout / JSON.parse failure:            │
│       return { ok: false, error, stderr, exitCode }  (D-04)     │
│     On success:                                                 │
│       parse Evidence → { citations, expanded_snippets, stats }  │
│       content = compact "path:start-end" lines (D-02)           │
│       structuredContent = { ok: true, ...evidence }  (D-02)     │
└───────────────────────────────┬────────────────────────────────┘
                                 │  spawn("token_miser",
                                 │    ["explore","--query",q,"--repo-root",r])
                                 ▼
┌───────────────────────────────────────────────────────────────┐
│ token_miser binary (external Rust process, sibling repo)       │
│                                                                 │
│  Reads its OWN config (TOKEN_MISER_CONFIG env or ./config.toml)│
│  — fastcontext.endpoint_url / model / api_key live here ONLY;  │
│  cairn-memory never sees or sets these (→ CTX-03 by design)     │
│                                                                 │
│  explore_repo(query, repo_root, ExploreConfig, FastContextConfig)│
│    → sandboxed local READ/GLOB/GREP tools (repo_root-scoped)   │
│    → remote model inference (agentic loop, max_turns capped)   │
│    → prints Evidence JSON to stdout; ALL logs to stderr         │
│                                                                 │
│  Exit 0 + Evidence JSON  = success (including EMPTY evidence —  │
│                             see Common Pitfalls #1 for the      │
│                             one case this looks identical to    │
│                             a real failure)                     │
│  Exit 1 + "Error: ..." on stderr, empty stdout = hard failure   │
│  (not configured / bad args / sandbox violation)                │
└───────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new files needed. `context_explore` is one more `server.registerTool(...)`
block inside `createMemoryServer()` in the existing single-file server:

```
mcp-memory-server/
├── src/
│   └── index.ts          # add context_explore registration here (~alongside
│                          # domain_knowledge_sync, using the same runCommand)
├── scripts/
│   └── smoke-explore-guard.mjs   # NEW — offline fail-closed smoke test (SC-4)
└── package.json           # add "check:explore-guard" + wire into test:smoke
```

### Pattern 1: Precondition-throw before subprocess-return-object

**What:** Two-tier error handling in a single tool handler — synchronous
`throw new Error(...)` for anything checkable *before* spawning a process, and
a returned `{ ok: false, ... }` object for anything only knowable *after* the
process ran.
**When to use:** Any tool that wraps a subprocess where some failure modes are
configuration-shaped (fix your environment) and others are execution-shaped
(the command ran and failed).
**Example:**
```typescript
// Source: pattern synthesized from index.ts's callLLM (throw) +
// domain_knowledge_sync (return) — CONTEXT.md D-04's hybrid contract.
async ({ query, repo_root, timeout_seconds }) => {
    // --- Precondition tier: throw (config/environment problems) ---
    const binaryPath = process.env.CAIRN_EXPLORE_BINARY;
    if (!binaryPath) {
        throw new Error("CAIRN_EXPLORE_BINARY is not set.");
    }
    if (!existsSync(binaryPath)) {
        throw new Error(`CAIRN_EXPLORE_BINARY does not exist: ${binaryPath}`);
    }

    const rawRoot = repo_root ?? process.env.CAIRN_EXPLORE_REPO_ROOT;
    if (!rawRoot) {
        throw new Error(
            "No repo_root provided and CAIRN_EXPLORE_REPO_ROOT is not set.",
        );
    }
    const resolvedRoot = resolve(expandHome(rawRoot));
    if (!existsSync(resolvedRoot)) {
        throw new Error(`repo_root does not exist: ${resolvedRoot}`);
    }

    // --- Execution tier: return { ok: false, ... } (runtime problems) ---
    const result = await runCommand(
        binaryPath,
        ["explore", "--query", query, "--repo-root", resolvedRoot],
        (timeout_seconds ?? 120) * 1000,
    );

    if (result.exitCode !== 0 || result.timedOut) {
        const payload = { ok: false, error: result.timedOut
            ? "token_miser explore timed out" : "token_miser explore exited non-zero",
            ...result };
        return {
            content: [{ type: "text", text: asToolText(payload) }],
            structuredContent: payload,
        };
    }

    let evidence: unknown;
    try {
        evidence = JSON.parse(result.stdout.trim());
    } catch {
        const payload = { ok: false, error: "malformed Evidence JSON", ...result };
        return {
            content: [{ type: "text", text: asToolText(payload) }],
            structuredContent: payload,
        };
    }

    // ... shape citations (Pattern 2) ...
}
```

### Pattern 2: Compact citation rendering (D-02)

**What:** Reduce the full `Evidence.citations` array to the lean
`path:start-end` text list that is the actual token-economy payoff of this
tool.
**When to use:** Building the `content` (text) half of the dual output; the
`structuredContent` half is the untouched `Evidence` object.
**Example:**
```typescript
// Source: synthesized from Evidence.citations shape
// (~/PARA/Projects/token-miser/src/explore/mod.rs, Citation struct)
function renderCitations(evidence: {
    citations: Array<{ path: string; start_line: number; end_line: number }>;
    stats: { turns: number; tool_calls: number };
}): string {
    if (evidence.citations.length === 0) {
        // Empty is a valid, first-class success (D-04) — but surface the loop
        // stats so the caller can judge plausibility given the known token-miser
        // limitation (Common Pitfalls #1: an unreachable endpoint also produces
        // this exact shape).
        return `(no citations found; turns=${evidence.stats.turns}, ` +
            `tool_calls=${evidence.stats.tool_calls})`;
    }
    return evidence.citations
        .map((c) => `${c.path}:${c.start_line}-${c.end_line}`)
        .join("\n");
}
```

### Anti-Patterns to Avoid

- **Changing `runCommand`'s hardcoded `cwd: infraRoot`:** unnecessary and risks
  regressing `domain_knowledge_sync` (the other caller). Resolve `repo_root` to
  an absolute path in JS and pass it as the `--repo-root` CLI argument instead —
  token-miser's own sandbox (`Sandbox::new(repo_root)`, `src/explore/tools.rs`)
  keys off that argument value, not the OS-level cwd of the process that
  invoked it.
- **Parsing token-miser's stderr text to classify the failure:** the `Error:
  {:?}` line is the Rust `Debug` representation of an internal error enum and
  is not a stable, documented interface — do not string-match it (e.g. do not
  special-case `"NotConfigured"` in JS). Surface `stderr` verbatim in the
  structured failure payload for the human/agent to read; classify only by
  `exitCode`/`timedOut`/JSON-parseability in code, exactly like
  `domain_knowledge_sync` already does.
- **Using `z.object().refine()` for cross-field validation** (e.g. "if neither
  `repo_root` nor the env var is set, error") — this collapses the published
  JSON Schema to `{}` per project memory
  [[mcp-sdk-zodeffects-empty-schema]] and per the `memory_read` registration's
  own comment in `index.ts`. Keep `inputSchema` a plain `z.object({...})` and do
  the repo_root fallback/validation logic inside the handler (Pattern 1).
- **Passing the subprocess's captured stderr through with ANSI escape codes
  intact and uninvestigated:** see Common Pitfalls #2 — set `NO_COLOR: "1"` in
  the spawn env, verified to fully suppress the escape codes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agentic READ/GLOB/GREP exploration loop | A TypeScript port of token-miser's `explore::client::run_loop` | `token_miser explore` subprocess | Explicit Out-of-Scope item in REQUIREMENTS.md; token-miser already owns, tests (`cargo test`), and sandboxes this |
| Subprocess spawn/timeout/capture | A second bespoke `child_process.spawn` wrapper | The existing `runCommand(command, args, timeoutMs)` | Already battle-tested by `domain_knowledge_sync`; a second implementation would be needless duplication for identical semantics |
| Evidence citation formatting | A custom line-range parser reading token-miser's `<final_answer>` text format | `JSON.parse` on `Evidence.citations` (already structured — token-miser did the `<final_answer>`-text → `Citation{path,start_line,end_line}` parsing internally, in `expand.rs`) | The JSON is the whole point of the CLI subcommand; re-parsing raw model text would duplicate work token-miser already does correctly |

**Key insight:** This phase has almost no "build" surface. Nearly every piece
of hard logic (agentic loop, tool-call parsing, citation extraction, evidence
expansion/capping) is implemented, tested, and owned by the sibling Rust
project. cairnkeep's job is precondition validation, subprocess plumbing (which
already exists), and reshaping one JSON object into two output shapes.

## Common Pitfalls

### Pitfall 1: token-miser swallows an unreachable FastContext endpoint as empty *success*, not an error

**What goes wrong:** If `fastcontext.endpoint_url` in token-miser's own config
IS set (so the CLI passes its own "not configured" gate) but the endpoint is
unreachable (wrong port, service down, DNS failure), `explore_repo` does
**not** return an `Err`. It logs a `WARN` to stderr
(`explorer turn failed; returning best-effort evidence turn=1
error=explorer request failed: ...`) and returns `Ok(Evidence)` with **empty**
`citations`/`expanded_snippets` and `stats: { turns: 1, tool_calls: 0, ... }` —
**exit code 0**.
**Why it happens:** `run_loop`'s per-turn request failures are treated as
best-effort/recoverable inside token-miser (by design, for its primary caller —
the router's upstream stage — where "proceed with the unmodified request" is
the correct degrade-gracefully behavior). The standalone `explore` CLI inherits
this behavior verbatim; it was not designed with a distinct-from-empty-result
error path for this specific failure class.
**How to avoid:** `context_explore` cannot distinguish "genuinely found
nothing" from "the configured endpoint was unreachable the whole time" purely
from the Evidence JSON's shape — both are `{citations: [], expanded_snippets:
[], stats: {turns: 1, tool_calls: 0, ...}}`. This is a **residual, documented
gap** in CTX-02's "misconfigured" fail-closed guarantee that this phase cannot
close without re-implementing the explorer loop (explicitly out of scope). The
recommended mitigation is transparency, not detection: surface `stats.turns` /
`stats.tool_calls` alongside an empty citation list (Pattern 2) so a human or
downstream agent can notice `tool_calls: 0` is suspicious for a query that
should plausibly have needed at least one file read, and consult token_miser's
own stderr/logs (which cairn-memory does not see, since it never runs with the
config that would reproduce this — that config lives entirely on token-miser's
side) if something looks wrong. Document this explicitly in the phase's
verification notes rather than silently treating D-04 as fully discharged.
**Warning signs:** An always-empty `context_explore` result across many
different queries against a repo known to contain relevant code is the tell —
check whether token-miser's own FastContext endpoint is actually reachable
(this is outside cairn-memory's process boundary to verify).
`[VERIFIED: direct execution this session — built and ran token_miser explore
against a config with fastcontext.enabled=true, endpoint_url pointing at an
unbound local port; observed exit 0, empty Evidence JSON, and the
"explorer turn failed; returning best-effort evidence" WARN on stderr]`

### Pitfall 2: Captured stderr contains raw ANSI color escape codes

**What goes wrong:** `token_miser`'s `tracing_subscriber` fmt layer emits ANSI
color escape sequences (`\x1b[2m`, `\x1b[32m`, etc.) on stderr **even when
piped to a non-TTY** (confirmed — it does not appear to gate on TTY detection
in this build). If `context_explore` passes captured `stderr` straight through
in its `{ ok: false, ..., stderr }` payload, the agent/human reading it sees
garbled escape-code noise around otherwise-readable diagnostic text.
**Why it happens:** Default color behavior of the `tracing_subscriber::fmt`
layer used in `main.rs`; it does not appear to special-case
non-interactive/piped stderr in this build.
**How to avoid:** Set `NO_COLOR: "1"` in the environment passed to the spawned
`token_miser` process (via `runCommand`'s `env: process.env` — extend it with
`{ ...process.env, NO_COLOR: "1" }` for this specific call, or make `runCommand`
accept an env-merge parameter). **Verified empirically this session:** with
`NO_COLOR=1` set, stderr is emitted with zero escape sequences, otherwise
byte-identical.
**Warning signs:** Stderr strings in tool output containing `\x1b[` / `^[` /
`[2m` sequences when displayed or logged.
`[VERIFIED: direct execution this session — same failing invocation run twice,
once without and once with NO_COLOR=1 in the environment, output captured with
`cat -v`]`

### Pitfall 3: A relative `repo_root` resolves against the wrong process

**What goes wrong:** If `context_explore` passes a relative path (e.g. `"."`
or `"../other-repo"`) straight through as `--repo-root`, token-miser's CLI
resolves it relative to *its own* process cwd at the moment it's spawned — not
relative to the MCP client's cwd, and not relative to whatever the caller
"meant." Since `runCommand` spawns with `cwd: infraRoot` (unchanged, per the
Anti-Pattern above), a relative `repo_root` would silently explore the wrong
tree (or a nonexistent path) with no clear error, potentially hitting
token-miser's own sandbox-violation error path (`ExploreError::Sandbox`) with a
confusing message.
**Why it happens:** Path resolution semantics of a spawned child process are
governed by its cwd, which `context_explore` does not change (by design — see
Anti-Patterns).
**How to avoid:** Always resolve `repo_root` (whether from the per-call param
or `CAIRN_EXPLORE_REPO_ROOT`) to an **absolute path** in the tool handler
(`resolve(expandHome(rawRoot))`) before it is ever passed to `--repo-root`, and
`existsSync`-check the resolved absolute path as a precondition (D-01's "if
neither resolves to an existing directory, fail closed"). Never pass a
relative string across the process boundary.
**Warning signs:** `context_explore` returns a sandbox-violation-shaped error
message from token-miser, or explores an unexpected directory, when called
with a bare relative `repo_root`.
`[VERIFIED: reasoned from token-miser's confirmed CLI parsing in main.rs
(`std::path::Path::new(&repo_root)` — no forced canonicalization before use)
combined with runCommand's confirmed hardcoded cwd in index.ts]`

## Code Examples

### Exact CLI invocation

```bash
# Source: ~/PARA/Projects/token-miser/src/main.rs (run_explore_cli, lines 131-169)
# and docs/architecture/FASTCONTEXT-EXPLORE.md — confirmed by direct execution.
token_miser explore --query "where is request routing decided?" --repo-root /abs/path/to/repo
# stdout (exit 0): pretty-printed Evidence JSON, nothing else
# stderr: tracing logs only (INFO/WARN), always
```

### Exact `Evidence` JSON schema

```typescript
// Source: ~/PARA/Projects/token-miser/src/explore/mod.rs (Citation, Snippet,
// ExploreStats, Evidence structs, all #[derive(Serialize)]) — field names and
// types are the literal Rust struct fields (serde default naming = struct
// field name, no rename attributes present).
type Citation = { path: string; start_line: number; end_line: number };
type Snippet = { path: string; start_line: number; end_line: number; code: string };
type ExploreStats = {
    turns: number;
    tool_calls: number;
    hit_turn_cap: boolean;
    expanded_lines: number;
    expanded_tokens: number;
};
type Evidence = {
    citations: Citation[];
    expanded_snippets: Snippet[];
    stats: ExploreStats;
};
```

### Empirically observed failure-mode outputs

```text
# 1. No config file, no TOKEN_MISER_CONFIG (default config): exit 1
# stdout: (empty)
# stderr:
#   INFO token_miser: No config file found; using default configuration
#   Error: NotConfigured("fastcontext.endpoint_url is empty")

# 2. Missing --query flag: exit 1
# stdout: (empty)
# stderr:
#   INFO token_miser: No config file found; using default configuration
#   Error: "explore requires --query <text>"

# 3. TOKEN_MISER_CONFIG points at a nonexistent file: falls back to defaults
#    (WARN logged), then behaves identically to case 1: exit 1, NotConfigured.

# 4. fastcontext.enabled=true + endpoint_url set but UNREACHABLE: exit 0 (!)
# stdout: {"citations": [], "expanded_snippets": [], "stats": {"turns": 1,
#          "tool_calls": 0, "hit_turn_cap": false, "expanded_lines": 0,
#          "expanded_tokens": 0}}
# stderr:
#   INFO token_miser: Loaded configuration from <path>
#   WARN token_miser::explore::client: explorer turn failed; returning
#        best-effort evidence turn=1 error=explorer request failed: ...
# — See Common Pitfalls #1. This is the one case context_explore CANNOT
#   distinguish from a genuine empty-result success.
```
All four confirmed by direct execution this session against the built
`~/PARA/Projects/token-miser/target/release/token_miser` binary.
`[VERIFIED: direct execution this session]`

### Offline smoke-test pattern to mirror (SC-4)

```javascript
// Source: mcp-memory-server/scripts/smoke-scope-guard.mjs (existing pattern —
// spawn the built server over stdio via the MCP Client/StdioClientTransport,
// call the tool, assert on isError / structuredContent). context_explore's
// smoke test should follow this exact shape for its two offline-testable
// fail-closed paths:
//   1. CAIRN_EXPLORE_BINARY unset → tool call throws / surfaces as isError
//   2. CAIRN_EXPLORE_BINARY set to a nonexistent path → same
// Neither requires a live token_miser process or a live FastContext model —
// both are precondition-tier throws (D-04), satisfying "no live model
// dependency" (ROADMAP SC-4).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, CAIRN_EXPLORE_BINARY: "" }, // unset for case 1
});
const client = new Client({ name: "smoke-explore-guard", version: "0" }, { capabilities: {} });
await client.connect(transport);

const res = await client.callTool({
    name: "context_explore",
    arguments: { query: "anything", repo_root: "/tmp" },
});
// check(name, cond) pattern from smoke-scope-guard.mjs:
// expect res.isError === true (binary not configured → thrown error)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| N/A | N/A | — | This is a first-time integration; there is no prior `context_explore` implementation to compare against or migrate from. |

**Deprecated/outdated:** None applicable this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Env var name `CAIRN_EXPLORE_BINARY` for the binary path | User Constraints / Discretion | Low — purely a naming choice; easy to rename before merge, no functional impact. Not externally referenced anywhere yet. |
| A2 | Default `timeout_seconds` of 120s (min 10, max 600) is a reasonable bound for a real (non-stubbed) multi-turn exploration call | Code Examples / Standard Stack | Medium — no real-world timing data exists yet for a live `token_miser explore` run against a real remote FastContext model (Phase 6's probe used a stubbed instant tool-result, not real end-to-end timing). If the real loop typically takes longer than the chosen default, calls will spuriously time out. Recommend the planner treat this as a tunable default confirmed empirically once a live FastContext endpoint is available, not a hard contract. |
| A3 | ANSI-suppression via `NO_COLOR=1` is sufficient across all `token_miser` invocations, not just the ones tested this session | Common Pitfalls #2 | Low — verified against the two failure-path invocations tested; the mechanism (tracing_subscriber's color layer) is invocation-independent, so it should generalize to the success path too, but was not separately re-verified against a successful (non-error) run this session. |

**If this table is empty:** N/A — see entries above; none of these need
resolution before planning, but A2 should be revisited once real end-to-end
timing data exists (likely surfaced naturally in Phase 9's A/B measurement).

## Open Questions (RESOLVED)

1. **Should `context_explore` attempt any heuristic detection of Pitfall #1
   (endpoint-down-but-reports-success)?**
   - **RESOLVED:** Accept + document as a residual CTX-02 gap; no heuristic
     detection. Disposition carried into the plans as threat T-07-06 (accepted)
     and the empty-citation text surfaces `turns`/`tool_calls` for transparency.
   - What we know: The failure is indistinguishable from a genuine empty
     result purely from the `Evidence` JSON's shape (`stats.tool_calls: 0`,
     `stats.turns: 1` in the observed case — but a legitimate trivial query
     could plausibly also produce low turn/tool-call counts).
   - What's unclear: Whether the milestone considers this an acceptable,
     documented residual gap in CTX-02 (consistent with the "thin adapter,
     never re-implement the loop" phase boundary) or whether it warrants a
     `checkpoint:human-verify` / an explicit UAT script step that intentionally
     misconfigures the endpoint and confirms the operator understands the tool
     cannot catch that specific case.
   - Recommendation: Treat as an accepted, documented limitation (matches
     "thin" framing and Out-of-Scope boundary) — record it plainly in the
     phase's verification artifacts rather than attempting any heuristic
     `tool_calls === 0` special-casing, which would be a guess dressed up as
     validation.

2. **What is the realistic wall-clock duration of a real `token_miser explore`
   call against a live FastContext endpoint?**
   - **RESOLVED:** Ship the conservative default `timeout_seconds` of 120s
     (Assumption A2) as a tunable, not a hard contract; Phase 9's live A/B
     measurement supplies real timing data to confirm or adjust it.
   - What we know: Phase 6's spike measured *raw-endpoint* tool-call
     reliability using a stubbed, instant tool-result loop — not real
     end-to-end timing through token-miser's actual Rust execution path.
   - What's unclear: Whether the default `max_turns: 16` loop against a real
     4B model on the deployed infra typically completes in single-digit
     seconds or tens of seconds.
   - Recommendation: Ship a conservative default (A2) and treat the exact
     value as tunable; Phase 9's live A/B measurement will surface real timing
     data that can retroactively validate or adjust the default.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `token_miser` binary | CTX-01 (the tool's actual delegate) | ✗ (not on `PATH`; present only as a local build artifact at `~/PARA/Projects/token-miser/target/{release,debug}/token_miser`) | release build, 12.9M, built this session via `cargo build --release` | None needed for *this phase* — the phase's own success criteria (SC-1/SC-2) explicitly require testing "against a real repo" (SC-1, needs the binary) and the "binary missing" fail-closed path (SC-2/SC-4, deliberately tests WITHOUT it). The offline smoke test (SC-4) needs no fallback since it intentionally exercises the missing/unconfigured paths. |
| Node.js | All of `mcp-memory-server` | ✓ | matches existing `@types/node ^22` devDependency | — |
| `cargo` / Rust toolchain | Building `token_miser` for live end-to-end testing (SC-1) | Not probed this session (out of scope for a Node-only phase) — but a working `token-miser` release binary already exists in the sibling repo's `target/release/`, built successfully at some prior point, so the toolchain is confirmed available on at least the machine that produced it. | — | If unavailable on the execution machine, SC-1's live test cannot run there; SC-2/SC-4 (fail-closed paths) remain fully testable regardless. |

**Missing dependencies with no fallback:**
- None. Every success criterion this phase can be built and offline-tested without a live, reachable `token_miser` + FastContext endpoint (SC-4 explicitly requires this).

**Missing dependencies with fallback:**
- `token_miser` on `PATH` — not required; the design deliberately references it only via an absolute-path env var (`CAIRN_EXPLORE_BINARY`), matching D-01/D-03/CTX-03's env-only configuration surface.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None (hand-rolled Node smoke scripts — no jest/vitest/mocha in this project) |
| Config file | none — see `mcp-memory-server/package.json` `scripts` block |
| Quick run command | `node scripts/smoke-explore-guard.mjs` (after `npm run build`) |
| Full suite command | `npm run test:smoke` (chains `check:embeddings`, `check:extract`, `check:scope-guard`, `check:http-guard`, and — after this phase — the new `check:explore-guard`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CTX-01 | Real repo query returns compact `path:line-range` citations, dual content/structuredContent | manual / live (SC-1 explicitly requires a real repo + real binary — not offline-automatable in CI without a live FastContext endpoint) | manual invocation via an MCP client against a real repo, once `token_miser` + FastContext are stood up | ❌ Wave 0 — no such live-only script exists yet; this is expected to remain a manual/operator-run check, not a CI gate, matching Phase 6's own "operator provides the runtime prerequisite" framing |
| CTX-02 | "not configured" (env unset) fails closed with a throw | unit/smoke | `node scripts/smoke-explore-guard.mjs` | ❌ Wave 0 — new file |
| CTX-02 | "binary missing" (path set but doesn't exist) fails closed with a throw | unit/smoke | `node scripts/smoke-explore-guard.mjs` | ❌ Wave 0 — same file, second case |
| CTX-02 | Non-zero exit / malformed stdout → `{ ok: false, ... }`, never silent empty-success | smoke (can be exercised offline with a fake "binary" — any executable script that exits non-zero or prints garbage, pointed at by `CAIRN_EXPLORE_BINARY` for the test only) | `node scripts/smoke-explore-guard.mjs` | ❌ Wave 0 — same file, additional cases; recommend a tiny fixture shell/node script standing in for `token_miser` so this is testable without the real binary |
| CTX-03 | No FastContext endpoint/model/API-key/vendor default committed in `src/` or docs | static grep audit | `grep -rniE "endpoint_url|fastcontext\.(model\|api_key)|localhost:8081|11434" mcp-memory-server/src docs/` (expect zero matches introduced by this phase) | ✅ — this is a repo-wide grep, not a new file; can be run as a CI step or a manual verification gate |

### Sampling Rate

- **Per task commit:** `npm run build && node scripts/smoke-explore-guard.mjs`
- **Per wave merge:** `npm run test:smoke` (full existing chain + the new explore-guard check)
- **Phase gate:** Full suite green before `/gsd-verify-work`; CTX-01's live-repo criterion (SC-1) is a manual/operator UAT step, not a CI gate, since it requires a live FastContext endpoint this phase does not stand up.

### Wave 0 Gaps

- [ ] `mcp-memory-server/scripts/smoke-explore-guard.mjs` — new offline fail-closed smoke test covering CTX-02's "not configured" and "binary missing" paths (mirrors `smoke-scope-guard.mjs`'s Client/StdioClientTransport pattern)
- [ ] A tiny fixture "fake binary" (executable script) for exercising the non-zero-exit / malformed-stdout `{ ok: false }` paths offline without the real `token_miser` — e.g. a one-line Node script pointed at by `CAIRN_EXPLORE_BINARY` during that specific test case, printing garbage or exiting 1
- [ ] `package.json` — add `"check:explore-guard": "node scripts/smoke-explore-guard.mjs"` and fold it into `test:smoke`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Not applicable — this tool has no auth surface of its own (inherits the MCP server's existing stdio/HTTP transport auth, unchanged this phase) |
| V3 Session Management | no | Not applicable |
| V4 Access Control | no | No new access-control boundary introduced |
| V5 Input Validation | yes | `zod` `inputSchema` (required non-empty `query`; optional `repo_root`/`timeout_seconds` with min/max bounds mirroring `domain_knowledge_sync`'s convention) |
| V6 Cryptography | no | Not applicable — no cryptographic operations in this tool |
| V12 File and Resources (informal — path handling) | yes | Resolve `repo_root` to an absolute path and validate existence via `existsSync` before use; never construct the `--repo-root` argument from unvalidated relative/untrusted input passed through a shell (spawn is invoked with an argv array, no `shell: true`, so shell metacharacter injection is not a vector regardless) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command/argument injection via `query` or `repo_root` containing shell metacharacters | Tampering | Not applicable as a shell-injection vector — `runCommand` calls `spawn(command, args, {...})` with an args **array** and no `shell: true`, so arguments are passed directly to `execve`-family calls, never interpreted by a shell. Confirmed unchanged by this phase (`[VERIFIED: mcp-memory-server/src/index.ts runCommand, lines 406-446, read directly this session]`). |
| Secrets/endpoint leakage via passthrough `stderr` in the `{ ok: false, ..., stderr }` failure payload | Information Disclosure | Not a leakage vector by construction — `cairn-memory` never sets or reads any `fastcontext.*` config, so it has no secret to leak; captured stderr can at most contain token-miser's own diagnostic text (e.g. an unreachable endpoint URL from *token-miser's own* config, which the operator configured on that side — out of cairn-memory's control or visibility). No cairnkeep-side secret ever touches this code path. |
| A caller supplying an arbitrary `repo_root` outside any "expected" project directory | Tampering / Elevation of Privilege | **Not a defect — this is the intended, documented semantics** (unlike `memory_read`'s scope confinement, which guards a shared multi-tenant AgentFS store). `context_explore` is designed to explore *any* repo the caller names; token-miser's own `Sandbox` (confirmed in `src/explore/tools.rs` module doc) confines the READ/GLOB/GREP tools *within* that named root, but the choice of root itself is caller-controlled by design (mirrors `runCommand`'s existing trust model — the caller is the same MCP client/operator that already has full filesystem access via other means). |

## Sources

### Primary (HIGH confidence — direct source read + direct execution this session)
- `~/PARA/Projects/token-miser/src/explore/mod.rs` — `Citation`/`Snippet`/`ExploreStats`/`Evidence` struct definitions, `ExploreError` enum, `explore_repo()` signature and NotConfigured gate, integration tests
- `~/PARA/Projects/token-miser/src/main.rs` — `run_explore_cli()` argument parsing (`--query`/`-q`, `--repo-root`/`-r`), stdout-is-clean-JSON / stderr-is-logs split, `is_fresh_task` / `explore_query` / `inject_evidence` (upstream proxy stage, informational only — not exercised by the standalone CLI)
- `~/PARA/Projects/token-miser/src/config.rs` — `FastContextConfig`/`ExploreConfig` field names and defaults, `TOKEN_MISER_CONFIG` env resolution, `apply_env_overrides()` (`TOKEN_MISER_PORT`/`TOKEN_MISER_FASTCONTEXT_ENABLED`/`TOKEN_MISER_EXPLORE_REPO_ROOT` — token-miser's own env vars, entirely distinct from cairnkeep's `CAIRN_*`)
- `~/PARA/Projects/token-miser/docs/architecture/FASTCONTEXT-EXPLORE.md` — standalone CLI usage example, config shape, "prints only JSON on stdout" confirmation
- `~/PARA/Projects/token-miser/config.example.toml` — `[fastcontext]`/`[explore]` example sections
- Direct execution of `~/PARA/Projects/token-miser/target/release/token_miser explore` this session (4 distinct scenarios: no config, missing `--query`, bad `TOKEN_MISER_CONFIG` path, unreachable-but-configured endpoint) — confirmed exit codes, stdout/stderr shapes, and the Pitfall #1 / Pitfall #2 findings empirically
- `mcp-memory-server/src/index.ts` — `runCommand`, `domain_knowledge_sync`, `callLLM`, `asToolText`, all tool registrations (read in full this session)
- `mcp-memory-server/package.json` — confirmed dependency set and test-script conventions
- `mcp-memory-server/scripts/smoke-scope-guard.mjs`, `smoke-http-guard.mjs` — existing offline smoke-test patterns to mirror
- `docs/operating.md` — `CAIRN_*` env var naming conventions

### Secondary (MEDIUM confidence)
- `.planning/phases/06-fastcontext-reliability-spike/06-RESEARCH.md` and `06-SPIKE.md` — confirmed `token_miser` absent from `PATH` on this machine, GO verdict for FastContext tool-call reliability at the raw-endpoint level, and the pre-existing forward-note pointing at this phase's Evidence-JSON-parsing work

### Tertiary (LOW confidence)
- None — every substantive claim in this document was either read directly from source or confirmed by direct execution this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; existing deps confirmed by reading `package.json` directly
- Architecture: HIGH — CLI shape, JSON schema, and error/exit-code behavior all confirmed by direct source read AND independent empirical execution (not just one or the other)
- Pitfalls: HIGH — both Pitfall #1 and Pitfall #2 were discovered and confirmed by direct execution this session, not inferred from documentation alone

**Research date:** 2026-07-05
**Valid until:** 30 days, OR immediately if `~/PARA/Projects/token-miser`'s `explore` module changes (it is a sibling project under active development in the same milestone's dependency chain, not a stable external package with a version-pin guarantee)
