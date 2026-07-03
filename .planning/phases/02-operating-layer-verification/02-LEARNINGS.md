---
phase: 2
phase_name: "Operating-layer verification"
project: "Cairnkeep"
generated: "2026-07-03"
counts:
  decisions: 4
  lessons: 4
  patterns: 4
  surprises: 3
missing_artifacts:
  - "02-*-PLAN.md (phase verified directly against cairn-memory; no formal GSD plan authored)"
  - "02-*-SUMMARY.md (phase results captured in STATE.md instead)"
  - "02-*-VERIFICATION.md"
  - "02-*-UAT.md"
---

# Phase 2 Learnings: Operating-layer verification

> Note: this phase was executed as a direct end-to-end verification pass against
> the registered `cairn-memory` MCP, not via the standard GSD plan/execute loop,
> so no `PLAN.md`/`SUMMARY.md` exist. Learnings below are extracted from the
> equivalent artifacts produced during the pass: `STATE.md` (Phase 2 results
> block), `.planning/reviews/REVIEW.md`, and
> `.planning/security/VALIDATED/SEC-0001-scope-path-traversal-sandbox-escape.md`.

## Decisions

### Validate memory scope at a single resolver chokepoint, not per tool
Scope confinement (`assertSafeScope` kebab-case allowlist + base-dir containment)
was placed inside `resolveScopePath`, the one function every memory tool and
`promote_to` resolves through, rather than duplicated across eight tool schemas.

**Rationale:** every read/write/list/delete/supersede/history path converges on
`openScope → resolveScopePath`; guarding the convergence point closes the whole
class with one change and no bypass surface.
**Source:** SEC-0001 validated report; STATE.md (Phase 2 results)

### Require an explicit embedding model — ship no vendor default
`getEmbeddingConfig` now returns `null` when `CAIRN_MEMORY_EMBEDDING_MODEL` is
unset (degrading to substring search) instead of falling back to a hardcoded
model name.

**Rationale:** the provider-neutrality constraint (no vendor names/defaults in
the core) applies to model identifiers too; a baked-in default is a silent
vendor coupling.
**Source:** STATE.md (Phase 2 results); commit 4599c42

### Track only canonical security records; gitignore the run-history
`FINDINGS.yaml` and `VALIDATED/` are committed; the transient
`CANDIDATES/`, `REPORTS/`, `ISSUES/`, and `tmp/` directories are gitignored.

**Rationale:** matches the security policy's own separation of durable ledger vs.
run history, and keeps machine-local absolute paths out of the public repo.
**Source:** STATE.md (Phase 2 results); .gitignore

### memory-review must declare the cairn-memory MCP tools it writes through
The `memory-review` command's `allowed-tools` was widened to include
`memory_read/search/write/supersede`.

**Rationale:** the accept gate writes durable memory via the MCP; omitting the
tools from the allowlist would silently break the write step at runtime.
**Source:** STATE.md (Phase 2 results); commit 03d62c2

---

## Lessons

### A ZodEffects inputSchema makes the MCP SDK publish an empty tool schema
Wrapping a tool's `inputSchema` in `z.object().refine()` produces a ZodEffects
the SDK cannot convert to JSON Schema, so the tool advertises no parameters and
strict clients can't call it. `memory_read` was affected.

**Context:** discovered when the direct MCP round-trip showed `memory_read` with
an empty parameter schema. Fix: keep `inputSchema` a plain `z.object` and do
cross-field validation (exactly-one-of key/query) inside the handler.
**Source:** STATE.md (Phase 2 results); commit 4599c42

### `resolve(base,x) === join(base,x)` does not catch `../` traversal
A containment guard comparing `path.resolve` against `path.join` only catches
absolute-path overrides — `path.join` normalizes `..` identically to `resolve`,
so both sides match for `../evil` and the check passes.

