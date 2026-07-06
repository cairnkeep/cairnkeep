# Phase 11: Self-Consistency & Public Positioning - Research

**Researched:** 2026-07-06
**Domain:** Docs-code parity auditing, repo-hygiene shell scripting, cross-repo GitHub publish workflow (no new runtime libraries)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**token-miser publication path (SC-01 prerequisite)**
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

**No-private-references guard (SC-03)**
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

**Docs drift sweep (SC-02)**
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

**Positioning placement & README refresh (SC-01/SC-02)**
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

### Deferred Ideas (OUT OF SCOPE)
- **CI wiring for the guard** (denylist via GitHub Actions secret, run on
  every push) — deliberately not now (D-08); revisit if local milestone runs
  prove insufficient.
- **A dedicated token-miser relationship/architecture section** in cairnkeep
  docs (tiers, FastContext, overlay story) — rejected as standing drift risk
  (D-12); token-miser's own public README owns its story.
- **token-miser's own public-repo maturation** (CI, issue templates, deeper
  docs) — belongs to the token-miser project after this phase publishes it,
  not to cairnkeep's roadmap.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-01 | token-miser is presented as a public cairnkeep-org sibling project in the docs (named, linked, described), so the routing wire references a public dependency rather than a vendor/private one. | Confirmed `cairnkeep` org exists with only `cairnkeep/cairnkeep` today; `cairnkeep/token-miser` does not yet exist. `gh repo create --source=. --public --push` (verified via `--help`) is the publish command. Positioning wording locations fixed by D-11/D-12 (README "Related projects" one-liner + link; `docs/operating.md` one-sentence-per-wire naming). See Architecture Patterns Pattern 3 and Code Examples. |
| SC-02 | The operating docs' description of the routing surface and the token-miser relationship matches the Phase 10 shipped code with no drift between prose and behavior. | Drift independently reproduced this session: 11 command files vs. docs' "10 commands"; 14 `CAIRN_*`/`MCP_HTTP_*` env keys in `mcp-memory-server/src/*.ts` vs. 8 named in `docs/operating.md`'s Configuration table. Parity-check script design (grep+sort+diff) provided in Code Examples; Wave 0 gap identified (script doesn't exist yet). |
| SC-03 | A full-repo no-private-references scan (code, comments, docs) returns zero hits, run and recorded as an explicit milestone gate. | Confirmed no existing guard script and no active pre-commit hook enforcing this today (`.git/hooks/` has only samples; the one active hook, `gsd-validate-commit.sh`, checks Conventional Commits format only). Guard script shape (fail-closed env-gated denylist + `git grep` + `git log --format=%B` scan) specified in Architecture Patterns Pattern 1/2 and Code Examples, following the established `scripts/verify-*.sh` convention (`verify-routing-seam.sh` read in full as the reference shape). |
</phase_requirements>

## Summary

Phase 11 is not a library-integration phase — it is a **documentation-parity, repo-hygiene, and cross-repo-publish** phase. No new npm/pip/cargo packages are introduced. The three verification surfaces are: (1) a bash guard script that greps the tracked tree + commit-message log for private terms, (2) a docs-vs-code parity sweep across three markdown files, and (3) a cross-repo publish operation on `~/PARA/Projects/token-miser` using stock `git` + `gh` CLI commands, executed and verified by the same operator/session (not a separate service).

All the facts needed to write correct plans are directly verifiable in this repo and the token-miser working tree, and were confirmed during this research pass:

