# Phase 7: context_explore MCP Tool - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-04
**Phase:** 7-context-explore-mcp-tool
**Areas discussed:** Repo-root resolution, Citation richness, Tool input surface, Error-return contract

---

## Repo-root resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Param + env fallback | Optional repo_root param → env CAIRN_EXPLORE_REPO_ROOT → error. Caller usually knows the repo; env covers unattended use; honors CTX-03. | ✓ |
| Env-only | Repo only from CAIRN_EXPLORE_REPO_ROOT, no per-call param. Simplest, but every caller must set env first. | |
| Param required | repo_root mandatory tool arg, no env. Most explicit, but breaks env-only framing. | |

**User's choice:** Param + env fallback
**Notes:** MCP server cwd is infraRoot, not the target repo, so a cwd default would explore the wrong tree — hence explicit resolution required.

---

## Citation richness

| Option | Description | Selected |
|--------|-------------|----------|
| Compact text + full structured | text = compact path:line-range list (lean); structuredContent = full Evidence passthrough (lossless). Mirrors existing tools. | ✓ |
| Bare path:line-range only | Drop everything except path:line-range in both outputs. Leanest, but loses snippet/relevance. | |
| Inline snippet + relevance | Snippet + score inline. Richest, but heavier tokens — works against savings goal. | |

**User's choice:** Compact text + full structured
**Notes:** This is the token-economy lever the milestone exists for; dual output keeps the agent-facing text lean while preserving data for programmatic callers.

---

## Tool input surface

| Option | Description | Selected |
|--------|-------------|----------|
| query + repo_root + timeout | query (required), optional repo_root, optional timeout_seconds. No top_k (defer/YAGNI). | ✓ |
| query only | Everything else from env/defaults. Leanest, but no per-call timeout control. | |
| Full knobs | query + repo_root + timeout + top_k. Max flexibility, but top_k unverified against token_miser. | |

**User's choice:** query + repo_root + timeout
**Notes:** top_k deferred until token_miser explore is confirmed to support it — avoid a dead param.

---

## Error-return contract

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid (throw config / struct exec) | Throw on precondition/config (not-configured, binary-missing) like callLLM; structured {ok:false} on execution failures like domain_knowledge_sync. Matches both existing patterns. | ✓ |
| Always throw | Every error path throws. Uniform, but less structured detail for callers. | |
| Always structured {ok:false} | Never throw. Uniform for callers, but diverges from env-guard-throws convention in index.ts. | |

**User's choice:** Hybrid (throw config / struct exec)
**Notes:** index.ts already does both patterns; the hybrid matches each to its natural error class. Empty-but-successful exploration stays ok:true, never conflated with failure.

---

## Claude's Discretion

- Exact `token_miser explore` CLI argument shape — resolve during research against sibling token-miser repo.
- How the Evidence block is located in stdout — implementation detail for researcher/planner.
- Env var name for the binary path — pick consistent with CAIRN_* conventions.

## Deferred Ideas

- `top_k` / result-count knob — deferred until token_miser explore support confirmed.
- Operating-layer wiring (Claude Code + OpenCode commands) — Phase 8 (CTX-04, CTX-05).
- Token-savings A/B measurement — Phase 9 (CTX-07).
