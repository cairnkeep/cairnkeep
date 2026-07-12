# Phase 11: Self-Consistency & Public Positioning - Pattern Map

**Mapped:** 2026-07-06
**Files analyzed:** 6 (2 new scripts, 3 edited docs, 1 cross-repo publish operation)
**Analogs found:** 5 / 6 (cross-repo publish has no in-repo analog — CLI-recipe only)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `scripts/verify-no-private-references.sh` | utility (verify script) | batch (grep/scan) | `scripts/verify-routing-seam.sh` | role-match (shape identical; different check logic) |
| `scripts/verify-docs-parity.sh` | utility (verify script) | batch (grep/diff) | `scripts/verify-routing-seam.sh` | role-match |
| `README.md` (edit) | config/doc | transform (prose edit) | itself (existing `## Status`/`## Configuration` sections) | exact (in-place edit, not new file) |
| `docs/operating.md` (edit) | config/doc | transform (prose edit) | itself (existing `## Configuration`/`### Routing seam` sections) | exact (in-place edit) |
| `docs/git-providers.md` (audit only) | config/doc | transform (audit, no edit expected) | itself | exact |
| `~/PARA/Projects/token-miser` publish | cross-repo op (no in-repo file) | batch (scrub+init+push) | none in this repo | no analog — CLI recipe from RESEARCH.md Pattern 3 |

## Pattern Assignments

### `scripts/verify-no-private-references.sh` (utility, batch scan)

**Analog:** `scripts/verify-routing-seam.sh` (full file read; 170 lines)

**Shape/header pattern** (lines 1-31):
```bash
#!/usr/bin/env bash
set -euo pipefail

# <comment block explaining WHY this script exists, which DEC/D-numbers it
#  satisfies, what it does NOT prove, and cross-references to sibling
#  verify-*.sh scripts for shared idiom>
```

**`usage()` heredoc pattern** (lines 32-62):
```bash
usage() {
  cat <<'EOF'
Usage: verify-routing-seam.sh
       verify-routing-seam.sh --full
       verify-routing-seam.sh -h|--help

<prose description of default vs. flag-gated modes>

Environment:
  CAIRN_ROUTE_BINARY   Absolute path to the token_miser binary. Defaults to
                        $HOME/PARA/Projects/token-miser/target/release/token_miser.
                        Never echoed — only a presence indicator is logged.
EOF
}
```
Apply this exact shape for `CAIRN_GUARD_DENYLIST`: document the env var, its
default (unset = generic-only check), and that its value/path is never
echoed — only a presence indicator (mirrors `log_binary_presence()` below).

**Env-var presence-only logging pattern** (lines 72-80) — copy verbatim idiom:
```bash
log_binary_presence() {
  local default="$HOME/PARA/Projects/token-miser/target/release/token_miser"
  local overridden="no"
  [[ "$CAIRN_ROUTE_BINARY" != "$default" ]] && overridden="yes"
  echo "[env] CAIRN_ROUTE_BINARY overridden from default: $overridden" >&2
}
```
For the guard script, use this idiom to log "CAIRN_GUARD_DENYLIST set: yes/no"
— never log the path or file contents (D-06 fail-closed + no-leak requirement).

**Fail-loud, never-silent pattern** (lines 85-89, 105-108):
```bash
if [[ ! -x "$CAIRN_ROUTE_BINARY" ]]; then
  echo "FATAL: token_miser binary not found or not executable ..." >&2
  return 1
fi
...
if [[ "$reached" != "yes" ]]; then
  echo "FATAL: ... never became reachable within the poll budget" >&2
  return 1
fi
```
Apply directly to D-06's fail-closed requirement: `CAIRN_GUARD_DENYLIST` set
but unreadable → `echo "FATAL: ..." >&2; exit 1` (see RESEARCH.md Pattern 2
for the exact conditional shape to reuse).

**`main()` arg-parsing + exit pattern** (lines 138-169):
```bash
main() {
  local full=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --full) full=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; exit 2 ;;
    esac
  done
  log_binary_presence
  if ! run_health_proof; then
    exit 1
  fi
  ...
}
main "$@"
```
Copy this control flow: parse flags, log env presence, run the check
function, propagate non-zero exit on any failure — never swallow a failure
into exit 0.

