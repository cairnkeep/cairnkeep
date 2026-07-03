# Milestones

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
