# Cairnkeep

## What This Is

A durable, harness-agnostic memory + context layer for coding agents (Claude Code, OpenCode, ...): the `cairn-memory` MCP server (Node.js/TypeScript), a CLI (`cairn`) that bootstraps a project's launchers and derived-knowledge layer, and an operating layer of commands, agents, and hooks for memory, wiki, security, and review workflows.

## Core Value

Drop-in parity: a fresh `cairn bootstrap` plus the carved commands, agents, and hooks reproduce the originating private workflow end-to-end, verified against the `cairn-memory` MCP server.

## Requirements

### Validated

- ✓ **REQ-provider-neutral-core** — git host selected by one provider config key; collaboration commands resolve every git-host operation through a per-provider operation→tool map; no hardcoded vendor endpoints anywhere in the core (Phase 1)

### Active

- [ ] **REQ-memory-mcp-server** — `cairn-memory` registers and responds as an MCP server; remember/recall work end-to-end
- [ ] **REQ-operating-layer** — commands, agents, and hooks for memory, wiki, security, and review workflows work end-to-end against `cairn-memory` across harnesses; memory hooks (wakeup/capture/review) round-trip
- [ ] **REQ-cli-bootstrap** — a fresh `cairn bootstrap` yields a working same-as-before workflow
- [ ] **REQ-feature-parity** — parity sign-off: operating guide in the OSS docs, fresh bootstrap works same-as-before, baseline tagged
- [ ] **REQ-oss-hygiene** — Apache-2.0 license, CI, no secrets, no attribution noise

### Out of Scope

- Enterprise overlay contents (organization-specific launchers and config) — lives only on the private remote, never in this repo (per DEC-no-private-references)
- token-miser integration — the routing + context-explore sibling; optional companion deferred to a future milestone
- Vendor-specific hardcoding (LLM or git host) — the core stays provider-neutral; all such configuration is external and swappable

## Context

- Layout: `mcp-memory-server/` (the `cairn-memory` MCP server), `bin/cairn` + `scripts/` (CLI, bootstrap, utilities), `templates/` (project scaffolding + derived-knowledge templates), `claude/` + `opencode/` (commands, agents, hooks, and plugins — the operating layer)
- Target runtime: Node.js/TypeScript for the MCP server; the operating layer targets the Claude Code and OpenCode harnesses
- Milestone "OSS core → parity" is mid-flight: Phase 1 (configurable git-provider abstraction) is complete; Phase 2 (operating-layer verification) is current; Phase 3 (docs + parity sign-off) is pending
- CI (build + smoke-test of the memory server) already exists per repo history

## Constraints (hard rules)

<decisions>

**DEC-no-private-references [LOCKED]**
The public repo never references any specific employer, vendor, internal host/IP, or private repo name — in code, comments, commit messages, or docs.
Corollary: the enterprise overlay wrapping the core with organization-specific launchers and config lives only on the private remote, never in this repo.

**DEC-no-ai-authorship [LOCKED]**
No AI/assistant authorship references anywhere — commits, comments, or docs.

**DEC-commit-scanning [LOCKED]**
Every commit is scanned (contents + message) before it is created.

</decisions>

Additional constraints:

- **Tech stack**: Node.js/TypeScript for `cairn-memory` — matches the MCP ecosystem and the existing CI
- **Compatibility**: Provider-neutral core — all LLM and git-provider configuration is external and swappable; git host selected by one config setting
- **Licensing**: Apache-2.0 — clean open-source hygiene target

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Git host resolved via one provider config key + per-provider operation→tool map | Collaboration commands must work against any git host, never assuming one | ✓ Good (Phase 1) |
| Enterprise overlay kept private-only | Enforces DEC-no-private-references; keeps the OSS core neutral | — Pending |
| Three hard rules locked (see decisions block above) | Public-repo hygiene is non-negotiable | ✓ Good |

---
*Last updated: 2026-07-03 after ingest of existing planning docs*