**Guard-specific check logic** (net new, not in the analog — from
RESEARCH.md Code Examples, already vetted against this repo's `DEC-no-
private-references`/`DEC-no-ai-authorship`/`DEC-commit-scanning`):
```bash
# Stage 1: generic denylist (committed, always runs)
git grep -niE \
  '(anthropic|claude code|written by (an? )?ai|generated (with|by) claude|co-authored-by: claude)' \
  -- . ':!scripts/verify-no-private-references.sh' && exit 1

# Stage 2: specific denylist (uncommitted file, env-gated, fail-closed)
if [[ -n "${CAIRN_GUARD_DENYLIST:-}" ]]; then
  if [[ ! -r "$CAIRN_GUARD_DENYLIST" ]]; then
    echo "FATAL: CAIRN_GUARD_DENYLIST is set but not readable: $CAIRN_GUARD_DENYLIST" >&2
    exit 1
  fi
  git grep -F -f "$CAIRN_GUARD_DENYLIST" && exit 1
fi

# Stage 3: commit-message scan (D-07)
git log --format=%B | grep -niE "$GENERIC_PATTERN" && {
  echo "FATAL: private/AI-authorship pattern found in commit message history" >&2
  exit 1
}
```

---

### `scripts/verify-docs-parity.sh` (utility, batch grep/diff)

**Analog:** `scripts/verify-routing-seam.sh` (same shape header/usage/main as above — reuse identically)

**Core diff logic** (net new; from RESEARCH.md Code Examples, ground-truth
verified this session against `mcp-memory-server/src/index.ts` and
`claude/commands/`):
```bash
# Env keys actually read by the server (ground truth)
grep -ohE '\b(CAIRN_[A-Z_]+|MCP_HTTP_[A-Z_]+)\b' mcp-memory-server/src/*.ts | sort -u > /tmp/code-keys.txt

# Env keys named in the docs
grep -ohE '\b(CAIRN_[A-Z_]+|MCP_HTTP_[A-Z_]+)\b' docs/operating.md README.md | sort -u > /tmp/doc-keys.txt

diff /tmp/code-keys.txt /tmp/doc-keys.txt   # non-empty diff = drift found

# Command filenames vs. docs' named list
ls claude/commands/ | sed 's/\.md$//' | sort -u > /tmp/code-cmds.txt
# (extract command names from docs/operating.md's "commands →" line the same way)
```
Verified ground truth this session: `mcp-memory-server/src/index.ts` contains
`CAIRN_AGENTFS_BASE_DIR`, `CAIRN_LLM_API_KEY`, `CAIRN_LLM_API_URL`,
`CAIRN_LLM_EXTRACTION_MODEL`, `CAIRN_EXPLORE_BINARY`, `CAIRN_EXPLORE_REPO_ROOT`,
`CAIRN_ROUTE_ENDPOINT`, `MCP_HTTP_PORT`, `MCP_HTTP_HOST`,
`CAIRN_MEMORY_HTTP_TOKEN`, `CAIRN_MEMORY_HTTP_ALLOWED_ORIGINS`,
`CAIRN_MEMORY_HTTP_ALLOWED_HOSTS` — a superset of what
`docs/operating.md`'s Configuration table (lines 98-107) currently lists.
`claude/commands/` has 11 files (`context-explore.md`, `graphify.md`,
`memory-review.md`, `memory-sync.md`, `recall.md`, `remember.md`,
`repo-review.md`, `security-audit.md`, `wiki-ingest.md`, `wiki-lint.md`,
`wiki-query.md`) vs. `docs/operating.md` line 55's "10 commands" listing
only 10 (missing `context-explore`).

---

### `README.md` (doc edit — Related projects, Status refresh, config table)

**Analog:** itself — existing `## Status` (lines 10-15), `## Configuration`
(implicit table further down), no `## Related projects` section yet.

**Current stale Status text to replace** (lines 10-15):
```markdown
## Status

Early. Cairnkeep is being carved out of a larger private workflow repo into a
clean open-source core. The first component landed here is the memory server;
launchers, the project bootstrapper, and the compiled-knowledge (wiki) layer
follow.
```
Per D-13, replace with shipped-reality framing (memory server + CLI +
operating layer on both harnesses + context exploration + routing seam +
token-miser as public sibling) — same section, same heading, prose swap only.

**Related-projects addition (net new, per D-11):** add a short section
(placement: after `## Components`, or a new `## Related projects` heading —
Claude's Discretion on exact wording) naming token-miser, one-liner, link to
`github.com/cairnkeep/token-miser`. Follow the existing bullet-list style used
in `## Components` (lines 19-26) for visual consistency.

---

### `docs/operating.md` (doc edit — config table, command count, workflow)

**Analog:** itself — read lines 50-138 in full this session.

**"10 commands" drift site** (lines 55-57) — must become 11, add
`context-explore`:
```markdown
- **10 commands** → `commands/`: `remember`, `recall`, `memory-sync`,
  `memory-review`, `wiki-ingest`, `wiki-query`, `wiki-lint`, `security-audit`,
  `repo-review`, `graphify`
```

**Configuration table pattern to extend** (lines 98-107) — existing row
shape to copy for the two missing `CAIRN_EXPLORE_*` rows:
```markdown
| `CAIRN_ROUTE_ENDPOINT` | Base URL of an already-running token-miser routing/tiering proxy (unset → the `route_check` tool is inert) |
```
Add matching rows for `CAIRN_EXPLORE_BINARY` and `CAIRN_EXPLORE_REPO_ROOT`
(ground truth: `mcp-memory-server/src/index.ts` lines 1012-1023) using the
same "(unset → behavior)" phrasing convention.

**Existing "thin adapter" prose pattern to mirror for context_explore**
(lines 109-134, the `### Routing seam` section — already self-consistent per
D-11/CONTEXT "Reusable Assets"):
```markdown
### Routing seam (`route_check`, opt-in)

`route_check` is a thin MCP tool that checks whether an external token-miser
routing/tiering proxy is reachable. It hosts no proxy, endpoint list, model
list, or tier config itself — the proxy runs elsewhere and `route_check` only
confirms the wire to it is live. This is the full contract; no source reading
required.
...
`scripts/verify-routing-seam.sh` proves this against the real token_miser
binary (not a mock) — see the script's `--help` for usage.
```
Per D-12, add a one-sentence token-miser-sibling naming + link to this
section (and create an equivalent short section/paragraph for
`context_explore` describing its `token_miser explore` subprocess delegation)
— do not expand into tiers/FastContext internals (anti-pattern, D-12).

---

### `docs/git-providers.md` (audit only)

**Analog:** itself. RESEARCH.md's D-09 sweep expects **no changes** here —
provider table doesn't reference token-miser or the routing seam. Read only
to confirm no drift; no excerpt needed unless drift is found at execution
time.

---

### `~/PARA/Projects/token-miser` publish (cross-repo op, no in-repo analog)

**No analog exists in this codebase** — clean-slate publish is a novel
operation here. Follow RESEARCH.md's Pattern 3 recipe verbatim (verified via
`gh repo create --help` this session):
```bash
cd ~/PARA/Projects/token-miser
# scrub/trim tree per D-04, add LICENSE (copy this repo's own LICENSE
# verbatim, update copyright line only — see Don't Hand-Roll table)
rm -rf .git
git init
git add -A
git commit -m "chore: initial public release"   # no AI-authorship trailer
gh repo create cairnkeep/token-miser --public --source=. --push
gh repo view cairnkeep/token-miser --json visibility   # → {"visibility":"PUBLIC"}
```
This repo's own `LICENSE` file (201 lines, Apache-2.0) is the copy source —
read it once at execution time to copy verbatim.

## Shared Patterns

### Verify-by-execution script shape
**Source:** `scripts/verify-routing-seam.sh` (full file, this repo)
**Apply to:** Both new scripts (`verify-no-private-references.sh`,
`verify-docs-parity.sh`)
```bash
#!/usr/bin/env bash
set -euo pipefail
usage() { cat <<'EOF' ... EOF ; }
main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help) usage; exit 0 ;;
      *) usage >&2; exit 2 ;;
    esac
  done
  # ... check function; exit 1 on any FATAL condition ...
}
main "$@"
```

### Env-var presence-only logging (never echo secret/private values)
**Source:** `scripts/verify-routing-seam.sh` lines 72-80 (`log_binary_presence`)
**Apply to:** `verify-no-private-references.sh`'s `CAIRN_GUARD_DENYLIST` handling
```bash
log_denylist_presence() {
  local set="no"
  [[ -n "${CAIRN_GUARD_DENYLIST:-}" ]] && set="yes"
  echo "[env] CAIRN_GUARD_DENYLIST set: $set" >&2
}
```

### Fail-closed on missing/unreadable env-referenced file
**Source:** RESEARCH.md Pattern 2 (derived from this repo's `CAIRN_*`
env-gating idiom in `mcp-memory-server/src/index.ts`, e.g. lines 1012-1023's
`CAIRN_EXPLORE_BINARY is not set` / `does not exist` throws)
**Apply to:** guard script's specific-denylist stage — any hit or unreadable
file → non-zero exit, never a silent skip.

### Doc-table row shape ("Variable | Purpose", unset-behavior noted)
**Source:** `docs/operating.md` lines 98-107 (Configuration table)
**Apply to:** the two new `CAIRN_EXPLORE_*` rows and `README.md`'s own
config table completion (D-11's config-table-completion clause).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `~/PARA/Projects/token-miser` publish sequence | cross-repo op | batch (scrub+init+push) | No prior clean-slate repo-publish operation exists in this repo; RESEARCH.md Pattern 3 (a verified `gh`/`git` CLI recipe, not a codebase analog) is the pattern source instead |

## Metadata

**Analog search scope:** `scripts/` (verify-*.sh family, 4 files), `README.md`,
`docs/operating.md`, `docs/git-providers.md`, `mcp-memory-server/src/index.ts`
(env-var ground truth), `claude/commands/` (command-count ground truth)
**Files scanned:** 4 verify scripts (1 read in full — `verify-routing-seam.sh`,
170 lines), 2 docs read in targeted ranges, 1 doc listed only, 1 TS file
grepped for env-var ground truth, 1 directory listed for command-count ground
truth
**Pattern extraction date:** 2026-07-06
