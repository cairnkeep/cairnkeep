# Stack Research

**Domain:** Token-efficient repo-exploration (FastContext) + routing layer (token-miser) for a Node/TS MCP server
**Researched:** 2026-07-04
**Confidence:** MEDIUM (model facts cross-verified across independent mirrors; "token-miser" as a package does not exist — see below; llama.cpp tool-calling behavior confirmed from official docs)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| llama.cpp (`llama-server`) | build ≥ b9870 (2026-07-03) | Serves the FastContext GGUF quant as an OpenAI-compatible `/v1/chat/completions` endpoint | Already the project's local-inference pattern (GPU hosts run OpenAI-compatible llama.cpp-style endpoints per existing infra); single binary, MIT-licensed, no new runtime family to operate. `--jinja` flag is required for tool-call templating — without it the server 500s on any request carrying a `tools` array. |
| microsoft/FastContext-1.0-4B-SFT or -RL (GGUF quant) | 1.0 | The exploration model itself — issues parallel Read/Glob/Grep tool calls, returns compact `file:line` citations | Purpose-built repo-explorer (Qwen3-4B-Instruct backbone), MIT-licensed, 4B fits modest VRAM. Cuts main-agent tokens up to ~60% and improves SWE-bench resolution up to +5.5% in the published benchmarks. **Caveat:** Microsoft pulled the original weights + `github.com/microsoft/fastcontext` from HuggingFace/GitHub around 2026-06-30 with no explanation (both now 404). The weights survive only via community mirrors — treat as a supply-chain risk (see "What NOT to Use" and Sources). |
| `mitkox/FastContext-1.0-4B-{SFT,RL}-*-GGUF` | Q4_K_M (2.5 GB) or Q8_0 | Pre-quantized GGUF the operator points `llama-server --hf-repo/--hf-file` at | Matches the milestone's stated default ("mitkox FastContext GGUF on local infra, operator-swappable"). Q4_K_M is the lean default for constrained VRAM; Q8_0 (also mirrored by `sandst1`/`sdougbrown`) is the better-quality option on the higher-VRAM host already in this operator's infra. |
| Node.js built-in `fs.promises.glob` / `fs.promises.readFile` | Node ≥ 22.2 (stable, no flag) | Implements the Glob and Read tool handlers the Node/TS server executes on FastContext's behalf | The project already targets `@types/node ^22.15.21`. `fs.promises.glob` shipped unflagged in 22.2.0 (officially stable docs since Node 24) — no new dependency needed for glob matching. |
| Native `fetch` (already used in `embeddings.ts`) | Node built-in | Calls the FastContext OpenAI-compatible endpoint and any token-miser-selected backend | The server has zero HTTP client dependencies today (`embeddings.ts` calls `${apiUrl}/embeddings` via raw `fetch`). Extending the same pattern to chat-completions calls keeps the "no vendor hardcoding, no heavy deps" constraint intact. |
| `zod` (already a dependency, `^3.25.76`) | existing | Validates the Read/Glob/Grep tool-call arguments the model emits, and the `context_explore` MCP tool's own input schema | Already in `package.json`. Reuse it — but keep validation inside the handler body, not as a `.refine()`-based `inputSchema`, per the already-documented pitfall (ZodEffects as an MCP `inputSchema` publishes an empty tool schema). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None (deliberately) | — | — | This milestone should NOT add a new HTTP client, glob library, or grep library. Node's built-in `fetch` + `fs.promises.glob` + a small manual regex scanner for Grep cover the full FastContext tool contract. If `ripgrep` (`rg`) happens to be on `$PATH`, shelling out to it via `node:child_process` for the Grep tool is a reasonable optional fast-path — but it must degrade gracefully to a pure-Node regex scan when `rg` is absent, since cairnkeep must not assume any pre-installed tooling. |
| `@modelcontextprotocol/sdk` (already a dependency, `^1.29.0`) | existing | Registers the new `context_explore` tool alongside the existing 10 tools | Same registration pattern already used for `memory_read`/`memory_write`/etc. No new MCP dependency needed. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `llama-server --jinja -c <N> --hf-repo <mitkox quant> --hf-file <file.gguf>` | Local dev/test endpoint for FastContext | Verify the effective chat template via `GET /props` → `chat_template_tool_use` after starting the server; if it's empty/generic, tool-call JSON will use llama.cpp's slower "Generic tool call" fallback rather than a native Qwen3 handler (llama.cpp's documented native handlers list Qwen 2.5 via the Hermes-2-Pro format; Qwen3 is not explicitly documented as of this build, so expect the generic fallback and budget extra tokens for it). |

## Installation

```bash
# No new npm packages required for the FastContext/token-miser integration itself.
# (mcp-memory-server already has @modelcontextprotocol/sdk, agentfs-sdk, zod.)

# Operator-side: serving FastContext (not an npm install — a model-serving step)
llama-server --jinja -c 32768 \
  --hf-repo mitkox/FastContext-1.0-4B-SFT-Q4_K_M-GGUF \
  --hf-file fastcontext-1.0-4b-sft-q4_k_m.gguf \
  --port 8090
```

Note on context size: the mitkox model card's example uses `-c 2048`, which is a toy value for a plain completion smoke test, not for real repo exploration — every Read/Grep tool result round-trips through the model's context. Size the context window to the largest expected tool-result batch (32K is a reasonable default; the training/eval setup used up to 128K–262K, which is unnecessary for local single-repo exploration).

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Serving backend | llama.cpp (`llama-server`) | vLLM / SGLang (used in FastContext's own published eval) | Higher throughput but heavier ops surface (Python service, GPU scheduler); llama.cpp is a single binary matching the operator's existing local-infra pattern and the project's "OpenAI-compatible endpoint, operator-swappable" convention. |
| Model variant | FastContext-1.0-4B-**SFT** as the safer default | FastContext-1.0-4B-**RL** | RL slightly outperforms on in-distribution paths but was trained against a Docker convention (`/<repo-name>/`) and is more prone to path hallucination on arbitrary local repos unless a `resolve_path()`-style normalization shim is applied (documented by the community harness). SFT is the more portable choice for a tool meant to run against any bootstrapped project; RL remains a valid operator override once the path-normalization shim exists. |
| Glob/Grep implementation | Node built-ins + manual regex scan | `fast-glob`, `globby`, a `ripgrep` npm wrapper | Adds dependency surface for functionality Node 22+ already covers (glob) or that a dozen lines of `fs.readFile` + line-regex covers (grep) for the file sizes this tool touches (source files, not multi-GB corpora). |
| Routing layer ("token-miser") | Build a small internal TS routing module in this repo | Adopt an existing GitHub project named `token-miser`/`TokenMiser`/`token-miser-mcp` | See dedicated section below — no such project is a viable dependency. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Any of the GitHub repos literally named `token-miser` / `TokenMiser` / `token-miser-mcp` (`rubin-johnson/token-miser`, `johnnyclem/token-miser`, `digitalnelson/token-miser`, `mathonsunday/token-miser`, `vkovic/token-miser-mcp`, `SpoonShawn/TokenMiser`) | None of these is the project referenced by cairnkeep's own planning docs. They are unrelated, unlicensed (no `license` field on any of them), 0-star, mostly stub-only repos (e.g. `vkovic/token-miser-mcp`'s only tool is `hello_world`; its own roadmap marks "Ollama integration" and "complexity routing" as unchecked TODOs). Depending on any of them would mean shipping an unmaintained, unlicensed third-party package under cairnkeep's Apache-2.0 hygiene bar. | Build `token-miser` as a small internal module (see below) — the milestone's own goal is to "land" this sibling, not import it. |
| `LangChain`, `LlamaIndex`, or any agent-framework package for the tool-call loop | The FastContext tool loop is 3 fixed tools (Read/Glob/Grep) and a stop condition (`<final_answer>` block) — a ~100-line hand-rolled loop over `fetch` + `zod` validation is simpler, auditable, and dependency-free, matching the existing `embeddings.ts` style. | A small `src/context-explore/` module using native `fetch`, following the `embeddings.ts` pattern. |
| Assuming `github.com/microsoft/fastcontext` or `huggingface.co/microsoft/FastContext-1.0-4B-*` are reachable at build/doc time | Both currently 404 — Microsoft removed them (~2026-06-30) without explanation. Any setup docs or CI that fetch directly from the `microsoft/*` org will break. | Reference the community mirrors explicitly (`mitkox/*-GGUF` for quants) and note in operator docs that the canonical source is presently unavailable. |
| Hardcoding the FastContext endpoint or a specific quant/model name in code | Violates `DEC-no-private-references` / provider-neutral-core precedent already set for `CAIRN_LLM_*` | New env vars following the exact same fallback pattern already used by `CAIRN_MEMORY_EMBEDDING_URL` (falls back to `CAIRN_LLM_API_URL`) — e.g. `CAIRN_CONTEXT_EXPLORE_URL` (falls back to `CAIRN_LLM_API_URL`), `CAIRN_CONTEXT_EXPLORE_MODEL`, `CAIRN_CONTEXT_EXPLORE_API_KEY` (falls back to `CAIRN_LLM_API_KEY`). |

## What "token-miser" Actually Is (verified)

There is **no existing, adoptable `token-miser` package** matching the "routing + context-explore sibling" description in cairnkeep's own planning docs (`PROJECT.md`, `ROADMAP.md`, `STATE.md`). Searched: npm registry (no package), GitHub code/repo search (six unrelated, unlicensed, low-activity repos with a similar name — none built by this project's author, none MIT/Apache-licensed, one is a stub with a single `hello_world` tool). The closest thing to a "real" reference implementation of the *pattern* cairnkeep wants is `LIVELUCKY/fastcontext-integrations`, a **Python** MCP glue package (`uvx --from git+https://github.com/LIVELUCKY/fastcontext-integrations fastcontext-mcp --base-url <url> --model <id> --api-key <key>`) that exposes a single tool, `fastcontext_explore(query)`, calling any OpenAI-compatible endpoint — but it is Python, not Node/TS, and is a thin wrapper, not a routing layer across multiple backends.

