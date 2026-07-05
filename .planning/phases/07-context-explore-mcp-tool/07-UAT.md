---
status: passed
phase: 07-context-explore-mcp-tool
source: [07-VERIFICATION.md]
started: 2026-07-04T23:56:56Z
updated: 2026-07-05T00:40:00Z
---

## Current Test

number: 1
name: SC-1 live repo query — context_explore returns compact citations from a real token_miser + FastContext endpoint
expected: |
  Tool returns compact `path:line-range` citations in `content` text and the full
  `Evidence` JSON in `structuredContent`.
awaiting: none (passed)

## Tests

### 1. SC-1 live repo query
expected: |
  Stand up a real `token_miser` binary with a reachable FastContext endpoint, set
  `CAIRN_EXPLORE_BINARY` (and `CAIRN_EXPLORE_REPO_ROOT`, or pass a `repo_root` arg),
  then invoke `context_explore` via an MCP client with a natural-language query against
  a real repo. It returns compact `path:line-range` citations in `content` text plus the
  full `Evidence` JSON in `structuredContent`.
result: passed
evidence: |
  Executed 2026-07-05 against a live setup: token_miser built from source
  (cargo 1.96.1, release) and a locally-served FastContext GGUF (llama.cpp server,
  --jinja, q4_0 KV cache). Drove `context_explore` through the built cairn-memory
  MCP server over stdio with CAIRN_EXPLORE_BINARY pointed at the real binary.
  Query "Where is the configuration TOML file loaded and parsed?" against the
  token-miser repo returned:
    - content text: "src/config.rs:1-100"  (compact path:line-range — CTX-01)
    - structuredContent: { ok: true, citations: [src/config.rs:1-100],
      stats: { turns: 11, tool_calls: 20, hit_turn_cap: false, expanded_lines: 100 } }
    - isError: false; all assertions (ok===true, citations>=1, compact
      path:line-range present) passed.
  A direct `token_miser explore` run was also confirmed (citation src/config.rs:394-400,
  turns=2, tool_calls=4). The FastContext model reliably emits tool_calls (Phase 6
  GO verdict holds live through the tool). No endpoint URL / model / key committed
  (CTX-03 preserved).

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
