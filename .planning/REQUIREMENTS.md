# Requirements: Cairnkeep — v1.1 OpenCode parity

**Defined:** 2026-07-03
**Core Value:** Drop-in parity — a fresh `cairn bootstrap` plus the carved operating layer reproduce the originating private workflow end-to-end. v1.1 extends that parity guarantee to the OpenCode harness, which today trails the verified Claude Code path.

## v1.1 Requirements

Requirements for the OpenCode-parity milestone. Each maps to exactly one roadmap phase.

### Memory lifecycle

- [x] **OCP-01**: On session end, OpenCode extracts memory candidates to the shared staging area (parity with the Claude `memory-capture` SessionEnd hook)
- [ ] **OCP-02**: Before an OpenCode edit/write, file-specific memory is injected into context (parity with the Claude `memory-recall` PreToolUse hook)
- [x] **OCP-05**: OpenCode `memory-wakeup` surfaces session-start context (AgentFS memory + wiki index + open HARD contradictions) without requiring Claude assets to be installed first

### Memory commands

- [x] **OCP-03**: User can run `remember` in OpenCode to persist a durable finding across memory layers
- [x] **OCP-04**: User can run `recall` in OpenCode to retrieve known info across memory layers

### Parity verification

- [ ] **OCP-06**: The full OpenCode memory lifecycle (wakeup → recall → capture) and the `remember`/`recall` commands round-trip against the registered `cairn-memory` MCP in a live OpenCode session

## v2 Requirements

Deferred to future milestones. Tracked but not in this roadmap.

### Companion tooling

- **TMISER-01**: token-miser integration (routing + context-explore companion)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Enterprise overlay assets | Private-only, never in this repo (DEC-no-private-references) |
| New memory/wiki/security capabilities | v1.1 is parity-only — no new operating-layer surface, just OpenCode reaching the Claude baseline |
| A third harness beyond Claude/OpenCode | Not requested; parity target is OpenCode ↔ Claude |
| Changing the `cairn-memory` MCP server contract | Server is v1.0-validated; parity is achieved in the operating layer, not by changing the server |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| OCP-01 | Phase 4 | Complete |
| OCP-02 | Phase 4 | Pending |
| OCP-03 | Phase 4 | Complete |
| OCP-04 | Phase 4 | Complete |
| OCP-05 | Phase 4 | Complete |
| OCP-06 | Phase 5 | Pending |

**Coverage:**

- v1.1 requirements: 6 total
- Mapped to phases: 6 (all mapped ✓)
- Unmapped: 0

---
*Requirements defined: 2026-07-03*
*Last updated: 2026-07-03 after roadmap creation — all 6 requirements mapped (Phase 4: OCP-01..05, Phase 5: OCP-06)*