**Conclusion for the roadmap:** treat "token-miser" as a component this milestone builds in-repo, not a dependency to `npm install`. Recommended shape, consistent with the existing codebase:

- A small module (e.g. `mcp-memory-server/src/routing/token-miser.ts` or a workspace-local package) exposing one function: given a task descriptor (`{ kind: "context-explore" | "extraction" | "embedding", ... }`), resolve which OpenAI-compatible backend/model to call, by reading `CAIRN_*` env vars with the same fallback chain the embeddings code already uses.
- No new runtime dependency — it's config resolution + a `fetch` call, not a scheduler or a queue.
- The `context_explore` MCP tool becomes the first (and for this milestone, only) consumer of this routing function; the routing surface is deliberately generic so a second backend (e.g. a different exploration model, or the existing extraction model as a fallback when no FastContext endpoint is configured) can be added later without an API change.

## FastContext Serving + Tool-Call Contract (verified)

- **Backbone / sizes:** Qwen3-4B-Instruct (4B explorer, this milestone's target) and Qwen3-Coder-30B-A3B (30B, out of scope — too large for the stated "local infra" default).
- **License:** MIT (consistently stated by every community mirror preserving the weights after Microsoft's removal). Note: the arXiv HTML abstract page shows a "CC BY-NC-ND 4.0" badge — this is arXiv's default badge for the *paper document*, not the code/weights license, and conflicts with every mirror's explicit "MIT" statement; flagged here rather than silently resolved (see Gaps).
- **Tools exposed to the model (fixed, 3 total, language-agnostic):**
  - `Read(path, offset?, limit?)` — line-numbered file contents
  - `Glob(pattern, directory?)` — path discovery
  - `Grep(pattern, path?, glob?, output_mode?, -B/-A/-C?, -i?, type?, head_limit?, multiline?)` — regex search over repo text
- **Turn structure:** at each turn the explorer either issues one or more tool calls (multiple calls in the same turn run in parallel) or stops and emits a final answer. This means the Node/TS integration must implement an actual multi-turn tool loop — llama.cpp/llama-server does **not** execute tools itself; it only emits `tool_calls` JSON. The calling code is responsible for: (1) sending the system prompt + tools schema + user query, (2) executing any returned `Read`/`Glob`/`Grep` calls against the real filesystem, (3) appending the results as `role: "tool"` messages, (4) repeating until the model emits a final block instead of tool calls.
- **Output format:** a `<final_answer>` block containing `path:startLine-endLine` citations with optional short relevance notes (e.g. `src/auth/webhook.py:42-61`). Parse this into the `context_explore` tool's structured return (`{ citations: [{ path, startLine, endLine, note? }] }`) rather than passing the raw text through.
- **Path-hallucination gotcha (community-documented, applies to both SFT and RL):** the model was trained against a Docker convention where repos are mounted at `/<repo-name>/`; on arbitrary local paths it will often emit truncated/absolute paths that don't match the real working directory. A small `resolve_path()`-style normalization step (prepend the real repo root to bare/truncated paths) is required before executing any tool call the model emits — this is not optional plumbing, it's a documented correctness fix, and skipping it will silently break exploration on any repo not mounted at `/`.
- **llama.cpp serving requirement:** the `--jinja` flag is mandatory for `tools`-bearing requests (`tools param requires --jinja flag` is the literal 500 error without it). llama.cpp does not document a native Qwen3 tool-call template as of the researched build (Qwen 2.5 has a native Hermes-2-Pro-based handler; Qwen3 is unconfirmed) — expect and budget for the "Generic tool call" fallback unless a working `--chat-template-file` is sourced and verified via `GET /props`.

## Stack Patterns by Variant

**If VRAM-constrained (default per milestone context):**
- Use `mitkox/FastContext-1.0-4B-SFT-Q4_K_M-GGUF` (2.5 GB)
- Because it's the smallest well-mirrored quant and SFT is the path-safer variant for arbitrary repos.

**If higher-VRAM host available (operator's own local infra already includes an RTX 5090 host):**
- Use a Q8_0 quant (e.g. `sandst1/FastContext-1.0-4B-RL-Q8_0-GGUF` or the SFT Q8_0 equivalent)
- Because quality improves meaningfully over Q4_K_M at negligible cost when VRAM isn't the binding constraint; RL becomes viable once the path-normalization shim is in place.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `llama-server` ≥ b9870 | `--jinja` tool-calling | Confirm at runtime via `GET /props` → `chat_template_tool_use`; older builds may lack the flag or have buggy generic-template rendering. |
| Node.js ≥ 22.2 | `fs.promises.glob` unflagged | Project's `@types/node ^22.15.21` already satisfies this; no engine bump needed. Node 24 marks it fully stable (no experimental warning) if a future engine bump happens. |
| FastContext-1.0-4B-* (Qwen3-4B-Instruct backbone) | GGUF via `llama.cpp` | Also loadable via Ollama/LM Studio per the `fastcontext-integrations` reference client, but llama.cpp is the milestone's stated default and matches existing infra. |

## Sources

- `docs/operating.md`, `mcp-memory-server/src/embeddings.ts`, `.planning/PROJECT.md` — HIGH (project's own canonical source for existing conventions to extend)
- arXiv 2606.14066 (FastContext paper, HTML) — MEDIUM (single web fetch; tool schema and turn-structure details cross-verified against the community harness below)
- `sdougbrown/fastcontext-harness` (GitHub, WebFetch) — MEDIUM (independent, corroborates tool schema/turn structure and documents the path-hallucination fix)
- `mitkox/FastContext-1.0-4B-SFT-Q4_K_M-GGUF` (Hugging Face, WebFetch) — MEDIUM (direct model-card fetch; quant size/filename verified)
- `LIVELUCKY/fastcontext-integrations` (GitHub, WebFetch) — MEDIUM (reference MCP client pattern; Python, not adopted, but confirms the "single explore tool over an OpenAI-compatible endpoint" shape)
- `ggml-org/llama.cpp` server README + function-calling docs (WebSearch) — MEDIUM (official docs, summarized via search snippets, not a raw fetch — verify `--jinja` behavior against the exact deployed build)
- GitHub code/repo search for `token-miser` / `TokenMiser` (via `gh api`/`gh search repos`) — HIGH (direct GitHub API results — repo metadata and one README fetched raw; confirms no viable existing dependency)
- WebSearch on Microsoft's removal of FastContext from HuggingFace/GitHub (~2026-06-30) — LOW/MEDIUM (community reporting, not an official statement; corroborated independently by the 404s observed directly against `github.com/microsoft/fastcontext` and by multiple "preserved because Microsoft deleted it" mirror descriptions)

## Gaps to Address

- **License conflict unresolved:** arXiv's paper-level CC BY-NC-ND badge vs. every mirror's explicit MIT claim for code/weights. Before any redistribution decision (e.g. bundling a quant in a Docker image or CI fixture), get a mirror's explicit `LICENSE` file content directly (the original `microsoft/fastcontext` LICENSE file is inaccessible — 404 — since the source repo was removed).
- **No native Qwen3 tool-call template confirmed in llama.cpp docs** — must be verified empirically (`GET /props`) against whatever `llama-server` build the operator actually runs; if generic fallback is in effect, expect higher token overhead per exploration turn than the published benchmarks (which likely used a purpose-built harness, not raw llama.cpp).
- **RL vs SFT path-hallucination behavior** is documented by a third-party harness, not by Microsoft (source removed) — worth a quick empirical check against this project's actual bootstrapped-project layout before defaulting to RL over SFT.
