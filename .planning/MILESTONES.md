# Milestones

## v1.1 OpenCode parity (Shipped: 2026-07-04)

**Phases completed:** 2 phases (4-5), 9 plans, 19 tasks
**Requirements:** 6/6 mapped — OCP-01/02/03/05 proven live; OCP-04/06 proven-achievable with an open reliability gap (see Known Gaps)
**Baseline tag:** `v1.1` (annotated, at HEAD)
**Closeout:** override_closeout — Phase 5 (OCP-06) shipped without a green verified closeout; the round-trip is proven achievable but not reliably reproducible headless (see Known Gaps)
**Git range:** `v1.0.0..v1.1` — 58 commits, 48 files, +6505/−155

**Delivered:** OpenCode reaches the Claude Code operating-layer baseline — the memory-capture (session-end) and memory-recall (pre-edit) lifecycle plus `remember`/`recall` commands ported to OpenCode's native plugin model, a self-sufficient session-start wakeup that no longer shells out to `~/.claude`, and a scratch-isolated live-parity harness that proves each stage against the registered `cairn-memory` MCP.

**Key accomplishments:**

- Confirmed experimental.chat.system.transform reaches the model in OpenCode v1.17.11, so OCP-05's wakeup rewrite keeps its existing injection mechanism instead of falling back to an instruction-file channel.
- Rewrote `opencode/plugins/memory-wakeup.ts` to surface AgentFS memory, the wiki index, open HARD contradictions, and staged-candidates count natively, removing the last `~/.claude` shell-out from the OpenCode wakeup path.
- `opencode/plugins/memory-capture.ts` extracts memory candidates on OpenCode session-end (`session.idle`, subagent-filtered, deduped) and stages them to `.planning/memory-staging/` byte-compatible with the Claude `memory-capture.sh` contract.
- `opencode/plugins/memory-recall.ts` blocks-and-surfaces file-specific AgentFS/wiki context before an OpenCode edit or write proceeds, using the confirmed `output.args.filePath` field and a throw-to-surface mechanism with a once-per-file-per-session guard.
- sync-opencode-plugin-assets.sh now renders @@INFRA_ROOT@@ and installs all three native plugins idempotently; the OCP-05 hard bar (wakeup surfaces AgentFS memory with no reachable ~/.claude) is proven by a live scratch-HOME acceptance run.
- session.idle confirmed live (v1.17.11) to fire exactly once per `opencode run`, always after real messages exist, plus the `sessionID` JSON field name — de-risking 05-02's capture and remember->recall stage design — and a scratch-isolated verify-opencode-live-parity.sh harness scaffold that registers cairn-memory as a real local MCP server.
- Extended the harness with all four remaining live stages, fixed a genuine memory-capture.ts crash (broken stdin-writer path) and a genuine opencode-run process-exit race via an opencode-serve/--attach harness pattern, and discovered a live-model reliability gap in read-oriented MCP tool calls that 05-03 must carry forward.
- Authored 05-UAT.md from fresh live-harness runs (discharging OCP-01/02/03/04 from 04-UAT test 2), traced OCP-04's recall read-back gap to qwen3.6-27b-coder's tool-calling (no thinking setting fires both write and read) and then PROVED OCP-04 achievable end-to-end live with a no-thinking tool-call-reliable model (qwen3.5-27b) — the first successful /remember->/recall round-trip in the phase, with reliable headless-harness reproduction the one open item; recorded the interactive TUI session as an explicit D-01 fallback-gap (headless operator, no TTY); and corrected the stale Claude-asset precondition in docs/operating.md.

### Known Gaps (override closeout)

- **OCP-06 — reliable headless reproduction of the `/remember`→`/recall` round-trip.** The full round-trip is **proven achievable** — demonstrated once live with a no-thinking, tool-call-reliable local model (qwen3.5-27b), the first successful round-trip in the phase — but not reliably reproducible in the scripted headless harness. Root cause is an opencode run-completion flakiness (undici↔server, model-independent) plus local thinking-model tool-call variance, **not** a defect in `recall.md`/`remember.md`/`cairn-memory`/the harness. The injection, capture, and write mechanisms are each proven live with structurally-trustworthy evidence.
- **OCP-06 — interactive TUI session not run.** The literal live-session bar (D-01) required a human at a real terminal; the resolving operator was headless with no TTY. Recorded as an explicit D-01 fallback-gap in `05-UAT.md` Test 5 — never claimed as passed. Left for a future operator with an interactive terminal to close if desired.

**Follow-up carried forward:** verify each stage with a genuine `"type":"tool"` event in the opencode `--format json` stream rather than a substring grep (a discovered false-positive class where narrated-but-unexecuted tool syntax matches); and re-confirm the round-trip interactively once a TTY operator is available or a reliably tool-calling local model is the default.

---

## v1.0 OSS core → parity (Shipped: 2026-07-03)

**Phases completed:** 3 phases (pre-plan-tracking; no SUMMARY.md artifacts)
**Requirements:** 6/6 satisfied (verified by `v1.0-MILESTONE-AUDIT.md`)
**Baseline tag:** `v1.0.0` (annotated, at HEAD)
**Closeout:** verified_closeout — build clean, smoke suite passing, no tracked secrets

**Delivered:** The open-source core — `cairn-memory` MCP server, the `cairn` CLI, and the carved operating layer (commands, agents, hooks) — brought to drop-in parity with the originating private workflow.

**Key accomplishments:**

- Provider-neutral core — one `CAIRN_GIT_PROVIDER` key + per-provider operation→tool map; no hardcoded git hosts anywhere in the core (Phase 1)
- `cairn-memory` MCP server — 10 tools on stdio plus opt-in token-gated HTTP; fixed the `memory_read` empty-schema bug (ZodEffects `.refine()` published an empty inputSchema)
- Operating layer verified end-to-end — memory round-trip, remember/recall, memory-sync, wiki (ingest/query/lint), security-audit, and repo-review all exercised against the registered MCP across Claude Code
- SEC-0001 fully closed — memory scope path-traversal guard (kebab-case allowlist + `relative()`-based containment) and opt-in HTTP hardening (fail-closed bearer auth, per-origin CORS, Host/DNS-rebinding validation); regression-tested by `smoke-scope-guard.mjs` + `smoke-http-guard.mjs`
- Fresh-bootstrap parity confirmed and documented — `docs/operating.md` operating guide (setup order, per-command workflow reference, config table); `cairn bootstrap` + `sync-claude-assets.sh` reproduce the operating layer into a scratch root, idempotent re-check clean
- OSS hygiene at sign-off — Apache-2.0 LICENSE, CI (`ci.yml`) building + smoke-testing on push/PR, no tracked secrets, no attribution noise

**Known deferred items:**

- OpenCode memory-wakeup install ordering — the OpenCode plugin reuses the rendered Claude hook and fails open if absent; closed by documenting the Claude-first ordering in `docs/operating.md`. Claude Code remains the complete, verified path.
- Enterprise overlay (private-only, never in this repo) and token-miser integration — carried to future milestones.

---
