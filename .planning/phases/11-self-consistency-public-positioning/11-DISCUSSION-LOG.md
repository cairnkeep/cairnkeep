# Phase 11: Self-Consistency & Public Positioning - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-06
**Phase:** 11-self-consistency-public-positioning
**Areas discussed:** token-miser publication path, Guard mechanism (SC-03), Drift-sweep breadth (SC-02), Positioning placement & README refresh

---

## token-miser publication path

*Scouting finding that framed this area: token-miser is private (`stondo/token-miser`), not in the cairnkeep org, has no LICENSE, and its README references the operator's employer. Scrub scale measured at 147 hits across 26 of 76 tracked files, zero in `src/`.*

**Q1: How does token-miser become the public sibling that cairnkeep's docs link to?**

| Option | Description | Selected |
|--------|-------------|----------|
| Clean-slate publish | Scrub working tree, add Apache-2.0, re-init history, push to cairnkeep/token-miser as public | ✓ |
| Transfer + history scrub | Move existing repo into org, rewrite git history | |
| Defer publication, link future home | Docs link the intended home; publication later (dead link) | |

**Q2: Where does the scrub+publish work live relative to Phase 11?**

| Option | Description | Selected |
|--------|-------------|----------|
| In-phase plan | A Phase 11 plan does the cross-repo scrub + publish before the docs/guard plans | ✓ |
| User-side prerequisite | User publishes separately; phase blocks on it | |
| You decide | Claude picks mechanics at planning time | |

**Q3: After the publish, which repo is canonical?**

| Option | Description | Selected |
|--------|-------------|----------|
| Public becomes canonical | cairnkeep/token-miser is the real home; stondo/token-miser becomes a private archive; employer config → private overlay | ✓ |
| Private upstream, public mirror | Dev stays private; public is a synced scrubbed mirror | |
| You decide | | |

**Q4: What goes into the published tree?**

| Option | Description | Selected |
|--------|-------------|----------|
| Trimmed core | src/ + Cargo + scrubbed README/QUICKSTART/docs + neutral example configs + LICENSE; drop .ai/.planning/bench/CLAUDE.md/AGENTS.md | ✓ |
| Full tree, everything scrubbed | Publish whole tree incl. .planning/.ai after scrubbing all 26 files | |
| You decide | | |

**User's choice:** Clean-slate publish, in-phase, public-canonical, trimmed core — all recommended options.
**Notes:** None beyond the selections.

---

## Guard mechanism (SC-03)

**Q1: What form does the guard take?**

| Option | Description | Selected |
|--------|-------------|----------|
| Re-runnable script | scripts/verify-no-private-references.sh alongside the verify-*.sh family; reusable on the token-miser publish tree | ✓ |
| Recorded manual scan | Documented git-grep procedure pasted into VERIFICATION | |

**Q2: How does the script get its denylist (specific terms can't be committed)?**

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: generic committed + external file | Generic detectors committed; specific terms via env-fed uncommitted file (e.g. CAIRN_GUARD_DENYLIST); fail-closed | ✓ |
| External file only | All terms external; fresh clone scans for nothing | |
| You decide | | |

**Q3: What does the guard scan?**

| Option | Description | Selected |
|--------|-------------|----------|
| Tracked tree + commit messages | git grep over tracked files (incl. .planning) + git log message scan; honors the DEC's commit-messages clause | ✓ |
| Tracked tree only | Literally what SC-03 lists | |
| Tree + messages + full history diffs | Scan every historical blob | |

**Q4: When does it run, where is it recorded?**

| Option | Description | Selected |
|--------|-------------|----------|
| Milestone-run, recorded in phase docs | Local run at phase verification + milestone close; output recorded in VERIFICATION/UAT + MILESTONES.md; no CI | ✓ |
| Also wire into CI | CI job with denylist from GitHub secret | |
| You decide | | |

**User's choice:** All recommended options.
**Notes:** CI wiring captured as a deferred idea.

---

## Drift-sweep breadth (SC-02)

*Scouting finding that framed this area: `claude/commands/` has 11 commands including `context-explore.md`, but operating.md says "10 commands" and omits it; config table lacks CAIRN_EXPLORE_*; workflow section lacks explore/routing; README config table lacks route/explore keys.*

**Q1: How broad is the sweep?**

| Option | Description | Selected |
|--------|-------------|----------|
| Full three-doc sweep | README + operating.md + git-providers.md audited against code: env keys, command lists/counts, hooks, tools, script refs | ✓ |
| Routing + explore only | Just what SC-02 names + the carried-forward table gap | |

**Q2: How is "no drift" proven?**

| Option | Description | Selected |
|--------|-------------|----------|
| Parity check + cold read | Mechanized diff of env keys/command filenames code-vs-docs, plus a recorded cold read like Phase 10's UAT | ✓ |
| Cold-read UAT only | Human/agent read with recorded verdict; no tooling | |
| You decide | | |

**User's choice:** Full sweep with parity check + cold read.
**Notes:** Script structure/naming left to planner latitude.

---

## Positioning placement & README refresh

**Q1: Where does the sibling positioning land?**

| Option | Description | Selected |
|--------|-------------|----------|
| README + operating.md | README "Related projects" mention (name, one-liner, link); operating.md carries the fuller description | ✓ |
| operating.md only | README untouched | |
| You decide | | |

**Q2: How deep does the description go?**

| Option | Description | Selected |
|--------|-------------|----------|
| Both wires, briefly | One sentence each where documented: explore = subprocess delegate, route_check = /health HTTP check; each names + links the sibling | ✓ |
| One-liner + link only | Minimal mention | |
| Full relationship section | Dedicated section on tiers/FastContext/overlay — drift risk | |

**Q3: Refresh README's stale Status section?**

| Option | Description | Selected |
|--------|-------------|----------|
| Refresh in this phase | Update to shipped reality (both harnesses, explore, routing seam, sibling) | ✓ |
| Leave it — out of scope | Defer to a later docs pass | |

**User's choice:** README + operating.md, both wires briefly, Status refreshed.
**Notes:** None.

---

## Claude's Discretion

- Guard/parity script structure and naming (one script vs. two, flag names, denylist file format) — constraints: fail-closed, non-zero on hit, one-command run, no private term committed.
- Neutral replacement wording for scrubbed token-miser docs/configs.
- Exact README "Related projects" and Status wording.
- Plan ordering, subject to: guard before publish, publish before docs link.

## Deferred Ideas

- CI wiring for the guard (denylist via Actions secret) — revisit if local milestone runs prove insufficient.
- Dedicated token-miser architecture section in cairnkeep docs — rejected as drift risk; token-miser's own README owns its story.
- token-miser public-repo maturation (CI, issue templates, deeper docs) — belongs to the token-miser project post-publish.
