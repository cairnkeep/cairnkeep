---
phase: 10-routing-seam
verified: 2026-07-06T19:05:00Z
status: passed
score: 8/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:

  - test: "Operator (not the executing agent) runs `bash scripts/verify-routing-seam.sh` with the real token_miser binary present and independently confirms a genuine 200 /health (D-06 live-proof sign-off)."
    expected: "`[health] OK: real token_miser binary answered GET /health with status ok` printed, exit 0, no lingering `token_miser` process after the run."
    why_human: "The plan's own <verify><human-check> designates this a human/operator sign-off step, not an automated check, because it proves the seam's target is a real external binary rather than a code artifact grep can see. Both the 10-02 executor and this verifier independently ran the script against the real binary present on this machine and observed success (see Verification Notes below) — that is strong technical evidence, but it does not substitute for the plan-designated operator confirmation, since an agent re-running the same script is not the independent human sign-off the plan calls for."

  - test: "Read the 'Routing seam (route_check, opt-in)' subsection of docs/operating.md cold and confirm it alone is sufficient for an external/private overlay to wire CAIRN_ROUTE_ENDPOINT and call route_check without opening mcp-memory-server/src/index.ts (SC #3)."
    expected: "The subsection names the tool, its single env key, the exact GET {endpoint}/health call, all three tier shapes (precondition throw / execution ok:false / success ok:true), and the does-NOT clause — with nothing left to infer from source."
    why_human: "The plan's own <verify><human-check> reserves this as a judgment call about documentation sufficiency, not a grep-able fact. This verifier performed a cold read (see Verification Notes) and found it structurally complete and accurate against the built tool, but sufficiency-for-an-external-reader is inherently a human editorial judgment the plan defers to a person, not an automated pass."
---

# Phase 10: Routing Seam Verification Report

