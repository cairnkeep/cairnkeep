# Phase 11: Self-Consistency & Public Positioning - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 11 makes cairnkeep's public story true and self-consistent: token-miser
is **published and presented as a public cairnkeep-org sibling** (SC-01), the
operating docs **match the shipped Phase 10 code with no drift** (SC-02), and
a **full-repo no-private-references scan passes and is recorded as an explicit
milestone gate** (SC-03).

Scouting established that SC-01 has a real-world prerequisite: token-miser is
currently **private** (`github.com:stondo/token-miser`), not under the
cairnkeep org, has **no LICENSE**, and its own README references the operator's
employer by name. The user decided the publish itself is **in-phase work**
(see D-01/D-02) — a cross-repo plan operating on `~/PARA/Projects/token-miser`.

This is HOW to position, document, and gate — not new runtime capabilities
(those belong to Phases 12/13).

</domain>

<decisions>
## Implementation Decisions

### token-miser publication path (SC-01 prerequisite)
- **D-01: Clean-slate publish.** Mirror cairnkeep's own carve-out: scrub the
  working tree, add Apache-2.0, **re-init history** (no private history ever
  pushed), publish to `github.com/cairnkeep/token-miser` as **public**.
  Rejected: transferring the existing repo + history rewrite (leak-audit
  burden), and defer-with-dead-link (fails SC-01's "linked" as written).
- **D-02: In-phase plan.** The scrub + publish is a Phase 11 plan executing
  cross-repo in `~/PARA/Projects/token-miser`. Verifiable end-to-end:
  `gh repo view cairnkeep/token-miser --json visibility` → `PUBLIC`.
  Scrub scale measured: 147 employer-name hits across 26 of 76 tracked files,
  **zero in `src/`** — docs/config/bench naming, not code surgery.
- **D-03: Public becomes canonical.** `cairnkeep/token-miser` is token-miser's
  real home going forward; `stondo/token-miser` becomes a private archive.
  Employer-specific config moves to a private overlay (mirrors cairnkeep's
  enterprise-overlay pattern). The docs' "public sibling" claim is simply true.
- **D-04: Trimmed-core published tree.** Publish `src/` + Cargo files +
  scrubbed README/QUICKSTART/docs + neutrally-renamed example configs
  (`config.enterprise.example.toml` gets a neutral name) + LICENSE. Drop `.ai/`
  launchers, `.planning/`, `bench/`, `CLAUDE.md`/`AGENTS.md` from the public
  tree. Constraint: the public tree must build (`cargo build`) and be useful
  standalone.

### No-private-references guard (SC-03)
- **D-05: Re-runnable script** `scripts/verify-no-private-references.sh`,
  alongside the existing `verify-*.sh` family (verify-by-execution bar).
  Also run against the token-miser publish tree **before** its first push
  (D-01 synergy).
- **D-06: Hybrid denylist.** Generic detectors are committed (AI-authorship
  phrases per DEC-no-ai-authorship, internal-TLD/IP patterns, obvious private
  markers); **specific terms (employer, private repo names) live in an
  uncommitted file** referenced by an env var (e.g. `CAIRN_GUARD_DENYLIST`,
  naming per the established `CAIRN_*` env-only idiom). **Fail closed**: env
  var set but file unreadable → non-zero exit. Any hit → non-zero exit.
- **D-07: Scan scope = tracked tree + commit messages.** `git grep` over all
  tracked files (`.planning/` is tracked and included) plus a `git log` scan
  of every commit message — honors the LOCKED DEC's "commit messages" clause,
  which SC-03's wording omitted. Historical diffs out of scope
  (DEC-commit-scanning has guarded content since day one).
- **D-08: Milestone-run, recorded.** Run locally as part of Phase 11
  verification and at each milestone close; the command, date, and zero-hit
  output are recorded in the phase VERIFICATION/UAT doc and MILESTONES.md.
  No CI wiring now (the specific denylist is local-only); add later only if
  proven insufficient.

### Docs drift sweep (SC-02)
- **D-09: Full three-doc sweep.** Audit `README.md`, `docs/operating.md`, and
  `docs/git-providers.md` against the shipped code: every env key, command
  list/count, hook list, tool description, and script reference must match
  reality. Known drift already confirmed:
  - `docs/operating.md` says "**10 commands**" and lists 10 — `claude/commands/`
    has **11**; `context-explore` is missing from the list.
  - `docs/operating.md` §Configuration table lacks `CAIRN_EXPLORE_BINARY` and
    `CAIRN_EXPLORE_REPO_ROOT` (gap explicitly assigned to this phase by
    Phase 10's CONTEXT).
  - `docs/operating.md` §The workflow has no context-explore (or routing)
    entries.
  - `README.md` config table has neither `CAIRN_ROUTE_ENDPOINT` nor the
    `CAIRN_EXPLORE_*` keys.
- **D-10: Drift proof = mechanized parity check + recorded cold read.** A
  small parity check (diff the sorted `CAIRN_*`/`MCP_*` env keys and command
  filenames found in code against those named in the docs) plus a recorded
  cold-read verification in the style of Phase 10's UAT. The parity check
  prevents re-accumulation; the cold read catches prose-level inaccuracy.

### Positioning placement & README refresh (SC-01/SC-02)
- **D-11: README + operating.md.** README gets a short "Related projects"
  mention of token-miser (name, one-liner, link to
  `github.com/cairnkeep/token-miser`); `docs/operating.md` carries the fuller
  description where the routing-seam and explore features are documented.
- **D-12: Describe both wires, briefly.** One sentence each, where the feature
  is documented: `context_explore` delegates to `token_miser explore`
  (subprocess); `route_check` checks the routing proxy's `/health` (HTTP).
  Each names token-miser as the public sibling owning that capability, plus
  the link. No dedicated section describing token-miser's internals (tiers,
  FastContext architecture) — that's token-miser's own README's job and a
  standing drift risk here.
- **D-13: Refresh README's Status section.** Replace the stale "Early…
  being carved out… first component is the memory server" framing with
  shipped reality: memory server + CLI + operating layer on both harnesses,
  context exploration, routing seam, token-miser as public sibling.

### Claude's Discretion
- Guard/parity script structure and naming (one script vs. two, exact flag
  names, denylist file format) — preserve: fail-closed behavior, non-zero exit
  on any hit, one-command local run, no private term ever committed.
- Exact neutral replacement wording for scrubbed token-miser docs/configs —
  preserve: provider-neutral, accurate ("any OpenAI-compatible endpoint"-style
  framing), no employer/vendor/internal-host names.
- Exact README "Related projects" and Status wording.
- Order of plans, except: the token-miser publish must complete before the
  cairnkeep docs land the public link, and the guard must exist before the
  publish (it gates the publish tree).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 11: Self-Consistency & Public Positioning" —
  goal + the 3 Success Criteria gating this phase.
- `.planning/REQUIREMENTS.md` — **SC-01** (public sibling named/linked/
  described), **SC-02** (docs match shipped code), **SC-03** (guard passes as
  milestone gate).
- `.planning/PROJECT.md` §Constraints — **DEC-no-private-references [LOCKED]**,
  **DEC-no-ai-authorship [LOCKED]**, **DEC-commit-scanning [LOCKED]**, and the
  LOCKED v1.2 thin-delegate boundary (docs must keep that framing).

### The docs being audited/changed (SC-01/SC-02 targets)
- `README.md` — front door; gets Related-projects mention, config-table
  completion, Status refresh (D-11/D-13).
- `docs/operating.md` — §Configuration table (missing `CAIRN_EXPLORE_*`),
  §"Routing seam (`route_check`, opt-in)" (Phase 10's frozen seam contract —
  do not weaken it), §Setup order (the "10 commands" list), §The workflow.
- `docs/git-providers.md` — included in the three-doc sweep (D-09).

### Ground truth the docs must match (SC-02)
- `mcp-memory-server/src/index.ts` — actual env keys: `CAIRN_EXPLORE_BINARY`,
  `CAIRN_EXPLORE_REPO_ROOT`, `CAIRN_ROUTE_ENDPOINT`, plus the `CAIRN_LLM_*`/
  `CAIRN_MEMORY_*`/`MCP_HTTP_*` families.
- `claude/commands/` (11 commands incl. `context-explore.md`) and
  `claude/hooks/` (3 hooks) — the real operating-layer inventory.
- `.planning/phases/10-routing-seam/10-CONTEXT.md` — records that the
  `CAIRN_EXPLORE_*` doc gap is Phase 11's (SC-02) responsibility, and the
  seam-contract decisions (D-08/D-10 there) the docs must stay consistent with.

### Verify-by-execution precedent (for guard + parity scripts)
- `scripts/verify-routing-seam.sh`, `scripts/verify-token-savings-ab.sh`,
  `scripts/verify-fastcontext-reliability.sh` — the re-runnable verify-script
  pattern D-05/D-10 follow.

### The cross-repo publish target (D-01…D-04)
- `~/PARA/Projects/token-miser` — the repo being scrubbed and published
  (outside this repo; measured: 147 employer hits / 26 of 76 tracked files /
  0 in `src/`; no LICENSE; remote `stondo/token-miser`, private).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`scripts/verify-*.sh` family**: the established gate-script shape
  (bash, `--help`, evidence output, non-zero on failure) — the new guard and
  parity scripts copy it.
- **`CAIRN_*` env-only config idiom**: the denylist env var (D-06) slots into
  the same pattern; document it like the other opt-in vars.
- **Phase 10's routing-seam section in `docs/operating.md`** (lines ~107-134):
  already written self-consistently — the sweep verifies rather than rewrites
  it; token-miser sibling naming/link is added to it.

### Established Patterns
- **Verify-by-execution [repo-wide]**: gates are re-runnable scripts with
  recorded output, not prose claims — D-05/D-08/D-10 all follow it.
- **Thin-delegate framing [LOCKED v1.2]**: all new prose must keep describing
  `context_explore`/`route_check` as thin delegates holding no endpoint/model/
  tier config.
- **Enterprise-overlay split [LOCKED]**: employer-specific token-miser config
  moves to a private overlay, exactly as cairnkeep's own overlay does (D-03).

### Integration Points
- New scripts land in `scripts/` next to the verify family.
- Doc edits: `README.md`, `docs/operating.md`, `docs/git-providers.md`.
- Cross-repo: `~/PARA/Projects/token-miser` working tree → new
  `github.com/cairnkeep/token-miser` public repo (org already exists and
  currently holds only `cairnkeep/cairnkeep`).
- Gate evidence: phase VERIFICATION/UAT doc + `.planning/MILESTONES.md`.

</code_context>

<specifics>
## Specific Ideas

- The publish is verifiable the same way everything else here is: run the
  guard against the publish tree (zero hits), `cargo build` the trimmed tree,
  then `gh repo view cairnkeep/token-miser` shows PUBLIC — record all three.
- Sequencing constraint worth honoring in plan order: guard script first
  (it gates the token-miser publish tree), publish second, docs last (so the
  README/operating.md link points at a repo that already exists).
- The guard's commit-message scan closes a real DEC/SC-03 wording gap the
  user explicitly chose to cover (D-07) — don't silently drop it if the
  script gets simplified.

</specifics>

<deferred>
## Deferred Ideas

- **CI wiring for the guard** (denylist via GitHub Actions secret, run on
  every push) — deliberately not now (D-08); revisit if local milestone runs
  prove insufficient.
- **A dedicated token-miser relationship/architecture section** in cairnkeep
  docs (tiers, FastContext, overlay story) — rejected as standing drift risk
  (D-12); token-miser's own public README owns its story.
- **token-miser's own public-repo maturation** (CI, issue templates, deeper
  docs) — belongs to the token-miser project after this phase publishes it,
  not to cairnkeep's roadmap.

</deferred>

---

*Phase: 11-self-consistency-public-positioning*
*Context gathered: 2026-07-06*
