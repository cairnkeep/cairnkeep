---
phase: 4
slug: opencode-parity-operating-layer
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-03
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Lifted from the six 04-0N-PLAN.md task `<verify>` blocks and 04-RESEARCH.md (## Validation Architecture). Not invented.

`$PHASE_DIR` = `.planning/phases/04-opencode-parity-operating-layer` (used to keep the 04-01 command readable below).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | No unit-test framework for the OpenCode plugin/command assets. This is a TypeScript-plugin + shell-script repo; validation is static acceptance assertions (`test -f`, `grep`), idempotent sync-script apply/check against a scratch `--live-root`, the shared-server contract guard (`npm run check:extract`), and live `opencode` CLI probes/acceptance gates. |
| **Config file** | none — no test runner config exists (see Wave 0 Requirements) |
| **Quick run command** | `cd mcp-memory-server && npm run check:extract` (offline; confirms the shared `extract` subcommand contract is untouched by this phase's TS glue) |
| **Full suite command** | `cd mcp-memory-server && npm test` (shared-server smoke tests) + per-task `grep`/`test` acceptance assertions listed below |
| **Estimated runtime** | `check:extract` ~seconds (offline). The two OCP-05 live-session gates are manual/out-of-band (minutes). |

**Why no unit harness:** the OpenCode plugin/command assets are exercised by live-session verification today (Phase 3, `docs/operating.md`). The full automated live round-trip is Phase 5 / OCP-06's scope; this phase leans on live-execution checks plus static per-task acceptance, consistent with how `memory-wakeup.ts` was verified in Phase 3.

---

## Sampling Rate

- **After every task commit:** Run `cd mcp-memory-server && npm run check:extract` plus that task's own `grep`/`test` acceptance assertion (see Per-Task Verification Map).
- **After every plan wave:** Live OpenCode session walkthrough of the specific OCP-0X behavior that wave implemented.
- **Before `/gsd-verify-work`:** The scratch-`HOME` wakeup acceptance test (OCP-05, task 04-06-02) plus one full remember → recall round trip.
- **Max feedback latency:** < 30s for automated per-task checks (`grep`/`test` instant; `check:extract` a few seconds). Live acceptance gates are manual and run out-of-band.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | OCP-05 | T-04-06 | Probe confined to a scratch `OPENCODE_CONFIG_DIR`; no probe file leaks into the repo plugin tree | live probe | `test -f $PHASE_DIR/04-SPIKE-INJECTION.md && grep -Eq 'MARKER-REACHES-MODEL:[[:space:]]*(yes\|no)' $PHASE_DIR/04-SPIKE-INJECTION.md && ! ls opencode/plugins 2>/dev/null \| grep -qi probe` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | OCP-05 | — | `CHOSEN-CHANNEL` consistent with the observed `MARKER-REACHES-MODEL` verdict | manual/live | — `checkpoint:human-verify` (see Manual-Only Verifications) | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | OCP-03 | T-04-07 | OpenCode `tools:` map (no Claude `allowed-tools:`); dedupe-before-write + supersede-for-audit preserved | grep acceptance | `test -f opencode/command/remember.md && [ "$(grep -c '^tools:' opencode/command/remember.md)" -eq 1 ] && grep -q 'cairn-memory_memory_write' opencode/command/remember.md && ! grep -q '^allowed-tools:' opencode/command/remember.md` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | OCP-04 | — | `tools:` map only; layer-agnostic read order preserved verbatim (D-07) | grep acceptance | `test -f opencode/command/recall.md && [ "$(grep -c '^tools:' opencode/command/recall.md)" -eq 1 ] && grep -q 'cairn-memory_memory_search' opencode/command/recall.md && grep -q 'domain_knowledge_query' opencode/command/recall.md && ! grep -q '^allowed-tools:' opencode/command/recall.md` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 1 | OCP-03, OCP-04 | — | Idempotent install into an operator-supplied scratch `--live-root` (no real config tree touched) | shell apply/check | `grep -q '"command/remember.md"' scripts/sync-opencode-memory-assets.sh && grep -q '"command/recall.md"' scripts/sync-opencode-memory-assets.sh && D=$(mktemp -d) && bash scripts/sync-opencode-memory-assets.sh --apply --live-root "$D" && bash scripts/sync-opencode-memory-assets.sh --check --live-root "$D"` | ✅ | ⬜ pending |
| 04-03-01 | 03 | 2 | OCP-05 | T-04-03 | Server path resolved only from install-rendered `@@INFRA_ROOT@@`; no home-dir shell-out; guarded + fail-open | grep + npm check | `grep -q '@@INFRA_ROOT@@' opencode/plugins/memory-wakeup.ts && grep -q 'mcp-memory-server/dist/index.js' opencode/plugins/memory-wakeup.ts && grep -q 'surfaced' opencode/plugins/memory-wakeup.ts && grep -q 'catch' opencode/plugins/memory-wakeup.ts && ! grep -q 'homedir' opencode/plugins/memory-wakeup.ts && cd mcp-memory-server && npm run check:extract` | ✅ | ⬜ pending |
| 04-04-01 | 04 | 2 | OCP-01 | T-04-08 | Top-level-session filter (`parentID`), per-`sessionID` dedupe, env-guarded, SDK read (not raw storage) | grep acceptance | `test -f opencode/plugins/memory-capture.ts && grep -q 'session.idle' opencode/plugins/memory-capture.ts && grep -q 'parentID' opencode/plugins/memory-capture.ts && grep -q 'CAIRN_LLM_API_KEY' opencode/plugins/memory-capture.ts && grep -q 'CAIRN_LLM_EXTRACTION_MODEL' opencode/plugins/memory-capture.ts && grep -q 'session.messages' opencode/plugins/memory-capture.ts && ! grep -q 'local/share/opencode/storage' opencode/plugins/memory-capture.ts` | ❌ W0 | ⬜ pending |
| 04-04-02 | 04 | 2 | OCP-01 | T-04-01 | Session text piped via `$` stdin (never interpolated into the command); 5-file staging cap; fail-open | grep + npm check | `grep -q 'extract' opencode/plugins/memory-capture.ts && grep -q 'memory-staging' opencode/plugins/memory-capture.ts && grep -q 'catch' opencode/plugins/memory-capture.ts && cd mcp-memory-server && npm run check:extract` | ❌ W0 | ⬜ pending |
| 04-05-01 | 05 | 2 | OCP-02 | T-04-02 | `relative()`-containment for wiki reads (untrusted path is a grep token only); throw-to-surface; once-per-file guard; fail-open | grep acceptance | `test -f opencode/plugins/memory-recall.ts && grep -q 'tool.execute.before' opencode/plugins/memory-recall.ts && grep -Eq '"edit"\|edit' opencode/plugins/memory-recall.ts && grep -q '@@INFRA_ROOT@@' opencode/plugins/memory-recall.ts && grep -q 'wiki/sources' opencode/plugins/memory-recall.ts && grep -q 'relative' opencode/plugins/memory-recall.ts && grep -q 'throw' opencode/plugins/memory-recall.ts && grep -q 'catch' opencode/plugins/memory-recall.ts` | ❌ W0 | ⬜ pending |
| 04-06-01 | 06 | 3 | OCP-01, OCP-02, OCP-05 | T-04-03 | `@@INFRA_ROOT@@` rendered only from script-derived `ROOT_DIR`; install stays inside `--live-root`; idempotent; no unresolved token in the live tree | shell apply/check | `grep -q '"plugins/memory-capture.ts"' scripts/sync-opencode-plugin-assets.sh && grep -q '"plugins/memory-recall.ts"' scripts/sync-opencode-plugin-assets.sh && grep -q 'INFRA_ROOT' scripts/sync-opencode-plugin-assets.sh && D=$(mktemp -d) && bash scripts/sync-opencode-plugin-assets.sh --apply --live-root "$D" && ! grep -rq '@@INFRA_ROOT@@' "$D/plugins" && bash scripts/sync-opencode-plugin-assets.sh --check --live-root "$D"` | ✅ | ⬜ pending |
| 04-06-02 | 06 | 3 | OCP-05 | — | Acceptance gate uses scratch `HOME` / `OPENCODE_CONFIG_DIR` only; never deletes or touches the real `~/.claude` | manual/live | — `checkpoint:human-verify` (see Manual-Only Verifications) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**File Exists column:** `❌ W0` = the verify target is a new artifact this phase must create first (the 04-01 spike note, the two new commands, the two new plugins); `✅` = the verify asserts against a file already present in the repo (the two sync scripts, the existing `memory-wakeup.ts`, and the `mcp-memory-server` extract contract).

**Phase-wide supply-chain threat (T-04-SC):** every plugin task carries the `@opencode-ai/plugin` (and optional `@opencode-ai/sdk`) `[SUS]` scanner verdict. No package install occurs — the plugins use runtime-resolved, type-only imports matching the existing `memory-wakeup.ts`. A blocking-human checkpoint verifying `npmjs.com/package/@opencode-ai/plugin` is required only if any executor introduces a `package.json` install.

---

## Wave 0 Requirements

- [ ] **04-01 injection-mechanism spike** (`$PHASE_DIR/04-SPIKE-INJECTION.md`) — the Wave-0-equivalent gating artifact. Must record: `MARKER-REACHES-MODEL: yes|no` (does `experimental.chat.system.transform` output reach the model on the installed OpenCode CLI v1.17.11), the confirmed `tool.execute.before` file-path field name (`filePath` vs `path`), the `client.session.messages()` top-level shape (`data` wrapper? where `role` lives?), and a `CHOSEN-CHANNEL:` line. **Gates plans 04-03, 04-04, 04-05** (all `depends_on: [04-01]`).
- [ ] **No unit-test stubs/harness are created this phase.** There is no automated test harness for OpenCode plugin/command behavior; per-task verification uses `grep`/`test` static acceptance plus the existing `mcp-memory-server` `npm run check:extract` guard. The full automated live round-trip is deferred to Phase 5 / OCP-06.
- [ ] **`sync-opencode-plugin-assets.sh` INFRA_ROOT-rendering** (Pitfall 5) is a design dependency the capture/recall/wakeup plugins rely on; it is implemented in plan 04-06 (not a separate stub), and the plugins reference the `@@INFRA_ROOT@@` token those plans render.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wakeup injection channel decision (`CHOSEN-CHANNEL`) — task 04-01-02 | OCP-05 | The channel must be chosen from a live model-visibility observation (whether the probe marker was reproduced by the model). No static check can prove `output.system` reached the LLM. | 1. Read `$PHASE_DIR/04-SPIKE-INJECTION.md`; confirm the `MARKER-REACHES-MODEL` verdict matches what was observed in the live probe session. 2. If `yes` → chosen channel is `experimental.chat.system.transform` (keep existing mechanism, D-04). 3. If `no` → chosen channel is the `instruction-file` fallback (write/refresh an `AGENTS.md`-style file loaded by OpenCode's instruction-file discovery, a code path not subject to GH #17100). 4. Record the confirmed channel as a `CHOSEN-CHANNEL:` line. Blocks 04-03 until confirmed. |
| OCP-05 hard acceptance gate — wakeup surfaces memory with no reachable `~/.claude` — task 04-06-02 | OCP-05 | Proving self-sufficiency of Claude assets requires running a live OpenCode session against a scratch project with a scratch empty `HOME` and observing whether the model's opening turn reflects seeded memory — an inherently live-session, model-behavior observation. | 1. Seed a scratch project dir with `.agentfs/project.db` (≥1 known fact) and `.planning/wiki/index.md`. 2. `bash scripts/sync-opencode-plugin-assets.sh --apply --live-root "$SCRATCH_CFG"`. 3. Run `opencode` against that project with `HOME` pointed at an empty scratch home (so `~/.claude` does not exist) and `OPENCODE_CONFIG_DIR="$SCRATCH_CFG"`. Do NOT delete or rename the real `~/.claude`. 4. Confirm the opening turn reflects the seeded AgentFS fact (and wiki index / open HARD contradictions if present) — the model answers about the seeded fact without being told it. 5. If `CHOSEN-CHANNEL` was `instruction-file`, also confirm the plugin wrote/refreshed the instruction file and OpenCode loaded it. 6. Record pass/fail + surfaced content in `04-06-SUMMARY.md`. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — every `type: auto` task carries a real `<automated>` block (above); the only two exceptions are the `checkpoint:human-verify` tasks (04-01-02, 04-06-02), which are legitimately live-session observations documented in Manual-Only Verifications.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — the two manual checkpoints (04-01-02, 04-06-02) never sit 3-in-a-row; each is adjacent to automated tasks.
- [x] Wave 0 covers all MISSING references — every `❌ W0` row maps to a new artifact this phase creates, and the 04-01 spike gates the dependent plans (04-03/04/05).
- [x] No watch-mode flags — no verify command uses `--watch` or any long-lived runner.
- [x] Feedback latency < 30s — automated per-task checks (`grep`/`test`, `check:extract`) complete in seconds.
- [x] `nyquist_compliant: true` set in frontmatter — the design-time sign-off genuinely holds; `wave_0_complete` stays `false` (Wave 0 has not executed yet).

**Approval:** approved 2026-07-03 (design-time; execution pending Wave 0)
