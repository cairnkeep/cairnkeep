# Project Research Summary

**Project:** cairnkeep
**Domain:** Token-efficient repo-exploration capability (`context_explore`), integrated into an existing MCP memory/context server, delegating to a sibling routing binary (token-miser)
**Researched:** 2026-07-04
**Confidence:** MEDIUM-HIGH (see reconciliation note below)

## Reconciliation Note (read first)

The four research agents ran in parallel and disagree on what "token-miser" is. STACK.md, FEATURES.md, and PITFALLS.md searched public registries (npm, GitHub) and concluded it "doesn't exist" as an adoptable dependency, and recommended building a routing module from scratch inside cairnkeep. **This is superseded.** ARCHITECTURE.md read the actual local sibling project source (`~/PARA/Projects/token-miser`, Rust) and confirmed the ground truth, since verified directly by the orchestrator:

- `token-miser` is a real, already-implemented, already-tested Rust binary. It has two faces: (1) an OpenAI-compatible routing proxy (`/v1/chat/completions`, `/v1/messages`, semantic router — out of scope for this milestone), and (2) a standalone `explore` subcommand: `token_miser explore --query "<text>" --repo-root <path>`, which runs the FastContext agentic tool-calling loop once and prints an `Evidence{citations, expanded_snippets, stats}` JSON blob to stdout.
- FastContext (Qwen3-4B, served via llama.cpp `llama-server --jinja` on a mitkox GGUF quant) only **emits** Read/Glob/Grep tool-call intents — it does not execute them. token-miser's `src/explore/{client,tools,mod}.rs` executes those calls in-process in Rust, sandboxed to a canonicalized `repo_root` (rejecting `..`/absolute escapes), including a path-normalization shim for FastContext's Docker-style `/reponame/` path hallucination.
- **Correct cairnkeep design:** `context_explore` is a thin new tool in the existing `cairn-memory` MCP server that shells out to the external `token_miser` binary via subprocess (`runCommand`, the exact pattern already used for `python3` graphify), and parses the `Evidence` JSON. cairnkeep does **not** reimplement the tool loop, the path-normalization shim, or FastContext model serving in TypeScript, and does not touch the FastContext endpoint/model config — that lives entirely in token-miser's own TOML. cairnkeep's only new config surface is the token-miser binary path + optional repo-root override.
- **Superseded recommendations to explicitly discard:** STACK.md's "build token-miser as an internal TS routing module," FEATURES.md's "token-miser routing layer" as a P2 differentiator to build in-repo, and PITFALLS.md's Pitfall 4 ("token-miser adopted with no public provenance to vet" / "vendor or reimplement" framing) — all assume token-miser is either nonexistent or a to-be-decided dependency. It is neither: it is a known, local, already-built sibling binary referenced by path/env var, never vendored into cairnkeep's repo.
- **Still valid and carried forward** from all four files: FastContext tool-call reliability risk (a 4B GGUF may narrate instead of executing tool calls — same class of gap as the prior OCP-04 finding); path containment reopening the SEC-0001 class of bug (reuse the `relative()`-based guard — but note this guard now lives in token-miser's Rust `Sandbox`, not in cairnkeep's TS, so cairnkeep's own containment obligation shrinks to "trust token-miser's sandbox, fail closed if the binary/config is missing" rather than re-deriving the guard itself); keep MCP tool schemas plain `z.object()` (ZodEffects `.refine()` empty-schema bug); the "~60% token savings" figure is an unverified paper claim requiring a live A/B measurement on cairnkeep's own harness; and the FastContext weights license/provenance ambiguity (Microsoft's HF/GitHub repos are now 404; community mirrors state MIT, arXiv shows a CC-BY-NC-ND badge on the paper page only — resolve before any redistribution decision, not blocking for a subprocess-only integration).

## Executive Summary

This milestone adds one new capability to cairnkeep's existing `cairn-memory` MCP server: a `context_explore` tool that offloads broad repository exploration (what would otherwise be a multi-turn Read/Glob/Grep fan-out by the main coding agent) to a small, purpose-built local model (FastContext, Qwen3-4B) via the sibling `token-miser` Rust binary's `explore` subcommand. The integration shape is thin by design: `context_explore` validates its input, spawns `token_miser explore --query <q> --repo-root <path>` as a subprocess using the exact `runCommand` pattern already proven for the `python3` graphify tool, and parses the returned `Evidence` JSON (citations + expanded snippets + stats) into a structured MCP tool result. All of the hard, already-solved engineering — the agentic tool-calling loop against FastContext, filesystem sandboxing/containment, and the Docker-mount-path normalization FastContext requires — lives in token-miser's tested Rust source and is reused, not reimplemented.

The recommended approach treats provider-neutrality the same way `embeddings.ts` already does for the semantic-search embedding endpoint: cairnkeep holds zero FastContext-specific config (no endpoint URL, model id, or API key) — only a binary path and optional repo-root override, both environment-driven with no committed defaults pointing at a real host/IP. This keeps cairnkeep's new surface area small (one tool, one subprocess call, one JSON parse) and pushes all backend-swapping, model-serving, and sandboxing concerns to token-miser's own already-owned config and code.

The two biggest risks are not architectural but empirical: (1) FastContext-4B, like a prior local model this project already fought (qwen3.5-27b under OpenCode), may narrate tool calls as text instead of actually invoking them under certain quant/template/serving configurations — this must be probed against the raw endpoint before any operating-layer wiring is built on top of it; and (2) the milestone's entire value proposition ("token-efficient exploration") is unverified until a real before/after token-count A/B is run on cairnkeep's own harness, not just cited from FastContext's paper. Both risks are cheap to de-risk early and expensive to discover late, so both should be resolved before broad operating-layer (Claude/OpenCode command) wiring.

## Key Findings

### Recommended Stack

No new npm dependencies are required. The `context_explore` tool reuses `@modelcontextprotocol/sdk` (existing), `zod` (existing, plain `z.object()` schemas per the already-fixed ZodEffects pitfall), and Node's built-in `child_process`/`fetch` idioms already used elsewhere in `mcp-memory-server`. The actual "hard" stack — llama.cpp `llama-server --jinja` serving a mitkox FastContext GGUF quant, and the Rust `token_miser explore` CLI that drives the tool-calling loop and sandbox — is entirely external to cairnkeep's own dependency tree; it is a runtime prerequisite (binary on `PATH` or path-configured), not something to `npm install` or vendor.

**Core technologies:**
- `token_miser` (external Rust binary, sibling project) — drives the FastContext agentic loop, executes Read/Glob/Grep locally in a sandboxed, canonicalized `repo_root`, returns `Evidence` JSON — already implemented and tested (`cargo test`, `clippy -D warnings`)
- FastContext-1.0-4B (Qwen3-4B backbone, GGUF via llama.cpp `llama-server --jinja`) — the exploration model itself, referenced only through token-miser's own config, never directly by cairnkeep
- `@modelcontextprotocol/sdk` (existing dependency) — registers `context_explore` alongside the existing 10 tools, same pattern
- `zod` (existing dependency) — plain `z.object()` inputSchema for `context_explore`'s own params (`query`, `repo_root?`, `timeout_seconds?`); cross-field validation stays in the handler body
- Node's existing `runCommand` subprocess helper (already used for `python3` graphify) — spawns `token_miser`, captures stdout/stderr, enforces timeout

### Expected Features

**Must have (table stakes) — this milestone's MVP:**
- `context_explore` MCP tool: NL query in, compact `path:line-range[]` citations out
- Provider-neutral, no-default config: only `CAIRN_CONTEXT_EXPLORE_BIN` (binary path) and `CAIRN_CONTEXT_EXPLORE_REPO_ROOT` (default `process.cwd()`) — no FastContext endpoint/model/API-key config lives in cairnkeep at all
- Read-only safety boundary (inherited from token-miser's sandbox; cairnkeep documents it, doesn't re-implement it)
- Fail-closed error on missing binary / misconfigured token-miser / timeout / malformed stdout — never a silent empty-success
- One operating-layer entry point (Claude + OpenCode command, mirroring the existing `wiki-query.md` → `wiki-query-analyst.md` pairing) so the capability is actually reachable, not just a registered-but-unused tool

**Should have (differentiators, defer until MVP is proven):**
- Memory-aware exploration: cross-reference `context_explore` citations against existing `memory_search`/`wiki-query` hits
- Pre-edit/pre-explore hook auto-invoke, reusing existing OCP-01/02 hook infrastructure (Claude Code hooks, OpenCode `tool.execute.before`) — but per token-miser's own invariant, exploration should only run on a *fresh* task, never as a per-tool-call hook
- Result caching keyed on (query, repo HEAD/dirty-state)
- Token-savings visibility (report measured tokens saved)

**Defer (v2+ / explicitly out of scope):**
- A general multi-provider cost/latency LLM router inside token-miser — token-miser's own docs are explicit that FastContext is "never a routing target... not a tier or a provider"; do not conflate `context_explore`'s subprocess delegation with token-miser's separate HTTP reverse-proxy/routing surface
- Additional exploration backends/models beyond FastContext
- A routing/dashboard UI

### Architecture Approach

`context_explore` is one more `registerTool` call in the existing single-process `cairn-memory` MCP server — no new service, no new transport, no new top-level directory. Its handler validates params, resolves `CAIRN_CONTEXT_EXPLORE_BIN` (default `token_miser` on PATH), and spawns `token_miser explore --query <q> --repo-root <r>` via the existing `runCommand` helper with a generous, configurable timeout (default ~120s, since cold-starting a local model server pays load latency on first request). It parses the single stdout JSON blob (`Evidence{citations, expanded_snippets, stats}`) into the MCP tool result, surfacing `stats.hit_turn_cap` if present so the agent knows evidence may be partial. Operating-layer wiring mirrors every other non-memory capability: a Claude command (`claude/commands/context-explore.md`) and an OpenCode command (`opencode/command/context-explore.md`) — both on-demand, agent-invoked commands, not lifecycle hooks, since token-miser's own invariant is that exploration only runs on a fresh task.

**Major components:**
1. `context_explore` MCP tool handler (new, in `mcp-memory-server/src/index.ts` or an extracted `context-explore.ts`) — validate, spawn, parse, shape result, fail closed on error
2. `runCommand`-style subprocess spawn (reused, unmodified pattern) — spawns `token_miser`, captures stdout/stderr, kills on timeout
3. `token_miser explore` CLI (external, sibling project, not vendored) — drives the FastContext tool-calling loop, executes Read/Glob/Grep locally inside a sandboxed `repo_root`, emits `Evidence` JSON
4. FastContext model server (external, referenced only via token-miser's own TOML config) — emits `tool_calls`/`<final_answer>` given the query + tool schemas
5. Claude/OpenCode operating-layer commands (new, mirrored) — teach the agent when to prefer `context_explore` over a broad native Read/Glob/Grep fan-out

### Critical Pitfalls

1. **FastContext-4B may narrate tool calls as text instead of executing them** (same failure class as the prior qwen3.5-27b OpenCode gap) — probe the raw endpoint with repeated trials requiring `finish_reason=tool_calls` on every turn *before* any operating-layer wiring; treat a "no tool call executed" response as a hard failure to detect and surface, not silently return empty results.
2. **Path/scope containment must not be re-derived weakly in cairnkeep** — the actual containment logic (relative()-based, rejecting `..`/absolute escapes, plus the Docker-mount-path `/reponame/` rewrite) already lives in token-miser's tested `Sandbox`. cairnkeep's obligation shrinks to: fail closed if the binary is missing/misconfigured, and never pass model-authored paths directly to its own `fs` calls (it shouldn't be touching the filesystem for this feature at all — token-miser owns that).
3. **Provider-neutral config must have no committed defaults** — mirror `embeddings.ts`'s `getEmbeddingConfig()` pattern exactly: `CAIRN_CONTEXT_EXPLORE_BIN`/`CAIRN_CONTEXT_EXPLORE_REPO_ROOT` required-or-absent-means-disabled, never a literal local IP/hostname/vendor-model-id committed to `src/` or docs (violates locked `DEC-no-private-references`).
4. **Keep MCP tool schemas plain `z.object()`** — no `.refine()`/`.transform()` at the top level (the already-fixed ZodEffects empty-schema bug); do cross-field validation inside the handler.
5. **The "~60% token savings" claim is unverified for this deployment** — design an A/B token-count comparison harness (native tools vs. `context_explore`, same prompt, measured not estimated) alongside the feature, and report cairnkeep's own measured number in SUMMARY/UAT docs rather than citing the paper's figure.

## Implications for Roadmap

### Phase 1: FastContext reliability spike (standalone, gates everything else)
**Rationale:** This project already burned significant time once on a near-identical failure mode (OCP-04: qwen3.5-27b narrating tool calls instead of invoking them). Re-running that investigation for a new model after building the MCP wiring on top of it would be the expensive way to discover the same problem.
**Delivers:** A documented, repeated-trial reliability probe against the actual pinned FastContext GGUF quant + llama.cpp `--jinja` + chat-template combination the operator will run, confirming `finish_reason=tool_calls` (not narration) across multiple turns and multiple prompts.
**Addresses:** N/A (pre-feature validation)
**Avoids:** Pitfall 1 (tool-call reliability degradation)

### Phase 2: `context_explore` MCP tool
**Rationale:** The core deliverable; depends on Phase 1 confirming the underlying model is usable, and is a prerequisite for every downstream feature (operating-layer wiring, differentiators).
**Delivers:** `server.registerTool("context_explore", ...)` in `mcp-memory-server/src/index.ts` (or an extracted module), subprocess delegation to `token_miser explore` via the existing `runCommand` pattern, `Evidence` JSON parsing, fail-closed error handling for missing binary/timeout/malformed output, plain `z.object()` input schema.
**Uses:** `@modelcontextprotocol/sdk`, `zod`, existing `runCommand` helper (STACK.md)
**Implements:** Component 1-2 from Architecture Approach

### Phase 3: Config surface + offline smoke test
**Rationale:** Config and its verification should ship in the same phase as the tool itself, not deferred — this is exactly where the provider-neutrality pitfall (Pitfall 3) is easiest to introduce and cheapest to catch via review/grep before commit.
**Delivers:** `CAIRN_CONTEXT_EXPLORE_BIN`/`CAIRN_CONTEXT_EXPLORE_REPO_ROOT` env vars documented in `docs/operating.md`; `scripts/smoke-context-explore.mjs` asserting graceful "not configured"/"binary missing" behavior offline (no live model dependency).
**Addresses:** Provider-neutral endpoint config (FEATURES.md table stakes)
**Avoids:** Pitfall 3 (hardcoded defaults / private references)

### Phase 4: Operating-layer wiring (Claude + OpenCode commands)
**Rationale:** Only wire the capability into agent-facing commands once the tool itself is proven reliable and correctly configured — matches the architecture's "on-demand command, not automatic hook" pattern and avoids the "silent auto-invoke" anti-feature.
**Delivers:** `claude/commands/context-explore.md` (mirrors `wiki-query.md`, auto-installed via existing glob-based sync), `opencode/command/context-explore.md` + new `scripts/sync-opencode-context-explore-assets.sh` (mirrors the simplest existing single-command topic installer).
**Addresses:** Operating-layer command/agent entry point (FEATURES.md P1)
**Avoids:** Pitfall regarding "agents ignore the tool unless explicitly instructed" (documented community failure mode)

### Phase 5: Live verification + A/B token-savings measurement (milestone close-out)
**Rationale:** This is the milestone's actual value-proof and should not be an afterthought; a comparative measurement is much harder to retrofit than to design alongside the feature.
**Delivers:** An A/B harness comparing native Read/Glob/Grep token consumption vs. `context_explore`-delegated exploration on a fixed representative prompt, with a measured (not cited-from-paper) number reported in UAT/SUMMARY docs; end-to-end `/context-explore` run in both harnesses against a real bootstrapped project.
**Avoids:** Pitfall 6 (unverified token-savings claim)

### Phase Ordering Rationale

- Phase 1 gates everything: building MCP/operating-layer wiring on top of an unreliable model would repeat the OCP-04 investigation cost for no reason — cheap to check first, expensive to discover late.
- Phase 2 before Phase 4: the tool must exist and be config-correct before it's wired into agent-facing commands, matching the dependency chain FEATURES.md documents ("operating-layer wiring requires context_explore MCP tool").
- Phase 3 folded immediately after/alongside Phase 2 rather than deferred, because config-hardcoding pitfalls are cheapest to catch in the same review pass as the tool's own commit, not in a later audit.
- Phase 5 last because it needs the full pipeline (tool + config + at least one operating-layer command) working end-to-end to produce a meaningful A/B measurement; it is the milestone's actual "done" gate, not a nice-to-have.
- Differentiators (memory-aware annotation, hook auto-invoke, caching) are explicitly deferred past this roadmap's scope per FEATURES.md's MVP definition — they depend on the base tool being proven useful first, and adding them prematurely would obscure whether the core capability actually works.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (reliability spike):** Needs research into the exact llama.cpp build/`--jinja`/chat-template combination and whether a native Qwen3 tool-call template exists or the "generic tool call" fallback applies — STACK.md flags this as unconfirmed in llama.cpp's own docs as of the researched build.
- **Phase 2 (`context_explore` tool):** Needs research into the exact `Evidence` JSON shape token-miser's `explore` subcommand emits (field names, citation/snippet structure, `stats` fields like `hit_turn_cap`) — read directly from token-miser's source (`src/explore/mod.rs`) during planning rather than assumed from this summary.

Phases with standard patterns (skip research-phase):
- **Phase 3 (config surface):** Directly mirrors the already-shipped `embeddings.ts` `getEmbeddingConfig()` pattern — no new research needed, just replicate the shape.
- **Phase 4 (operating-layer wiring):** Directly mirrors the existing `wiki-query.md`/`wiki-query-analyst.md` command pairing and the existing OpenCode topic-installer scripts — established pattern, no new research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | STACK.md's model/serving facts (llama.cpp, FastContext GGUF, licensing ambiguity) are cross-verified across independent mirrors; its "build token-miser as a TS module" conclusion is superseded by direct source verification (see Reconciliation Note) |
| Features | MEDIUM | FastContext/community-wrapper facts are solid; the "token-miser routing layer" framing needs re-reading against actual token-miser scope, since FEATURES.md wrote it as speculative in-repo design rather than "call an existing binary's subcommand" |
| Architecture | HIGH | Grounded directly in token-miser's own working, tested source (`FASTCONTEXT-EXPLORE.md`, `src/explore/*.rs`) plus this repo's own existing patterns (`runCommand`, `registerTool`, sync scripts) — the most reliable of the four files given it read primary, local, verified sources |
| Pitfalls | MEDIUM-HIGH | The two highest-value pitfalls (tool-call reliability, provider-neutrality) are grounded in this project's own prior incidents (HIGH); FastContext/mitkox specifics are MEDIUM (cross-checked web sources); Pitfall 4 (token-miser provenance) is superseded — it is a known local binary, not an unvetted dependency, so its "vendor vs. reimplement" framing doesn't apply, though the underlying "don't vendor token-miser's source into cairnkeep" instinct is still correct (it's referenced by path, never vendored) |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Exact `Evidence` JSON schema from `token_miser explore`:** not fully specified in any research file; read `~/PARA/Projects/token-miser/src/explore/mod.rs` directly during Phase 2 planning to get the precise field names/types before writing the parser.
- **llama.cpp Qwen3 tool-call template support:** unconfirmed as of researched build; verify via `GET /props` → `chat_template_tool_use` against whatever `llama-server` build is actually deployed, during the Phase 1 spike.
- **FastContext weights license ambiguity:** arXiv paper page shows a CC-BY-NC-ND badge (paper-level, not code/weights) vs. every community mirror's explicit MIT claim for code/weights. Not blocking for this milestone (cairnkeep never touches the weights directly — token-miser does), but should be resolved before any future redistribution/bundling decision.
- **token-miser's own `Evidence`/CLI contract stability:** since it's a sibling project under active local development, confirm the `explore` subcommand's CLI flags and output shape haven't drifted since this research was gathered, immediately before Phase 2 implementation.

## Sources

### Primary (HIGH confidence)
- `~/PARA/Projects/token-miser/docs/architecture/FASTCONTEXT-EXPLORE.md`, `src/explore/{mod,client,tools}.rs`, `src/main.rs` — the sibling project's own working, tested implementation; primary source for the entire integration architecture
- `.planning/PROJECT.md`, `.planning/security/VALIDATED/SEC-0001-scope-path-traversal-sandbox-escape.md`, `mcp-memory-server/src/embeddings.ts`, `mcp-memory-server/src/index.ts` — cairnkeep's own canonical conventions to extend (provider-neutral config pattern, `runCommand` subprocess pattern, `registerTool` pattern, prior path-containment fix)
- Project memory: `qwen-coder-opencode-toolcall-limits`, `scope-path-containment-join-pitfall`, `mcp-sdk-zodeffects-empty-schema`, `local-inference-infra` — first-hand prior investigations directly informing Pitfalls 1, 2, and 5

### Secondary (MEDIUM confidence)
- FastContext arXiv paper (2606.14066) — model design, benchmark claims (~60% token reduction, +5.5% SWE-bench), cross-checked against the primary token-miser implementation
- `mitkox/FastContext-1.0-4B-{SFT,RL}-*-GGUF` Hugging Face model cards — GGUF quant details, Docker-mount-path quirk, llama.cpp invocation
- `sdougbrown/fastcontext-harness`, `LIVELUCKY/fastcontext-integrations` (community GitHub projects) — corroborate tool schema/turn structure and document the delegation-reliability failure mode ("agents ignore the tool unless explicitly instructed")
- `ggml-org/llama.cpp` server docs — `--jinja` requirement, tool-calling template behavior

### Tertiary (LOW confidence, superseded or needing validation)
- STACK/FEATURES/PITFALLS' web/npm/GitHub searches for a public "token-miser" package — correctly found nothing (it's a private local sibling project, not a public dependency), but their downstream recommendation ("build it as a TS module in-repo") is superseded by the Architecture agent's direct source read and the orchestrator's verification — see Reconciliation Note at top of this document.

---
*Research completed: 2026-07-04*
*Ready for roadmap: yes*
