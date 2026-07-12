# Feature Research

**Domain:** Repo-exploration offload (FastContext-style subagent) + backend routing (token-miser), integrated into an existing memory+context MCP layer (cairnkeep)
**Researched:** 2026-07-04
**Confidence:** MEDIUM (public sources on FastContext/community MCP wrapper are solid; "token-miser" is cairnkeep's own internal concept — no external product to benchmark, so its feature shape is derived from general LLM-routing patterns + cairnkeep's existing provider-neutral core, not verified against a reference implementation)

## Feature Landscape

### Table Stakes (Users Expect These)

A working `context_explore` capability is broken without these.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `context_explore` MCP tool: NL query in → compact `path:line-range` citations out | This is the entire value proposition (offload READ/GLOB/GREP from the main agent). Without it there's no capability, just a routing shell. | MEDIUM | New `registerTool` on the existing `McpServer` instance in `mcp-memory-server/src/index.ts` (same pattern as `memory_search`/`semantic_search`). Body: forward the query + repo root to an OpenAI-compatible chat endpoint running the FastContext model, parse its final citation block, return structured `{path, startLine, endLine, reason}[]`. |
| Provider-neutral endpoint config (base URL, model id, API key/auth, timeout) | cairnkeep's core constraint (`DEC`-level: provider-neutral core, no vendor hardcoding) applies here exactly as it did for the embedding endpoint | LOW-MEDIUM | Reuse the exact pattern already in place for the semantic-search embedding endpoint (env-driven config, no default vendor baked into logic — "required, else fallback" precedent from Key Decisions). Default value can point at a local mitkox FastContext GGUF endpoint, but must be operator-swappable, never hardcoded in code paths. |
| Read-only safety boundary | FastContext's own design principle: the explorer "touches nothing" — only read/glob/grep. cairnkeep already has a scope-guard/path-containment precedent (SEC-0001) it must not regress. | LOW | Tool must not accept or forward any write/edit capability. Document explicitly in the tool description (mirrors `memory_search`'s description pattern) that this is read-only, sandboxed to the scoped project root, same containment rule as existing scope-guard (`relative()`-based, not `resolve===join`). |
| Fallback / fail-closed behavior when the exploration endpoint is unreachable | Users will hit this immediately (no local server running, wrong port). Silent hang or crash breaks trust in a verify-by-execution project. | LOW-MEDIUM | Same shape as the existing "semantic search falls back to substring matching when embeddings are unavailable" precedent — either fail fast with a clear error, or (differentiator territory) fall back to letting the main agent do native Read/Grep. Table-stakes minimum is: fail fast, clear error, no silent degradation. |
| Explicit invocation surface for the main agent (tool description + operating-layer guidance) | Community reports on the FastContext MCP wrapper note agents "need explicit instructions to actually delegate... otherwise they tend to ignore it or re-scan the repository afterward, negating efficiency gains." | LOW | Tool description text + at least one operating-layer artifact (command or agent prompt) that tells the main agent/subagent when to prefer `context_explore` over native Read/Glob/Grep. Mirrors the existing `wiki-query.md` → `wiki-query-analyst.md` command/agent pairing already in `claude/`. |
| Config validation at startup, not first call | Matches existing MCP server posture (opt-in HTTP transport "fails closed"; embedding model "required, else substring fallback") | LOW | Validate base URL/model presence when the tool is registered or on first invocation with a clear misconfiguration error, not a stack trace. |

### Differentiators (Competitive Advantage)