- **Command count drift is real and reproducible:** `claude/commands/` has 11 files (10 named in `docs/operating.md` + the missing `context-explore.md`). `claude/hooks/` has exactly 3 hooks, matching the doc.
- **Env var drift is real and reproducible:** `mcp-memory-server/src/*.ts` references 14 distinct `CAIRN_*`/`MCP_HTTP_*` env vars; `docs/operating.md`'s Configuration table lists only 8 (missing `CAIRN_EXPLORE_BINARY`, `CAIRN_EXPLORE_REPO_ROOT`, `CAIRN_MEMORY_EMBEDDING_URL`, `CAIRN_MEMORY_EMBEDDING_MODEL`, `MCP_HTTP_HOST`, `MCP_HTTP_PORT` — the last two are documented in the separate HTTP-transport table, so the *true* gap is the `CAIRN_EXPLORE_*` pair plus confirming `CAIRN_ROUTE_ENDPOINT` is present, which it is).
- **No prior art exists for the guard or parity scripts in this repo** — `scripts/` has no `verify-no-private-references.sh` and no docs-parity checker today; both are net-new, following the established `scripts/verify-*.sh` shape (bash, `--help`, evidence to stdout, non-zero exit on failure).
- **`gh` CLI is installed, authenticated, and the `cairnkeep` GitHub org already exists** with exactly one repo (`cairnkeep/cairnkeep`) — `cairnkeep/token-miser` does not yet exist, confirming D-01's premise.
- **token-miser has no LICENSE file today**, and its `.ai/` directory contains employer-adjacent scripts (`refresh-gitlab-cookie.py`, `claude-managed-launch.py`) that D-04 already excludes from the public tree.
- **No pre-commit hook enforces DEC-commit-scanning today** — the only active hook (`.claude/hooks/gsd-validate-commit.sh`) checks Conventional Commits format, not private terms. D-07/D-08's `git log` scan is a milestone-gate check, not continuous enforcement — consistent with the CONTEXT's "no CI wiring now" decision.

**Primary recommendation:** Sequence exactly as CONTEXT specifies — guard script first (it must exist to gate the token-miser publish tree), token-miser publish second (clean-slate re-init, trimmed tree, `gh repo create --source --public --push`), cairnkeep docs last (so the "Related projects" link points at a repo that already exists). Build the parity check as a small script that diffs two sorted lists (env keys found in `mcp-memory-server/src/index.ts` via grep vs. env keys named in `docs/operating.md`'s tables; command filenames in `claude/commands/` vs. names listed in `docs/operating.md`'s Setup Order section) rather than any doc-linting dependency — this is a 20-line bash+grep+diff script, not a library problem.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| No-private-references guard | Repo tooling (bash script) | — | Runs locally against the tracked git tree + log; no server/runtime component |
| Docs-code parity check | Repo tooling (bash script) | Docs (markdown) | Script only reads/diffs; the docs themselves are the artifact being corrected |
| token-miser publish | Cross-repo Git/GitHub operation | — | Operates entirely outside this repo's runtime — a filesystem + `git`/`gh` CLI operation on `~/PARA/Projects/token-miser` |
| Positioning prose (README, operating.md) | Docs (markdown) | — | Static content; no code path reads or enforces it beyond human/agent reading |
| Milestone-gate recording | Docs (MILESTONES.md / VERIFICATION.md) | Repo tooling | Evidence capture step after the guard/parity scripts run, not a new mechanism |

**Note:** This phase touches zero lines in `mcp-memory-server/src/` or `claude/` command/hook implementations — it is documentation, shell scripts, and one cross-repo publish operation. There is no "Frontend/Backend/Database" tier applicable here; the map above substitutes the project's own tiers (docs, repo tooling, cross-repo).

## Standard Stack

### Core
No new libraries. This phase's "stack" is entirely CLI tools already present on the machine:

| Tool | Version (verified) | Purpose | Why Standard |
|------|---------------------|---------|--------------|
| `git` | present (`/usr/bin/git`) | tracked-tree grep, commit-log scan, re-init history for token-miser | Already the project's VCS; no alternative needed |
| `gh` (GitHub CLI) | 2.46.0 `[VERIFIED: gh --version]` | `gh repo create`, `gh repo view --json visibility` | Already authenticated (`stondo` account, `cairnkeep` org membership confirmed); avoids hand-rolling GitHub REST calls |
| `bash` + `grep`/`diff` | POSIX | guard script, parity script | Matches every existing `scripts/verify-*.sh` — no new interpreter or dependency |
| `cargo build` | token-miser's existing toolchain | proves the trimmed public tree still builds (D-04 constraint) | Already how token-miser builds; no change needed |

