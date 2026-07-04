---
phase: 7
slug: context-explore-mcp-tool
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-05
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `07-RESEARCH.md` §Validation Architecture (framework/commands/Wave 0 pinned there).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — hand-rolled Node smoke scripts (`.mjs`), mirroring `mcp-memory-server/scripts/smoke-scope-guard.mjs`. No jest/vitest/mocha in this project. |
| **Config file** | none — `mcp-memory-server/package.json` `scripts` block |
| **Quick run command** | `npm run build && node scripts/smoke-explore-guard.mjs` (from `mcp-memory-server/`) |
| **Full suite command** | `npm run test:smoke` (chains existing `check:*` smoke guards + the new `check:explore-guard`) |
| **Estimated runtime** | ~seconds (offline — no live model dependency) |

---

## Sampling Rate

- **After every task commit:** Run `npm run build && node scripts/smoke-explore-guard.mjs`
- **After every plan wave:** Run `npm run test:smoke`
- **Before `/gsd-verify-work`:** Full smoke suite must be green
- **Max feedback latency:** ~seconds (offline smoke; no network)

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; `File Exists` / `Status` are filled during execution. Requirement→behavior→command mapping below is lifted from `07-RESEARCH.md` §Phase Requirements → Test Map.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD-planner | TBD | 1 | CTX-02 | V5 input-validation | "not configured" (env unset) throws (fail-closed) | smoke | `node scripts/smoke-explore-guard.mjs` | ❌ W0 | ⬜ pending |
| TBD-planner | TBD | 1 | CTX-02 | — | "binary missing" (path set, file absent) throws | smoke | `node scripts/smoke-explore-guard.mjs` | ❌ W0 | ⬜ pending |
| TBD-planner | TBD | 1 | CTX-02 | — | non-zero exit / malformed stdout → `{ ok: false, ... }`, never silent empty-success | smoke (fake-binary fixture) | `node scripts/smoke-explore-guard.mjs` | ❌ W0 | ⬜ pending |
| TBD-planner | TBD | 1 | CTX-03 | V12 path/config | no FastContext endpoint/model/API-key/vendor default committed in `src/` or docs | static grep audit | `grep -rniE "endpoint_url\|fastcontext\.(model\|api_key)\|:8081\|:11434" mcp-memory-server/src docs/` (expect zero new matches) | ✅ repo-wide | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `mcp-memory-server/scripts/smoke-explore-guard.mjs` — new offline fail-closed smoke test (CTX-02 "not configured" + "binary missing" paths); mirror `smoke-scope-guard.mjs`'s `Client`/`StdioClientTransport` pattern
- [ ] Tiny fixture "fake binary" (executable script) pointed at by `CAIRN_EXPLORE_BINARY` to exercise the non-zero-exit / malformed-stdout `{ ok: false }` paths offline, without the real `token_miser`
- [ ] `mcp-memory-server/package.json` — add `"check:explore-guard": "node scripts/smoke-explore-guard.mjs"` and fold it into `test:smoke`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-repo query returns compact `path:line-range` citations (dual `content`/`structuredContent`) | CTX-01 | SC-1 requires a real repo + real `token_miser` binary + live FastContext endpoint this phase does not stand up (matches Phase 6's operator-provides-runtime framing) | Operator UAT: stand up `token_miser` + FastContext, set `CAIRN_EXPLORE_BINARY`, invoke `context_explore` via an MCP client against a real repo, confirm compact citations |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`smoke-explore-guard.mjs` + fake-binary fixture + `package.json` script)
- [ ] No watch-mode flags
- [ ] Feedback latency < ~5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