**Phase Goal:** Thin, documented delegate to token-miser's routing/tiering surface; no proxy, endpoint, or model config in the core.
**Verified:** 2026-07-06T19:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `route_check` registered in cairn-memory MCP server, callable via a real MCP round-trip | ✓ VERIFIED | `cd mcp-memory-server && npm run build && node scripts/smoke-route-guard.mjs` → exit 0, all 9 assertions "ok", including "route_check is registered" via `listTools()` |
| 2 | Unset or malformed `CAIRN_ROUTE_ENDPOINT` throws at the precondition tier (D-09) | ✓ VERIFIED | Guard checks 2–3 pass (`isError` true for unset env and for `CAIRN_ROUTE_ENDPOINT=not-a-url`); code at `index.ts:1097-1106` throws in both cases before any fetch |
| 3 | Connection-refused, non-2xx, malformed-JSON, and timeout all return `{ok:false,...}` at the execution tier, never throw (D-09) | ✓ VERIFIED | Guard checks 4–6 pass against a live unreachable port and two ephemeral `node:http` servers (503, non-JSON body); code wraps the entire `fetch()` in one `try/catch` (`index.ts:1110-1124`) that returns `{ok:false}` for every exception including `TimeoutError` — the timeout branch is structurally covered by the same catch as connection-refused (same code path, only the error string differs by `e.name`), so the guard's connection-refused test exercises the identical control flow a real timeout would hit |
| 4 | A real 200 from `GET {endpoint}/health` returns `{ok:true, status, cluster_healthy}` | ✓ VERIFIED | Guard checks 7–8 pass against an ephemeral ok-server returning `{status:"ok",cluster_healthy:null}` and a second returning `cluster_healthy:true`; both echoed correctly in `structuredContent` |
| 5 | The delegate reads exactly one env key (`CAIRN_ROUTE_ENDPOINT`) and hits exactly `GET /health` — no hardcoded proxy endpoint, model list, or tier config in `src/` (SC #1, RT-01, D-03/D-08) | ✓ VERIFIED | `grep -nE 'localhost:8080\|127\.0\.0\.1:8080\|/v1/chat/completions\|/v1/messages\|tier[123]' mcp-memory-server/src/index.ts` → 0 matches; `grep -n 'CAIRN_ROUTE_' src/index.ts` → all 4 occurrences are `CAIRN_ROUTE_ENDPOINT`, no second key; `grep -c 'runCommand' src/index.ts` → 4, unchanged vs. the pre-phase commit (`git show b480e04~1:...\|grep -c runCommand` also 4); D-10 pinning assertions in the guard independently confirm exactly one request is made and its path is exactly `/health` |
| 6 | A real (non-mocked) `token_miser` binary is started and answers `GET /health` with `status ok`, proving the routing surface genuinely runs (D-06, RT-01) | ? UNCERTAIN — see human verification #1 | This verifier independently ran `timeout 30 bash scripts/verify-routing-seam.sh` against the real binary present at `$HOME/PARA/Projects/token-miser/target/release/token_miser` (not a mock): observed `[env] CAIRN_ROUTE_BINARY overridden from default: no`, the binary's own startup log lines, then `[health] OK: real token_miser binary answered GET /health with status ok`, exit 0. Confirmed via `ps aux \| grep token_miser` after the run that no process was left running (clean `trap` teardown). This is real technical confirmation, but the plan explicitly reserves final sign-off for a human operator, not the executing/verifying agent |
| 7 | The real-proof step is operator-gated: absent binary fails loud, never silently exits 0 (D-06) | ✓ VERIFIED | `CAIRN_ROUTE_BINARY=/nonexistent bash scripts/verify-routing-seam.sh` → prints `FATAL: token_miser binary not found or not executable...` to stderr, exit 1 (confirmed directly, not from SUMMARY claim) |
| 8 | A full `/v1/chat/completions` round-trip is available only behind an explicit `--full` flag, never the required minimum | ✓ VERIFIED | Code review of `scripts/verify-routing-seam.sh`: `main()` only calls `run_full_stretch` when `full=1` (set only by the `--full` arg); `run_health_proof` (the default path) never references `/v1/chat/completions`; the `--full` path itself skips-with-message (`return 0`) rather than failing when no tier backend answers |
| 9 | `docs/operating.md` documents `CAIRN_ROUTE_ENDPOINT` and the `route_check` seam contract, sufficient for an overlay to drive routing without reading core source (SC #2, SC #3, RT-02) | ? UNCERTAIN — see human verification #2 | `grep -q CAIRN_ROUTE_ENDPOINT docs/operating.md` and `grep -q route_check docs/operating.md` both succeed (lines 107, 109–134). Content covers tool name, single env key, exact `GET {endpoint}/health` call, precondition/execution/success shapes, and matches the frozen contract in `10-01-PLAN.md` verbatim. This verifier's own cold read found it structurally complete, but the plan reserves final sufficiency judgment for a human reviewer |
| 10 | The doc explicitly states what the seam does NOT do (no proxy hosting, no tier/model/endpoint config, does not drive `/v1/chat/completions`/`/v1/messages`, does not report which tier serves a request) | ✓ VERIFIED | `docs/operating.md:126-131`: "**What it does NOT do:** it does not drive `/v1/chat/completions` or `/v1/messages`... It does not report which tier serves a request, or any tier/model/endpoint configuration at all" |

**Score:** 8/10 truths verified (2 uncertain, pending human sign-off per plan design — not failures)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `mcp-memory-server/src/index.ts` | `route_check` tool (fetch-based, fail-closed) | ✓ VERIFIED | Real implementation at lines 1087-1142: precondition throws, execution-tier `{ok:false}` branches, success shape — matches must-haves exactly, no stub patterns found |
| `mcp-memory-server/scripts/smoke-route-guard.mjs` | Offline MCP round-trip guard + D-10 pinning | ✓ VERIFIED | 159-line file, real `node:http` ephemeral fixtures, real MCP `Client`/`StdioClientTransport` round-trip (not a unit mock), 9 assertions all passing |
| `mcp-memory-server/package.json` | `check:route-guard` wired into `test:smoke` | ✓ VERIFIED | `check:route-guard` script defined (line 18) and appended to `test:smoke` chain (line 20); `npm run test:smoke` runs it and exits 0 |
| `scripts/verify-routing-seam.sh` | Real-binary `/health` proof, operator-gated, default + `--full` modes | ✓ VERIFIED | Executable (`-rwxrwxr-x`), `bash -n` passes, `--help` exits 0, real run against the live binary exits 0 with clean teardown, absent-binary run exits 1 with explicit message |
| `docs/operating.md` | `CAIRN_ROUTE_ENDPOINT` config row + Routing seam contract subsection | ✓ VERIFIED | Row at line 107; subsection "Routing seam (`route_check`, opt-in)" at lines 109-134 with full contract + does-NOT clause |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `CAIRN_ROUTE_ENDPOINT` (env) | `route_check` | read at `index.ts:1097` | ✓ WIRED | Only consumer of the env key in `src/` |
| `route_check` | `fetch GET {endpoint}/health` | frozen seam (D-10) | ✓ WIRED | `index.ts:1112`; guard's D-10 assertion confirms exactly one request, path exactly `/health` |
| `smoke-route-guard.mjs` | `dist/index.js` | real MCP round-trip via `StdioClientTransport` | ✓ WIRED | Not a mock — spawns the actual built server binary and talks MCP protocol over stdio |
| `verify-routing-seam.sh` | real `token_miser` binary | background spawn + `GET /health` poll | ✓ WIRED | Independently re-run by this verifier; genuine 200 observed, clean teardown confirmed via `ps aux` |
| docs seam contract | Plan 01's frozen `route_check` contract | name/env-key/path/shape match | ✓ WIRED | Doc names `route_check`, `CAIRN_ROUTE_ENDPOINT`, `/health`, and the exact three return shapes — verified word-for-word against the built tool's actual behavior (not just against the plan's aspiration) |

### Anti-Patterns Found

None. Scanned all five files modified/created by this phase (`src/index.ts`, `smoke-route-guard.mjs`, `package.json`, `verify-routing-seam.sh`, `docs/operating.md`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` and "not yet implemented"/"coming soon" phrasing — zero matches.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|-------------|--------------|--------|----------|
| RT-01 | 10-01, 10-02 | cairnkeep drives token-miser's routing surface through a thin delegate; core hosts no proxy/endpoint/model/tier config | ✓ SATISFIED | Truths 1-8 above; grep confirms zero proxy/tier literals in `src/`; guard proves fail-closed behavior end-to-end; real-binary proof confirmed independently |
| RT-02 | 10-02 | Routing invocation + provider-neutral config keys documented as a stable seam contract for external overlay use | ✓ SATISFIED (content-verified); sign-off pending | Doc content verified complete and accurate against the built tool (truths 9-10); final cold-read sufficiency judgment is the plan's own designated human-check |

No orphaned requirements: REQUIREMENTS.md maps only RT-01 and RT-02 to Phase 10, and both appear in the plans' `requirements` frontmatter.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Build + full guard round-trip | `cd mcp-memory-server && npm run build && node scripts/smoke-route-guard.mjs` | 9/9 checks "ok", exit 0 | ✓ PASS |
| Full smoke suite (build + all 6 guards) | `cd mcp-memory-server && npm run test:smoke` | All guards green including `check:route-guard` | ✓ PASS |
| No proxy/tier literals in core | `grep -nE 'localhost:8080\|127\.0\.0\.1:8080\|/v1/chat/completions\|/v1/messages\|tier[123]' src/index.ts` | 0 matches | ✓ PASS |
| Script help | `bash scripts/verify-routing-seam.sh --help` | Usage printed, exit 0 | ✓ PASS |
| Script syntax | `bash -n scripts/verify-routing-seam.sh` | No errors | ✓ PASS |
| Script real-binary run | `timeout 30 bash scripts/verify-routing-seam.sh` (real binary present) | `[health] OK...`, exit 0, no lingering process | ✓ PASS |
| Script absent-binary run | `CAIRN_ROUTE_BINARY=/nonexistent bash scripts/verify-routing-seam.sh` | `FATAL: token_miser binary not found...`, exit 1 | ✓ PASS |
| Doc greps | `grep -q CAIRN_ROUTE_ENDPOINT docs/operating.md && grep -q route_check docs/operating.md` | Both succeed | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention or explicit probe declarations found in this phase's PLAN/SUMMARY files — this phase's own real-binary proof script (`scripts/verify-routing-seam.sh`) serves the equivalent role and was executed directly above, not substituted with narration.

### Human Verification Required

### 1. D-06 live-proof operator sign-off

**Test:** With the real `token_miser` binary present, an operator runs `bash scripts/verify-routing-seam.sh` once and confirms a genuine 200 `/health`; on a machine without the binary, confirms the loud failure.
**Expected:** `[health] OK...` line, exit 0, clean teardown (present case); `FATAL:` message, nonzero exit (absent case).
**Why human:** The plan's own `<verify><human-check>` designates this a human/operator confirmation step, not an automated one. Both the 10-02 executor and this verifier independently re-ran the script against the real binary and observed success — strong technical evidence — but an agent re-running the same script is not the independent human sign-off the plan calls for.

### 2. SC #3 cold-read sufficiency review

**Test:** Read the "Routing seam (`route_check`, opt-in)" subsection of `docs/operating.md` cold and confirm it alone is sufficient to wire and drive `route_check` without opening `mcp-memory-server/src/index.ts`.
**Expected:** The subsection is complete and self-sufficient — no need to consult source.
**Why human:** Documentation-sufficiency-for-an-external-reader is a judgment call the plan explicitly reserves for a human, not a grep-able fact. This verifier's own cold read found the subsection structurally complete and accurate against the built tool's actual behavior, but did not substitute for the plan-designated review.

### Gaps Summary

No gaps found. All automated/grep/behavioral checks pass, including full re-execution of the real-binary verify script (both present- and absent-binary paths) and the complete `test:smoke` chain. The only outstanding items are the two `<human-check>` sign-offs the plans themselves deliberately deferred to a human operator — technical evidence for both is now independently confirmed by this verifier (not just claimed by the SUMMARY), but final human sign-off per the plan's own design is still open. This is a `human_needed` status, not `gaps_found`.

---

_Verified: 2026-07-06T19:05:00Z_
_Verifier: Claude (gsd-verifier)_
