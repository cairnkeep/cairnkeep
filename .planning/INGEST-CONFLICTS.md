## Conflict Detection Report

### BLOCKERS (0)

(none)

### WARNINGS (0)

(none)

### INFO (3)

[INFO] Precedence override applied per manifest
  Note: .planning/PROJECT.md (PRD) assigned precedence 0 and .planning/ROADMAP.md (SPEC) precedence 1, overriding the default type order ADR > SPEC > PRD. No content contradiction required the override to be exercised — the two docs are complementary (project definition + roadmap, authored together). Cross-ref cycle detection: no cross-references between the two docs, no cycles.

[INFO] PROJECT.md hard rules treated as LOCKED decisions
  Note: The three entries under "Constraints (hard rules)" in .planning/PROJECT.md (no employer/vendor/private references; no AI authorship references; commit scanning before creation) were extracted as LOCKED decisions in .planning/intel/decisions.md. No LOCKED-vs-LOCKED contradictions exist among them, and .planning/ROADMAP.md's "enterprise overlay lives only on the private remote" reinforces rather than contradicts DEC-no-private-references.

[INFO] Phase 1 completion status preserved
  Note: .planning/ROADMAP.md marks Phase 1 (configurable git-provider abstraction) as done. The corresponding constraint (CON-git-provider-abstraction in .planning/intel/constraints.md) carries status "delivered"; downstream planning must not re-plan Phase 1.
