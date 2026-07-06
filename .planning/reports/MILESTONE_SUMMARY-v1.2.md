# Milestone v1.2 — Context Exploration (token-miser + FastContext)

**Generated:** 2026-07-06
**Purpose:** Team onboarding and project review
**Status:** ✅ Complete — all 4 phases (6–9) delivered, 7/7 requirements validated (not yet tag-archived)

---

## 1. Project Overview

**Cairnkeep** is a durable, harness-agnostic memory + context layer for coding agents (Claude Code, OpenCode, …). It ships three things: the **`cairn-memory` MCP server** (Node.js/TypeScript), a **`cairn` CLI** that bootstraps a project's launchers and derived-knowledge layer, and an **operating layer** of commands, agents, and hooks for memory, wiki, security, and review workflows.

**Core value — drop-in parity:** a fresh `cairn bootstrap` plus the carved commands, agents, and hooks reproduce the originating private workflow end-to-end, verified against the registered `cairn-memory` MCP server.

**What v1.2 added — one new capability:** token-efficient repo exploration. A `context_explore` tool in the `cairn-memory` MCP delegates natural-language exploration queries to the external **`token_miser explore`** binary (which drives a **FastContext** GGUF model over an OpenAI-compatible endpoint) and returns compact `path:line-range` citations instead of full file dumps — the token-economy lever. It is wired into both the Claude Code and OpenCode operating layers as an on-demand `/context-explore` command. This fulfills the v1.1-deferred token-miser integration (its `context_explore` slice; the HTTP routing surface remains deferred as TMISER-R1).

> **Background:** FastContext is Microsoft's repo-exploration subagent (4B–30B, MIT-licensed) that cuts main-agent tokens ~60% at +5.5% SWE-bench; mitkox ships GGUF quants for llama.cpp. Cairnkeep does **not** reimplement FastContext's agentic loop, sandbox, or serving — it delegates by subprocess and stays provider-neutral, holding none of the endpoint/model config (token-miser owns that in its own TOML).

**All four phases are complete.** The milestone was built and verified in three days (2026-07-04 → 2026-07-06) against the real FastContext backend, closing on cairnkeep's **own measured** token-savings number rather than a cited paper figure.

## 2. Architecture & Technical Decisions

The milestone's defining architectural stance is **thin delegation over reimplementation**, applied consistently at every layer:

- **The MCP tool is a subprocess adapter, not an engine.** `context_explore` shells out to `token_miser explore` via the existing `runCommand` pattern (the same one `domain_knowledge_sync` uses) and parses its `Evidence` JSON. It owns no FastContext loop, sandbox, or model serving.
  - **Why:** token-miser already owns and tests the agentic loop in Rust. Re-deriving it in TypeScript would duplicate a moving target and pull vendor config into the core. *(Phase 7)*

- **Provider-neutral, env-only configuration.** The tool's entire config surface is two environment variables: `CAIRN_EXPLORE_BINARY` (binary path, falls back to `token_miser` on `PATH`) and `CAIRN_EXPLORE_REPO_ROOT` (optional repo-root override). No FastContext endpoint, model, API key, host, IP, or vendor default is committed anywhere in `src/` or `docs/` — verified by a grep audit.
  - **Why:** honors the LOCKED `DEC-no-private-references` rule; keeps the OSS core swappable. *(Phase 7, CTX-03)*

- **Fail-closed, hybrid error contract.** Precondition/config errors (unconfigured or missing binary, unresolvable repo root) **throw**; execution failures (non-zero exit, timeout, malformed stdout) **return** a structured `{ ok:false, error, stderr, exitCode, timedOut }`. An empty citation list from a *successful* run is a first-class `ok:true` — never conflated with an error.
  - **Why:** a silent empty-success on a broken backend would be indistinguishable from a genuine "nothing found." *(Phase 7, CTX-02, D-04)*

- **Explicit `repo_root`, never cwd.** Commands resolve the target repo via `git rev-parse --show-toplevel` and pass it explicitly to the tool.
  - **Why:** the MCP server's cwd is `infraRoot`, not the target repo — a cwd default would explore the wrong tree. *(Phase 7 D-01 / Phase 8 D-03)*

- **Citations only at the operating layer.** The `/context-explore` commands surface the compact `path:line-range` list and stop. They deliberately exclude Read/Grep/Glob from `allowed-tools` so the cited ranges can't be auto-expanded, and they don't pre-summarize per citation.
  - **Why:** auto-reading the citations "spends the exact tokens the tool exists to save." The main agent decides what to `Read` next. *(Phase 8 D-02)*

