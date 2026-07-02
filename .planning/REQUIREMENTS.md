# Requirements: Cairnkeep

**Defined:** 2026-07-03 (ingested from existing planning docs; IDs preserved from .planning/intel/requirements.md)
**Core Value:** Drop-in parity — a fresh `cairn bootstrap` plus the carved commands, agents, and hooks reproduce the originating private workflow end-to-end, verified against the `cairn-memory` MCP server.

## v1 Requirements (Milestone: OSS core → parity)

Each requirement maps to exactly one roadmap phase.

### Memory Server

- [ ] **REQ-memory-mcp-server**: The `cairn-memory` MCP server registers and responds as an MCP server, with remember/recall operations working end-to-end

### Operating Layer

- [ ] **REQ-operating-layer**: Commands, agents, and hooks for memory, wiki, security, and review workflows work end-to-end against the `cairn-memory` MCP across harnesses (Claude Code, OpenCode, ...), including memory hooks (wakeup/capture/review) round-tripping

### CLI & Bootstrap

- [ ] **REQ-cli-bootstrap**: A fresh `cairn bootstrap` yields a working same-as-before workflow (launchers + derived-knowledge layer)

### Core Neutrality

- [x] **REQ-provider-neutral-core**: Provider-neutral core — git host selected by one config setting, collaboration commands resolve every git-host operation through a per-provider operation→tool map, no hardcoded vendor endpoints anywhere in the core (delivered in Phase 1)

### Parity & Hygiene

- [ ] **REQ-feature-parity**: Feature parity with the originating private workflow — operating guide in the OSS docs, fresh bootstrap works same-as-before, baseline tagged at sign-off
- [ ] **REQ-oss-hygiene**: Clean open-source hygiene — Apache-2.0 license present, CI in place, no secrets or attribution noise in any artifact

## Future Milestones (deferred)

Tracked but not in the current roadmap.

- **Enterprise overlay (private)** — wraps the core with organization-specific launchers and config; lives only on the private remote, never in this repo
- **token-miser integration** — the routing + context-explore sibling, brought in as an optional companion

## Out of Scope

| Feature | Reason |
|---------|--------|
| Enterprise overlay contents in this repo | DEC-no-private-references — private-only, lives on the private remote |
| Vendor-specific hardcoding (LLM or git host) | Violates the provider-neutral core; all such configuration is external and swappable |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-provider-neutral-core | Phase 1 | Complete |
| REQ-memory-mcp-server | Phase 2 | Pending |
| REQ-operating-layer | Phase 2 | Pending |
| REQ-cli-bootstrap | Phase 3 | Pending |
| REQ-feature-parity | Phase 3 | Pending |
| REQ-oss-hygiene | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 6 total
- Mapped to phases: 6
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-03*
*Last updated: 2026-07-03 after roadmap creation (ingest)*
