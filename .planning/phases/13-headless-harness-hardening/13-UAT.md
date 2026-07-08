---
status: testing
phase: 13-headless-harness-hardening
source: [13-VERIFICATION.md]
started: 2026-07-08T14:44:34Z
updated: 2026-07-08T14:44:34Z
---

## Current Test

number: 1
name: Live 5/5 round-trip soak
expected: |
  5 consecutive `[repeat:i/5] PASS (retries=N)` rows followed by
  `[repeat] 5/5 PASSED` and `[repeat] OK: 5/5 consecutive round-trips`,
  exit code 0.
awaiting: user response

## Tests

### 1. Live 5/5 round-trip soak

Run `scripts/verify-opencode-live-parity.sh --repeat 5` in an environment with
`CAIRN_LLM_API_KEY` / `CAIRN_LLM_API_URL` / `CAIRN_LLM_EXTRACTION_MODEL` set to
a no-thinking, tool-call-reliable local model (e.g. qwen3.5-27b), and confirm
the output ends with `[repeat] OK: 5/5 consecutive round-trips`.

expected: 5 consecutive `[repeat:i/5] PASS (retries=N)` rows followed by `[repeat] 5/5 PASSED` and `[repeat] OK: 5/5 consecutive round-trips`, exit code 0.
result: [pending]

### 2. Retry-absorption evidence

Inspect the `retries=` column across the 5 iterations of a live `--repeat 5`
run for at least one non-zero value that still resulted in PASS.

expected: At least one iteration shows retries>0 with an eventual PASS, demonstrating the retry logic absorbed real opencode run-completion flakiness without an operator intervening — OR all 5 iterations show retries=0, which is also an acceptable (if less demonstrative) passing outcome.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
