# Requirements: Cairnkeep — v1.2 Context Exploration (token-miser + FastContext)

**Defined:** 2026-07-04
**Core Value:** Drop-in parity — a fresh `cairn bootstrap` plus the carved operating layer reproduce the originating private workflow end-to-end, verified against the `cairn-memory` MCP. v1.2 adds one new capability to that layer: token-efficient repo exploration (`context_explore`), delegated to the sibling `token-miser` binary's FastContext explore loop. Fulfills the v1.1-deferred TMISER-01.

## v1.2 Requirements

Each maps to exactly one roadmap phase. Numbering continues from v1.1 (phases 4–5) — v1.2 begins at Phase 6.

### Context exploration

- [ ] **CTX-01**: User can run a `context_explore` MCP tool that takes a natural-language query and returns compact `path:line-range` citations, by delegating to the external `token_miser explore` subcommand and parsing its `Evidence` JSON
- [ ] **CTX-02**: `context_explore` fails closed with a clear error when the `token-miser` binary is missing, misconfigured, times out, or emits malformed output — never a silent empty-success
- [ ] **CTX-03**: `context_explore` is configured provider-neutrally via environment only (token-miser binary path + optional repo-root override); no FastContext endpoint/model/API-key, and no host/IP/vendor default, is committed anywhere in `src/` or docs (honors DEC-no-private-references)

### Operating layer

- [ ] **CTX-04**: User can invoke context exploration on demand from a Claude Code command
- [ ] **CTX-05**: User can invoke context exploration on demand from an OpenCode command, installed via a `sync-opencode-*-assets.sh` script (parity with Claude)

### Verification

- [x] **CTX-06**: FastContext tool-call reliability is probed and documented against the actually-deployed GGUF quant + `llama-server --jinja` combination (confirming real `tool_calls`, not narration) before any operating-layer wiring is built on top of it
- [ ] **CTX-07**: The token-savings value proposition is proven by a measured before/after A/B (native Read/Glob/Grep vs `context_explore`) on cairnkeep's own harness against a real bootstrapped project — cairnkeep's own measured number, not FastContext's paper figure

## Future Requirements

Deferred to future milestones. Tracked but not in this roadmap.

### Exploration differentiators

- **CTX-F1**: Memory-aware exploration — cross-reference `context_explore` citations against existing `memory_search` / `wiki-query` hits
- **CTX-F2**: Pre-task hook auto-invoke of exploration (reusing OCP-01/02 hook infrastructure), fresh-task-only per token-miser's invariant
- **CTX-F3**: Result caching keyed on (query, repo HEAD/dirty-state)

### Companion routing

- **TMISER-R1**: token-miser's HTTP routing-proxy surface (`/v1/chat/completions` tiering, semantic router) as a cairnkeep-facing capability — distinct from `context_explore`'s subprocess delegation

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Reimplementing the FastContext agentic loop, filesystem sandbox, or Docker-path shim in TypeScript | token-miser already owns and tests these in Rust; cairnkeep delegates via subprocess, never re-derives them |
| token-miser's HTTP routing proxy (tier1/2/3, semantic router) | A separate surface from context-explore; FastContext is explicitly "never a routing target." Deferred as TMISER-R1 |
| Vendoring token-miser source or FastContext GGUF weights into this repo | token-miser is referenced by binary path/env; FastContext is served externally. No redistribution decision this milestone |
| FastContext endpoint/model/serving config inside cairnkeep | Lives entirely in token-miser's own TOML; cairnkeep stays provider-neutral and holds none of it |
| Memory-aware annotation, hook auto-invoke, caching, savings UI | Differentiators deferred (CTX-F1..F3) until the base tool is proven useful |
| Enterprise overlay assets | Private-only, never in this repo (DEC-no-private-references) |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CTX-01 | Phase 7 | Pending |
| CTX-02 | Phase 7 | Pending |
| CTX-03 | Phase 7 | Pending |
| CTX-04 | Phase 8 | Pending |
| CTX-05 | Phase 8 | Pending |
| CTX-06 | Phase 6 | Complete |
| CTX-07 | Phase 9 | Pending |

**Coverage:**

- v1.2 requirements: 7 total
- Mapped to phases: 7
- Unmapped: 0

---
*Requirements defined: 2026-07-04*
*Roadmap created: 2026-07-04 — 4 phases (6-9), 100% coverage*
