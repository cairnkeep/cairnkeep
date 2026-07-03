---
phase: 05-live-opencode-parity-verification
plan: 02
subsystem: infra
tags: [opencode, verification, harness, mcp, memory-capture, live-model-reliability]

# Dependency graph
requires:
  - phase: 05-live-opencode-parity-verification
    provides: "05-01's scratch-isolated harness scaffold (setup_scratch, seed_canary, install_assets, write_scratch_config, positive_load_check, cleanup) plus the confirmed session.idle and sessionID-field findings"
provides:
  - "run_stage_wakeup / run_stage_recall_edit / run_stage_capture / run_stage_remember_recall / run_negative_controls / main() (--stage, --full) added to scripts/verify-opencode-live-parity.sh, exercised live against the registered cairn-memory MCP"
  - "A genuine memory-capture.ts defect found and fixed: the shared extract subprocess's stdin-writer path (\`\$\`...\`.stdin.getWriter()\`) is undefined at runtime in this OpenCode build, so capture was silently no-oping on every single session end via the outer fail-open catch"
  - "A genuine opencode CLI limitation found and worked around at the harness level (no plugin/server change): bare \`opencode run\` kills its whole process (including in-flight child processes spawned by plugin event handlers) as soon as its own turn finishes, without waiting for session.idle's async extract call to settle; worked around via \`opencode serve\` + \`opencode run --attach\`"
  - "A discovered live-model reliability limitation: /remember reliably drives a real cairn-memory_memory_write tool call; /recall did not drive a real cairn-memory_memory_search/_read tool call in any of ~9 live attempts against the configured local model, while the endpoint was independently confirmed reachable"
