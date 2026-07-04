---
phase: 07-context-explore-mcp-tool
verified: 2026-07-04T23:54:57Z
status: human_needed
score: 3/4 roadmap success criteria verified (1 uncertain — requires live external service)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Stand up a real `token_miser` binary with a reachable FastContext endpoint, set `CAIRN_EXPLORE_BINARY` (and `CAIRN_EXPLORE_REPO_ROOT` or pass `repo_root`), then invoke `context_explore` via an MCP client with a natural-language query against a real repo."
    expected: "Tool returns compact `path:line-range` citations in `content` text and the full `Evidence` JSON in `structuredContent`, matching the parsing/rendering logic already verified by code inspection and the offline `fake-tokenmiser-cited.sh` smoke case."
    why_human: "SC-1 requires a live `token_miser` binary and a reachable FastContext endpoint — neither is available in this CI/offline environment. 07-VALIDATION.md explicitly designates this as a manual/operator UAT step, not a CI gate. The code path (spawn -> JSON.parse -> renderCitations) is verified by inspection and exercised offline by the `fake-tokenmiser-cited.sh` fixture, which stands in for a real populated Evidence result."
---

# Phase 07: context_explore MCP Tool Verification Report

**Phase Goal:** `cairn-memory` exposes a `context_explore` tool that delegates natural-language exploration queries to the external `token_miser explore` binary and returns compact citations, configured entirely provider-neutrally, and failing closed on every error path.

**Verified:** 2026-07-04T23:54:57Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (SC) | Status | Evidence |
|---|------------|--------|----------|
| 1 | User can invoke `context_explore` with a natural-language query against a real repo and receive compact `path:line-range` citations, parsed from `token_miser explore`'s `Evidence` JSON via `runCommand`. | ? UNCERTAIN (human verification required) | Code path verified by inspection: `src/index.ts:1000-1085` registers the tool, calls `runCommand(binaryPath, ["explore","--query",query,"--repo-root",resolvedRoot], ..., {...process.env, NO_COLOR:"1"})`, `JSON.parse(result.stdout.trim())`, then `renderCitations(evidence)`. Offline populated-citation smoke case (`fake-tokenmiser-cited.sh` via `check:explore-guard`) independently re-run and passes: `sc.ok===true`, `citations.length===2`, text matches `/.+:\d+-\d+/`. Per 07-VALIDATION.md, the live-repo/live-endpoint run is explicitly manual/operator UAT, not a CI gate — flagged as human verification, not failed. |
| 2 | When the `token-miser` binary is missing, misconfigured, times out, or emits malformed stdout, `context_explore` returns a clear, fail-closed error — never a silent empty-success. | ✓ VERIFIED | Code: precondition tier throws on unset/missing binary and unresolvable repo_root (`src/index.ts:1012-1032`); execution tier returns `{ok:false, error, stderr, exitCode, timedOut}` on non-zero exit / timeout (`:1042-1056`) and on malformed stdout (`:1063-1076`) — never a throw, never a silent empty success. Independently re-ran `cd mcp-memory-server && npm run build && node scripts/smoke-explore-guard.mjs`: all 10 checks pass, including "not configured", "binary missing", "repo_root unresolvable" (throws/isError), "non-zero exit returns structured ok:false", "malformed stdout returns structured ok:false". Timeout path (`result.timedOut`) shares the same `if` branch as non-zero-exit and is code-reviewed as correct; not independently smoke-tested (no fixture sleeps past a timeout), consistent with the plan's own scope. |
| 3 | `context_explore`'s only configuration surface is environment variables (binary path + optional repo-root override); a grep across `src/` and docs confirms no FastContext endpoint/model/API-key or private host/IP/vendor default is committed anywhere. | ✓ VERIFIED | Code: only `process.env.CAIRN_EXPLORE_BINARY` and `process.env.CAIRN_EXPLORE_REPO_ROOT` are read; no default binary path, no hardcoded endpoint. Independently re-ran the CTX-03 grep: `grep -rniE "endpoint_url|fastcontext\.(model\|api_key)|:8081|:11434|<RFC1918-pattern>" mcp-memory-server/src docs` → zero matches (confirmed `CTX03_CLEAN`). Also re-ran the same pattern against `mcp-memory-server/scripts/fixtures/` (07-01's own gate) → zero matches. |
| 4 | An offline smoke test (no live model dependency) exercises the "not configured" and "binary missing" fail-closed paths and passes in CI. | ✓ VERIFIED | `package.json`: `"check:explore-guard": "node scripts/smoke-explore-guard.mjs"` exists and `"test:smoke"` ends with `... && npm run check:explore-guard` (confirmed by direct read, not just grep-in-SUMMARY). Independently re-ran the full `npm run test:smoke` chain from a clean `mcp-memory-server` shell: `check:embeddings`, `check:extract`, `check:scope-guard`, `check:http-guard`, and `check:explore-guard` all pass, exit 0. `check:explore-guard` alone re-run twice, deterministic, no network calls (no `fetch`/`http`/live `token_miser` reference in the guard script itself). |