These are where cairnkeep's existing memory/wiki layer gives it something a bare FastContext MCP wrapper (like the community `fastcontext-integrations` project) doesn't have.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| token-miser routing layer (backend dispatch for exploration + model calls) | Decouples "what backend runs FastContext" from "how the main agent asks for exploration." Lets an operator swap local llama.cpp ↔ a hosted OpenAI-compatible endpoint ↔ a future second exploration model without touching the MCP tool contract. This is explicitly cairnkeep's own deferred concept ("the routing + context-explore sibling"), not a third-party product — shape it minimally. | MEDIUM-HIGH | Keep scope to: a config-driven map of `capability → backend config` (e.g. `exploration: {baseUrl, model}`, `chat: {...}`), resolved once per call. Resist building a general multi-provider cost/latency router (see Anti-Features) — that's a different, much bigger product. |
| Memory-aware exploration (cross-reference `context_explore` hits with existing `memory_search`/wiki) | cairnkeep already has durable project memory and a compiled wiki; a bare FastContext wrapper only sees the live filesystem. Surfacing "this file also has a memory entry / wiki page" turns a generic repo-scout into a context layer that actually knows the project's history. | MEDIUM-HIGH | New composition, not a new tool: after `context_explore` returns citations, optionally check if any hit paths intersect existing memory/wiki entries and annotate the response. Depends on `memory_search`/`semantic_search` (existing) and `wiki-query` (existing). Real integration risk — keep it additive/optional, not a hard requirement of the base tool. |
| Operating-layer auto-invoke hook (pre-edit or pre-explore nudge) | cairnkeep already proved this pattern for memory (OCP-02: OpenCode's `tool.execute.before` plugin injects file-specific memory before an edit; Claude Code has an equivalent hook). The same lifecycle point could nudge the agent toward `context_explore` before a broad Read/Grep sweep. | MEDIUM | Reuses existing hook infrastructure (Claude Code hooks + OpenCode plugin events) rather than inventing new lifecycle points. Genuine differentiator because it makes delegation automatic instead of relying on prompt discipline alone (the exact gap the community FastContext MCP wrapper's docs flag as a failure mode). |
| Result caching keyed on (query, repo HEAD / dirty-state fingerprint) | FastContext calls cost a local-inference round trip; repeated identical queries during a session (or across a short-lived branch) are wasted latency+tokens. | MEDIUM | Store in the same scoped AgentFS mechanism memory tools already use, or a lightweight in-process LRU. Must invalidate on repo state change — do not over-build this into a general cache service. |
| Slash-command / explicit `/explore`-style entry point | Matches the milestone's existing "Explore-style capability in the operating layer" and the `wiki-query.md` precedent — gives a human-invokable path distinct from agent-autonomous tool calls. | LOW-MEDIUM | Wraps the same underlying `context_explore` MCP tool; no new backend logic. |
| Token-savings visibility (report tokens/turns saved by delegating) | Directly evidences the "~60% main-agent token cut" claim FastContext's own paper makes, and matches the verify-by-execution culture (don't just claim savings, show them). | LOW-MEDIUM | Simple before/after or estimated-tokens-saved note in the tool response or a companion report; not a full analytics dashboard. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Letting the exploration subagent write or edit files | "Since it's already reading, why not let it fix small things too?" | Breaks FastContext's own core safety design ("touches nothing... cannot break anything while it looks") and cairnkeep's scope-guard precedent; conflates two agent roles with different trust levels. | Keep `context_explore` strictly read-only; edits stay with the main agent, which now has better (compact) evidence to act on. |
| A full general-purpose multi-provider LLM router (cost/latency-optimizing, dozens of providers) inside token-miser | "Since we're routing exploration calls, let's route everything and optimize spend across all providers" | This is a different, much larger product (see LiteLLM/LLMRouter/bentoml-llm-router class of projects). Scope creep risk explicitly flagged by the milestone's own framing ("routing + context-explore sibling," not "universal LLM gateway"). Would balloon complexity and dependency surface far beyond this milestone. | Bound token-miser to a small, named set of capabilities (`exploration`, maybe `chat`) with config-driven backend selection — not dynamic cost optimization across an open provider catalog. |
| Hardcoding the mitkox FastContext GGUF endpoint (or any specific vendor/model) as a non-overridable default | Convenient for the maintainer's own local infra (matches this project's real dev setup) | Directly violates cairnkeep's locked provider-neutral-core constraint and the DEC-no-private-references spirit — a public repo default that assumes one operator's private host/IP. | Default value in `.env.example`/docs only, always overridable via config; core logic must treat the endpoint as arbitrary OpenAI-compatible. |
| Auto-invoking `context_explore` transparently on every Read/Grep with no opt-out or visibility | Feels seamless, maximizes token savings automatically | Removes user control and auditability — conflicts with the project's verify-by-execution culture and the observed failure mode where broad/imprecise citations cause the main agent to silently re-explore anyway (inflating rather than saving tokens, per FastContext's own case-study caveat). | Auto-invoke only via an explicit, documented hook/config toggle; always leave a visible trace (e.g., logged tool call) that exploration was delegated. |
| Merging `context_explore` into `memory_search`/`wiki-query` as one unified "ask anything" tool | Looks like consolidation, fewer tools to learn | Conflates two fundamentally different data sources: durable curated memory/wiki (write-once, reviewed) vs. live filesystem state (transient, unreviewed). Blurring them undermines the wiki's citation/trust model. | Keep `context_explore` a distinct tool; use the "memory-aware exploration" differentiator (annotation, not merger) to bridge them. |
| A routing/dashboard UI for backend selection | Nice-to-have visibility | Out of scope for a CLI/MCP-first project with no existing UI surface; adds a whole new surface area (web server, auth, etc.) with no precedent in cairnkeep. | Config file + CLI/`cairn` subcommand for inspecting current routing config, if visibility is needed at all. |

