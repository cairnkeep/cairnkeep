---
status: testing
phase: 08-operating-layer-wiring
source: [08-VERIFICATION.md]
started: 2026-07-05T20:30:00Z
updated: 2026-07-05T20:30:00Z
---

## Current Test

number: 1
name: Live end-to-end /context-explore invocation
expected: |
  The response surfaces real path:line-range citations (or the documented
  zero-citation note `(no citations found; turns=N, tool_calls=N)`), not a
  stub or error, sourced from a live token_miser explore invocation — and the
  command does not itself read/summarize the cited files.
awaiting: user response

## Tests

### 1. Live end-to-end /context-explore invocation
expected: |
  Run `/context-explore "<some real repo-exploration query>"` from a live
  Claude Code or OpenCode session, with `CAIRN_EXPLORE_BINARY` configured,
  against a bootstrapped project. The command output shows real
  `path:line-range` citations (or the documented zero-citation note), sourced
  from a real token_miser explore invocation, not a stub.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
