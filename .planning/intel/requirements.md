# Requirements

Extracted from PRD-classified docs. One entry per requirement; acceptance criteria as stated or derivable from the source.

---

## REQ-memory-mcp-server
source: .planning/PROJECT.md (section "What")
scope: mcp-memory-server/

A durable memory MCP server (`cairn-memory`) forming the core of the memory + context layer.

Acceptance:
- Server registers and responds as an MCP server
- remember/recall operations work end-to-end (verification detailed in .planning/ROADMAP.md Phase 2)

---

## REQ-cli-bootstrap
source: .planning/PROJECT.md (section "What")
scope: bin/cairn, scripts/, templates/

A CLI that bootstraps a project's launchers and derived-knowledge layer.

Acceptance:
- A fresh `cairn bootstrap` yields a working same-as-before workflow (per .planning/ROADMAP.md Phase 3)

---

## REQ-operating-layer
source: .planning/PROJECT.md (section "What")
scope: claude/, opencode/

A set of commands, agents, and hooks for memory, wiki, security, and review workflows, usable across harnesses (Claude Code, OpenCode, ...).

Acceptance:
- Commands/agents/hooks work end-to-end against the cairn-memory MCP
- Memory hooks (wakeup/capture/review) round-trip (per .planning/ROADMAP.md Phase 2)

---

## REQ-provider-neutral-core
source: .planning/PROJECT.md (section "Goals")
scope: entire core

Provider-neutral core: no vendor names, no hardcoded endpoints. All LLM and git-provider configuration is external and swappable.

Acceptance:
- Git host selected by one config setting; collaboration commands resolve through a provider config key + per-provider operation→tool map (per .planning/ROADMAP.md Phase 1, delivered)
- No hardcoded vendor endpoints anywhere in the core

---

## REQ-feature-parity
source: .planning/PROJECT.md (section "Goals")
scope: entire project (milestone target)

Feature parity with the originating private workflow, so the OSS core can be adopted as a drop-in replacement.

Acceptance:
- Parity sign-off per .planning/ROADMAP.md Phase 3: operating guide in OSS docs, fresh bootstrap works same-as-before, baseline tagged

---

## REQ-oss-hygiene
source: .planning/PROJECT.md (section "Goals")
scope: repo governance

Clean open-source hygiene: Apache-2.0 license, CI, no secrets, no attribution noise.

Acceptance:
- Apache-2.0 license present
- CI in place (build + smoke test exists per repo history)
- No secrets or attribution noise in any artifact (enforced by DEC-commit-scanning, see intel/decisions.md)
