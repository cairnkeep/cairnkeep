---
status: complete
phase: 13-headless-harness-hardening
source: [13-VERIFICATION.md]
started: 2026-07-08T14:44:34Z
updated: 2026-07-08T15:20:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Live 5/5 round-trip soak

Run `scripts/verify-opencode-live-parity.sh --repeat 5` in an environment with
`CAIRN_LLM_API_KEY` / `CAIRN_LLM_API_URL` / `CAIRN_LLM_EXTRACTION_MODEL` set to
a no-thinking, tool-call-reliable local model (e.g. qwen3.5-27b), and confirm
the output ends with `[repeat] OK: 5/5 consecutive round-trips`.

expected: 5 consecutive `[repeat:i/5] PASS (retries=N)` rows followed by `[repeat] 5/5 PASSED` and `[repeat] OK: 5/5 consecutive round-trips`, exit code 0.
result: pass
evidence: |
  Run 2026-07-08 against local qwen3.5-27b (llama.cpp, no-thinking, tool-calls)
  at CAIRN_LLM_API_URL=http://127.0.0.1:8001/v1, opencode-ai 1.17.15.
  [preflight] OK: model made a genuine tool call
  [repeat:1/5] PASS (retries=0)
  [repeat:2/5] PASS (retries=0)
  [repeat:3/5] PASS (retries=0)
  [repeat:4/5] PASS (retries=0)
  [repeat:5/5] PASS (retries=0)
  [repeat] 5/5 PASSED
  [repeat] OK: 5/5 consecutive round-trips
  Exit code 0.
  Note: "FATAL: real ~/.claude changed during the run" fired as a false
  positive -- the run was driven from inside a live Claude Code session whose
  transcript writes under ~/.claude trip the mtime fingerprint. The real
  OpenCode config guard did NOT fire (opencode stayed fully isolated in the
  scratch HOME).

### 2. Retry-absorption evidence

Inspect the `retries=` column across the 5 iterations of a live `--repeat 5`
run for at least one non-zero value that still resulted in PASS.

expected: At least one iteration shows retries>0 with an eventual PASS, demonstrating the retry logic absorbed real opencode run-completion flakiness without an operator intervening -- OR all 5 iterations show retries=0, which is also an acceptable (if less demonstrative) passing outcome.
result: pass
evidence: All 5 iterations showed retries=0 with PASS -- the acceptable (less demonstrative) outcome named in the expected criteria. No retry was needed; no operator intervention occurred.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