affects: [05-03-interactive-session-and-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "opencode serve + opencode run --attach <url> as the pattern for testing any OpenCode plugin behavior gated on an async post-turn event (session.idle), since bare `opencode run` does not outlive its own turn"
    - "Never include literal `<...>` angle-bracket placeholder syntax in an opencode run prompt — live testing this phase found it hangs the CLI indefinitely with zero output, reproduced twice, unrelated to model/timeout"
    - "node:child_process spawn-based stdin piping for a plugin's own subprocess calls, in place of the @opencode-ai/plugin `$` BunShell helper's .stdin, which this build does not implement functionally"

key-files:
  created: []
  modified:
    - scripts/verify-opencode-live-parity.sh
    - opencode/plugins/memory-capture.ts

key-decisions:
  - "memory-capture.ts's stdin-writer bug is fixed in-scope per D-03/OCP-06's defect clause (a genuine, 100%-reproducible crash, not the double-fire pitfall 05-01 already ruled out) — replaced with a small node:child_process helper; type-checks clean via the 04-05 scratch-tsc precedent"
  - "The opencode-run-kills-pending-async-work limitation is NOT fixed in the plugin (no plugin-side code can outrun an external process kill); worked around at the harness level via opencode serve + --attach, confirmed live"
  - "requirements-completed is intentionally left empty, mirroring 05-01's own precedent — OCP-06 is only fully proven once 05-03's interactive session and UAT compilation complete; recall's live-model reliability gap (below) is an open item for 05-03 to carry forward, not something 05-02 can resolve in a scripted harness"
  - "The plan's own automated verify command for Task 1/2 checked literally for the string '--auto' / ran 'npx --prefix opencode tsc'; both predate 05-01's live findings (no opencode/package.json exists; the real flag is --dangerously-skip-permissions). Verified functional intent instead: grep for --dangerously-skip-permissions, and a scratch-tsc typecheck (04-05 precedent) in place of the non-functional npx command"

patterns-established:
  - "Bounded-retry (2-3 attempts) around any live-model-driven assertion where a scripted single-shot prompt cannot rely on 100% correct tool-call formatting from the configured local reasoning model"

requirements-completed: []

coverage:
  - id: D1
    description: "run_stage_wakeup: OCP-05 re-confirmed live in this phase's own scratch env (explicit-recite + natural-framing FOUND, unseeded NOT-FOUND)"
    requirement: "OCP-06"
    verification:
      - kind: manual_procedural
        ref: "Live opencode run against a seeded and an unseeded scratch project this session; raw JSON evidence quoted below"
        status: pass
    human_judgment: false
  - id: D2
    description: "run_stage_recall_edit: stem-matching file edit throws the injected 'Memory recall' context with the seeded fact; non-matching file and unseeded control stay silent"
    requirement: "OCP-06"
    verification:
      - kind: manual_procedural
        ref: "Live opencode run tool_use event captured with state.status=error and the injected Memory recall context; raw evidence quoted below. Later same-session repeats degraded as the local model endpoint went down mid-session (see Issues Encountered) — mechanism is proven correct with concrete evidence, not asserted as 100%-reliable per invocation."
        status: pass
    human_judgment: true
    rationale: "The underlying mechanism is proven with direct evidence, but live-model response reliability (not the plugin/harness) varies run to run; a human (05-03) should re-confirm in an interactive session per D-01's fallback clause."
  - id: D3
    description: "memory-capture.ts stdin-writer crash found and fixed (TypeError on every invocation); capture stage passes end to end via the opencode-serve + --attach harness pattern"
    requirement: "OCP-06"
    verification:
      - kind: manual_procedural
        ref: "Instrumented debug run isolated the exact TypeError; post-fix live run staged a real candidates JSON containing the turn's canary after the fix, confirmed via opencode serve + --attach"
        status: pass
    human_judgment: false
  - id: D4
    description: "run_stage_remember_recall: /remember performs a live cairn-memory_memory_write call and captures the sessionID"
    requirement: "OCP-06"
    verification:
      - kind: manual_procedural
        ref: "Live opencode run JSON stream showing a completed cairn-memory_memory_write tool_use event and an extracted sessionID, reused successfully for --session continuation"
        status: pass
    human_judgment: false
  - id: D5
    description: "run_stage_remember_recall: /recall on the continued session retrieves the canary via a live cairn-memory_memory_search/_read call"
    requirement: "OCP-06"
    verification:
      - kind: manual_procedural
        ref: "~9 live attempts (literal /recall, --command recall, and direct imperative prompts) against the reachable, responsive local model; none drove a real memory_search/_read tool call — the model narrated an intended search or emitted malformed pseudo-tool text instead"
        status: fail
    human_judgment: true
    rationale: "This is a discovered reliability limitation of the configured local model for read-oriented MCP tool invocation in headless `opencode run`, not a defect in recall.md, the cairn-memory server, or this harness (write-oriented calls — write, memory_write — were reliable throughout). Requires either a different/more capable model, or a human steering the model in 05-03's interactive session (D-01's explicit fallback clause), to close out OCP-03/OCP-04's read-back half."

duration: 79min
completed: 2026-07-03
status: complete
---

# Phase 05 Plan 02: Capture, Remember/Recall, Negative Controls Summary

**Extended the harness with all four remaining live stages, fixed a genuine memory-capture.ts crash (broken stdin-writer path) and a genuine opencode-run process-exit race via an opencode-serve/--attach harness pattern, and discovered a live-model reliability gap in read-oriented MCP tool calls that 05-03 must carry forward.**

## Performance

- **Duration:** 79 min
- **Started:** 2026-07-03T18:16:22Z (approx, first live endpoint check)
- **Completed:** 2026-07-03T19:35:42Z
- **Tasks:** 3 (all `type="auto"`)
- **Files modified:** 2 (`scripts/verify-opencode-live-parity.sh`, `opencode/plugins/memory-capture.ts`)

## Accomplishments

- **Task 1 — wakeup + recall-on-edit stages, both proven live with concrete evidence.**
  - `run_stage_wakeup`: explicit-recite and natural-framing prompts both surfaced the seeded canary in the seeded scratch project; the unseeded negative control returned NOT-FOUND with no canary-shaped leak. Confirmed multiple times.
  - `run_stage_recall_edit`: a stem-matching file edit produced a `tool_use` event with `state.status: "error"` whose `error` field was exactly the plugin's injected `"Memory recall (auto-injected for this file edit):\n\n## Relevant project memory for ocp-06-canary-fact.md\n\n- ocp-06-canary-fact: OCP-06-CANARY-..."` context; a non-matching-file edit and the unseeded control both stayed silent.
  - **Found and fixed a real prompt-authoring hazard**: a prompt containing literal `<...>` angle-bracket placeholder syntax hangs the installed CLI indefinitely (reproduced twice, unrelated to model load/timeout) — every prompt in the harness avoids this syntax.
- **Task 2 — a genuine memory-capture.ts defect found and fixed, plus a genuine opencode CLI limitation discovered and worked around at the harness level.**
  - Instrumented debug logging (a throwaway probe patch to the scratch-installed copy of the plugin, never the repo file) isolated the exact failure: `const writer = shellPromise.stdin.getWriter()` throws `TypeError: undefined is not an object (evaluating 'shellPromise.stdin.getWriter')` on every single invocation. Capture had been silently no-oping end to end since day one via the outer fail-open catch — 05-01's session.idle finding (fires once, always after real messages) was correct, but the extract call itself never ran.
  - Fixed by replacing the `$`...`` BunShell-helper stdin path with a small `node:child_process`-based `runExtract()` helper. Type-checks clean (scratch-tsc, 04-05 precedent).
  - **Separately discovered a process-exit race**: even after the stdin fix, a bare `opencode run` invocation kills its entire process — including any still-running child process a plugin's `event` handler spawned — the instant its own turn finishes, without waiting for `session.idle`'s async work to settle. An instrumented run showed the extract subprocess spawn successfully and then die before its `"close"` event could fire, despite the whole `opencode run` call completing in ~3s wall-clock. This is a genuine limitation of the CLI's headless process lifecycle, not fixable from inside a plugin.
  - Worked around at the harness level only (no plugin/server contract change): `opencode serve` starts a persistent headless server; `opencode run --attach <url>` drives it as a client whose own exit does not kill the server. Confirmed live: with `--attach`, the extract subprocess's `"close"` event fired ~8s after the triggering turn — well after the `run` client itself had already exited — and a real staged candidates JSON containing the turn's canary appeared.
- **Task 3 — remember->recall stage, negative-control sweep, and main() runner added; a genuine live-model reliability gap discovered for the recall half.**
  - `/remember`-style prompts reliably drove a real `cairn-memory_memory_write` tool call in every instance observed, and the session ID was successfully extracted from the JSON stream's `sessionID` field (05-01's finding) for `--session` continuation.
  - `/recall`-style prompts (the literal `/recall` command, `--command recall`, and several direct imperative rephrasings) did **not** drive a real `cairn-memory_memory_search`/`_read` tool call in any of roughly 9 live attempts, while the local model endpoint was independently confirmed reachable and responsive throughout most of those attempts. The model instead narrated an intended search, printed a markdown code fence with pseudo-tool syntax, or (once) emitted a hallucinated `<|tool_redacted>` token. This reproduced with a fresh, uncluttered scratch project too, ruling out directory-state confusion.
  - This is documented as a discovered reliability limitation of the configured local reasoning model (`qwen3.6-27b-coder`, NVFP4-quantized) for read-oriented MCP tool invocation in headless `opencode run` — not a defect in `recall.md`, the `cairn-memory` server, or this harness. `run_stage_remember_recall`'s bounded retry (3 attempts) is a good-faith attempt; its FAIL path reports this distinctly so 05-03's interactive session (D-01's explicit fallback clause) can attempt the same round trip with a human steering the model in real time.
  - `run_negative_controls()` and `main()`'s `--stage`/`--full` modes were added and exercise the full suite in one pass.
- **Mid-session infrastructure outage**: partway through Task 3's live testing, the local model endpoint (`127.0.0.1:8001`) stopped accepting connections (`Connection refused`, confirmed via `curl -v`) and did not recover within this session's remaining time (checked repeatedly over ~1 minute of waiting). This is an operator-side inference-service issue outside this executor's ability or mandate to restart (matches the plan's own `user_setup` precedent — provisioning/restarting the local model endpoint is the operator's responsibility). As a result, Task 3's code was written and statically verified (`bash -n`, function-presence greps) but **not** re-exercised live end-to-end after the outage; the negative-control sweep and a full `main --full` run remain to be executed once the endpoint is confirmed reachable again (a fast, cheap re-check — `curl -s "$CAIRN_LLM_API_URL/models"` — before re-running `bash scripts/verify-opencode-live-parity.sh --full`).

## Task Commits

Each task was committed atomically:

1. **Task 1: wakeup + recall-on-edit stages with negative controls** — `6458978` (feat)
2. **Task 2: capture stage (memory-capture.ts stdin-writer fix + opencode-serve/--attach harness pattern)** — `ba48f29` (fix)
3. **Task 3: remember->recall round-trip + full-suite runner + negative-control sweep** — `06d3895` (feat)

**Plan metadata:** (this commit) `docs(05-02): complete capture, remember/recall, negative-control plan`

## Files Created/Modified

- `scripts/verify-opencode-live-parity.sh` — extended with `run_stage_wakeup`, `run_stage_recall_edit`, `run_stage_capture`, `run_stage_remember_recall`, `run_negative_controls`, `setup_negative_project`, `start_capture_server`/`stop_capture_server`, `extract_session_id`, `log_env_presence`, `run_opencode`, and `main()`'s `--stage`/`--full` modes (in addition to 05-01's `--setup-only`). `cleanup()` extended to stop the capture server and remove the unseeded negative-control project.
- `opencode/plugins/memory-capture.ts` — replaced the broken `$`...`` BunShell `.stdin.getWriter()` path with a `node:child_process.spawn`-based `runExtract()` helper (async, non-blocking, bounded by a timeout); dropped the now-unused `$` plugin-context binding.