## Feature Dependencies

```
context_explore MCP tool (registerTool on existing McpServer)
    └──requires──> provider-neutral endpoint config (base URL/model/auth pattern)
                       └──requires──> existing provider-neutral-core precedent (embedding endpoint config)
    └──requires──> a running FastContext-compatible backend (external prerequisite: llama.cpp + mitkox GGUF, or any OpenAI-compatible server)

token-miser routing layer
    └──requires──> context_explore MCP tool (first/primary capability it routes to)
    └──enhances──> future additional backends/capabilities (kept out of scope this milestone per Out-of-Scope note)

Operating-layer wiring (commands/agents/hooks in claude/ + opencode/)
    └──requires──> context_explore MCP tool (the thing being wired to)
    └──requires──> existing hook infrastructure (OCP-01/02 pattern: OpenCode tool.execute.before plugin, Claude Code PreToolUse-equivalent hook)
    └──requires──> existing command/agent pairing pattern (wiki-query.md → wiki-query-analyst.md) as the template for a slash-command entry point

Memory-aware exploration (differentiator)
    └──requires──> context_explore MCP tool
    └──requires──> existing memory_search / semantic_search tools
    └──requires──> existing wiki-query capability

Result caching (differentiator)
    └──requires──> context_explore MCP tool
    └──enhances──> AgentFS scoped-storage pattern already used by memory tools (reuse, don't reinvent)

Fallback-to-native-Read/Grep (stretch table-stakes / differentiator boundary)
    └──requires──> context_explore MCP tool's fail-closed error path
    └──conflicts──> "auto-invoke transparently with no opt-out" anti-feature (fallback must stay visible, not silent)
```

### Dependency Notes

- **`context_explore` requires the provider-neutral endpoint config pattern:** cairnkeep already solved "external, swappable, no vendor default" once for the semantic-search embedding endpoint (Key Decisions: "Semantic-search embedding model required, else substring fallback... Removed a hardcoded vendor model default to keep the core provider-neutral"). Re-derive the same shape rather than inventing a new config surface — this is the cheapest path to compliance with `DEC-no-private-references` and the provider-neutral-core constraint.
- **token-miser requires `context_explore` to exist first:** there is nothing to route to otherwise. Land the MCP tool in an earlier phase; routing is a thin layer on top, not a prerequisite.
- **Operating-layer wiring requires the existing hook infrastructure, not new lifecycle points:** OCP-01 (session-end capture) and OCP-02 (pre-edit recall injection) already proved OpenCode's plugin events and Claude Code's hook model can intercept the right moments. Reuse those attach points for an exploration nudge instead of inventing a third hook mechanism.
- **Memory-aware exploration enhances but does not require token-miser:** it only needs the base `context_explore` tool plus already-shipped `memory_search`/`wiki-query`. It can land independently of routing complexity.
- **Fallback conflicts with silent auto-invoke:** if `context_explore` silently falls back to native tools, the main agent (and the operator) must still be able to tell that delegation failed — otherwise a failure path becomes indistinguishable from the "seamless auto-invoke" anti-feature's undesirable side effects.