**Score:** 3/4 roadmap success criteria VERIFIED, 1/4 UNCERTAIN (SC-1, routed to human verification per the phase's own documented validation strategy).

### Plan-Level Must-Haves (07-01 + 07-02 frontmatter)

| # | Must-have | Status | Evidence |
|---|-----------|--------|----------|
| 07-01 T1 | `npm run build && node scripts/smoke-explore-guard.mjs` exercises not-configured/binary-missing/non-zero-exit/malformed-stdout/empty-success/populated-citation paths offline | ✓ VERIFIED | Re-run independently; 10/10 checks pass; no `fetch`/`http`/live binary in the guard. |
| 07-01 T2 | `npm run test:smoke` includes `check:explore-guard` | ✓ VERIFIED | `package.json` line 19: `test:smoke` chain ends in `&& npm run check:explore-guard`. |
| 07-01 T3 | Fake-binary fixtures reproduce exit1/garbage/empty/populated outcomes offline, pinned field names | ✓ VERIFIED | All four fixtures read directly; exact `Citation`/`ExploreStats` field names (`path`,`start_line`,`end_line`,`turns`,`tool_calls`,`hit_turn_cap`,`expanded_lines`,`expanded_tokens`) present; all four are executable (`-rwxr-xr-x`). |
| 07-01 T4 | Smoke harness anchors on `context_explore` registration (RED pre-Plan-02, GREEN post) | ✓ VERIFIED | `smoke-explore-guard.mjs` case 1 calls `listTools()` and checks `tools.some(t=>t.name==="context_explore")`; now passes post-Plan-02 (confirmed by re-run). |
| 07-02 T1 | `context_explore` registered MCP tool, visible via `listTools()` | ✓ VERIFIED | `src/index.ts:1000` `server.registerTool("context_explore", ...)`; smoke case 1 passes. |
| 07-02 T2 | Unset/missing binary or unresolvable repo_root → THROWS | ✓ VERIFIED | `src/index.ts:1012-1032`; smoke cases 2-4 pass. |
| 07-02 T3 | Non-zero exit / timeout / malformed stdout → `{ok:false, error, stderr, exitCode, timedOut}` | ✓ VERIFIED | `src/index.ts:1042-1076`; smoke cases 5-6 pass. |
| 07-02 T4 | Valid empty Evidence → `ok:true`, empty citations, turns/tool_calls text | ✓ VERIFIED | `renderCitations` (`:604-615`); smoke case 7 passes. |
| 07-02 T5 | Valid populated Evidence → compact `path:line-range` text + full Evidence structuredContent | ✓ VERIFIED | `:1078-1083`; smoke case 8 passes. |
| 07-02 T6 | `repo_root` resolved to ABSOLUTE path before crossing process boundary | ✓ VERIFIED | `:1029` `resolve(expandHome(rawRoot))`, used as the `--repo-root` argv value; never the raw string. |
| 07-02 T7 | No FastContext endpoint/model/API-key/host/IP/vendor default committed in `src/` or `docs/` | ✓ VERIFIED | Independently re-ran CTX-03 grep; zero matches. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `mcp-memory-server/scripts/smoke-explore-guard.mjs` | Offline fail-closed smoke guard | ✓ VERIFIED | Exists, 125 lines, 10 checks, all pass. |
| `mcp-memory-server/scripts/fixtures/fake-tokenmiser-exit1.sh` | Non-zero-exit fixture | ✓ VERIFIED | Exists, executable, exits 1, stderr diagnostic only. |
| `mcp-memory-server/scripts/fixtures/fake-tokenmiser-garbage.sh` | Malformed-stdout fixture | ✓ VERIFIED | Exists, executable, non-JSON stdout, exit 0. |
| `mcp-memory-server/scripts/fixtures/fake-tokenmiser-empty.sh` | Valid-empty-Evidence fixture | ✓ VERIFIED | Exists, executable, valid empty Evidence JSON, exit 0. |
| `mcp-memory-server/scripts/fixtures/fake-tokenmiser-cited.sh` | Valid-populated-Evidence fixture | ✓ VERIFIED | Exists, executable, valid 2-citation Evidence JSON, exit 0. |
| `mcp-memory-server/package.json` | `check:explore-guard` wired into `test:smoke` | ✓ VERIFIED | Confirmed by direct read of `scripts` block. |
| `mcp-memory-server/src/index.ts` | `context_explore` tool + `renderCitations` + `runCommand` env param | ✓ VERIFIED | All three symbols present, substantive, and wired (see Key Link table). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `context_explore` handler | `runCommand` | `runCommand(binaryPath, ["explore","--query",query,"--repo-root",resolvedRoot], timeoutMs, {...process.env, NO_COLOR:"1"})` | ✓ WIRED | `src/index.ts:1035-1040`, exact argv shape and env-merge as specified. |
| `runCommand` result | `renderCitations` / structuredContent | `JSON.parse(result.stdout.trim())` → `renderCitations(evidence)` for text, `{ok:true,...evidence}` for structuredContent | ✓ WIRED | `src/index.ts:1063-1083`. |
| env `CAIRN_EXPLORE_BINARY` + `repo_root` param | `CAIRN_EXPLORE_REPO_ROOT` fallback → throw | Precondition chain: param → env → throw naming both | ✓ WIRED | `src/index.ts:1020-1025`. |
| `context_explore` | `scripts/smoke-explore-guard.mjs` | Guard turns GREEN once tool is registered | ✓ WIRED | Independently re-run: 10/10 checks pass. |
| `runCommand` 4th `env` param | `domain_knowledge_sync` (only other caller) | Default `env: NodeJS.ProcessEnv = process.env` keeps the 3-arg call site byte-identical | ✓ WIRED, NO REGRESSION | `src/index.ts:406-410` default param confirmed; call site at `:977` still 3-arg (`runCommand("python3", args, timeoutMs)`); `check:scope-guard` and `check:http-guard` independently re-run as part of full `test:smoke`, both pass. |

### Behavioral Spot-Checks (independently re-run, not trusted from SUMMARY)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Offline explore guard, all 10 cases | `cd mcp-memory-server && npm run build && node scripts/smoke-explore-guard.mjs` | 10/10 `ok:` lines, "Explore guard checks passed" | ✓ PASS |
| Full smoke chain incl. explore guard | `cd mcp-memory-server && npm run test:smoke` | All 5 sub-checks (`check:embeddings`, `check:extract`, `check:scope-guard`, `check:http-guard`, `check:explore-guard`) pass, exit 0 | ✓ PASS |
| CTX-03 grep audit (src + docs) | `grep -rniE "endpoint_url\|fastcontext\.(model\|api_key)\|:8081\|:11434\|<RFC1918>" mcp-memory-server/src docs` | zero matches | ✓ PASS |
| CTX-03 grep audit (fixtures, 07-01's own gate) | same pattern against `mcp-memory-server/scripts/fixtures/` | zero matches | ✓ PASS |
| TypeScript build | `cd mcp-memory-server && npm run build` | tsc exits 0, no type errors | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CTX-01 | 07-01 (scaffold), 07-02 (impl) | User can run `context_explore` for NL query → compact `path:line-range` citations via `token_miser explore` + `Evidence` JSON parsing | ✓ SATISFIED (code + offline evidence); SC-1's live-repo run is explicitly deferred to manual UAT per 07-VALIDATION.md, not required for "Complete" under this phase's own validation contract | `src/index.ts:1000-1085`, `renderCitations` (`:604-615`), offline smoke case 8 (populated citations) passes |
| CTX-02 | 07-01 (scaffold), 07-02 (impl) | Fails closed on missing/misconfigured/timeout/malformed-output — never silent empty-success | ✓ SATISFIED | Precondition throws + execution-tier `{ok:false}` returns, all 6 relevant smoke cases (2-6, plus empty-is-first-class case 7) independently re-run and pass |
| CTX-03 | 07-02 | Env-only config surface, no FastContext endpoint/model/API-key/vendor-default host committed | ✓ SATISFIED | Independently re-ran grep audit against `src/`, `docs/`, and fixtures — zero matches |

**No orphaned requirements.** `.planning/REQUIREMENTS.md` maps only CTX-01/02/03 to Phase 7, and both plans' frontmatter `requirements` fields collectively cover all three (07-01: CTX-01, CTX-02; 07-02: CTX-01, CTX-02, CTX-03).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` grep across `src/index.ts`, `scripts/smoke-explore-guard.mjs`, and all four fixtures returns zero matches. No stub returns (`return {}`/`return []`/`console.log`-only handlers) in the `context_explore` code path. |

### Documented Residual Gaps (accepted, not silently swallowed)

Both gaps are explicitly named in the 07-02 PLAN's threat model (T-07-06) and carried forward accurately in the 07-02 SUMMARY — confirmed by direct comparison, not just SUMMARY self-report:

1. **T-07-06 / Pitfall #1 — endpoint-down-but-configured indistinguishable from genuine empty result.** `token_miser explore` treats an unreachable-but-configured FastContext endpoint as exit 0 + empty `Evidence`. `context_explore` cannot distinguish this from a real "no citations found" outcome purely from the JSON shape. **Mitigation actually present in code:** `renderCitations` (`src/index.ts:608-610`) surfaces `stats.turns`/`stats.tool_calls` in the empty-citation text, confirmed live by smoke case 7 ("empty success text mentions turns/tool_calls"). This is accepted as a documented, out-of-scope residual (closing it requires re-implementing token_miser's explorer loop) — not a silent defect.
2. **`runCommand` 12000-char stdout truncation.** Pre-existing `truncateOutput(value, maxLength=12000)` (`src/index.ts:268`) is unchanged by this phase and applies to `context_explore`'s captured stdout. A sufficiently large `Evidence` payload would truncate mid-JSON, causing `JSON.parse` to throw and the tool to correctly report `{ok:false, error:"malformed Evidence JSON"}` — fail-closed, never a silent wrong-success, but a real practical limitation for large result sets. Accurately documented in both the plan's `<verification>` section and the 07-02 SUMMARY's "Documented Residual Gaps" section — not omitted or downplayed.

Both gaps are correctly classified as accepted residual risk (not blockers): the failure mode in each case is fail-closed or transparency-mitigated, consistent with CTX-02's "never a silent empty-success" contract.

### Human Verification Required

### 1. SC-1 Live Repo Query

**Test:** Stand up a real `token_miser` binary with a reachable FastContext endpoint, set `CAIRN_EXPLORE_BINARY` (and either `CAIRN_EXPLORE_REPO_ROOT` or a per-call `repo_root`), then invoke `context_explore` via an MCP client with a natural-language query against a real repo.

**Expected:** The tool returns compact `path:line-range` citations in the text `content` and the full `Evidence` JSON in `structuredContent`, matching the logic already verified by code inspection and by the offline `fake-tokenmiser-cited.sh` smoke case.

**Why human:** Requires a live external binary and a live external model endpoint — neither exists in this offline/CI verification environment. `07-VALIDATION.md` §"Manual-Only Verifications" explicitly designates this as operator UAT, not a CI gate, and the phase's task prompt directs this be routed to human verification rather than failed.

### Gaps Summary

No blocking gaps. All CI-gated success criteria (SC-2, SC-3, SC-4) and all plan-level must-haves for both 07-01 and 07-02 are independently verified against the actual codebase — build succeeds, the full `test:smoke` chain (including the newly folded `check:explore-guard`) passes with 10/10 checks, and the CTX-03 grep audit is clean against `src/`, `docs/`, and the fixtures directory. The two residual gaps (T-07-06 endpoint-down-ambiguity and the 12000-char stdout truncation) are correctly documented as accepted, fail-closed/transparency-mitigated limitations rather than swallowed defects.

The only unresolved item is SC-1's live-repo verification, which the phase's own validation strategy (07-VALIDATION.md) intentionally scopes out of CI and defers to operator UAT. This is not a code defect — it is an environment constraint (no live `token_miser` + FastContext endpoint available here) — so the phase is not blocked, but the live run should be exercised before Phase 9's A/B token-savings measurement, per the 07-02 SUMMARY's own "Next Phase Readiness" note.

---

_Verified: 2026-07-04T23:54:57Z_
_Verifier: Claude (gsd-verifier)_
