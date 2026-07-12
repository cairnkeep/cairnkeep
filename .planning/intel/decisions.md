# Decisions

Extracted from ingested planning docs. LOCKED decisions cannot be overridden by any downstream synthesis or planning step; changing one requires explicit user action on the source doc.

---

## DEC-no-private-references [LOCKED]
source: .planning/PROJECT.md (section "Constraints (hard rules)")
status: locked
scope: public repo content (code, comments, commit messages, docs)

The public repo never references any specific employer, vendor, internal host/IP, or private repo name — in code, comments, commit messages, or docs.

Corollary (from .planning/ROADMAP.md, "Future milestones"): the enterprise overlay wrapping the core with organization-specific launchers and config lives only on the private remote, never in this repo.

---

## DEC-no-ai-authorship [LOCKED]
source: .planning/PROJECT.md (section "Constraints (hard rules)")
status: locked
scope: all repo artifacts (commits, comments, docs)

No AI/assistant authorship references anywhere — commits, comments, or docs.

---

## DEC-commit-scanning [LOCKED]
source: .planning/PROJECT.md (section "Constraints (hard rules)")
status: locked
scope: commit workflow

Every commit is scanned (contents + message) before it is created.
