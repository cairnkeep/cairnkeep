# Synthesis Summary

Entry point for downstream consumers (gsd-roadmapper). Mode: new. Ingested 2026-07-03.

## Docs synthesized

2 docs, both fully read and extracted:
- .planning/PROJECT.md — PRD, precedence 0 (manifest override)
- .planning/ROADMAP.md — SPEC, precedence 1 (manifest override)

Provenance note: classification metadata (type, precedence, LOCKED semantics for PROJECT.md hard rules, Phase 1 done status) was taken from the ingest manifest; both source docs were read directly and in full. No content was skipped.

Cycle detection: no cross-references between the two docs; no cycles.

## Decisions locked: 3

Source: .planning/PROJECT.md "Constraints (hard rules)" → intel/decisions.md
- DEC-no-private-references [LOCKED]
- DEC-no-ai-authorship [LOCKED]
- DEC-commit-scanning [LOCKED]

## Requirements extracted: 6

Source: .planning/PROJECT.md → intel/requirements.md
- REQ-memory-mcp-server
- REQ-cli-bootstrap
- REQ-operating-layer
- REQ-provider-neutral-core
- REQ-feature-parity
- REQ-oss-hygiene

## Constraints extracted: 3

Source: .planning/ROADMAP.md → intel/constraints.md
- CON-git-provider-abstraction (api-contract) — status: delivered (Phase 1 done)
- CON-mcp-e2e-verification (protocol) — status: pending (Phase 2)
- CON-bootstrap-parity (nfr) — status: pending (Phase 3)

## Context topics: 3

→ intel/context.md
- Repo layout
- Milestone structure and phase status (Phase 1 DONE — do not re-plan)
- Future milestones (enterprise overlay private-only; token-miser optional companion)

## Conflicts

0 blockers, 0 competing variants, 3 auto-resolved/info entries.
Detail: .planning/INGEST-CONFLICTS.md

## Files

- .planning/intel/decisions.md
- .planning/intel/requirements.md
- .planning/intel/constraints.md
- .planning/intel/context.md
- .planning/INGEST-CONFLICTS.md
