# Roadmap: Cairnkeep

## Released baseline

- v1.0 through v1.3: original OSS parity and context maturation milestones
- v2.4: agent scaffolding and measurement
- v2.9: MCP trust profiles and immutable context packs
- v2.10: native Windows support
- v2.11: guided setup, harness selection, Pi MCP bridge
- v2.12: harness registry and Codex setup
- v2.13: Git-linked work evidence and CycloneDX 1.6 SBOM
- v2.14: reviewed OKF knowledge exchange

The public Git tag and package version are the release authority. Older detailed
GSD milestone archives remain under `.planning/milestones/`.

## Completed milestone: v2.15 Cairnkeep Playbooks

### Phase 27: Playbooks Workflow Kernel

**Goal:** Agents receive an opinionated, customizable, observable workflow that
selects appropriate context, planning, verification, review, security,
documentation, and learning practices without turning Cairnkeep into an agent
runtime or weakening approval boundaries.

**Requirements:** PBK-01–PBK-06, WFL-01–WFL-03, TEAM-01–TEAM-02, COMP-01, DOC-01

**Success criteria:**

1. A user can initialize and customize a strict local playbook, inspect its
   canonical digest, and receive byte-stable decisions for identical inputs.
2. Agents can follow a small start/check/finish workflow; `must` actions fail
   enforcement until evidence is supplied, while Cairnkeep executes nothing.
3. Setup and bootstrap safely install balanced guidance without overwriting
   user instructions, and every supported harness receives a usable adapter.
4. Private receipts explain what ran or was skipped and why, bound to policy,
   decision, project, session, and an explicitly unverified local actor.
5. The full compatibility, security, documentation, learning, package, and
   release suites pass; future team mode has a complete design contract but is
   not misrepresented as shipped isolation.

**Plans:** 5

- [x] 27-01 — Contracts and threat boundary
- [x] 27-02 — Policy engine, CLI, enforcement, and receipts
- [x] 27-03 — Agent workflow and harness integration
- [x] 27-04 — Team foundation and documentation
- [x] 27-05 — Review, release readiness, and shipping

## Progress

| Phase | Milestone | Status | Plans |
|-------|-----------|--------|-------|
| 27. Playbooks Workflow Kernel | v2.15 | Complete | 5/5 |
