# Context

Background notes from ingested docs, keyed by topic, with source attribution. No DOC-typed docs were in the ingest set; entries below are contextual (non-normative) content from the PRD/SPEC sources.

---

## Topic: Repo layout
source: .planning/PROJECT.md (section "Layout")

- `mcp-memory-server/` — the `cairn-memory` MCP server
- `bin/cairn`, `scripts/` — CLI, bootstrap, and utilities
- `templates/` — project scaffolding + derived-knowledge templates
- `claude/`, `opencode/` — commands, agents, hooks, and plugins (the operating layer)

---

## Topic: Milestone structure and phase status
source: .planning/ROADMAP.md

Milestone "OSS core → parity": bring the open-source core to feature parity with the originating workflow so it can be adopted as a drop-in.

- Phase 1 — Configurable git-provider abstraction: DONE (marked "(done)" in source; preserve this status downstream — do not re-plan Phase 1)
- Phase 2 — Operating-layer verification: pending
- Phase 3 — Docs + parity sign-off: pending

---

## Topic: Future milestones (out of current scope)
source: .planning/ROADMAP.md (section "Future milestones")

- Enterprise overlay (private) — wraps the core with organization-specific launchers and config; lives only on the private remote, never in this repo (reinforces DEC-no-private-references, see intel/decisions.md)
- token-miser integration — the routing + context-explore sibling, brought in as an optional companion
