---
status: testing
phase: 10-routing-seam
source: [10-VERIFICATION.md]
started: 2026-07-06T17:00:47Z
updated: 2026-07-06T17:00:47Z
---

## Current Test

number: 1
name: D-06 live-proof operator sign-off — run verify-routing-seam.sh against the real token_miser binary
expected: |
  `[health] OK: real token_miser binary answered GET /health with status ok` printed, exit 0,
  and no lingering `token_miser` process after the run (clean trap teardown).
awaiting: user response

## Tests

### 1. D-06 live-proof operator sign-off
expected: Operator (not the executing agent) runs `bash scripts/verify-routing-seam.sh` with the real token_miser binary present and independently confirms a genuine 200 /health — `[health] OK: real token_miser binary answered GET /health with status ok`, exit 0, no lingering `token_miser` process afterward. (On a machine without the binary, confirm it fails loud: nonzero exit + explicit not-found message, never a silent pass.)
result: [pending]

### 2. SC #3 cold-read doc-sufficiency review
expected: Read the "Routing seam (`route_check`, opt-in)" subsection of `docs/operating.md` cold and confirm it alone is sufficient for an external/private overlay to wire `CAIRN_ROUTE_ENDPOINT` and call `route_check` without opening `mcp-memory-server/src/index.ts`. The subsection must name the tool, its single env key, the exact `GET {endpoint}/health` call, all three tier shapes (precondition throw / execution `{ok:false}` / success `{ok:true, status, cluster_healthy}`), and the does-NOT clause — with nothing left to infer from source.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