- **Direct inline MCP call, no paired sub-agent.** The command calls `context_explore` directly (mirroring `recall.md`) rather than dispatching to an analyst agent (the `wiki-query` pattern).
  - **Why:** the tool is already thin and returns final citations — a sub-agent would only relay them, adding an agent file to sync for no work. *(Phase 8 D-01)*

- **Harness-specific tool-naming convention.** Claude Code uses `allowed-tools: Bash, mcp__cairn-memory__context_explore`; OpenCode uses a YAML `tools:` map (`cairn-memory_context_explore: true`). Same tool, two frontmatter dialects — the established cross-harness parity pattern.

- **Reliability gated before wiring.** A standalone spike (Phase 6) proved the deployed model reliably emits real tool calls **before** any code depended on it, and a live A/B (Phase 9) proved the value proposition with a measured number — both committed as re-runnable bash+curl probes.
  - **Why:** OCP-04 (v1.1) already paid once for building atop an unverified local model's tool-calling; the spike de-risks that exact failure class. *(Phases 6 & 9)*

**Tech stack:** Node.js/TypeScript for `cairn-memory` (deps: `@modelcontextprotocol/sdk`, `agentfs-sdk`, `zod`); bash+curl+jq for the verification probes; Apache-2.0; CI runs the smoke suite. External runtime prerequisites (the `token_miser` binary and the FastContext endpoint) are operator-provided and referenced by path/env only — never vendored.

## 3. Phases Delivered

| Phase | Name | Status | One-Liner |
|-------|------|--------|-----------|
| 6 | FastContext Reliability Spike | ✅ Complete (2026-07-04) | Proved the deployed GGUF quant + `llama-server --jinja` emits real `tool_calls` (15/15, GO) before any code depends on it. |
| 7 | context_explore MCP Tool | ✅ Complete (2026-07-04) | Thin subprocess-delegating MCP tool that parses token-miser's `Evidence` JSON into compact citations, fails closed on every error, env-only config. |
| 8 | Operating-Layer Wiring | ✅ Complete (2026-07-05) | Paired `/context-explore` commands for Claude Code + OpenCode, installed via a dedicated `sync-opencode-explore-assets.sh`. |
| 9 | Live Verification + A/B | ✅ Complete (2026-07-06) | Measured ~99.9% byte-savings on verified pinpoint queries (D-03 **PASS**); broad-set model unreliability disclosed transparently. |

### Phase 6 — FastContext Reliability Spike (CTX-06)

A spike, not a build: prove — before Phases 7–9 depend on it — that the actually-deployed FastContext GGUF quant + `llama-server --jinja` reliably emits real `tool_calls` (not narration). Delivered a committed, re-runnable probe (`scripts/verify-fastcontext-reliability.sh`; bash+curl+jq, with offline `--self-test`, `--props-only`, and `--full` modes) and a documented go/no-go verdict (`06-SPIKE.md`).

- **Verdict: GO** — *"Reliably invokes tools — safe to build Phase 7 on."* Every turn of the ≥15-turn matrix returned `finish_reason=tool_calls` with a well-formed non-empty `tool_calls` array: **15/15 pass, 0 narration, `--full` exit 0.**
- **Pinned combination (D-08):** model `FastContext-1.0-4b-rl` `q8_0`, `llama-server` build `b8856-9da7b42f4`, `n_ctx 24576`, `--jinja` on, endpoint via `FASTCONTEXT_PROBE_URL` (redacted, loopback-only). GPU explicitly noted as *not* the variable under test.
- **Refined verdict rubric (D-05):** the verdict anchors on **gate #2** (per-turn `tool_calls` matrix). Gate #1 (`/props` → `chat_template_tool_use`) is recorded as evidence only, never an auto-NO-GO — because that field is **absent by architecture** for this single-unified-template Qwen3-family GGUF (source-verified), not a defect.
- **Code review caught a latent false-NO-GO** (`CR-01`): the stubbed reply only answered `tool_calls[0]` per turn, which could misfire on a future *parallel* tool-call run. It never affected the recorded GO (all 15 turns had one call each). Operator chose fix + live re-run; hardened in commit `9df61a7` (reply to every call, id-normalized, new parallel self-test guard) and re-run live: **15/15, GO, verdict unchanged.**

### Phase 7 — context_explore MCP Tool (CTX-01, CTX-02, CTX-03)

