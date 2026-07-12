# Architecture Research

**Domain:** Token-efficient repo-exploration capability (`context_explore`) added to an existing MCP server + dual-harness operating layer
**Researched:** 2026-07-04
**Confidence:** HIGH (primary source: token-miser's own working, tested implementation at `~/PARA/Projects/token-miser`, `docs/architecture/FASTCONTEXT-EXPLORE.md` + `src/explore/`, cross-checked against the FastContext arXiv paper 2606.14066 and its HF model cards)

## The key design fact (answers the open question)

**FastContext does not execute tools itself. It only emits tool-call intents.** It is a plain Qwen3-4B causal LM served behind an OpenAI-compatible `chat/completions` endpoint with `tools` (llama.cpp `llama-server --jinja`, or any OpenAI-compatible runtime). Given a query, it returns `tool_calls` for three read-only ops — `read` / `glob` / `grep` — advertised lowercase in the tool schema. **A caller-side harness must execute those calls against the real repository, append the results as `role:"tool"` messages, and loop** until the model emits a `<final_answer>` block of `path:START-END` citations (or the loop hits a turn cap). This is confirmed by:
- token-miser's own architecture doc (`FASTCONTEXT-EXPLORE.md`): *"the model emits READ/GLOB/GREP tool calls; THIS process executes them LOCALLY against repo_root, feeds observations back, until `<final_answer>`."*
- The FastContext paper: *"At each turn, the explorer either issues one or more tool calls or stops with a final evidence list"* — tool execution is the harness's job, not the model's.

**This is already built.** `token-miser` (sibling Rust project, `~/PARA/Projects/token-miser`) implements exactly this loop today: `src/explore/client.rs` drives the `chat/completions` round-trips, `src/explore/tools.rs` executes `read`/`glob`/`grep` **in-process, in pure Rust** (`ignore`/`globset`/ripgrep `grep` crates), sandboxed to a canonicalized `repo_root` (absolute paths and `..` escapes rejected), and `src/explore/mod.rs` assembles the result into a typed `Evidence { citations, expanded_snippets, stats }`. It is exposed as a **standalone CLI subcommand** for exactly this reuse case: `token_miser explore --query "<text>" --repo-root <path>` prints `Evidence` as JSON on stdout (logs go to stderr, so it pipes cleanly), independent of token-miser's proxy/routing mode.

**Consequence for cairnkeep:** the `cairn-memory` MCP server (Node/TS) must **not** reimplement the agentic READ/GLOB/GREP loop, the FastContext tool-calling protocol, or the sandboxing. That logic already exists, is tested (`cargo test`, `cargo clippy -D warnings`), and is exactly the kind of local-tool sandboxing cairnkeep's own `SEC-0001` lesson (`resolve===join` misses `../`, use containment-checked resolution) already cares about getting right. The correct integration is **subprocess delegation to the `token_miser explore` CLI**, mirroring the pattern `cairn-memory` already uses for `runCommand("python3", …)` (graphify).

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Operating layer (Claude Code / OpenCode)                                │
│  claude/commands/context-explore.md   opencode/command/context-explore.md│
│  — prompts the agent to call the context_explore MCP tool with a query   │
└───────────────────────────────┬────────────────────────────────────────┘
                                 │ MCP tool call: context_explore({ query, repo_root? })
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  cairn-memory MCP server (Node/TS, mcp-memory-server/src/index.ts)       │
│  — new tool: context_explore (server.registerTool, handler-validated)    │
│  — spawns a subprocess (existing runCommand() pattern)                   │
└───────────────────────────────┬────────────────────────────────────────┘
                                 │ spawn: token_miser explore --query … --repo-root …
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  token-miser `explore` CLI (Rust, external binary — NOT imported/vendored)│
│  ┌────────────────────────────┐      ┌────────────────────────────────┐ │
│  │ client.rs: agentic loop     │◄────►│ FastContext model (REMOTE)      │ │
│  │  sends chat/completions +   │      │ any OpenAI-compatible endpoint  │ │
│  │  tool schemas; receives      │      │ (llama.cpp llama-server --jinja,│ │
│  │  tool_calls or <final_answer>│      │  vLLM, etc.) — provider-neutral │ │
│  └──────────────┬─────────────┘      └────────────────────────────────┘ │
│                 │ tool_calls (read/glob/grep)                            │
│                 ▼                                                        │
│  ┌────────────────────────────┐                                         │
│  │ tools.rs: Sandbox            │  LOCAL execution, sandboxed to         │
│  │  canonicalize(repo_root);     │  repo_root; rejects absolute paths     │
│  │  read/glob/grep in-process     │  and `..` escapes; size/line-capped   │
│  └────────────────────────────┘                                         │
│  → Evidence{citations, expanded_snippets, stats} as JSON on stdout        │
└───────────────────────────────┬────────────────────────────────────────┘
                                 │ parsed JSON
                                 ▼
              MCP tool result: compact file:line citations + expanded code
                                 ▼
                    back to the calling agent's context window
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `context_explore` MCP tool (new) | Validate params, spawn the CLI, parse `Evidence` JSON, shape MCP tool-result content | `server.registerTool` in `mcp-memory-server/src/index.ts`, plain `z.object()` inputSchema (no `.refine()` — known ZodEffects empty-schema pitfall), validation in the handler body |
| `runCommand`-style subprocess spawn (reused) | Spawn `token_miser`, capture stdout/stderr, enforce a timeout | Already exists (`runCommand`, used today for the `python3` graphify CLI) — same pattern, new args |
| `token_miser explore` CLI (external, sibling project) | Drive the FastContext tool-calling loop; execute READ/GLOB/GREP locally, sandboxed; return `Evidence` JSON | Rust binary, already implemented and tested; installed/available on the host, referenced by path/env var — never vendored into cairnkeep |
| FastContext model server (external) | Emit `tool_calls` and a final citation list given a query + tool schemas | Any OpenAI-compatible `chat/completions` endpoint with `tools` (validated recipe: `llama-server` + `mitkox/FastContext-1.0-4B-RL-Q8_0-GGUF`, `--jinja` required) |
| Claude command (`claude/commands/context-explore.md`) (new) | Teach the agent when/how to call `context_explore` instead of broad `Grep`/`Glob`/`Read` fan-out | Markdown command, mirrors `wiki-query.md` shape; auto-installed by the existing glob-based `sync-claude-assets.sh` |
| OpenCode command (`opencode/command/context-explore.md`) (new) | Same, for the OpenCode harness | Markdown command with `tools:` frontmatter, mirrors `opencode/command/wiki-query.md` |
| `sync-opencode-context-explore-assets.sh` (new) | Install/verify the OpenCode command asset | Mirrors the existing single-command topic script `sync-opencode-graphify-assets.sh` (OpenCode sync scripts are topic-specific fixed-file-list installers, unlike Claude's glob-based one) |

## Recommended Project Structure

```
mcp-memory-server/
└── src/
    └── index.ts                     # MODIFIED — add context_explore tool registration + handler
                                      #   (or, if index.ts is getting large, extract to
                                      #    src/context-explore.ts and import — optional split,
                                      #    not required for correctness)
mcp-memory-server/
└── scripts/
    └── smoke-context-explore.mjs    # NEW — offline smoke test (stub `token_miser` binary,
                                      #   assert graceful "not configured" error when unset)
claude/commands/
└── context-explore.md               # NEW — Claude command wiring
opencode/command/
└── context-explore.md               # NEW — OpenCode command wiring
scripts/
└── sync-opencode-context-explore-assets.sh   # NEW — topic-specific OpenCode installer
docs/
└── operating.md                     # MODIFIED — new capability + config table rows
```

### Structure Rationale

- **No new top-level directory.** `context_explore` is one more MCP tool in the existing single-process `cairn-memory` server — same trust boundary, same process, same install path (`claude mcp add cairn-memory …`). A separate service would double the moving parts (a second process to launch, register, and keep alive) for no benefit: the actual heavy lifting (agentic loop, sandboxing, remote inference) already lives in the external `token_miser` binary, which is *itself* the separate process.
- **`claude/` and `opencode/` stay mirrored**, one command per harness, matching every other capability in this repo (`wiki-query`, `graphify`, `security-audit`). No plugin is needed on the OpenCode side — `context_explore` is a request/response tool call, not a lifecycle hook (`session.idle`, `tool.execute.before`, `experimental.chat.system.transform` are for the memory lifecycle, not this).
- **`sync-opencode-context-explore-assets.sh` is new** because OpenCode's sync scripts are topic-scoped with explicit file-list arrays (not glob-based like the Claude one) — every existing topic (`wiki`, `security`, `graphify`, `memory`, `plugin`) has its own installer, so a new topic gets its own installer too.

## Architectural Patterns

### Pattern 1: CLI-subprocess delegation to an external, already-sandboxed binary

**What:** The MCP server does not reimplement the FastContext tool-calling loop or the READ/GLOB/GREP sandbox. It shells out to `token_miser explore --query <q> --repo-root <path>`, capped by a timeout, and parses the single JSON blob on stdout.
**When to use:** Whenever a capability's hard part (agentic tool-calling loop, filesystem sandboxing, remote-model plumbing) is already implemented, tested, and maintained in a separate, more suitable language/runtime (Rust, here) — reimplementing it in TypeScript would duplicate the sandbox logic and risk drifting from the tested version.
**Trade-offs:** + no duplicate sandbox code, reuses `cargo test`/`clippy`-verified logic, keeps `cairn-memory` thin. − cairnkeep now has a runtime dependency on an external binary being installed/on `PATH` (or path-configured) — must fail with a clear, actionable error when missing, exactly like the existing `CAIRN_LLM_API_KEY`-unset path degrades gracefully rather than crashing.

**Example (mirrors the existing `runCommand` pattern already in `index.ts`, used for `python3` graphify):**
```typescript
server.registerTool(
    "context_explore",
    {
        description: "Explore the repository for a natural-language query via a FastContext-backed explorer; returns compact file:line citations and expanded code, without consuming the calling agent's own context on broad reads/greps.",
        inputSchema: z.object({
            query: z.string(),
            repo_root: z.string().optional(),
            timeout_seconds: z.number().optional(),
        }),
    },
    async ({ query, repo_root, timeout_seconds }) => {
        // validate query non-empty and repo_root containment here (handler-side,
        // not via .refine() on inputSchema — known ZodEffects empty-schema pitfall)
        const bin = process.env.CAIRN_CONTEXT_EXPLORE_BIN ?? "token_miser";
        const args = ["explore", "--query", query];
        if (repo_root) args.push("--repo-root", repo_root);
        const result = await runCommand(bin, args, (timeout_seconds ?? 120) * 1000);
        // parse result.stdout as Evidence JSON; surface a clear error (not a stack
        // trace) when the binary is missing or fastcontext is not configured
    },
);
```

### Pattern 2: Endpoint config lives entirely outside cairnkeep

**What:** `cairn-memory` never needs to know the FastContext endpoint URL, model name, or API key — that config (`[fastcontext] endpoint_url`, `model`, optional `api_key`) belongs entirely to `token-miser`'s own TOML config. `cairn-memory`'s only configuration surface is *where the binary is* and *what repo to point it at*.
**When to use:** Any time an external tool already owns its own provider-neutral config surface — don't shadow it with a second, redundant set of env vars in the caller.
**Trade-offs:** + strongest possible provider neutrality (cairn-memory literally cannot hardcode a vendor endpoint — it doesn't hold that config at all); the operator swaps models/backends entirely in `token-miser`'s config, with zero cairnkeep changes. − two places to configure across a full install (`token-miser`'s TOML for the model, cairnkeep's env for the binary path) — document both in `docs/operating.md`.

**Example config surface added to `docs/operating.md`'s existing table:**
```
| CAIRN_CONTEXT_EXPLORE_BIN | Path to the token_miser binary (default: "token_miser" on PATH) |
| CAIRN_CONTEXT_EXPLORE_REPO_ROOT | Default repo root for exploration (default: process.cwd()) |
```
(No `CAIRN_CONTEXT_EXPLORE_API_*` vars — that config is token-miser's, not cairnkeep's.)

### Pattern 3: Mirrored operating-layer command, not a hook

**What:** `context_explore` is wired as a command (`/context-explore <question>`) in both `claude/commands/` and `opencode/command/`, following the exact shape already used for `/wiki-query`: frontmatter + `<objective>` + process, prompting the agent to call the MCP tool and then open only the cited file ranges — not a session-lifecycle hook.
**When to use:** For on-demand, agent-invoked capabilities (vs. the automatic hooks used for memory wakeup/capture/recall, which fire on `SessionStart`/`SessionEnd`/`PreToolUse`).
**Trade-offs:** + consistent with how every other non-memory capability in this repo is wired; agents can also call `context_explore` directly as a tool without the slash command, since it's just another registered MCP tool. − needs explicit agent guidance (in the command doc, and optionally a one-line nudge in `code-reviewer`/`wiki-query-analyst` agent prompts) to actually prefer it over ad hoc `Grep`/`Glob` fan-out; it won't be reached for automatically.

## Data Flow

### Request Flow

```
Agent decides it needs repo context for a vague/large task
    ↓ (invokes /context-explore "<question>" or calls the MCP tool directly)
context_explore MCP tool (cairn-memory)
    ↓ validates query + repo_root, resolves CAIRN_CONTEXT_EXPLORE_BIN
runCommand(token_miser, ["explore","--query",q,"--repo-root",r], timeout)
    ↓ spawns subprocess
token_miser explore CLI
    ↓ opens a fresh chat/completions loop against the configured FastContext endpoint,
      sending the query + read/glob/grep tool schemas
FastContext model (remote, OpenAI-compatible chat/completions)
    ↓ emits tool_calls (read/glob/grep) — model does NOT execute them
token_miser Sandbox (LOCAL, in-process Rust)
    ↓ executes each tool call against canonicalized repo_root; appends role:"tool" results
    ↺ loop continues (multiple turns, parallel tool calls per turn) until <final_answer>
      or max_turns cap (best-effort evidence returned on cap)
token_miser assembles Evidence{citations, expanded_snippets, stats}
    ↓ prints as JSON to stdout (logs → stderr)
cairn-memory parses stdout JSON
    ↓ shapes MCP tool-result content (citations + expanded code, or a clear "not
      configured"/"binary not found"/"timed out" error)
Agent receives compact file:line evidence
    ↓ opens only the cited ranges (via its own Read tool) instead of broad exploration
```

### Key Data Flows

1. **Cold exploration query:** agent → command → MCP tool → subprocess → FastContext loop → Evidence JSON → MCP result → agent reads cited ranges. This is the only flow v1.2 needs to land.
2. **Config resolution (no request-time flow):** `token-miser`'s own TOML/env resolves `fastcontext.endpoint_url`/`model` at *its* process start, entirely decoupled from cairnkeep's request path — cairn-memory never touches this.
3. **Failure flow:** binary missing, `fastcontext` not configured on the token-miser side, timeout, or malformed stdout → `context_explore` returns a structured MCP error (not a crash), matching the existing graceful-degradation posture for `CAIRN_LLM_API_KEY`-unset memory search.

## Scaling Considerations

This tool scales along **repo size / query breadth**, not user count (single-operator MCP server):

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Small repo, narrow query | Default `max_turns`/`max_expanded_lines`/`max_expanded_tokens` (token-miser's own caps) are sufficient; a few turns, a handful of citations |
| Large monorepo, broad query | A 4B explorer can over-explore and overflow its own context window; token-miser already documents the mitigation (max context headroom, `q4_0` KV cache, flash-attn) — this is entirely on the FastContext-serving side, not cairnkeep's concern |
| Turn/time budget in the MCP call | `runCommand`'s existing `timeoutMs` parameter caps the whole subprocess call; `token_miser`'s own `max_turns` caps the inner loop and returns best-effort evidence on cap rather than hanging — set the MCP-side timeout comfortably above `max_turns × per-turn model latency` |

### Scaling Priorities

1. **First bottleneck:** an under-provisioned FastContext endpoint (context window too small for a broad query) — degrades gracefully to best-effort evidence on `hit_turn_cap`, not a hard failure. Not cairnkeep's problem to solve, but worth surfacing `stats.hit_turn_cap` in the MCP tool result so the agent knows the evidence may be partial.
2. **Second bottleneck:** MCP-side subprocess timeout too tight for a cold-start model server (first request pays model load latency) — make the default timeout generous (e.g. 120s) and configurable, matching the existing `timeout_seconds` parameter pattern already used for the graphify `python3` tool.

## Anti-Patterns

### Anti-Pattern 1: Reimplementing the agentic tool-calling loop in TypeScript

**What people do:** Write a new `chat/completions` client with `tools` inside `cairn-memory`, hand-roll READ/GLOB/GREP against the filesystem, and hand-roll the sandbox containment check.
**Why it's wrong:** Duplicates already-tested logic (Rust, `cargo test`+`clippy` clean) in a second language, doubling the maintenance surface and risking a second, weaker sandbox (cairnkeep already has one scope-guard pitfall on record — `resolve===join` misses `../` — don't create a second copy of that risk in a new subsystem).
**Do this instead:** Delegate to the `token_miser explore` CLI as a subprocess; treat it as a black box that returns `Evidence` JSON.

### Anti-Pattern 2: Treating FastContext as a routing tier, or wiring cairnkeep to token-miser's proxy mode

**What people do:** Point cairnkeep's memory-extraction or embedding calls (`CAIRN_LLM_API_URL`) *through* token-miser's `/v1/chat/completions` reverse-proxy, or treat FastContext as one of token-miser's routed tiers (`tier1_free`/`tier2_standard`/`tier3_complex`).
**Why it's wrong:** token-miser's own docs are explicit — *"FastContext is never a routing target. It runs strictly upstream … it is not a tier or a provider."* Folding cairnkeep's other LLM calls through token-miser's proxy is a distinct, unrelated integration surface (token-miser's HTTP reverse-proxy interface) that isn't part of this milestone's `context_explore` capability, and conflating the two would blur "where token-miser sits in the call path."
**Do this instead:** Use *only* the standalone `token_miser explore` CLI subcommand for `context_explore`. Leave `CAIRN_LLM_*` (memory extraction/embeddings) calling its own endpoint directly, unchanged.

### Anti-Pattern 3: Hardcoding the FastContext backend or model name in cairnkeep

**What people do:** Bake `mitkox/FastContext-1.0-4B-RL-Q8_0-GGUF` or a specific `llama-server` host/port into `cairn-memory` source or docs as *the* backend.
**Why it's wrong:** Violates the project's provider-neutral-core rule and `DEC-no-private-references` (never hardcode a specific host). It's also unnecessary — cairnkeep doesn't hold this config at all (Pattern 2, above); the only reference needed in cairnkeep's own docs is "point token-miser's `[fastcontext]` config at any OpenAI-compatible endpoint," with the mitkox GGUF mentioned only as the validated *example* recipe, not a requirement.
**Do this instead:** Document the binary-path + repo-root config surface only; link out to token-miser's own docs for backend setup, and keep the mitkox recipe as an illustrative example, not a hardwired default.

### Anti-Pattern 4: Running `context_explore` automatically on every tool call (like the memory-recall hook)

**What people do:** Wire `context_explore` as a `PreToolUse`/`tool.execute.before` hook that fires before every edit, the way `memory-recall.sh`/`memory-recall.ts` does.
**Why it's wrong:** token-miser's own invariant is explicit — the explore stage only runs on a **fresh task** (no prior assistant/tool turns), because re-exploring on every tool round-trip would re-gather context repeatedly for no benefit and burn the FastContext endpoint's latency budget on every step.
**Do this instead:** Wire it as an on-demand command/tool the agent chooses to call once per exploration need, not an automatic hook.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| `token_miser` CLI (Rust binary, sibling project) | Subprocess spawn (`runCommand`), stdout JSON | Referenced by binary path/env var, never vendored into cairnkeep's repo or build; treat as an optional runtime dependency (tool absent → clear MCP error, not a crash) |
| FastContext model server | Indirect — only `token-miser` talks to it (`chat/completions` + `tools`) | cairn-memory never calls this endpoint directly; provider-neutrality is inherited from token-miser's own config, not re-implemented |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Operating-layer command ↔ `context_explore` MCP tool | Standard MCP tool call (harness-mediated) | Same channel every other `cairn-memory` tool already uses — no new transport |
| `context_explore` handler ↔ `token_miser` CLI | Child process (stdin unused, stdout = JSON, stderr = logs, exit code + timeout) | Reuses the existing `runCommand` helper already present in `index.ts` (currently used for the `python3` graphify invocation) — same timeout/kill-on-timeout semantics |
| `cairn-memory` ↔ project repo filesystem | None, directly — cairnkeep does not read the repo for this feature | All filesystem access for exploration happens inside token-miser's own sandboxed `tools.rs`, not in cairn-memory. `repo_root` is passed through as a CLI arg only |

## Suggested Build Order (dependency-ordered)

1. **Prerequisite (not cairnkeep code):** confirm a `token_miser` build is available on the target machine and its `[fastcontext]` config points at a live OpenAI-compatible endpoint (llama.cpp `llama-server --jinja` + a FastContext GGUF is the validated recipe already documented in token-miser's own docs). This is an operator/infra step, not something cairnkeep's roadmap needs to build.
2. **`context_explore` MCP tool** — add to `mcp-memory-server/src/index.ts`: `server.registerTool`, handler-side validation (not `.refine()` on the schema — the known ZodEffects empty-schema pitfall), subprocess spawn via the existing `runCommand` pattern, `Evidence` JSON parsing, structured MCP error on missing binary/timeout/malformed output.
3. **Config surface** — `CAIRN_CONTEXT_EXPLORE_BIN` (default `token_miser` on `PATH`), `CAIRN_CONTEXT_EXPLORE_REPO_ROOT` (default `process.cwd()`), documented in `docs/operating.md`'s existing config table.
4. **Offline smoke test** — `scripts/smoke-context-explore.mjs` (stub binary or explicit "not configured" path), wired into `package.json` as its own `check:context-explore` (like `check:search`, kept out of the default `test:smoke` chain since it depends on an external binary, mirroring how embeddings-dependent `check:search` is already separated from the always-run smoke suite).
5. **Claude operating layer** — `claude/commands/context-explore.md` (mirrors `wiki-query.md`); auto-installed by the existing glob-based `sync-claude-assets.sh`, no script changes needed.
6. **OpenCode operating layer** — `opencode/command/context-explore.md` (mirrors `opencode/command/wiki-query.md`) + new `scripts/sync-opencode-context-explore-assets.sh` (mirrors `sync-opencode-graphify-assets.sh`, the simplest existing single-command topic installer).
7. **Docs** — update `docs/operating.md`: new capability under "The workflow," new config rows, and a short note that `token_miser` + a FastContext endpoint are optional-but-recommended (mirrors how an LLM endpoint is already optional for memory extraction, degrading gracefully when absent).
8. **Live verify-by-execution** — run `/context-explore <question>` end-to-end in both harnesses against a real bootstrapped project with `token_miser` + a live FastContext endpoint, confirming file:line citations return and match the project's existing "verify by execution, not by inspection" bar.

## Sources

- `~/PARA/Projects/token-miser/docs/architecture/FASTCONTEXT-EXPLORE.md` (sibling project, already implemented + tested — primary source for the tool-delegation architecture, config shape, and CLI contract) — HIGH confidence
- `~/PARA/Projects/token-miser/src/explore/{mod,client,tools}.rs`, `src/main.rs` (CLI arg parsing, `Evidence`/`Citation`/`Snippet` types, `Sandbox` containment) — HIGH confidence, verified against working source
- `~/PARA/Projects/token-miser/README.md`, `docs/OVERVIEW.md`, `docs/architecture/ROUTING-ARCHITECTURE.md` (confirms FastContext is explicitly *not* a routing tier, and token-miser's proxy interface is a separate, unrelated surface)
- FastContext arXiv paper (2606.14066), "FastContext: Training Efficient Repository Explorer for Coding Agents" — corroborates the tool-call-intent (not self-executing) protocol — MEDIUM-HIGH confidence (secondary summary of the paper, cross-checked against the primary implementation above)
- `mitkox/FastContext-1.0-4B-SFT-Q4_K_M-GGUF` / `mitkox/FastContext-1.0-4B-RL-Q8_0-GGUF` (Hugging Face model cards) — confirms Qwen3-4B backbone, MIT-licensed, GGUF quantization for llama.cpp — MEDIUM confidence (community/vendor model card)
- `mcp-memory-server/src/index.ts` (existing `runCommand`, `server.registerTool`, ZodEffects-safe validation pattern, `python3` subprocess precedent for graphify) — HIGH confidence, read directly from this repo
- `docs/operating.md`, `scripts/sync-claude-assets.sh`, `scripts/sync-opencode-graphify-assets.sh`, `scripts/sync-opencode-wiki-assets.sh` (existing install/sync patterns for the operating layer) — HIGH confidence, read directly from this repo

---
*Architecture research for: FastContext + token-miser integration into cairnkeep (v1.2 Context Exploration)*
*Researched: 2026-07-04*