## Decisions Made

- memory-capture.ts's stdin-writer crash is fixed in-scope (D-03/OCP-06's defect clause) — a genuine, 100%-reproducible bug distinct from 05-01's already-ruled-out double-fire pitfall.
- The `opencode run` process-exit race is NOT fixed in the plugin (nothing in plugin code can outrun an external process kill); the fix lives entirely in the harness (`opencode serve` + `--attach`), with no change to the plugin/server contract.
- `requirements-completed` is intentionally left empty, mirroring 05-01's own precedent: OCP-06 is only fully proven once 05-03's interactive session and UAT compilation complete, and the recall reliability gap (D5 above) is an open item to carry into that session, not something a scripted harness can resolve on its own.
- Adapted two of the plan's own literal automated-verify commands to match reality already established by 05-01: `--auto` (the plan's assumed flag, per 05-RESEARCH.md's docs-derived assumption) does not exist in the installed CLI — verified `--dangerously-skip-permissions` presence instead (05-01's confirmed real flag). `npx --prefix opencode tsc --noEmit ...` does not work in this repo (no `opencode/package.json` exists) — verified via a scratch-tsc typecheck instead, following the exact precedent set in `04-05-SUMMARY.md`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed memory-capture.ts's stdin-writer crash (capture was silently no-oping on every session end)**
- **Found during:** Task 2, via an instrumented throwaway debug-log patch to the scratch-installed copy of the plugin (never the repo file)
- **Issue:** `const shellPromise = $`node ${SERVER_ENTRY} extract ${model}`.quiet().nothrow(); const writer = shellPromise.stdin.getWriter()` throws `TypeError: undefined is not an object (evaluating 'shellPromise.stdin.getWriter')` — `.stdin` is undefined at runtime in this OpenCode build despite the `@opencode-ai/plugin` type declarations promising it. The outer try/catch (fail-open by design) swallowed this every time, so capture had never actually staged anything since the plugin was written.
- **Fix:** Replaced the extract-subprocess call with a small `node:child_process.spawn`-based `runExtract()` helper that pipes `text` to the child's stdin directly, async and non-blocking (bounded by a 120s timeout), preserving fail-open and one-attempt-per-session semantics.
- **Files modified:** `opencode/plugins/memory-capture.ts`
- **Verification:** Scratch-tsc typecheck (04-05 precedent) clean; live post-fix run staged a real candidates JSON containing the triggering turn's canary (via the `opencode serve` + `--attach` pattern — see Deviation 2).
- **Committed in:** `ba48f29` (Task 2 commit)