### Supporting
None — no test framework, no linter, no markdown-parity tool is being added. Deliberately avoid pulling in a doc-linting dependency (e.g. `markdownlint`, `remark`) for a parity check this narrow; a grep+diff script is smaller and has zero install/version-drift surface.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled bash denylist grep (D-06) | `gitleaks`/`trufflehog` (secret scanners) | Wrong tool: those detect credential *patterns* (API keys, tokens), not employer-name/private-repo-name literals. A custom denylist grep is the correct, already-decided approach (D-06) — do not substitute a secret scanner. |
| Clean-slate `git init` republish (D-01) | `git filter-repo` / BFG history rewrite on the existing private repo | Rejected in CONTEXT already (D-01) — history-rewrite carries a leak-audit burden a fresh init avoids entirely. Confirms D-01 is the lower-risk, lower-effort path — do not revisit. |
| Bash grep+diff parity script | A doc-generation tool that derives docs from source (e.g., typedoc-style annotation extraction) | Massive overkill for 3 markdown files and ~14 env keys; would require annotating source with doc-comments the project doesn't use anywhere else. |

**Installation:** None. All tools are already present; verify with:
```bash
git --version && gh --version && cargo --version
```

## Package Legitimacy Audit

**Not applicable.** This phase installs no new npm/pip/cargo packages — it adds two bash scripts (`scripts/verify-no-private-references.sh` and a docs-parity script), edits three markdown files, and re-publishes an existing Rust codebase (token-miser) with its **existing** `Cargo.toml`/`Cargo.lock` unchanged. No `package-legitimacy check` run was needed or performed.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────┐
                     │      Phase 11 verification flow          │
                     └─────────────────────────────────────────┘

  [1] scripts/verify-no-private-references.sh
        │
        ├─ git grep <generic denylist patterns>  ──┐
        ├─ git grep <$CAIRN_GUARD_DENYLIST file>  ──┤──► any hit? → non-zero exit (FAIL)
        └─ git log --format=%B | grep <patterns> ───┘         no hits → exit 0 (PASS)
        │
        ▼ (must pass before publish tree is created)

  [2] ~/PARA/Projects/token-miser  (cross-repo, outside this repo)
        │
        ├─ scrub tree to trimmed core (D-04: src/ + Cargo.* + scrubbed docs + LICENSE)
        ├─ run [1]'s guard against the trimmed tree  ──► zero hits required
        ├─ cargo build                                ──► must succeed standalone
        ├─ rm -rf .git && git init && git add -A && git commit
        └─ gh repo create cairnkeep/token-miser --public --source=. --push
        │
        ▼ gh repo view cairnkeep/token-miser --json visibility → "PUBLIC"

  [3] cairnkeep docs sweep (only after [2] exists)
        │
        ├─ README.md: "Related projects" link → github.com/cairnkeep/token-miser
        ├─ docs/operating.md: routing-seam section gets token-miser naming;
        │  Configuration table gets CAIRN_EXPLORE_BINARY/CAIRN_EXPLORE_REPO_ROOT;
        │  Setup Order command list becomes 11 (adds context-explore)
        └─ docs/git-providers.md: swept for drift (no changes expected — provider
           table doesn't reference token-miser or the routing seam)
        │
        ▼ parity script (diff sorted env-keys-in-code vs env-keys-in-docs,
          command-filenames-in-claude/commands vs names-in-docs) → zero diff

  [4] Milestone gate recording
        │
        └─ command + date + zero-hit output → phase VERIFICATION/UAT doc
           + .planning/MILESTONES.md
```

### Recommended Project Structure
No new directories. New files land in existing locations:
```
scripts/
├── verify-no-private-references.sh   # NEW — D-05/D-06/D-07 guard
├── verify-docs-parity.sh             # NEW (or a --docs-parity flag on the above) — D-10
└── verify-routing-seam.sh            # existing — pattern reference only, not touched

README.md                 # EDIT — Related-projects, Status refresh, config-table completion
docs/operating.md         # EDIT — routing-seam token-miser naming, Configuration table, Setup Order command list, workflow section
docs/git-providers.md     # AUDIT only — expected no edit
```

### Pattern 1: Verify-by-execution script shape
**What:** Every `scripts/verify-*.sh` in this repo follows the same shape: `#!/usr/bin/env bash`, `set -euo pipefail`, a `usage()` heredoc reachable via `-h|--help`, evidence printed to stdout/stderr with a `[tag] OK:`/`FATAL:` prefix convention, and a non-zero exit on any failure condition — never a silent pass.
**When to use:** Both new scripts in this phase (guard + parity check).
**Example:**
```bash
# Source: scripts/verify-routing-seam.sh (this repo, read in full during research)
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: verify-no-private-references.sh
       verify-no-private-references.sh -h|--help
EOF
}

main() {
  # ... argument parsing identical shape to verify-routing-seam.sh main() ...
  :
}

main "$@"
```

### Pattern 2: Fail-closed env-var-gated secret file (D-06)
**What:** The specific-terms denylist file is never committed; its path comes from an env var, and the script must fail (non-zero exit) if the env var is set but the file is unreadable — never silently skip the specific-term check.
**When to use:** Guard script's specific-denylist stage.
**Example:**
```bash
# Pattern mirrors CAIRN_ROUTE_BINARY / CAIRN_EXPLORE_BINARY env-gating
# already used in mcp-memory-server/src/index.ts and verify-routing-seam.sh
if [[ -n "${CAIRN_GUARD_DENYLIST:-}" ]]; then
  if [[ ! -r "$CAIRN_GUARD_DENYLIST" ]]; then
    echo "FATAL: CAIRN_GUARD_DENYLIST is set but not readable: $CAIRN_GUARD_DENYLIST" >&2
    exit 1
  fi
  # ... git grep -f "$CAIRN_GUARD_DENYLIST" ...
fi
```

### Pattern 3: Cross-repo clean-slate publish (D-01/D-02)
**What:** Scrub working tree → verify no LICENSE/history carries private data → re-init git history from scratch → create the GitHub repo from the local source directory.
**When to use:** The token-miser publish plan.
**Example:**
```bash
# Verified command shapes via `gh repo create --help` during research
cd ~/PARA/Projects/token-miser
# ... scrub / trim tree per D-04, add LICENSE (Apache-2.0, mirrors this repo's
# own LICENSE file verbatim — 201 lines, standard Apache-2.0 boilerplate) ...
rm -rf .git
git init
git add -A
git commit -m "chore: initial public release"   # DEC-no-ai-authorship: no AI-authorship trailer
gh repo create cairnkeep/token-miser --public --source=. --push
gh repo view cairnkeep/token-miser --json visibility   # → {"visibility":"PUBLIC"}
```

### Anti-Patterns to Avoid
- **Rewriting token-miser's existing git history (BFG/filter-repo) instead of re-init:** already rejected in CONTEXT (D-01) — do not let a plan reintroduce it as an "easier" alternative; a fresh `git init` is strictly simpler and carries zero leak-audit burden.
- **Wiring the guard into CI now:** explicitly deferred (D-08) — a plan task that adds a GitHub Actions workflow for this guard is out of scope for Phase 11; the specific denylist is local-only by design (D-06) and a CI secret-injection scheme is unproven need.
- **Describing token-miser's internal architecture (tiers, FastContext) in cairnkeep's docs:** explicitly rejected (D-12) as a standing drift risk — any plan task that adds more than "one sentence + link" per feature is scope creep on this phase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting employer/vendor secrets in code | A custom entropy-based secret scanner | The already-decided hybrid denylist (D-06): committed generic patterns + uncommitted specific-terms file | Entropy-based secret detection solves a different problem (credentials) than literal name/term matching; D-06 already scoped this correctly — don't gold-plate it into a generic scanner |
| GitHub repo creation/visibility check | Raw `curl` calls to the GitHub REST API | `gh repo create` / `gh repo view --json visibility` | `gh` is already installed, authenticated, and is the project's established tool for git-provider operations (see `docs/git-providers.md`); hand-rolling REST calls duplicates auth handling `gh` already provides |
| Apache-2.0 LICENSE text for token-miser | Writing new license prose | Copy this repo's own `LICENSE` file verbatim (201 lines, standard Apache-2.0 boilerplate), updating only the copyright line | The text is a fixed legal standard; this repo already has a correct copy 12 months old — reuse it rather than re-fetch or paraphrase |
| Docs-vs-code drift detection | A generic doc-linting framework (`remark`, `markdownlint` plugins, AST diffing) | A ~20-line grep+sort+diff bash script over two known, narrow lists (env var names, command filenames) | The drift surface is exactly two enumerable lists; a general framework adds install/config surface for a problem grep+diff already solves in one script, consistent with the repo's own `scripts/verify-*.sh` convention |

**Key insight:** Every "don't hand-roll" temptation in this phase points toward *under*-building with existing CLI tools (`gh`, `git`, `grep`, `diff`), not toward pulling in a new dependency — this phase has essentially zero library surface, so the risk is over-engineering a bash script into unneeded tooling, not skipping a standard library.

## Runtime State Inventory

> Included because Phase 11 involves a repository-identity-level change: token-miser transitions from private/vendor-adjacent to public cairnkeep-org sibling, and docs are being renamed/repositioned to match. Answered explicitly per category:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no database/datastore in either repo stores "token-miser" or the employer name as a key/collection/user_id. `cairn-memory`'s AgentFS memory store is per-project scoped by filesystem path, not by these strings. | None |
| Live service config | **token-miser's GitHub remote** (`git@github.com:stondo/token-miser.git`, private) is live service config living outside git content — it must be re-pointed/superseded by the new `cairnkeep/token-miser` remote. No other live service (no CI dashboards, no Datadog/Tailscale-style external config) references token-miser by name in either repo, confirmed by `.github/` inspection (only `.gitlab-ci.yml` and a `.github/` dir exist in token-miser — both are files-in-tree, already covered by the scrub, not external state). | Re-init git remote to `cairnkeep/token-miser`; archive `stondo/token-miser` as private per D-03 |
| OS-registered state | None found — no Task Scheduler/pm2/launchd/systemd registrations embed "token-miser" or the employer name; both are local dev repos with no OS-level service registration. | None |
| Secrets/env vars | `CAIRN_ROUTE_ENDPOINT`, `CAIRN_EXPLORE_BINARY`, `CAIRN_EXPLORE_REPO_ROOT` are cairnkeep-side env vars that *point at* token-miser (a path/URL) but do not embed the string "token-miser" or any private term in the key name itself — renaming/republishing token-miser does not require changing these key names, only (potentially) the values an operator sets locally. Not committed anywhere (confirmed: these are read via `process.env.*`, never given a default value containing a path). | None — code-level, no migration |
| Build artifacts | token-miser's `target/` (Rust build output, gitignored) and `Cargo.lock` are local/tracked respectively; `Cargo.lock` has no employer-name entries (confirmed: it lists only crates.io dependency names). `bench/` is dropped from the public tree per D-04 — verify it contains no build artifacts committed by accident. | None beyond the already-planned D-04 trim |

**The canonical question, answered:** After every file in both repos is updated, the only runtime artifact still pointing at the old (private) identity is the git remote URL on `~/PARA/Projects/token-miser` itself (`stondo/token-miser`) — which D-03 already resolves by keeping it as an intentional private archive, not something to migrate away from.

## Common Pitfalls

### Pitfall 1: Guard script that greps only the working tree, missing `.planning/` or commit messages
**What goes wrong:** A guard that runs plain `grep -r` over the working tree can (a) accidentally include untracked scratch files that were never meant to be scanned, or (b) miss `.planning/` if a naive script excludes dot-directories.
**Why it happens:** `.gitignore`-unaware recursive grep behaves differently from `git grep`, which respects tracked-file boundaries automatically.
**How to avoid:** Use `git grep` (not `grep -r`) — it inherently scans only tracked files, which per D-07 explicitly includes `.planning/` since it's tracked. Add the `git log --format=%B` scan as a second, separate stage (D-07) — `git grep` alone never sees commit message content.
**Warning signs:** A guard script that passes locally but the parity/UAT step later finds a private term in a commit message the guard never scanned.

### Pitfall 2: Publishing token-miser before the guard exists (violates sequencing)
**What goes wrong:** If the publish plan runs before the guard script is built and run against the trimmed tree, there's no automated proof the 147 known employer-name hits (and any hits missed by manual scrubbing) are actually gone before the tree goes public.
**Why it happens:** Plans get ordered by "logical" feature grouping (guard, then docs, then publish) rather than by the actual dependency the CONTEXT specifies.
**How to avoid:** CONTEXT is explicit and non-negotiable on this: "the guard must exist before the publish (it gates the publish tree)." Plan ordering: guard script → token-miser publish (gated by guard) → cairnkeep docs (linking to the now-existing public repo).
**Warning signs:** A plan where the token-miser-publish task has no dependency on / precondition referencing the guard script's existence.

### Pitfall 3: Trusting `npm view`-style "package exists" logic for this phase
**What goes wrong:** N/A directly (no packages here), but the analogous risk is trusting `gh repo view cairnkeep/token-miser` to succeed *before* actually running `gh repo create` — i.e., assuming the org/repo state without checking it live.
**Why it happens:** Planning documents (including this one) record a point-in-time check; by execution time the state could have changed (someone else created the repo, renamed the org, etc.)
**How to avoid:** Re-run `gh repo view cairnkeep/token-miser --json visibility` immediately before creating, and treat "already exists" as a plan branch to handle (skip create, verify visibility instead) rather than an unhandled error.
**Warning signs:** A publish script that hard-fails with an unhelpful `gh` error instead of distinguishing "repo already exists" from a real permission/auth failure.

### Pitfall 4: Docs sweep introduces new drift while fixing old drift
**What goes wrong:** Adding the missing `context-explore` command to the "10 commands" list in `docs/operating.md` without also updating the literal count ("10" → "11") in the prose sentence, or adding `CAIRN_EXPLORE_*` to the Configuration table without also mentioning it in "The workflow" section where `/context-explore` is otherwise undocumented.
**Why it happens:** The drift audit (D-09) names several *known* gaps but a docs edit touching one paragraph can leave an adjacent, related paragraph stale (the count and the list are two separate strings in the same file, discovered via direct read of `docs/operating.md` lines 55-57 during this research).
**How to avoid:** After editing, re-run the parity script (D-10) AND do a manual cold-read of the entire edited section, not just the specific line that was known to be wrong.
**Warning signs:** Parity script passes (env keys/command names match) but a human reading the prose still finds an inconsistent number or missing workflow-section mention — this is exactly why D-10 pairs a mechanized check with a recorded cold read.

## Code Examples

### Guard script generic-pattern stage (D-06)
```bash
# Source: pattern derived from PROJECT.md's DEC-no-private-references wording
# and DEC-no-ai-authorship, applied to git grep
git grep -niE \
  '(anthropic|claude code|written by (an? )?ai|generated (with|by) claude|co-authored-by: claude)' \
  -- . ':!scripts/verify-no-private-references.sh' && exit 1   # any hit = fail
```

### Guard script commit-message stage (D-07)
```bash
# Source: git-log format documented in `git help log` (--format=%B, body-only)
git log --format=%B | grep -niE "$GENERIC_PATTERN" && {
  echo "FATAL: private/AI-authorship pattern found in commit message history" >&2
  exit 1
}
```

### Docs-code parity check core (D-10)
```bash
# Env keys actually read by the server (ground truth)
grep -ohE '\b(CAIRN_[A-Z_]+|MCP_HTTP_[A-Z_]+)\b' mcp-memory-server/src/*.ts | sort -u > /tmp/code-keys.txt

# Env keys named in the docs (adjust the extraction pattern to the doc's table markup)
grep -ohE '\b(CAIRN_[A-Z_]+|MCP_HTTP_[A-Z_]+)\b' docs/operating.md README.md | sort -u > /tmp/doc-keys.txt

diff /tmp/code-keys.txt /tmp/doc-keys.txt   # non-empty diff = drift found
```

### Cross-repo publish verification triad (per CONTEXT's "Specific Ideas")
```bash
# 1. guard against the trimmed publish tree
./scripts/verify-no-private-references.sh   # run with CWD = trimmed token-miser tree

# 2. the trimmed tree still builds standalone
cargo build

# 3. the repo is live and public
gh repo view cairnkeep/token-miser --json visibility
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| token-miser private under `stondo/token-miser`, referenced only informally | token-miser public under `cairnkeep/token-miser`, Apache-2.0, named/linked as a sibling in cairnkeep's docs | This phase (Phase 11) | The routing seam (Phase 10, RT-01/RT-02) now references a real, public, freely-inspectable dependency instead of an implied private one |
| `docs/operating.md` "10 commands" | 11 commands, `context-explore` included | This phase (SC-02/D-09) | Doc count matches `claude/commands/` exactly |

**Deprecated/outdated:**
- README's "Early... first component is the memory server" Status framing — superseded by D-13's refresh reflecting the actual v1.0-v1.3 shipped surface (memory server + CLI + operating layer on two harnesses + context exploration + routing seam + public token-miser sibling).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `gh repo create --source=. --public --push` is the correct flag combination for a clean-slate cross-repo publish (verified via `gh repo create --help` output, but the exact end-to-end flow — especially interaction with an org name prefix `cairnkeep/token-miser` vs. bare `token-miser -R cairnkeep` — was not dry-run tested in this research pass) | Code Examples / Architecture Patterns | Low — `gh` will surface a clear CLI error if the org/name syntax is wrong; the planner should have the publish plan verify the exact invocation against `gh repo create --help` output at execution time, or dry-run in a scratch dir first |
| A2 | The Apache-2.0 LICENSE text can be copied verbatim from this repo's own `LICENSE` file, updating only the copyright line | Don't Hand-Roll | Low — Apache-2.0 is a fixed standard text; this repo's own copy was read (201 lines) and is presumed byte-correct since it's cairnkeep's actual published license |

**If this table is empty:** N/A — two low-risk assumptions logged above; both are easily verified live during execution (a `--dry-run`-style check before the real `gh repo create`, and a diff of the copied LICENSE against `apache.org`'s canonical text if desired).

## Open Questions (RESOLVED)

1. **Exact guard script filename/structure: one script with `--docs-parity` flag, or two separate scripts?** (RESOLVED)
   - What we know: CONTEXT explicitly leaves this to Claude's discretion ("Guard/parity script structure and naming... one script vs. two").
   - What's unclear: Nothing blocking — this is a genuinely open discretion point, not a research gap.
   - Recommendation: Two scripts (`verify-no-private-references.sh`, `verify-docs-parity.sh`) — they check different things (security/hygiene gate vs. accuracy check) and have different failure semantics (D-06 fail-closed vs. D-10 diff-and-report); combining them would conflate two audiences (security reviewer vs. docs reviewer) reading the same script.

2. **Whether the `CAIRN_GUARD_DENYLIST` file format should be one-term-per-line or a `git grep -E` pattern file.** (RESOLVED)
   - What we know: D-06 leaves exact format to discretion; `git grep -f <file>` treats each line as a fixed string by default (`-F` implied only with that flag combo — actually `git grep -f` reads patterns and follows whatever pattern flags are also passed, e.g. `-E`/`-F`).
   - What's unclear: Whether the specific denylist needs regex (e.g., to match an employer name with optional suffix) or plain substrings suffice.
   - Recommendation: Plain one-substring-per-line (simplest, matches D-06's stated examples — "employer, private repo names" are literal strings, not patterns needing regex) — use `git grep -F -f "$CAIRN_GUARD_DENYLIST"` for fixed-string matching, avoiding regex-metacharacter escaping bugs entirely.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` | guard script, parity script, token-miser re-init | Yes `[VERIFIED: which git]` | present | — |
| `gh` (GitHub CLI) | token-miser publish, visibility verification | Yes `[VERIFIED: gh --version]` | 2.46.0, authenticated as `stondo`, member of `cairnkeep` org | — |
| `cargo` | proving trimmed token-miser tree builds | Not directly probed this session (token-miser's own Rust toolchain — assumed present since the repo already builds per its existing CI config `.gitlab-ci.yml`) `[ASSUMED]` | — | If missing at execution time, run `cargo --version` first; the operator's existing token-miser dev environment should already have it since it's an active Rust project |
| `~/PARA/Projects/token-miser` working tree | the entire publish plan | Yes `[VERIFIED: ls]` | private repo, no LICENSE, `.ai/` dir present, `src/` clean of employer terms | — |

**Missing dependencies with no fallback:** None identified.

**Missing dependencies with fallback:** `cargo` unverified this session but has a trivial fallback check (`cargo --version`) the plan's own verification step should run first.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None new — this phase adds bash scripts, not TS/JS code. The existing `mcp-memory-server` test framework (`npm test` → `test:smoke`) is unaffected since no `src/` files change. |
| Config file | n/a for this phase's own changes; `mcp-memory-server/package.json` scripts section is the existing regression net |
| Quick run command | `./scripts/verify-no-private-references.sh` (self-contained, <5s expected) |
| Full suite command | `./scripts/verify-no-private-references.sh && ./scripts/verify-docs-parity.sh && (cd mcp-memory-server && npm test)` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-01 | token-miser named/linked/described as public sibling, actually public | smoke (live, one-shot) | `gh repo view cairnkeep/token-miser --json visibility` (expect `"PUBLIC"`) + `grep -n "cairnkeep/token-miser" README.md docs/operating.md` | ❌ Wave 0 — repo doesn't exist yet, must be created by the plan itself |
| SC-02 | docs match shipped code, zero drift | smoke (script) | `./scripts/verify-docs-parity.sh` | ❌ Wave 0 — script doesn't exist |
| SC-03 | zero private-reference hits, recorded milestone gate | smoke (script) | `./scripts/verify-no-private-references.sh` | ❌ Wave 0 — script doesn't exist |

### Sampling Rate
- **Per task commit:** `./scripts/verify-no-private-references.sh` (fast, self-contained — run after every doc/script edit)
- **Per wave merge:** full suite (guard + parity + `npm test` regression check on `mcp-memory-server`)
- **Phase gate:** all three scripts green, plus the live `gh repo view` check, before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `scripts/verify-no-private-references.sh` — covers SC-03 (D-05/D-06/D-07)
- [ ] `scripts/verify-docs-parity.sh` (or equivalent flag/mode) — covers SC-02 (D-10)
- [ ] No shared fixtures needed — both scripts operate directly on the live tracked tree/log, no mocks per the repo's verify-by-execution convention

*(No TS test files needed — this phase does not touch `mcp-memory-server/src/`.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth surface touched this phase |
| V3 Session Management | No | n/a |
| V4 Access Control | No | n/a |
| V5 Input Validation | Marginal | Guard script's denylist-file path (`CAIRN_GUARD_DENYLIST`) should be validated readable before use (fail-closed, D-06) — this is the phase's only "input" |
| V6 Cryptography | No | n/a |

### Known Threat Patterns for this phase's stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Publishing a private repo's history by accident (git history leak) | Information Disclosure | D-01's clean-slate `git init` (no history carried over) — the single most important mitigation in this phase; do not substitute any history-rewrite approach that could leave dangling private blobs reachable via reflog/pack files on the *old* remote (irrelevant to the *new* repo, but worth noting the old private remote itself is unaffected and stays private per D-03) |
| Denylist file accidentally committed | Information Disclosure | D-06: the specific-terms file lives outside git entirely (env-var-referenced path, e.g. outside the repo or `.gitignore`'d) — verify `.gitignore` covers whatever path convention is chosen, or keep it fully outside the repo tree |
| Guard script silently passing when misconfigured (env var typo, empty denylist) | Tampering (of the verification process itself) | Fail-closed exit codes (D-06): env var set + file unreadable → non-zero exit, never a silent skip; this is the phase's core security-relevant design decision and must not be weakened for convenience |

## Sources

### Primary (HIGH confidence)
- Direct file reads this session: `docs/operating.md`, `README.md`, `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/phases/11-self-consistency-public-positioning/11-CONTEXT.md`, `mcp-memory-server/src/index.ts` (grep), `docs/git-providers.md`, `scripts/verify-routing-seam.sh` (read in full)
- Direct shell verification this session: `git grep` for command/hook file listings, `grep -oP` for CAIRN_/MCP_HTTP_ env-key enumeration, `ls` on `~/PARA/Projects/token-miser`, `gh repo view`/`gh api orgs/cairnkeep/repos`/`gh repo create --help`, `.git/hooks/` inspection, `.claude/hooks/gsd-validate-commit.sh` read

### Secondary (MEDIUM confidence)
- None — no external web sources were needed for this phase; every fact required is directly inspectable in this repo or the token-miser working tree, and confidence was obtained via live tool execution rather than documentation lookup.

### Tertiary (LOW confidence)
- `gh repo create --source=. --public --push` end-to-end flow against an org-prefixed name (`cairnkeep/token-miser`) was confirmed only via `--help` text, not a live dry-run (Assumption A1).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; every tool (`git`, `gh`, `cargo`, `bash`) verified present/authenticated on this machine
- Architecture: HIGH — verified directly by reading the actual doc/code drift (command counts, env keys) rather than inferring it
- Pitfalls: HIGH — each pitfall is grounded in a specific CONTEXT decision (D-01, D-06, D-07, D-09/D-10) plus a concrete, session-verified fact (e.g., the exact "10 commands" string and the exact 11-file `claude/commands/` listing)

**Research date:** 2026-07-06
**Valid until:** 2026-07-13 (7 days — this research is tightly coupled to the current exact state of `docs/operating.md`, `claude/commands/`, and the token-miser working tree; any further doc or command-count changes before planning executes would invalidate the specific line-number/count claims above, though the overall approach would not change)
