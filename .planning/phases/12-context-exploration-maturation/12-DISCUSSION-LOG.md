# Phase 12: Context Exploration Maturation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 12-context-exploration-maturation
**Areas discussed:** Cross-reference mechanics, Pre-task hook trigger, Cache design, Auto-invoke latency & output budget

---

## Gray area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Cross-reference mechanics | Where citation↔memory/wiki matching runs, what query drives it, how flags render | ✓ |
| Pre-task hook trigger | What counts as "task start", harness scope, query derivation, opt-in gating | ✓ |
| Cache design | Storage location/format, dirty-state hashing, eviction, cross-ref freshness | ✓ |
| Auto-invoke latency & output budget | Blocking vs async, injection size limits | ✓ |

**User's choice:** All four areas, with the note "discuss all the points and decide autonomously what's best" — full delegation of the design decisions to Claude (same pattern as Phase 10).

---

## Cross-reference mechanics (CTX-08)

Alternatives considered:
- Per-citation semantic `memory_search` using the path as query — rejected (paths aren't natural language; N embedding calls per result; non-deterministic).
- One semantic search on the original query, matched back to citations — deferred as a future enrichment, not the phase's mechanism.
- **Deterministic stem matching mirroring `memory-recall.sh` — chosen** (proven semantics, cheap, verifiable). → D-01…D-04

## Pre-task hook trigger (CTX-09)

Alternatives considered:
- Fire on every `UserPromptSubmit` unconditionally — rejected (noise + latency; violates the high-signal hook bar).
- Hook speaks MCP to the server — rejected (CLI subcommand pattern already exists for `wakeup`/`extract`).
- Mandatory OpenCode parity — softened to conditional (researcher verifies a clean prompt-submit plugin event exists; #5894 limitation noted). → D-05…D-08

## Cache design (CTX-10)

Alternatives considered:
- Cache inside token-miser — rejected (out of repo scope; cairnkeep-side wrapping keeps the thin delegate unmodified).
- Repo-local cache in `<repo_root>/.agentfs/` — rejected (explored repo may be any repo; don't write into it).
- Dirty key from `git status --porcelain` file list only — rejected (two different edits to the same file would collide; key must be content-sensitive). → D-09…D-12

## Auto-invoke latency & output budget

Alternatives considered:
- Async background warming — deferred (complexity; blocking is acceptable under double opt-in + cache).
- Injecting expanded snippets — rejected (budget; compact citations + flags only). → D-13, D-14

## Claude's Discretion

The user delegated all decisions in all four areas. Planner latitude: marker rendering, skip-heuristics, cache format/prune cap, dirty-hash incantation, CLI subcommand name, verify-script structure — preserving thin-delegate, env-only opt-in, fail-open enrichment/hooks, fail-closed tool tiers, verify-by-execution.

## Deferred Ideas

- Semantic cross-referencing on the original query (embedding-backed)
- Async/background cache warming
- OpenCode auto-invoke parity (conditional in-phase; documented gap if the plugin API lacks the event)
- Cache-aware `/context-explore` command UX (`--fresh`-style flag)