**2. [Rule 3 - Blocking] Worked around a discovered `opencode run` process-exit race via a harness-level `opencode serve` + `--attach` pattern**
- **Found during:** Task 2, after Deviation 1's fix — capture still didn't stage anything through bare `opencode run`
- **Issue:** Bare `opencode run` tears down its entire process (killing in-flight child processes, e.g., the extract subprocess) the instant its own turn finishes, without waiting for the plugin's `session.idle` event handler's async work to complete. Instrumented logging showed the extract subprocess spawn successfully and receive its stdin write, then simply vanish (no `"close"`/`"error"` event ever logged, process confirmed no longer running), even when an artificial-delay test (a bare `setTimeout`) was substituted for the real extract call and given 15+ seconds after process exit to fire — it never did.
- **Fix:** Added `start_capture_server()`/`stop_capture_server()` to the harness, using `opencode serve --port 0` (a persistent headless server) plus `opencode run --attach <url>` (a client that does not kill the server on exit) for the capture stage specifically. No plugin or server-contract change. Confirmed live: with `--attach`, the same extract subprocess's `"close"` event fired ~8s after the triggering turn.
- **Files modified:** `scripts/verify-opencode-live-parity.sh`
- **Verification:** Live run via the `--attach` pattern staged a real candidates JSON containing the canary, after 1-3 bounded retries (absorbing the separately-observed extraction-model reasoning-token flakiness below).
- **Committed in:** `ba48f29` (Task 2 commit)

