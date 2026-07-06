---
phase: 11
slug: self-consistency-public-positioning
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-06
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None new — this phase adds bash gate scripts, not TS/JS code. The existing `mcp-memory-server` test framework (`npm test` → `test:smoke`) is the untouched regression net (no `src/` files change). |
| **Config file** | `mcp-memory-server/package.json` scripts section (existing regression net); the phase's own gates are self-contained bash scripts, no config file. |
| **Quick run command** | `./scripts/verify-no-private-references.sh` |
| **Full suite command** | `./scripts/verify-no-private-references.sh && ./scripts/verify-docs-parity.sh && (cd mcp-memory-server && npm test)` |
| **Estimated runtime** | ~5 seconds (each gate script self-contained, <5s; +smoke suite if run) |

---

## Sampling Rate

- **After every task commit:** Run `./scripts/verify-no-private-references.sh` (once it exists — Plan 01 Task 1)
- **After every plan wave:** Run the full suite (`verify-no-private-references.sh && verify-docs-parity.sh && npm test`)
- **Before `/gsd-verify-work`:** Full suite must be green (guard exit 0 + parity exit 0)
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | SC-03 | T-11-01 / T-11-02 | Guard fails closed on unreadable denylist; flags planted term; never leaks denylist path/contents | smoke (script) | `bash -n scripts/verify-no-private-references.sh && scripts/verify-no-private-references.sh --help && scripts/verify-no-private-references.sh; echo "clean-tree-exit=$?"` | ❌ W0 (this task creates it) | ⬜ pending |
| 11-01-02 | 01 | 1 | SC-02 | — | One-directional parity: code keys must be documented; doc-only keys allowed | smoke (script) | `bash -n scripts/verify-docs-parity.sh && scripts/verify-docs-parity.sh --help && scripts/verify-docs-parity.sh; echo "parity-exit=$?"` | ❌ W0 (this task creates it) | ⬜ pending |
| 11-02-01 | 02 | 2 | SC-01 | T-11-03 / T-11-04 / T-11-05 | Clean-history re-init (1 commit); guard zero-hit with denylist set before any push | smoke (live) | `cd ~/PARA/Projects/token-miser && test -n "${CAIRN_GUARD_DENYLIST:-}" && bash /home/stondo/PARA/Projects/cairnkeep/scripts/verify-no-private-references.sh && cargo build 2>&1 | tail -3` | ✅ (consumes 11-01-01) | ⬜ pending |
| 11-02-02 | 02 | 2 | SC-01 | T-11-03 / T-11-04 | Blocking human confirmation before irreversible public push | manual | see Manual-Only Verifications | n/a | ⬜ pending |
| 11-02-03 | 02 | 2 | SC-01 | T-11-04 | Repo verified PUBLIC; single clean commit | smoke (live) | `gh repo view cairnkeep/token-miser --json visibility` | ✅ | ⬜ pending |
| 11-03-01 | 03 | 3 | SC-01 / SC-02 | T-11-06 | README names/links public sibling; config table complete; stale Status removed | smoke (grep) | `grep -q 'cairnkeep/token-miser' README.md && grep -q 'CAIRN_ROUTE_ENDPOINT' README.md && grep -q 'CAIRN_EXPLORE_BINARY' README.md && grep -q 'CAIRN_EXPLORE_REPO_ROOT' README.md && ! grep -qi 'being carved out' README.md && echo README-OK` | ✅ | ⬜ pending |
| 11-03-02 | 03 | 3 | SC-02 | T-11-07 | Parity green; count/list coupled fix (Pitfall 4); sibling named | smoke (script) | `scripts/verify-docs-parity.sh && ! grep -q '10 commands' docs/operating.md && grep -q 'context-explore' docs/operating.md && grep -q 'CAIRN_EXPLORE_BINARY' docs/operating.md && grep -q 'CAIRN_EXPLORE_REPO_ROOT' docs/operating.md && grep -q 'cairnkeep/token-miser' docs/operating.md && echo OPERATING-OK` | ✅ (consumes 11-01-02) | ⬜ pending |
| 11-03-03 | 03 | 3 | SC-01 / SC-02 | T-11-06 / T-11-07 | Cold read catches prose-level inaccuracy the script cannot (D-10) | manual | see Manual-Only Verifications | n/a | ⬜ pending |
| 11-04-01 | 04 | 4 | SC-03 | T-11-08 / T-11-09 | Gate run live (not asserted); record carries no private term | smoke (live+grep) | `scripts/verify-docs-parity.sh && grep -qi 'Phase 11' .planning/MILESTONES.md && grep -q 'verify-no-private-references' .planning/MILESTONES.md && echo GATE-RECORDED` | ✅ (consumes 11-01-01 + 11-01-02) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

The two gate scripts that RESEARCH.md's test map marks `❌ Wave 0` are delivered as
Plan 01 (Wave 1) tasks — there is no separate pre-execution scaffolding step, and
dependency ordering guarantees they exist before any consumer runs:

- [x] `scripts/verify-no-private-references.sh` — SC-03 guard, created by task 11-01-01; consumed by 11-02-01 (Wave 2), 11-04-01 (Wave 4)
- [x] `scripts/verify-docs-parity.sh` — SC-02 parity checker, created by task 11-01-02; consumed by 11-03-02 (Wave 3), 11-04-01 (Wave 4)
- [x] Regression net — existing `mcp-memory-server` `npm test` (`test:smoke`), unchanged (no `src/` files touched this phase)

No new test framework or stub file is required: this phase adds bash gate scripts,
and the existing smoke suite covers the unchanged server surface.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pre-push confirmation of the token-miser publish tree (11-02-02) | SC-01 | Publishing is irreversible — the automated guard is necessary but not sufficient for a first-ever public release | 1. `cd ~/PARA/Projects/token-miser && git ls-files` — confirm no `.ai/`, `.planning/`, `bench/`, `CLAUDE.md`, `AGENTS.md`, `.gitlab-ci.yml`, `.github/`, `target/`, no `config.enterprise.example.toml`. 2. Re-run guard with `CAIRN_GUARD_DENYLIST` set → exit 0. 3. Spot-check scrubbed docs/configs. 4. Confirm `cargo build` and `git rev-list --count HEAD` == 1. Type "approved". |
| Cold read of swept docs (11-03-03) | SC-01 / SC-02 | Mechanized parity cannot catch prose-level inaccuracy (stale count adjacent to a fixed list, dead link, token-miser internals creeping past one sentence) — D-10 | 1. Read README Status / Related projects / Configuration table — shipped-reality framing accurate + link resolves to public repo. 2. Read operating.md command count+list, config table, workflow context-explore entry, routing-seam sibling naming — counts consistent, one sentence + link per wire. 3. Confirm Phase 10 seam contract prose unweakened. Type "approved". |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or manual-only justification (7 automated smoke tasks, 2 blocking human checkpoints)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (both gate scripts delivered by Plan 01 before any consumer wave)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-06