`cairn-memory` now registers a `context_explore` tool that delegates a natural-language query to `token_miser explore`, parses the `Evidence` JSON, and returns dual output: compact `path:start-end` citation text (the token lever) plus the full lossless `Evidence` in `structuredContent`.

- **Offline-first test infra:** four executable fixture scripts (`fake-tokenmiser-{exit1,garbage,empty,cited}.sh`) stand in for the real binary; `smoke-explore-guard.mjs` exercises the not-configured / binary-missing / non-zero-exit / malformed-stdout / empty-success / populated-citations paths with **no live-model dependency**, wired into `test:smoke` via `check:explore-guard`. The guard was intentionally **RED** at the registration anchor until the tool landed (proving it's not false-green).
- **`runCommand` gained a backward-compatible optional `env` param** (defaults to `process.env`) so `NO_COLOR=1` can be injected without regressing the only other caller, `domain_knowledge_sync` (its 3-arg call stays byte-identical).
- **No `top_k` param** — `token_miser explore`'s CLI has no such flag; adding one would be a dead param (YAGNI).
- **Live SC-1 discharged** (`07-UAT.md`): `context_explore` returned a compact `src/config.rs:1-100` citation through the MCP tool against a real backend. All 4/4 success criteria verified.
- **Accepted residual (T-07-06 / Pitfall #1):** an unreachable-but-configured endpoint yields exit 0 + empty `Evidence`, indistinguishable from a genuine empty result by JSON shape alone. Mitigated by transparency — the empty-citation text surfaces `stats.turns` / `stats.tool_calls`. Fully closing it would mean re-implementing the explorer loop (out of the thin-adapter scope).

### Phase 8 — Operating-Layer Wiring (CTX-04, CTX-05)

Paired `/context-explore` slash commands for both harnesses that call the tool directly and relay its citations verbatim — no auto-read, no pre-synthesis.

- `claude/commands/context-explore.md` (`allowed-tools: Bash, mcp__cairn-memory__context_explore` only) and `opencode/command/context-explore.md` (OpenCode `tools:` map form) — bodies identical, both resolving `repo_root` via `git rev-parse --show-toplevel` with an optional path override.
- `scripts/sync-opencode-explore-assets.sh` — the sixth `sync-opencode-*-assets.sh` sibling (after memory, wiki, security, graphify, plugin), narrowed to a single managed asset; `--apply` then `--check` round-trips clean (both exit 0).
- `docs/operating.md` updated for install/verify parity. **D-04 fulfilled as documentation parity, not a new CI job** — no sibling sync script has real CI wiring, so inventing a first-of-its-kind job would silently add unmatched scope.
- **Live end-to-end invocation was deliberately deferred to Phase 9** (CTX-07 / SC-3), consistent with how Phases 5–7 deferred live-model-dependent checks.

### Phase 9 — Live Verification + A/B Token-Savings (CTX-07)

The milestone close-out gate: prove the value proposition with cairnkeep's **own measured** before/after number. Delivered `scripts/verify-token-savings-ab.sh` (557 lines; deterministic offline native side, live explore side, `--self-test`/`--native`/`--explore`/`--full` modes) and the recorded verdict in `09-AB.md`.

- **Headline: ~99.9% byte-savings on verified pinpoint queries. D-03 verdict = PASS.** Measured live against the real FastContext + `token_miser` backend:

  | Query | Native bytes (before) | Explore citation bytes (after) | Savings |
  |-------|----------------------:|-------------------------------:|--------:|
  | `renderCitations` location | 52,620 (12 hits) | 38 | **99.93%** |
  | `runCommand` location | 42,154 (12 hits) | 38 | **99.91%** |

  Both explore citations (`mcp-memory-server/src/index.ts:604-615` and `:406-450`) were **independently verified correct**. Byte delta is the tokenizer-free ground truth; a provider-neutral `chars/4` token estimate is reported alongside, never a vendor tokenizer.
- **The magnitude need not match FastContext's ~60% paper figure** — different measurement shapes (native = a conservative 12-window grep dump; explore = a single pinpoint citation).
- **Honesty on the broad set (D-01 finding, disclosed not hidden):** the default 5-query broad set was run live and the small 4B model was **unreliable** on loosely-worded queries — one query wandered to 0 citations after 31 tool_calls and blew the 120s timeout; four others returned **hallucinated, non-existent paths** (e.g. `git2-rs/src/lib.rs:1-1000`, `agentfs/README.md`). A naive byte-delta on that set would read ~99.8% "savings" — **explicitly NOT the headline**, because it rests on empty/fabricated citations. This is recorded transparently, following the 06-SPIKE precedent of noting caveats without gating the verdict.
- **SC-3 live run:** exercised the identical tool-call surface the `/context-explore` command wraps (same explicit `repo_root` a `git rev-parse` resolution produces), disclosed as `/context-explore`-equivalent rather than a literal command-line invocation.

## 4. Requirements Coverage

All 7 v1.2 requirements validated (source: `.planning/REQUIREMENTS.md`, 100% traceable to phases):

- ✅ **CTX-01** — `context_explore` MCP tool takes a natural-language query and returns compact `path:line-range` citations by delegating to `token_miser explore` and parsing `Evidence` JSON — *Phase 7*
- ✅ **CTX-02** — Fails closed with a clear error when the binary is missing/misconfigured/times-out/emits malformed output — never a silent empty-success — *Phase 7*
- ✅ **CTX-03** — Configured provider-neutrally via environment only; no endpoint/model/API-key/host/vendor default committed anywhere in `src/` or `docs/` (grep-audited) — *Phase 7*
- ✅ **CTX-04** — Context exploration invocable on demand from a Claude Code command — *Phase 8*
- ✅ **CTX-05** — Same, from an OpenCode command, installed via a `sync-opencode-*-assets.sh` script (parity with Claude) — *Phase 8*
- ✅ **CTX-06** — FastContext tool-call reliability probed and documented against the deployed GGUF quant + `llama-server --jinja` (real `tool_calls`, not narration) before any wiring — *Phase 6*
- ✅ **CTX-07** — Token-savings value proven by a measured before/after A/B on cairnkeep's own harness against a real bootstrapped project (its own number, not the paper figure) — *Phase 9*

## 5. Key Decisions Log

| ID | Decision | Rationale | Phase |
|----|----------|-----------|-------|
| Arch | `context_explore` is a thin subprocess adapter over `token_miser explore`, not a reimplementation | token-miser owns/tests the loop in Rust; delegation keeps vendor config out of the core | 7 |
| CTX-03 | Env-only, provider-neutral config (`CAIRN_EXPLORE_BINARY`, `CAIRN_EXPLORE_REPO_ROOT`) | Honors LOCKED `DEC-no-private-references`; keeps the core swappable | 7 |
| D-04 (P7) | Hybrid fail-closed contract: throw on config errors, return `{ok:false}` on execution errors, `ok:true` on empty-success | A silent empty-success on a broken backend is indistinguishable from "nothing found" | 7 |
| D-01 (P7) | Resolve repo root: per-call `repo_root` → env → throw; absolute-path resolved | MCP server cwd is `infraRoot`, not the target repo | 7 |
| D-03 (P7) | No `top_k` input param | The `explore` CLI has no such flag — a dead param (YAGNI) | 7 |
| D-02 (P8) | Operating-layer commands surface citations only; Read/Grep/Glob excluded from `allowed-tools` | Auto-reading citations spends the exact tokens the tool exists to save | 8 |
| D-01 (P8) | Direct inline MCP call, no paired sub-agent | The tool already returns final citations; an agent would only relay them | 8 |
| D-04 (P8) | Dedicated sync script; CI parity as documentation, not a new CI job | No sibling sync script has real CI wiring; inventing one adds unmatched scope | 8 |
| D-05 (P6) | Reliability verdict anchors on the per-turn `tool_calls` matrix; `/props` field is evidence-only | `chat_template_tool_use` is absent *by architecture* for this GGUF, not a defect | 6 |
| D-06 (P6) | Strict ~100%-at-raw-API bar | For a 4B quant, anything short of 100% at curl level is a red flag (OCP-04 memory) | 6 |
| D-01/D-01a (P9) | Deterministic committed harness; byte delta is ground truth, `chars/4` a reported estimate | A live-agent-both-sides measurement drifts every run; no vendor tokenizer, per DEC-no-private-references | 9 |
| D-03 (P9) | Record + net-savings gate on aggregate bytes; headline = verified tight queries, not the naive broad-set number | The broad-set ~99.8% rests on hallucinated citations — honest reporting over a flattering figure | 9 |

## 6. Tech Debt & Deferred Items

**Accepted residual risks (documented, non-blocking):**

- **Unreachable-but-configured endpoint** (T-07-06 / Pitfall #1) — exit 0 + empty `Evidence` looks identical to a genuine empty result. Mitigated only by surfacing `stats.turns`/`stats.tool_calls` in the empty-citation text. Fully closing it means re-implementing the explorer loop (out of scope for a thin adapter).
- **`runCommand` 12,000-char stdout truncation** (pre-existing) — a very large `Evidence` payload can truncate mid-JSON and be reported as `ok:false` ("malformed Evidence JSON"). Fail-closed (never a silent wrong-success), but a real limit for large result sets.
- **Small-model unreliability on broad queries** (P9 D-01) — the 4B FastContext quant wanders to the turn cap or fabricates non-existent paths on loosely-worded queries. The tool is reliable on *specific* queries; broad-query robustness depends on a larger/better model, not cairnkeep code.
- **A/B harness self-referential contamination** (P9, info) — the harness header and `09-AB.md` contain the literal grep patterns as prose, so a later `--native` broad-set run can pick up the doc's own text as extra hits (observed: a 33-byte drift). Does not affect the CTX-07 headline (tight queries use different patterns) or the PASS verdict.

**Deferred to future milestones (from PROJECT.md / REQUIREMENTS.md):**

- **CTX-F1** — memory-aware exploration (cross-reference citations against `memory_search` / wiki-query hits)
- **CTX-F2** — pre-task hook auto-invoke of exploration (fresh-task-only, reusing OCP-01/02 hook infra)
- **CTX-F3** — result caching keyed on (query, repo HEAD/dirty-state)
- **TMISER-R1** — token-miser's HTTP routing-proxy surface (tiering, semantic router) — distinct from `context_explore`'s subprocess delegation
- **Enterprise overlay** — organization-specific launchers/config; private-only, never in this repo

**Lessons carried forward (RETROSPECTIVE.md, cross-milestone):**

1. Verification by execution beats a paper trail — run the build + smoke suite (and, here, a committed re-runnable probe).
2. Fail closed on any opt-in network/subprocess surface.
3. Trust only structural, server-side evidence when verifying against a variable-reliability local model — not grep matches on model free-text. v1.2's tight-vs-broad A/B split is this lesson applied: the headline rests on independently-verified citations, and hallucinated broad-set output is disclosed, never counted.

## 7. Getting Started

**Run the MCP server & tests** (from `mcp-memory-server/`):

```bash
npm run build          # tsc
npm test               # build + full smoke suite (test:smoke)
npm run check:explore-guard   # the offline context_explore fail-closed guard
```

The smoke suite chains: `check:embeddings`, `check:extract`, `check:scope-guard`, `check:http-guard`, `check:explore-guard`.

**Exercise the v1.2 verification probes** (from repo root; all have offline modes needing no backend):

```bash
scripts/verify-fastcontext-reliability.sh --self-test   # offline; reliability probe logic
scripts/verify-token-savings-ab.sh --self-test          # offline; A/B arithmetic + gate
scripts/verify-token-savings-ab.sh --native --repo .    # deterministic offline "before" side
```

The live modes (`--props-only` / `--full` for the reliability probe; `--full` for the A/B) need an operator-provided FastContext endpoint (via `FASTCONTEXT_PROBE_URL`) and the `token_miser` binary (via `CAIRN_EXPLORE_BINARY`, or on `PATH`) — loopback-only, nothing committed.

**Use context exploration** (after `token_miser` + a FastContext endpoint are configured):

- Claude Code: `/context-explore <natural-language query>`
- OpenCode: same command, installed via `scripts/sync-opencode-explore-assets.sh --apply`

**Key directories:**

- `mcp-memory-server/` — the `cairn-memory` MCP server (tool registration in `src/index.ts`)
- `scripts/` — `sync-*-assets.sh` installers and `verify-*.sh` probes
- `claude/` + `opencode/` — the operating layer (commands, agents, hooks, plugins)
- `bin/cairn` + `templates/` — the CLI and project scaffolding
- `docs/operating.md` — the operating guide

**Where to look first for v1.2:** `mcp-memory-server/src/index.ts` (the `context_explore` registration + `renderCitations()` + `runCommand`), then `claude/commands/context-explore.md`, then `.planning/phases/09-.../09-AB.md` for the measured value proof.

---

## Stats

- **Timeline:** 2026-07-04 → 2026-07-06 (3 days)
- **Phases:** 4 / 4 complete (Phases 6–9)
- **Plans:** 8 / 8 complete
- **Commits:** 79 (v1.2 scope)
- **Source footprint:** ~13 files, +1,760 / −25 lines (churn concentrated in `scripts/`, then `mcp-memory-server/`, `opencode/`, `claude/`, `docs/`)
- **Contributors:** Stefano Tondo
- **Milestone tag:** none yet — complete but not archived/tagged (v1.0.0 and v1.1 are the prior baselines)