**3. [Rule 3 - Blocking, adapted verification] Two of the plan's literal automated-verify commands did not match the installed environment**
- **Found during:** Tasks 1 and 2, running the plan's own prescribed `<verify>` commands
- **Issue:** Task 1's verify grepped literally for `--auto` (05-RESEARCH.md's docs-derived assumption, predating 05-01's live finding that the installed CLI has no such flag). Task 2's verify ran `npx --prefix opencode tsc --noEmit opencode/plugins/memory-capture.ts`, but no `opencode/package.json` exists in this repo, so `npx` prints its "this is not the tsc command you are looking for" placeholder instead of type-checking anything.
- **Fix:** Verified the equivalent, already-established-correct mechanism instead: `grep -q -- '--dangerously-skip-permissions'` (05-01's confirmed real flag) for Task 1; a scratch-tsc typecheck against a temporary copy of the plugin plus the scratch-installed `@opencode-ai/plugin` type declarations (exact precedent: `04-05-SUMMARY.md`) for Task 2.
- **Files modified:** None (verification-only adaptation, no source change beyond what's already listed above)
- **Verification:** Both adapted checks pass; documented here for traceability since they diverge from the plan's literal `<verify>` text.
- **Committed in:** N/A (verification-only; no separate commit)

---

**Total deviations:** 3 (2 auto-fixed bugs/blockers under Rules 1/3, 1 verification-command adaptation)
**Impact on plan:** Deviations 1-2 were necessary correctness fixes squarely within OCP-06's defect clause ("a genuine defect is a fix within scope") and required no server-contract or new-capability changes. Deviation 3 is process-only (adapting stale verify commands to already-established 05-01 facts), not a source change. No scope creep.

## Known Issues / Discovered Limitations

- **Live-model reliability for read-oriented MCP tool calls (recall).** Across roughly 9 live attempts using three different prompt strategies (the literal `/recall` slash command, `--command recall`, and direct imperative natural-language prompts), the configured local model (`qwen3.6-27b-coder`, NVFP4-quantized, served via a local OpenAI-compatible endpoint) never issued a real `cairn-memory_memory_search`/`_read` tool call — it consistently narrated an intended search, emitted a markdown code fence with pseudo-tool syntax, or (once) produced a hallucinated `<|tool_redacted>` token, while the endpoint was independently confirmed reachable and responsive for most of these attempts (plain-text generation and `/remember`-style write calls both remained fast and reliable in the same window). This reproduced in both a heavily-reused scratch project and a completely fresh one, ruling out directory-state confusion as the cause. This is a genuine, disclosed limitation of the chosen local model for this specific tool-calling shape, not a defect in `recall.md`, the `cairn-memory` MCP server, or this harness. Recommendation for 05-03: attempt the same remember->recall round trip in the interactive session with a human steering/re-prompting the model in real time (D-01's explicit fallback clause exists for exactly this class of gap); if it still cannot be closed, record it explicitly in `05-UAT.md` as OCP-03/OCP-04's read-back half remaining open pending a more capable/differently-tuned model.
- **Mid-session local model endpoint outage.** The local model endpoint (`http://127.0.0.1:8001/v1`) went from reachable to `Connection refused` partway through this session's Task 3 live testing and did not recover within the remaining session time (confirmed via `curl -v`, checked repeatedly). This is very likely the local vLLM/proxy backend crashing or being restarted under the sustained load of the extensive live testing this plan required (dozens of back-to-back model calls over roughly an hour) — an operator-side infrastructure concern outside this executor's mandate to restart. Task 3's code (`run_stage_remember_recall`, `run_negative_controls`, `main --full`) is written and statically verified but was not re-exercised live end-to-end after the outage.

## User Setup Required

**Before running the full suite again:** confirm the local model endpoint is reachable — `curl -s "$CAIRN_LLM_API_URL/models"` should return the configured model's metadata. If it does not, the endpoint needs to be restarted/reprovisioned by the operator (outside this executor's scope) before `bash scripts/verify-opencode-live-parity.sh --full` can be re-run to completion.

## Next Phase Readiness

- The harness (`scripts/verify-opencode-live-parity.sh`) now defines all five stage functions plus `run_negative_controls` and `main()`'s `--stage`/`--full` modes, ready for 05-03 to drive the interactive-session proof and compile `05-UAT.md`.
- Four of five stages (wakeup, recall-on-edit, capture, remember) are proven live with concrete, quoted evidence in this SUMMARY and this session's commits.
- The recall half of the remember->recall round trip (OCP-03/OCP-04) is the one open item 05-03 must carry forward, per the interactive-session fallback clause D-01 already anticipates for exactly this class of gap.
- Once the local model endpoint is confirmed reachable again, re-running `bash scripts/verify-opencode-live-parity.sh --full` gives a single green/red signal for the whole suite, including the negative-control sweep and capture stage that were written this session but not re-exercised after the outage.

---
*Phase: 05-live-opencode-parity-verification*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: scripts/verify-opencode-live-parity.sh
- FOUND: opencode/plugins/memory-capture.ts
- FOUND: 6458978 (git log --oneline --all)
- FOUND: ba48f29 (git log --oneline --all)
- FOUND: 06d3895 (git log --oneline --all)