**Context:** this was the defense-in-depth layer behind the SEC-0001 allowlist;
repo-review flagged it. Correct form: `const rel = relative(base, p); reject if
rel === "" || rel.startsWith("..") || isAbsolute(rel)`.
**Source:** REVIEW.md (finding 1); commit 367b4d1

### A configurable-provider key is not the same as provider-neutral behavior
Despite the `CAIRN_GIT_PROVIDER` abstraction landing in Phase 1, `memory-sync`
still had a hardcoded GitHub `GET /repos/.../pulls/...` read path. Neutrality
had to be verified in the command bodies, not assumed from the config key.

**Context:** caught while exercising memory-sync; routed the PR-state read
through the provider operation map instead.
**Source:** STATE.md (Phase 2 results); commit 03d62c2

### Global hooks need install-time sync, and the install step was invisible
The memory hooks and every operating-layer command exist in the harness only
after `sync-claude-assets.sh --apply`; this step was undocumented, so a fresh
setup produced a registered memory server with no commands or hooks.

**Context:** surfaced during hook round-trip verification and confirmed in the
Phase 3 fresh-bootstrap check; fixed by documenting the full setup order.
**Source:** STATE.md (Phase 2 + Phase 3 results)

---

## Patterns

### Single-chokepoint validation for a security boundary
When many entry points converge on one resolver (here: all memory tools →
`resolveScopePath`), validate once at the convergence point.

**When to use:** untrusted input reaching a filesystem/DB/command sink through a
shared helper; prefer guarding the helper over N call sites.
**Source:** SEC-0001 validated report

### Protocol-level regression test that drives the built server
`smoke-scope-guard.mjs` spawns the compiled MCP server over stdio and issues
real `tools/call` requests, asserting traversal scopes are rejected and no file
escapes the base dir — verifying the fix at the boundary a client actually uses.

**When to use:** locking in a security or protocol fix where unit-level checks
would miss transport/schema wiring; wire it into `npm test`.
**Source:** STATE.md (Phase 2 results); mcp-memory-server/scripts/smoke-scope-guard.mjs

### Adversarially review your own fix
Running repo-review on the session's own diff caught a Medium bug inside the
just-written SEC-0001 fix (the ineffective containment guard).

**When to use:** after any non-trivial security fix, review the fix itself as a
fresh diff rather than trusting it because you wrote it.
**Source:** REVIEW.md

### Governed audit chain with dynamic confirmation before acceptance
The selector → investigator → validator chain only accepted SEC-0001 after the
`path.resolve` traversal was confirmed by actually running it, not from source
reading alone.

**When to use:** security triage where a plausible-looking source-level claim
should be executed/reproduced before it's promoted to an accepted finding.
**Source:** SEC-0001 validated report

---

## Surprises

### A verification pass uncovered a real, unknown security vulnerability
What was scoped as "confirm the carved flows still work" produced accepted
finding SEC-0001 — an unvalidated `scope` argument that escaped
`CAIRN_AGENTFS_BASE_DIR` to read/create arbitrary `.db` files.

**Impact:** turned a verification task into a fix + regression-test + governed
finding record; the highest-value outcome of the phase came from the audit tool
itself, not from the flows under test.
**Source:** SEC-0001 validated report

### The review caught a real bug inside the security fix
The `resolve === join` containment guard shipped in the first SEC-0001 fix was
itself defective for `../` traversal — found by the very repo-review flow being
verified.

**Impact:** required an immediate follow-up commit (367b4d1); reinforced that a
security fix is not done until independently reviewed and re-tested.
**Source:** REVIEW.md (finding 1)

### Subagents could not run code, so dynamic checks fell to the orchestrator
The session shell allowlist blocked `bash`/`node` inside spawned agents, so the
selector/investigator/validator could reason from source but not execute; the
`path.resolve` traversal and the containment fix were confirmed by the
orchestrator running the code directly.

**Impact:** claims that would normally be agent-verified had to be
orchestrator-verified; worth accounting for when a phase leans on subagents for
dynamic proof.
**Source:** SEC-0001 validated report; session execution notes
