---
status: testing
phase: 07-context-explore-mcp-tool
source: [07-VERIFICATION.md]
started: 2026-07-04T23:56:56Z
updated: 2026-07-04T23:56:56Z
---

## Current Test

number: 1
name: SC-1 live repo query — context_explore returns compact citations from a real token_miser + FastContext endpoint
expected: |
  Tool returns compact `path:line-range` citations in `content` text and the full
  `Evidence` JSON in `structuredContent`, matching the parsing/rendering logic already
  verified by code inspection and the offline `fake-tokenmiser-cited.sh` smoke case.
awaiting: user response

## Tests

### 1. SC-1 live repo query
expected: |
  Stand up a real `token_miser` binary with a reachable FastContext endpoint, set
  `CAIRN_EXPLORE_BINARY` (and `CAIRN_EXPLORE_REPO_ROOT`, or pass a `repo_root` arg),
  then invoke `context_explore` via an MCP client with a natural-language query against
  a real repo. It returns compact `path:line-range` citations in `content` text plus the
  full `Evidence` JSON in `structuredContent`, matching the offline `fake-tokenmiser-cited.sh`
  smoke case behavior.
why_human: |
  SC-1 requires a live external `token_miser` binary and a reachable FastContext endpoint,
  neither of which exists in the offline/CI verification environment. 07-VALIDATION.md
  §"Manual-Only Verifications" designates this as operator UAT, not a CI gate. The code
  path (spawn → JSON.parse → renderCitations) is verified by inspection and exercised
  offline by the populated-citation fixture. Recommended before Phase 9's A/B token-savings
  measurement.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
