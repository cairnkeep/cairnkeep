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
- v2.15: bounded workflow playbooks and future team-mode design
- v2.16: dependency-free guided setup selectors
- v2.17: measured context intelligence and guarded memory proposals

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

## Completed release: v2.16 Guided Setup Selectors

**Goal:** Make interactive onboarding clear and efficient without changing the
deterministic setup contract used by scripts, CI, policies, and overlays.

**Delivered:** Dependency-free terminal selectors for Git and memory choices,
Space-toggle harness checkboxes, selectable confirmation, safe cancellation,
limited-terminal fallback, and non-interactive output detection.

**Status:** Released as v2.16.0 on 2026-08-27.

## Completed release: v2.17 Context Intelligence

**Goal:** Improve retrieval quality and explainability while retaining local
authority, response compatibility, explicit consent, and review-before-write
memory boundaries.

**Delivered:**

- A frozen offline retrieval benchmark with quality, latency, cost, mutation,
  and forbidden-leakage measurements.
- Progressive context-pack tree, summary cache, opt-in hierarchical search,
  stable result digests, and sanitized explanation traces.
- Privacy-preserving context-usage receipts linked to work evidence.
- Digest-bound trajectory-derived memory proposals with explicit review and
  apply steps.
- A gated, read-only OpenViking retrieval adapter that cannot replace or mutate
  Cairnkeep authority.
- Complete Node 22/24/26, native Windows, Bash 3.2, package, container,
  compatibility, documentation, learning, and release verification.

**Status:** Released as v2.17.0 on 2026-08-29 from
`350849e800399da105afbfb349b53b5179bf90b0`.

## Next milestone gate

Do not select another large feature solely from architecture comparisons. First
complete overlay/fleet adoption and run a bounded private pilot that measures
retrieval usefulness, forbidden-result isolation, receipt quality, proposal
acceptance/rejection, and operational friction. Use that evidence to choose the
smallest next milestone.
