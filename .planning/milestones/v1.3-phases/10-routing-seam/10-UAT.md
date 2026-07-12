---
status: complete
phase: 10-routing-seam
source: [10-VERIFICATION.md]
started: 2026-07-06T17:00:47Z
updated: 2026-07-06T17:22:33Z
---

## Current Test

[testing complete]

## Tests

### 1. D-06 live-proof operator sign-off
expected: Operator (not the executing agent) runs `bash scripts/verify-routing-seam.sh` with the real token_miser binary present and independently confirms a genuine 200 /health — `[health] OK: real token_miser binary answered GET /health with status ok`, exit 0, no lingering `token_miser` process afterward. (On a machine without the binary, confirm it fails loud: nonzero exit + explicit not-found message, never a silent pass.)
result: pass
evidence: |
  Ran `bash scripts/verify-routing-seam.sh` against the real binary present at the
  default CAIRN_ROUTE_BINARY path. Observed the real Axum server boot
  ("Starting server on 0.0.0.0:8080"), then `[health] OK: real token_miser binary
  answered GET /health with status ok`, exit 0. After the run port 8080 was free and
  GET /health no longer answered — clean EXIT-trap teardown (the pgrep self-match was
  the shell command line, not the binary). Fail-loud path confirmed:
  `CAIRN_ROUTE_BINARY=/nonexistent bash scripts/verify-routing-seam.sh` printed the
  explicit FATAL not-found message and exited 1 (never a silent pass).

### 2. SC #3 cold-read doc-sufficiency review
expected: Read the "Routing seam (`route_check`, opt-in)" subsection of `docs/operating.md` cold and confirm it alone is sufficient for an external/private overlay to wire `CAIRN_ROUTE_ENDPOINT` and call `route_check` without opening `mcp-memory-server/src/index.ts`. The subsection must name the tool, its single env key, the exact `GET {endpoint}/health` call, all three tier shapes (precondition throw / execution `{ok:false}` / success `{ok:true, status, cluster_healthy}`), and the does-NOT clause — with nothing left to infer from source.
result: pass
evidence: |
  Cold-read of docs/operating.md:109-134 (without opening src/index.ts). All required
  elements present: tool name (`route_check`), single env key (`CAIRN_ROUTE_ENDPOINT`),
  exact call (`GET {CAIRN_ROUTE_ENDPOINT}/health` + timeout_seconds default 10s), all
  three tier shapes (throw on unset/malformed; `{ok:false, error}` on execution failure;
  `{ok:true, status, cluster_healthy}` on success), and the does-NOT clause (no
  /v1/chat/completions|/v1/messages driving, no tier reporting). States "This is the full
  contract; no source reading required." Sufficient to wire an overlay without reading src/.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
