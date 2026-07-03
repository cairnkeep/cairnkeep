---
phase: 04-opencode-parity-operating-layer
plan: 01
subsystem: infra
tags: [opencode, plugin, system.transform, tool.execute.before, sdk]

# Dependency graph
requires:
  - phase: 03-baseline-verification
    provides: Claude Code operating layer parity baseline; OpenCode-side gap documented
provides:
  - Empirical proof that experimental.chat.system.transform mutations reach the model in the installed OpenCode CLI (v1.17.11)
  - Confirmed tool.execute.before file-path field name (filePath)
  - Confirmed client.session.messages() response shape (data-wrapped array, role at info.role, parts pre-joined)
  - Chosen wakeup injection channel for OCP-05 (system.transform), unblocking Plan 04-03
affects: [04-03-wakeup-rewrite, 04-04-recall-plugin, 04-05-capture-plugin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Throwaway probe plugins for de-risking OpenCode hook behavior: scratch OPENCODE_CONFIG_DIR + scratch project, never touching the shipped opencode/plugins/ tree"

key-files:
  created:
    - .planning/phases/04-opencode-parity-operating-layer/04-SPIKE-INJECTION.md
  modified: []

key-decisions:
  - "Wakeup injection channel for OCP-05 is experimental.chat.system.transform (existing memory-wakeup.ts mechanism kept, per D-04) — GH anomalyco/opencode#17100's silently-discarded bug does not reproduce against the installed v1.17.11 CLI"
  - "tool.execute.before edit/write payloads use field name filePath, matching Assumption A2 in 04-RESEARCH.md"
  - "client.session.messages().data is Array<{ info: Message, parts: Array<Part> }>; role lives at info.role; parts are pre-joined, simplifying Plan 04-04/04-05's message-to-text conversion (no separate part-fetch needed)"

patterns-established:
  - "Pattern: de-risk uncertain runtime/hook behavior with a scratch, deletable probe before committing to a full plugin rewrite"

requirements-completed: [OCP-05]

coverage:
  - id: D1
    description: "Determine whether experimental.chat.system.transform output reaches the model in the installed OpenCode CLI"
    requirement: "OCP-05"
    verification:
      - kind: manual_procedural
        ref: "Two isolated opencode run --format json probe sessions, both echoing FOUND:CAIRN-WAKEUP-PROBE-x7q2f9"
        status: pass
    human_judgment: false
  - id: D2
    description: "Confirm tool.execute.before file-path field name from a live edit/write call"
    verification:
      - kind: manual_procedural
        ref: "Live opencode run write+edit sequence against sample.txt; observed argsKeys filePath"
        status: pass
    human_judgment: false
  - id: D3
    description: "Confirm client.session.messages() top-level shape (data wrapper, role location, part joining)"
    verification:
      - kind: manual_procedural
        ref: "Raw GET /session/{id}/message HTTP inspection + @opencode-ai/sdk cached type definitions"
        status: pass
    human_judgment: false
  - id: D4
    description: "Choose and record the wakeup injection channel for OCP-05, gating Plan 04-03"
    requirement: "OCP-05"
    verification:
      - kind: manual_procedural
        ref: "04-SPIKE-INJECTION.md CHOSEN-CHANNEL: system.transform line, operator-confirmed at Task 2 checkpoint"
        status: pass
    human_judgment: true
    rationale: "Channel choice gates the Plan 04-03 rewrite and was an explicit checkpoint:human-verify decision point per the plan; the checkpoint response was auto-confirmed by the orchestrator after a timeout with the operator away, so it is flagged here for operator re-confirmation before 04-03 executes if they disagree."

duration: ~25min
completed: 2026-07-03
status: complete
---

# Phase 04 Plan 01: Wakeup Injection Spike Summary

**Confirmed experimental.chat.system.transform reaches the model in OpenCode v1.17.11, so OCP-05's wakeup rewrite keeps its existing injection mechanism instead of falling back to an instruction-file channel.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-03T12:24:01Z
- **Completed:** 2026-07-03
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Ran a throwaway probe plugin against the live, locally installed `opencode` CLI and proved `experimental.chat.system.transform` output reaches the model (two clean, isolated runs both echoed the injected marker) — GH `anomalyco/opencode#17100`'s "silently discarded" bug does not reproduce in this version
- Confirmed the `tool.execute.before` file-path field name is `filePath` for both `edit` and `write` tools, from a live edit/write call
- Confirmed `client.session.messages()` returns `{ data: Array<{ info: Message, parts: Array<Part> }>, ... }` — `role` lives at `info.role`, and `parts` are pre-joined per message, simplifying the message-to-text conversion planned for OCP-01
- Recorded `CHOSEN-CHANNEL: system.transform` in `04-SPIKE-INJECTION.md`, unblocking Plan 04-03's wakeup rewrite

## Task Commits

Each task was committed atomically:

1. **Task 1: Probe system.transform delivery, tool.execute.before payload, and message shape** - `d457676` (feat)
2. **Task 2: Confirm the wakeup injection channel for OCP-05** - `574aa75` (docs)

**Plan metadata:** (this commit) - `docs: complete 04-01 plan`

## Files Created/Modified
- `.planning/phases/04-opencode-parity-operating-layer/04-SPIKE-INJECTION.md` - Probe findings (marker delivery, tool.execute.before field, message shape) plus the recorded `CHOSEN-CHANNEL: system.transform` decision

## Decisions Made
- Injection channel for OCP-05 is `experimental.chat.system.transform` (the existing `memory-wakeup.ts` mechanism), not the instruction-file fallback — decided per the plan's deterministic rule (D-04) once `MARKER-REACHES-MODEL: yes` was confirmed.
- The Task 2 checkpoint response was auto-confirmed by the orchestrator after an interactive timeout with the operator away; this is consistent with the deterministic decision rule (the "yes" verdict has only one valid channel choice) but is flagged as re-visitable before Plan 04-03 executes, in case the operator returns and disagrees.

## Deviations from Plan

None - plan executed exactly as written. Task 1's probe surfaced one non-isolated run that produced `NOT-FOUND` (log-correlation noise from earlier failed-provider setup attempts, not a genuine hook-delivery failure); this was documented transparently in the spike note itself rather than treated as a contradicting result, since two subsequent clean, isolated re-runs were consistent and unambiguous.

## Issues Encountered
- Two providers (`github-copilot`, `zai-coding-plan/glm-4.7`) had no working credentials/availability in this environment during Task 1 setup; the probe used the already-configured `local-ai/qwen3.6-27b-coder` local provider instead, which is unaffected by the injection-channel question being tested.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 04-03 (wakeup rewrite) is unblocked: the injection channel is confirmed as `experimental.chat.system.transform`, so the existing plugin mechanism is kept rather than replaced with an instruction-file fallback.
- Plans 04-04/04-05 (recall/capture) can rely on the confirmed `filePath` field and the `data`-wrapped, pre-joined `client.session.messages()` shape without further probing.
- Operator re-confirmation of the auto-confirmed Task 2 checkpoint is recommended before 04-03 executes, though the plan's decision rule leaves no ambiguity in the channel choice given the recorded verdict.

---
*Phase: 04-opencode-parity-operating-layer*
*Completed: 2026-07-03*