## MVP Definition

### Launch With (v1 of this milestone)

Minimum viable `context_explore` capability — validates the concept end-to-end.

- [ ] `context_explore` MCP tool registered on the existing `cairn-memory` server — NL query in, `path:line-range[]` out — this is the entire value proposition
- [ ] Provider-neutral endpoint config (base URL/model/auth, no hardcoded vendor default) — required by locked project constraints, not optional
- [ ] Read-only safety boundary, explicitly documented in the tool description — required to match FastContext's own safety model and cairnkeep's scope-guard precedent
- [ ] Fail-closed error on unreachable/misconfigured endpoint — required so the tool is debuggable on day one
- [ ] One operating-layer entry point (command + optionally an agent, following the `wiki-query.md`/`wiki-query-analyst.md` pairing) so the capability is human- and agent-invokable, not just an unused MCP tool

### Add After Validation (v1.x)

- [ ] token-miser routing layer (config-driven backend map, scoped to `exploration` + maybe `chat` capabilities) — add once `context_explore` itself is proven useful and a second backend/config need actually appears
- [ ] Memory-aware exploration annotations (cross-reference with `memory_search`/`wiki-query`) — add once base exploration is trusted and stable
- [ ] Pre-edit/pre-explore hook wiring in Claude Code + OpenCode operating layers — add once the manual invocation path (command/agent) has been exercised and the delegation trigger points are well understood
- [ ] Result caching — add once real usage shows repeated-query waste is actually a problem, not preemptively

### Future Consideration (v2+)

