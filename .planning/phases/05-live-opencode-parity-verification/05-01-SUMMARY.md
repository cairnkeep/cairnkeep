---
phase: 05-live-opencode-parity-verification
plan: 01
subsystem: infra
tags: [opencode, verification, harness, mcp, session-idle, scratch-isolation]

# Dependency graph
requires:
  - phase: 04-opencode-parity-operating-layer
    provides: OpenCode plugin/command assets (memory-wakeup.ts, memory-capture.ts, memory-recall.ts, remember.md, recall.md), the scratch-HOME OCP-05 acceptance pattern, and the throwaway-probe convention (04-01)
provides:
  - session.idle characterized live against the installed OpenCode CLI (v1.17.11): fires exactly once per `opencode run` invocation, always after real user/assistant messages exist — no title-gen double-fire risk observed for this hook (unlike the confirmed system.transform double-fire)
  - the exact top-level JSON field name for the session ID in `opencode run --format json` output, confirmed live: `sessionID`
  - scripts/verify-opencode-live-parity.sh — the reusable harness scaffold (setup_scratch, seed_canary, install_assets, write_scratch_config, positive_load_check, cleanup) that 05-02 extends with stage assertions
affects: [05-02-capture-and-remember-recall-stages, 05-03-interactive-session-and-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Throwaway session.idle diagnostic probe under a scratch OPENCODE_CONFIG_DIR, never opencode/plugins/, deleted after use (mirrors 04-01's probe.ts pattern)"
    - "Scratch opencode.json fields (provider/model/apiKey/baseURL) interpolated entirely from CAIRN_LLM_* env vars at write time — never a hardcoded host/model literal in the committed script"
    - "cleanup() fingerprints the real ~/.config/opencode and ~/.claude (file path + size + mtime listing) before scratch setup and after teardown, failing loudly on any drift"

key-files:
  created:
    - scripts/verify-opencode-live-parity.sh
  modified: []

key-decisions:
  - "session.idle does NOT exhibit the system.transform double-fire class: two independent probe runs each logged exactly one session.idle fire per sessionID, with messageCount=2 (a real user+assistant pair) both times — never 0, never more than one fire. memory-capture.ts's mark-processed-before-extract dedupe is safe as-is; no in-scope fix required for this hook."
  - "The installed OpenCode CLI (v1.17.11) has no --auto flag, contradicting 05-RESEARCH.md's docs-derived assumption. The real flag for auto-approving non-denied permissions is --dangerously-skip-permissions (confirmed via opencode run --help). The harness uses this flag; write_scratch_config's permissive permission block remains as defense-in-depth."
  - "OCP-06 is NOT marked complete by this plan — this is Wave 0 (probe + scaffold only); the full round-trip proof is 05-02/05-03's scope. requirements-completed is intentionally empty here."

patterns-established:
  - "Live CLI-behavior assumptions from docs research must be re-verified against the actually-installed CLI version before being encoded into a harness (--auto vs --dangerously-skip-permissions)."

requirements-completed: []

coverage:
  - id: D1
    description: "session.idle runtime characterization: does it double-fire (title-gen sub-call + real turn, shared sessionID), and does any fire occur before real messages exist?"
    requirement: "OCP-06"
    verification:
      - kind: manual_procedural
        ref: "Throwaway probe plugin (session.idle handler logging {sessionID, messageCount, time} to a scratch log), two isolated `opencode run` invocations under a scratch HOME/OPENCODE_CONFIG_DIR — raw log evidence recorded below"
        status: pass
    human_judgment: true
    rationale: "Requires a live model-in-the-loop OpenCode session to observe real hook-firing behavior; not reducible to a deterministic script assertion (matches the Phase-4 04-01/04-06 precedent for this class of finding)."
  - id: D2
    description: "Exact JSON field name carrying the session ID in `opencode run --format json` output"
    requirement: "OCP-06"
    verification:
      - kind: manual_procedural
        ref: "Live `opencode run \"hello\" --format json | jq` inspection — every streamed event (step_start, text, step_finish, and an incidental error event) carries a top-level `sessionID` field"
        status: pass
    human_judgment: false
  - id: D3
    description: "Harness scaffold (scripts/verify-opencode-live-parity.sh) defines setup_scratch/seed_canary/install_assets/write_scratch_config/positive_load_check/cleanup and parses clean"
    requirement: "OCP-06"
    verification:
      - kind: other
        ref: "bash -n scripts/verify-opencode-live-parity.sh && grep -qE 'mktemp -d' ... && grep -q 'cairn-memory' ... && grep -q 'positive_load_check' ... (plan's own <verify> block)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-07-03
status: complete
---

# Phase 05 Plan 01: Wave-0 Diagnostic Probe + Harness Scaffold Summary

**session.idle confirmed live (v1.17.11) to fire exactly once per `opencode run`, always after real messages exist, plus the `sessionID` JSON field name — de-risking 05-02's capture and remember->recall stage design — and a scratch-isolated verify-opencode-live-parity.sh harness scaffold that registers cairn-memory as a real local MCP server.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-07-03T14:27:00Z (approx)
- **Completed:** 2026-07-03T15:22:03Z
- **Tasks:** 2 (both `type="auto"`)
- **Files modified:** 1 (`scripts/verify-opencode-live-parity.sh`)

## Accomplishments

- **Task 1 (probe) — both open questions resolved with genuine live evidence**, not assumed:
  - `session.idle` does **not** double-fire and does **not** fire before real messages exist. Two independent, isolated `opencode run` invocations (fresh scratch HOME + scratch project each time) each logged exactly one `session.idle` fire for their `sessionID`, both with `messageCount: 2` (a real user+assistant pair) — never 0, never more than one. This is a materially different result than the confirmed `system.transform` double-fire (Phase 4), so `memory-capture.ts`'s existing mark-processed-before-extract dedupe requires **no in-scope fix**.
  - The exact JSON field name for the session ID in `opencode run --format json` output is confirmed: **`sessionID`**, present as a top-level key on every streamed event (`step_start`, `text`, `step_finish`, and an incidentally-observed `error` event all carried it).
- **Task 2 — harness scaffold built and exercised**: `scripts/verify-opencode-live-parity.sh` defines `setup_scratch`, `seed_canary`, `install_assets`, `write_scratch_config`, `positive_load_check`, `cleanup`, wired behind a `--setup-only [seeded|unseeded]` entrypoint. Ran end to end in this session: scratch dirs created, a runtime-generated canary seeded into `$SCRATCH_PROJECT/.agentfs/project.db` via `agentfs-sdk`, both sync scripts applied cleanly into the scratch config, the scratch `opencode.json` written (MCP registration + provider/model/permission block interpolated from `CAIRN_LLM_*`), and `cleanup()`'s tamper-check confirmed the real `~/.config/opencode` and `~/.claude` were unmodified on every run.
- **Found and fixed a real CLI-flag mismatch** during Task 2 execution: the installed OpenCode CLI (v1.17.11) has no `--auto` flag (05-RESEARCH.md's assumption was docs-derived, not run-verified against this CLI version); the actual flag is `--dangerously-skip-permissions`, confirmed via `opencode run --help`. Fixed before commit.

## Task Commits

Each task was committed atomically:

1. **Task 1: Diagnostic probe — session.idle double-fire + session-ID field name** — no code commit (throwaway probe only, per plan; findings recorded in this SUMMARY). Probe plugin, scratch config, scratch project, and log file were all created under `mktemp -d` scratch paths and deleted after use; `opencode/plugins/` confirmed clean via `git status --porcelain opencode/plugins/`.
2. **Task 2: Harness scaffold — scratch env, cairn-memory registration, positive-load check** - `1652eb2` (feat), including the Rule-1 `--auto` -> `--dangerously-skip-permissions` fix (same commit, found before first commit of this file).

**Plan metadata:** (this commit) `docs(05-01): complete Wave-0 diagnostic probe + harness scaffold plan`

## Files Created/Modified

- `scripts/verify-opencode-live-parity.sh` - scratch-isolated harness scaffold: `setup_scratch` (mktemp -d HOME/project, exports `CAIRN_LLM_*` into the harness's own shell, `OPENCODE_CONFIG_DIR` set to the default `$SCRATCH_HOME/.config/opencode` path, EXIT trap registers `cleanup`), `seed_canary` (runtime-generated canary via `agentfs-sdk`, `seeded`/`unseeded` modes for 05-02's negative controls), `install_assets` (calls both `sync-opencode-*-assets.sh --apply --live-root`), `write_scratch_config` (writes `mcp.cairn-memory` + provider/model/permission block, all values from `CAIRN_LLM_*`), `positive_load_check` (bounded `opencode run` + grep for `cairn-memory_` tool names), `cleanup` (rm -rf scratch dirs + before/after fingerprint comparison of the real `~/.config/opencode` and `~/.claude`).

## Decisions Made

- `session.idle` runtime behavior differs from `system.transform`: no double-fire, no pre-message risk. No fix carried into 05-02 for this hook.
- Harness uses `--dangerously-skip-permissions` (the CLI's actual flag) instead of the docs-assumed `--auto`.
- `requirements-completed` is intentionally left empty — OCP-06 is only fully proven once 05-02 (capture/remember/recall stages) and 05-03 (interactive session + UAT) complete; this plan is Wave 0 only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `--auto` flag assumption — installed CLI has no such flag**
- **Found during:** Task 2 (first `--setup-only` exercise of `positive_load_check`)
- **Issue:** The script initially passed `--auto` to `opencode run` per 05-RESEARCH.md's docs-derived assumption. The installed CLI (v1.17.11) rejected it as an unknown flag, printing yargs help/usage text instead of running, so `positive_load_check`'s grep always failed regardless of MCP registration state.
- **Fix:** Confirmed via `opencode run --help` that the real flag is `--dangerously-skip-permissions` ("auto-approve permissions that are not explicitly denied"). Updated `positive_load_check` to use it; the scratch config's permissive `permission` block remains as defense-in-depth per the original design.
- **Files modified:** `scripts/verify-opencode-live-parity.sh`
- **Verification:** Re-ran `--setup-only`; the flag was accepted (no yargs usage dump) and the run proceeded to an actual model-call attempt.
- **Committed in:** `1652eb2` (fixed before the file's first commit, so it landed in the single Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule-1 bug)
**Impact on plan:** Necessary correctness fix for the harness to be usable at all; no scope creep beyond the one flag.

## Issues Encountered

- **No local OpenAI-compatible model endpoint was reachable in this execution session** (`CAIRN_LLM_API_KEY`/`CAIRN_LLM_API_URL`/`CAIRN_LLM_EXTRACTION_MODEL` are unset; `.ai/.env` does not exist in this checkout; ports checked at loopback and the operator's configured provider hosts — per DEC-no-private-references, the specific hosts checked are not named here — all refused or timed out). This is exactly the dependency the plan's `user_setup` block flags as outside Claude's ability to provision. **Consequence:** `positive_load_check`'s live cairn-memory-tool-visibility assertion could not be exercised to a PASS in this session — the harness mechanically completes every step through `write_scratch_config` and then correctly fails closed at `positive_load_check` because the scratch provider's `baseURL`/`apiKey` are empty strings (observed error: `"/chat/completions" cannot be parsed as a URL"`). This is the harness behaving correctly given missing operator-supplied credentials, not a script defect.
  - **Workaround for Task 1 only:** Task 1's probe does not require the `CAIRN_LLM_*`-configured local model specifically (its `<action>` only requires "a real conversational turn"); the installed OpenCode CLI resolved a working default network-reachable model with no explicit provider configured in the scratch config, which was sufficient to produce genuine `session.idle` evidence. This workaround does **not** apply to Task 2's `positive_load_check` or to 05-02's capture/remember/recall stages, which are explicitly scoped to the `CAIRN_LLM_*`-driven local model per D-04 and must not silently fall back to an unspecified, costed, network-hosted default.
- **Recommendation for 05-02/operator:** before 05-02 executes the live capture/remember/recall stages, the operator must ensure a local OpenAI-compatible endpoint is reachable and `CAIRN_LLM_API_KEY`/`CAIRN_LLM_API_URL`/`CAIRN_LLM_EXTRACTION_MODEL` are exported (or present in `.ai/.env`) — matching this plan's own `user_setup` block. Once available, `bash scripts/verify-opencode-live-parity.sh --setup-only` re-validates `positive_load_check` end to end.

## User Setup Required

**External local model endpoint required for full live verification.** Not yet configured in this environment:
- `CAIRN_LLM_API_KEY` — placeholder `"local"` for loopback endpoints, per Phase-4 precedent
- `CAIRN_LLM_API_URL` — base URL of a reachable OpenAI-compatible endpoint (loopback)
- `CAIRN_LLM_EXTRACTION_MODEL` — chat model name for extraction/recall (qwen family per D-04)

Set these (e.g. via `.ai/.env`) before running `scripts/verify-opencode-live-parity.sh --setup-only` for a full live pass, and before 05-02 executes the capture/remember/recall stages.

## Next Phase Readiness

- 05-02 can proceed with the capture-stage design: `session.idle` is confirmed safe (no double-fire, no pre-message risk) against the installed CLI, so `memory-capture.ts`'s existing dedupe needs no fix.
- 05-02's remember->recall `--session` continuity step can rely on `sessionID` as the exact top-level JSON field name without re-probing.
- 05-02/05-03 must not proceed with their live stages until the operator provides a reachable local model endpoint + `CAIRN_LLM_*` credentials (see User Setup Required above) — this is a pre-existing gate, not new to this plan.
- `scripts/verify-opencode-live-parity.sh` is ready for 05-02 to extend with `run_stage_wakeup`/`run_stage_recall_edit`/`run_stage_capture`/`run_stage_remember_recall`/`run_negative_controls`.

---
*Phase: 05-live-opencode-parity-verification*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: scripts/verify-opencode-live-parity.sh
- FOUND: 1652eb2 (git log --oneline --all)
