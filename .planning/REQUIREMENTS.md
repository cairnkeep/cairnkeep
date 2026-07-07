# Requirements: Cairnkeep

**Defined:** 2026-07-06
**Milestone:** v1.3 Routing Seam & Context Maturation
**Core Value:** Drop-in parity — a fresh `cairn bootstrap` plus the carved commands, agents, and hooks reproduce the originating private workflow end-to-end, verified against the `cairn-memory` MCP server.

## v1.3 Requirements

Requirements for the v1.3 milestone. Each maps to exactly one roadmap phase (see Traceability).

### Routing Integration

- [x] **RT-01**: cairnkeep drives token-miser's routing/tiering surface through a thin delegate — the core invokes it but hosts no proxy and holds no endpoint, model, or tier config (mirrors the `context_explore` subprocess-delegate boundary). _(from TMISER-R1)_
- [x] **RT-02**: The routing invocation and its provider-neutral config keys are documented as a stable seam contract in the operating docs, so an external/private overlay can drive routing unchanged.

### Self-Consistency & Hygiene

- [x] **SC-01**: token-miser is presented as a public cairnkeep-org sibling project in the docs (named, linked, described), so the routing wire references a public dependency rather than a vendor/private one.
- [x] **SC-02**: The operating docs describe the routing surface and the token-miser relationship consistently with the shipped code — no drift between docs and behavior.
- [x] **SC-03**: The repo contains zero private/vendor references — the DEC-no-private-references guard passes as a milestone gate across code, comments, and docs.

### Context Exploration (matured)

- [ ] **CTX-08**: `context_explore` cross-references its citations against memory (`memory_search`) and the wiki, surfacing which cited ranges have related memory/wiki context. _(from CTX-F1)_
- [ ] **CTX-09**: A pre-task hook can auto-invoke `context_explore` for a task's query, so exploration runs without a manual `/context-explore` call. _(from CTX-F2)_
- [x] **CTX-10**: `context_explore` caches results keyed on (query, repo HEAD + dirty-state), reusing them on a cache hit and invalidating when the repo changes. _(from CTX-F3)_

### OpenCode Reliability

- [ ] **OCP-07**: The headless harness reliably reproduces the OpenCode `/remember`→`/recall` round-trip (serve/`--attach` + retry), closing the v1.1 OCP-06 override gap. Headless reproducibility only — interactive-TUI confirm is out of scope.

## Future Requirements

Deferred to a future release. Tracked but not in the current roadmap.

_(none newly deferred this milestone — CTX-F1/F2/F3 promoted to CTX-08/09/10 above)_

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Hosting a routing/tiering proxy or endpoint/model config in the core | token-miser owns routing; cairnkeep stays a thin delegate (LOCKED v1.2 thin-delegate boundary) |
| The private enterprise / corporate-validation overlay | Private remote only, never in this repo (DEC-no-private-references); a separate private track *after* v1.3 freezes the seam (RT-02) |
| Interactive-TUI confirm of the OpenCode round-trip | Needs a TTY operator; OCP-07 targets headless reliability only (carried from the v1.1 known gap) |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RT-01 | Phase 10 | Complete |
| RT-02 | Phase 10 | Complete |
| SC-01 | Phase 11 | Complete |
| SC-02 | Phase 11 | Complete |
| SC-03 | Phase 11 | Complete |
| CTX-08 | Phase 12 | Pending |
| CTX-09 | Phase 12 | Pending |
| CTX-10 | Phase 12 | Complete |
| OCP-07 | Phase 13 | Pending |

**Coverage:**

- v1.3 requirements: 9 total
- Mapped to phases: 9 (Phases 10-13)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-06*
*Last updated: 2026-07-06 after roadmap creation (Phases 10-13, 100% coverage)*
