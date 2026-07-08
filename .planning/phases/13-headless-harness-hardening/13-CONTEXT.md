# Phase 13: Headless Harness Hardening - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 13 makes the OpenCode `/remember`→`/recall` round-trip **reliably
reproducible in the scripted headless harness**
(`scripts/verify-opencode-live-parity.sh`), closing the v1.1 OCP-06 override
gap. Requirement: **OCP-07**. The named approach is the one the roadmap
carries: convert the round-trip stage to the **serve/`--attach`** pattern the
capture stage already proved, plus **retry** that absorbs the diagnosed
opencode run-completion flakiness.

This is HOW to harden the existing Phase 5 harness — no new memory
capabilities, no plugin/server behavior changes, no interactive-TUI work
(explicitly out of scope per REQUIREMENTS.md). The round-trip mechanisms
themselves (remember/recall commands, cairn-memory tools, plugins) were
proven in v1.1 and are not the subject.

</domain>

<decisions>
## Implementation Decisions

### Reliability bar (Success Criterion #1)
- **D-01: The bar is 5/5 consecutive round-trip passes** with zero manual
  operator intervention. A failed iteration resets the count. Rejected: M-of-N
  (tolerating flaky runs doesn't close a reliability gap) and 3/3 (thin margin
  over v1.1's "proven once").
- **D-02: A `--repeat N` soak mode is added to `scripts/verify-opencode-live-parity.sh`**
  (e.g. `--repeat 5`) that loops
  the round-trip stage N times and emits a per-iteration PASS/FAIL table plus
  an aggregate verdict — one command, one recorded output. Rejected: separate
  wrapper script, manual re-runs.
- **D-03: Fresh scratch environment per iteration.** Each of the 5 runs does
  full scratch-HOME setup, fresh canary, fresh `opencode serve`, and teardown
  — 5 independent cold reproductions, no state bleed between runs.
- **D-04: Evidence = per-run + aggregate.** The `--repeat` output (per-run
  table + verdict) is recorded in the phase UAT/VERIFICATION doc;
  MILESTONES.md's v1.1 Known Gaps entry and REQUIREMENTS.md traceability are
  updated to point at it (Success Criterion #3), the way Phase 11 recorded
  its milestone gate.

### Model policy
- **D-05: OCP-07 is conditioned on a tool-call-reliable model.** "Reliable
  headless reproduction" means reliable **given a no-thinking,
  tool-call-reliable local model** (the class that proved the round-trip in
  v1.1). Retry exists to absorb opencode run-completion flakiness — it does
  NOT attempt to out-retry a thinking model that narrates instead of calling
  tools; v1.1 root-caused that as external to cairnkeep.
- **D-06: A mechanical preflight probe gates the soak.** Before the 5-run
  soak, a cheap probe asserts the configured model emits a genuine tool call,
  failing fast with a clear "model not tool-call-reliable" message instead of
  burning 5 scratch setups. Mirrors the Phase 6 spike-before-wiring lesson.
  Probe placement/shape = planner discretion.
- **D-07: Docs state the precondition trait-based, with the proven example.**
  The requirement is documented as "a no-thinking, tool-call-reliable local
  model", citing qwen3.5-27b as the publicly-known model that passed (a public
  model name does not breach DEC-no-private-references). Model selection stays
  operator-env-driven — no committed defaults, no known-good allowlist in the
  harness.

### Assertion trust
- **D-08: The round-trip stages upgrade to genuine tool-event assertions.**
  `run_stage_remember_recall` (seeded + unseeded negative control) stops
  trusting substring greps and instead parses the `--format json` NDJSON
  stream for real tool-execution events — discharging the MILESTONES.md
  carried-forward follow-up (narrated-but-unexecuted tool syntax
  false-positives) where it matters. Other stages keep their existing
  assertions (v1.1 accepted their evidence; no requirement demands widening
  the diff).
- **D-09: Assertion strictness = tool event + canary linkage.** PASS requires
  a genuine `memory_write`/`memory_supersede` tool event on `/remember` AND a
  `memory_search`/`memory_read` tool event on `/recall` whose result payload
  contains the canary — tying the tool call to the actual data round-trip.
- **D-10: The researcher pins the real NDJSON event schema first.** The exact
  event shape from `opencode run --format json` (field names, tool-result
  payload location) is unconfirmed — the researcher MUST capture a live
  stream from the installed opencode version and pin the shape before
  planning locks the parser (Phase 10 D-02 precedent).

### Hardening scope & retry policy
- **D-11: Only `run_stage_remember_recall` converts to serve/`--attach`.**
  The capture stage already runs on that pattern; wakeup and recall-on-edit
  keep plain `opencode run` — their evidence was accepted in v1.1 and they
  are not part of the gap.
- **D-12: The soak covers the round-trip stage 5/5; `--full` runs once.** The
  `--repeat` loop soaks the hardened remember→recall stage (fresh scratch each
  iteration, D-03); the full suite (wakeup, recall-on-edit, capture, negative
  controls) runs once as a regression check that the harness changes broke
  nothing.
- **D-13: Retries absorb infra failures only.** Bounded retry (~3 attempts,
  planner discretion) applies only to identifiable run-completion/transport
  flakiness (the undici↔server race, timeouts, opencode exiting before the
  turn completes). A run that completes cleanly but fails its
  tool-event/canary assertion FAILS the iteration outright — no retry.
  Retry counts are logged in the per-run evidence so 5/5 stays honest
  (Success Criterion #2: retries absorb the flakiness; they never mask a
  broken round-trip).

### Claude's Discretion
- Preflight probe placement and mechanism (inside the harness vs. reusing the
  Phase 6 probe style), exact retry bound and infra-failure classification,
  NDJSON parser implementation (jq/node/etc.), `--repeat` flag ergonomics,
  and evidence-table format — preserve the invariants above (5/5 bar, fresh
  scratch per iteration, infra-only retry, event+canary assertions).
- If new env keys are introduced (none are expected), they must land in the
  docs in the same phase — `scripts/verify-docs-parity.sh` gates this.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 13: Headless Harness Hardening" — goal + the
  3 success criteria (repeated-run reliability, retry absorbs flakiness,
  gap recorded as resolved).
- `.planning/REQUIREMENTS.md` — **OCP-07** (headless reproducibility only;
  interactive-TUI confirm explicitly out of scope).
- `.planning/PROJECT.md` §Constraints — **DEC-no-private-references [LOCKED]**,
  **DEC-no-ai-authorship [LOCKED]**, **DEC-commit-scanning [LOCKED]**.

### The gap being closed (root-cause record)
- `.planning/MILESTONES.md` §"v1.1 … Known Gaps (override closeout)" — the
  OCP-06 gap statement, the diagnosed root causes (opencode run-completion
  flakiness, undici↔server, model-independent + thinking-model tool-call
  variance), and the carried-forward follow-up (genuine `"type":"tool"`
  events vs. substring grep) that D-08 discharges. Phase 13's closeout must
  update this section (D-04).

### The harness being hardened
- `scripts/verify-opencode-live-parity.sh` — the entire subject of this
  phase. Key internals: `run_opencode()` (plain-run helper),
  `start_capture_server()`/`stop_capture_server()` (the proven
  serve/`--attach` pattern D-11 extends to the round-trip stage, including
  the port-0/hostname/URL-poll bring-up), `run_stage_remember_recall()`
  (current 3-attempt recall retry + substring-grep assertions being replaced),
  `extract_session_id()` (existing NDJSON field extraction precedent),
  fingerprint guards + cleanup discipline (must be preserved per-iteration
  under D-03).

### Verify-by-execution precedent
- `scripts/verify-fastcontext-reliability.sh` — the Phase 6 preflight-probe
  style D-06 mirrors (probe the model's tool-calling before building on it).
- `scripts/verify-explore-maturation.sh`, `scripts/verify-routing-seam.sh` —
  the current verify-script family shape (help text, staged output, non-zero
  on failure) the `--repeat` mode must match.
- `scripts/verify-docs-parity.sh`, `scripts/verify-no-private-references.sh`
  — Phase 11 gates that must stay green after this phase's changes.

### Where the precondition gets documented
- `docs/operating.md` — the operating guide where the trait-based model
  precondition (D-07) and any harness usage notes land; keep consistent with
  the docs-parity gate.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`start_capture_server()` / `stop_capture_server()`** (harness): the
  proven `opencode serve --port 0` + `--attach` workaround for the
  process-exit race — the exact pattern D-11 applies to the round-trip stage.
- **`run_stage_remember_recall()`**: already has session-ID threading
  (`--session` on recall) and a bounded recall retry; hardening replaces its
  transport (plain run → attach) and its assertions (grep → tool events).
- **`extract_session_id()`**: existing NDJSON parsing over `--format json`
  output — the seed for the D-08/D-09 tool-event parser.
- **Scratch-HOME setup/teardown + fingerprint guards**: the per-iteration
  unit D-03 loops; already confirms the operator's real
  `~/.config/opencode`/`~/.claude` are untouched on every exit path.

### Established Patterns
- **Verify-by-execution [repo-wide]**: gates are re-runnable scripts with
  recorded output — D-02/D-04 follow it.
- **Probe-before-build (Phase 6 lesson)**: never build atop an unverified
  local model's tool-calling — D-06 is the same lesson applied to the soak.
- **Bounded, classified retry (Phase 5 precedent)**: retries are good-faith
  and bounded, and failure classes are reported distinctly — D-13 tightens
  this to infra-only.
- **Env-only `CAIRN_*` config, no committed defaults**: model/endpoint config
  stays in the operator's environment (D-07).

### Integration Points
- `scripts/verify-opencode-live-parity.sh` — all harness changes land here
  (`--repeat` flag, preflight probe, stage conversion, assertion upgrade).
- `.planning/MILESTONES.md` + `.planning/REQUIREMENTS.md` — gap-resolution
  records (Success Criterion #3).
- `docs/operating.md` — model-precondition documentation (D-07); guarded by
  `scripts/verify-docs-parity.sh`.
- No changes expected in `mcp-memory-server/`, `opencode/`, or `claude/` —
  this phase is harness + docs + planning records only.

</code_context>

<specifics>
## Specific Ideas

- The 5/5 claim is only as strong as its assertions: a soak built on
  substring greps could be five false positives, which is why the assertion
  upgrade (D-08/D-09) is in-phase rather than deferred — the two halves make
  one credible claim together.
- Retry visibility matters as much as retry behavior: log how many infra
  retries each iteration consumed, so the recorded evidence shows *how much*
  flakiness was absorbed, not just that the run eventually passed.
- The preflight probe should fail with a message that names the trait
  requirement (no-thinking, tool-call-reliable) so a future operator
  immediately knows it's a model problem, not a harness regression — the
  exact ambiguity v1.1 suffered.

</specifics>

<deferred>
## Deferred Ideas

- **Interactive TUI confirm of the round-trip** — carried v1.1 gap, remains
  out of scope (needs a TTY operator; REQUIREMENTS.md Out of Scope).
- **Tool-event assertion upgrade for wakeup/recall-on-edit/capture stages**
  — D-08 scopes the upgrade to the round-trip stages; converting the rest is
  a possible future consistency pass if their evidence is ever questioned.
- **Converting wakeup/recall-on-edit to serve/`--attach`** — rejected for
  this phase (D-11); revisit only if those stages exhibit the same
  run-completion flakiness in practice.
- **Soaking the whole `--full` suite N×** — rejected (D-12) as runtime-heavy
  with no requirement behind it; the single regression pass covers it.

</deferred>

---

*Phase: 13-headless-harness-hardening*
*Context gathered: 2026-07-08*