- [ ] Token-savings reporting/telemetry — nice validation evidence, but not needed to prove the core capability works
- [ ] Additional exploration backends beyond FastContext (e.g., a second model size/vendor) — defer until token-miser's minimal routing shape is proven with one real alternate backend, not designed speculatively for many
- [ ] Any general-purpose multi-provider cost/latency routing — explicitly out of scope per the anti-features list; revisit only if a concrete, named need emerges

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `context_explore` MCP tool (query → file:line) | HIGH | MEDIUM | P1 |
| Provider-neutral endpoint config | HIGH | LOW-MEDIUM | P1 |
| Read-only safety boundary | HIGH | LOW | P1 |
| Fail-closed error handling | MEDIUM-HIGH | LOW-MEDIUM | P1 |
| Operating-layer command/agent entry point | HIGH | LOW-MEDIUM | P1 |
| token-miser minimal routing layer | MEDIUM | MEDIUM-HIGH | P2 |
| Memory-aware exploration annotation | MEDIUM | MEDIUM-HIGH | P2 |
| Pre-edit/pre-explore hook auto-invoke | MEDIUM | MEDIUM | P2 |
| Result caching | LOW-MEDIUM | MEDIUM | P3 |
| Token-savings telemetry | LOW-MEDIUM | LOW-MEDIUM | P3 |
| General multi-provider cost router | LOW (not requested by this milestone's scope) | HIGH | Out of scope |

**Priority key:**
- P1: Must have for a working `context_explore` capability this milestone
- P2: Should have, once the base capability is proven — the genuine differentiators
- P3: Nice to have, defer until real usage justifies it

## Competitor Feature Analysis

| Feature | Community `fastcontext-integrations` MCP wrapper | Bare native Read/Glob/Grep (status quo) | Cairnkeep's Planned Approach |
|---------|--------------------------------------------------|------------------------------------------|-------------------------------|
| Query → citation contract | Single tool (`fastcontext_explore`), NL query in, `<final_answer>` citation block with `path:line-range` out | N/A — main agent does its own multi-turn Read/Glob/Grep, no compact contract | Same core contract, exposed as a `cairn-memory` MCP tool (consistent with existing tool set, not a separate server) |
| Backend config | CLI flags (`--base-url`, `--model`, `--api-key`), defaults to `localhost:1234/v1` (LM Studio-style) | N/A | Config-driven (env/config file), no hardcoded default vendor — stricter than the community wrapper because of `DEC-no-private-references` |
| Delegation reliability | Documented failure mode: agents ignore the tool or re-scan afterward unless explicitly instructed | N/A (no delegation to fail) | Addressed via explicit operating-layer command/agent guidance + optional hook auto-invoke (a step further than the bare MCP wrapper, which relies on prompt text alone) |
| Memory/context awareness | None — purely a filesystem scout, no notion of project history | None | Differentiator: optional cross-reference with existing `memory_search`/`wiki-query` |
| Routing across backends | None — single fixed backend per server instance | N/A | token-miser layer (deferred to P2), scoped narrowly to avoid becoming a general LLM router |
| Safety model | Explicitly read-only ("touches nothing") | Read/Grep only, but interleaved with edits by the same main agent (no separation of concerns) | Matches the community wrapper's read-only boundary; adds cairnkeep's existing scope-guard/path-containment precedent |

## Sources

- [FastContext: Training Efficient Repository Explorer for Coding Agents (arXiv 2606.14066)](https://arxiv.org/pdf/2606.14066) — HIGH confidence, primary paper: exploration-subagent design, SFT/RL training, SWE-bench Multilingual/Pro/QA results (up to 5.5% resolution-rate improvement, up to 60% main-model token reduction), read/grep-only safety framing, and the case study where imprecise citations cause token increase despite task resolution
- [Trained Repository Explorer Sub-Agent (FastContext) — AgentPatterns.ai](https://agentpatterns.ai/agent-design/fastcontext-trained-repository-explorer/) — MEDIUM confidence, secondary summary corroborating the design pattern
- [Microsoft FastContext: A Scout So Your Coding Agent Stops Burning Tokens – ToKnow.ai](https://toknow.ai/posts/microsoft-fastcontext-scout-subagent-coding-agent-tokens/) — MEDIUM confidence, secondary commentary
- [microsoft/FastContext-1.0-4B-SFT on Hugging Face](https://huggingface.co/microsoft/FastContext-1.0-4B-SFT) — HIGH confidence, model card
- [mitkox/FastContext-1.0-4B-SFT-Q4_K_M-GGUF on Hugging Face](https://huggingface.co/mitkox/FastContext-1.0-4B-SFT-Q4_K_M-GGUF) — HIGH confidence, GGUF quant details, llama.cpp invocation
- [GitHub - LIVELUCKY/fastcontext-integrations](https://github.com/LIVELUCKY/fastcontext-integrations) — MEDIUM confidence (community, not Microsoft-official), fetched directly for the concrete MCP tool contract (`fastcontext_explore`, `--base-url`/`--model`/`--api-key` config, documented delegation-reliability failure mode)
- Web search for "token-miser" turned up no matching external project (searched general LLM-routing/token-optimization space: LiteLLM-class routers, `LLMRouter`, `llm-interactive-proxy`, `bentoml/llm-router`, etc.) — confirms token-miser is cairnkeep's own internal concept, not a third-party dependency to integrate; its feature shape here is derived from cairnkeep's own PROJECT.md framing plus general routing-layer patterns observed across that search, not from a reference implementation. LOW confidence on any specific routing-layer design detail beyond "config-driven backend map" — flagged as a gap for phase-specific research.
- `/home/stondo/PARA/Projects/cairnkeep/.planning/PROJECT.md` — project-internal source of truth for milestone scope, locked constraints, and existing requirement/decision history
- `/home/stondo/PARA/Projects/cairnkeep/mcp-memory-server/src/index.ts` (read via `grep` for `registerTool`) — confirms the exact existing MCP tool registration pattern (`memory_read`, `memory_write`, `semantic_search`, `wiki_query`, etc.) that a new `context_explore` tool would follow
- `/home/stondo/PARA/Projects/cairnkeep/claude/agents/wiki-query-analyst.md` — confirms the existing command/agent pairing pattern (`wiki-query.md` → `wiki-query-analyst.md`) usable as a template for an exploration slash-command entry point

---
*Feature research for: repo-exploration offload + backend routing integration into cairnkeep's memory+context layer*
*Researched: 2026-07-04*
</content>
