# Meta-agent design contract

> **Design-only status.** Phase 20 ships this Markdown file only. It ships no
> executable schema, compiler, generator, controller, adapter change,
> configuration surface, command-line interface, or runtime default. Phase 18
> capability state and Phase 19 evaluation behavior described below are current
> facts. Every meta-agent control, artifact, state, and action described as a
> requirement is future work that requires separate approval.

## Status and normative language

This document specifies a future, bounded build-test-improve configuration
loop. It does not accept input and is not an executable interface. In future
requirements, **MUST**, **MUST NOT**, **REQUIRED**, and **SHALL** are normative;
**SHOULD** and **MAY** describe constrained choices. Statements explicitly
labelled current describe accepted Phase 18 or Phase 19 behavior rather than
new behavior.

Every block labelled **Illustrative only** is fictional, secret-free, and
non-normative. Such a block is not a shipped schema and is not accepted CLI
input. It provides no default, compatibility promise, or implementation
authority.

## Paper concept and Cairnkeep boundary

The paper's build-test-improve concept motivates a future bounded configuration
loop, but does not redefine Cairnkeep's ownership. Cairnkeep may eventually
compile an operator objective into a reviewable form, propose bounded candidate
artifacts, coordinate approved measurement, and prepare a reversible proposal.
It must not own a harness inference loop. Existing repository contracts remain
the authority over external design inspiration.

Natural-language objectives are untrusted proposal data. They never authorize
repository reads, writes, commands, network use, evaluation, or application.
Only a future compiler and deterministic validator may produce the strict,
versioned form that an operator can review, reject, or confirm. Confirmation of
that form grants no evaluation or apply authority.

## Natural-language specification → strict form

The future form is the only reviewable control representation. Its validator
MUST reject unknown fields and MUST NOT infer, repair, or model-author any
safety-critical value. A natural-language objective remains attached as
untrusted provenance, not executable policy.

### Required configuration fields and fail-closed rules

| Required field group | Required future content | Deterministic invalidation rule |
|---|---|---|
| Schema and specification identity | Supported schema version, unique specification ID, canonical form digest, and untrusted objective reference | Reject absent or duplicate identity, unknown fields, unsupported versions, or a digest that does not match canonical form bytes. |
| Repository scope and immutable revisions | One or more declared repository roots, each bound to an exact immutable revision | Reject an empty root set, unresolved or non-immutable revisions, duplicate aliases, or a root whose real path cannot be established. |
| Path policy | Canonical `allowed_paths` and `denied_paths`, with deny precedence and a declared symlink policy | Reject absolute or non-canonical entries, traversal, symlink escape, out-of-root resolution, overlap with ambiguous ownership, or any target denied after canonicalization. |
| Per-run execution limits | Finite positive elapsed-time and output-byte limits for every command and adapter run | Reject missing, zero, negative, non-finite, unsafe, or unbounded resources; do not assign compatibility defaults. |
| Search and campaign ceilings | Finite maximum candidates, iterations, total wall time, reported token budget, reported cost budget with currency, consecutive invalid candidates, and consecutive non-improving candidates | Reject every omitted or non-finite ceiling, incompatible cost units, or a bound that cannot be accounted from retained evidence. Exhaustion is terminal. |
| Safety policy | Explicit network, write, command, privacy, and hard-regression rules, including non-compensable gates | Reject omissions, ambiguous verbs, undeclared egress, ambient command authority, or a policy that lets metric gain compensate for a hard failure. |
| Capability baseline and candidate | All eight canonical IDs in canonical order, each with complete before/after enabled state and matching before/after configuration digests | Reject missing, extra, reordered, or duplicate IDs; partial deltas; unavailable status; or any state/digest mismatch. A Phase 18 digest is provenance, not approval. |
| Task-set separation | Separate committed exploration and held-out confirmation task-set references, each with immutable source revision and task-set digest | Reject reuse, overlap, mutable references, unresolved revisions, digest mismatch, or any path by which held-out results become generator feedback. |
| Evaluation identity and schedule | Operator-owned adapter/config IDs, exact adapter-config digest, repetitions, deterministic seeds and order, verifier identity, isolated workspace policy, and execution limits | Reject resolved secret or endpoint values, implicit ordering, incomplete schedules, mutable verifier inputs, or an adapter/config identity that changes after approval. |
| Selection policy | Primary metric, direction, minimum improvement rule, regression guards, minimum eligible pairs, interval/confidence rule, repeated-comparison policy, and sufficient evidence scope | Reject missing denominators, undefined direction, unusable interval rules, absent regression gates, or any policy able to reinterpret missing evidence as success. |
| Mutable surfaces | Exact allowed harness-owned prompt files and typed capability fields, with pre-image identities and digests | Reject a target outside repository/path policy, a non-harness-owned prompt file, free-form configuration, or a target not present in the approved candidate artifact. |
| Human authority | Explicit human approval policy for form confirmation, evaluation, apply, rollback, rejection, and cancellation | Reject combined or delegated gates, automatic application, ambiguous approvers, or a form that removes unconditional cancellation and rollback authority. |

The exact Phase 18 capability IDs, in canonical order, are:

1. `memory.write`
2. `memory.search`
3. `notes.distill`
4. `wiki`
5. `graph`
6. `security.audit`
7. `route.check`
8. `context.explore`

The current `resolveCapabilityStatus()` result supplies an effective ordered
snapshot and `configuration_digest`. Neither the status nor its digest is a
meta-agent candidate, signature, approval, or authorization.

### Admission is fail closed

The future validator MUST reject every safety-critical omission, unknown field,
unsupported version, unresolved revision, non-finite resource, path traversal,
symlink escape, and out-of-root path. It MUST also reject stale or mismatched
digests and any value that would require an inferred default. Invalid input
cannot be made valid by prose interpretation, candidate output, prior runs, or
operator environment discovery.

Forms, proposals, and reports may carry only bounded, value-free identifiers
for operator-owned secret or adapter configuration. They MUST NOT contain
credentials, resolved secrets, endpoint values, provider defaults, complete
environment snapshots, or captured environment values. A reference says which
operator-owned configuration is expected; it never resolves or copies it.

### Illustrative only — fictional strict form

The following is secret-free and non-normative. It is not a shipped schema and
is not accepted CLI input. Angle-bracketed values are fictional review labels,
not normative numeric defaults or accepted syntax.

```text
specification: sample-improvement-study
schema: future-version
repositories:
  - root_ref: repo-alpha
    immutable_revision: revision-alpha
scope:
  allowed_paths: [harness-owned/prompts]
  denied_paths: [operator-settings]
limits:
  maximum candidates: <operator-declared finite count>
  iterations: <operator-declared finite count>
  total_wall_time: <operator-declared finite duration>
  reported_token_budget: <operator-declared finite amount>
evaluation:
  exploration_task_set: committed-set-alpha
  held_out_task_set: committed-set-beta
  adapter_config_ref: operator-config-alpha
capabilities:
  before_and_after: [memory.write, memory.search, notes.distill, wiki,
    graph, security.audit, route.check, context.explore]
human approval policy:
  form: separate
  evaluation: separate
  apply: separate
  rollback: always available
  cancellation: always available
```

## Bounded candidate artifact

A future candidate generator may emit only an immutable, canonically digested
artifact within the confirmed form's mutable surfaces. It may include bounded
prompt diffs and a complete typed capability before/after snapshot. It cannot
execute inference, commands, evaluation, or writes; grant itself new scope;
change any task, verifier, metric, threshold, resource bound, safety rule,
approval rule, stopping policy, or evidence history; or consult held-out
confirmation results. Generation and execution are separate authorities.

## Ownership and authority

The operator retains every irreversible or cost-bearing authority. Cairnkeep's
future components may transform and validate bounded artifacts, but every
inference execution MUST cross the accepted Phase 19 coordinator into an
operator-configured external adapter. Candidate generation, comparison,
approval, application, confirmation policy, and rollback have no direct
inference edge.

```text
untrusted objective
  -> future form compiler/validator -> human form confirmation
  -> future bounded candidate artifact -> human evaluation approval
  -> Phase 19 immutable schedule
       -> operator-configured external adapter -> inference execution
       -> independent verifier -> canonical Phase 19 report
  -> future comparison -> reviewable patch proposal -> human apply approval
  -> future backup/digest/atomic applier -> held-out confirmation approval
  -> Phase 19 immutable held-out schedule
       -> operator-configured external adapter -> inference execution
       -> independent verifier -> canonical Phase 19 report
  -> accept | inconclusive | no_eligible_candidate | rollback
```

There is no arrow from a Cairnkeep generator, selector, applier, or rollback
operation to inference. Phase 19 is the sole Cairnkeep execution and measurement
seam; the operator-configured external adapter remains the sole inference owner.

| Actor or component | May do | Must not do | Required authority |
|---|---|---|---|
| Operator | Confirm/reject form, approve/cancel evaluation, approve/reject application, accept confirmation, request rollback | Delegate mandatory gates to candidate output or ambient configuration | Separate, explicit decision at each gate |
| Future compiler/validator | Convert untrusted prose to a strict form; reject invalid fields | Execute prose, infer defaults, resolve secrets, or broaden scope | Form confirmation before admission |
| Future candidate generator | Produce bounded immutable artifacts within declared mutable surfaces | Execute inference/commands, mutate control policy, inspect held-out results, or write repositories | Confirmed form and remaining resource budget |
| Phase 18 capability contract | Resolve current ordered state and configuration digest | Select candidates, authorize changes, or represent arbitrary candidate overlays | Existing operator configuration |
| Phase 19 coordinator | Validate committed inputs, create isolated serial schedules, call the configured adapter, verify tasks, and persist canonical evidence | Own inference, generate candidates, choose a winner, apply a patch, or grant approval | Separate evaluation or confirmation approval |
| Operator-configured external adapter | Execute all inference under the approved bounded request and its operator-owned environment | Change tasks, verifier, policy, schedule, or repository state through this design | Operator configuration plus Phase 19 request |
| Future comparator | Apply the predeclared policy to canonical reports | Reclassify infrastructure errors, hide missingness, or relax thresholds after seeing results | Immutable form and validated reports |
| Future applier/rollback owner | Apply or exactly restore one approved proposal under digest guards | Infer intent, overwrite later edits, delete unrelated content, or invoke inference | Separate apply or rollback approval |

## Candidate evaluation through Phase 19

Candidate generation first produces an immutable candidate artifact and stops.
Deterministic validation and explicit evaluation approval are required before
Phase 19. The approved evaluation freezes committed task sets, exact source
revision, independent verifier, finite limits, repetitions, seeds and order,
adapter/config identity, and fresh isolated workspaces. The adapter alone runs
inference. Comparison reads canonical JSON; it never parses arbitrary adapter
diagnostics or model output.

### Current Phase 19 behavior versus missing future contract

| Concern | Current accepted Phase 18/19 behavior | Missing future contract; not shipped by Phase 20 |
|---|---|---|
| Capability identity | `expected_capability_digest` and `observed_capability_digest` bind the complete Phase 18 effective state. | Candidate-overlay identity and expected/observed candidate digests for arbitrary prompt/config candidates. |
| Adapter identity | `adapter_config_digest` binds the operator adapter configuration. | It is not a generated-candidate digest and grants no selection or apply authority. |
| Request surface | Phase 19 sends experiment/task identity, arm, repetition, pass, isolated paths, fixed input, limits, seed, expected capability digest, and output path. | Phase 19 has no arbitrary candidate overlay reference, injection contract, or expected candidate digest. |
| Result surface | Strict results may report bounded metrics, identities, references, and `observed_capability_digest`. | There is no observed candidate-overlay digest, and no candidate pass/approval field. |
| Ablation | `runCapabilityAblation()` compares an all-enabled baseline with exactly one disabled capability and requires four invocations per task/repetition: two passes in each of two arms. | It is not generic prompt search, arbitrary configuration injection, or a multi-capability candidate arm. |
| Scheduling | Deterministic, serial, immutable, paired schedules and fresh isolated workspaces are current. | Adaptive generation/selection and separate exploration/held-out campaign control are absent. |
| Report | Canonical reports preserve observations, aggregates, condition levels, eligible pairs, missingness, warnings, intervals, evidence scope, and provenance. | Reports do not choose winners, authorize application, or provide a proposal/rollback ledger. |

Exploration and held-out confirmation task sets MUST be separate, committed,
immutable, non-overlapping, and digest-bound. Exploration results may inform the
next bounded candidate within remaining limits. Held-out results MUST never
become generator feedback, even after rejection or rollback. A changed task,
verifier, metric, threshold, seed policy, bound, safety policy, or confirmation
set requires a new form and new approvals; it cannot be a candidate mutation.

The future comparator consumes Phase 19's exact terminal states: `completed`,
`verifier_failed`, `timeout`, `cancelled`, `adapter_error`, and
`invalid_result`; and pass states: `passed`, `failed`, and `unknown`. It also
consumes expected/observed capability digests, condition levels, eligible-pair
counts, missingness, warnings, intervals, and evidence scope. Infrastructure
states and unknown verification remain missing or ineligible evidence, never
candidate failures or passes. `offline-framework` evidence authorizes framework
mechanics only and cannot support product quality, efficiency, cost, latency,
significance, or causal claims.

## Proposal bundle, application, and rollback

A future proposal bundle is one canonically identified, reviewable unit. Any
failed element invalidates the whole proposal; partial acceptance or partial
application is forbidden.

| Required proposal bundle element | Content | Whole-proposal invalidation |
|---|---|---|
| Canonical identity | Proposal version/ID/digest; confirmed form digest; immutable source revision; baseline and candidate artifact digests | Unknown version, non-canonical bytes, duplicate ID, unresolved revision, or any digest mismatch |
| Evidence-bound rationale | Primary metric rule, regression guards, eligible-pair counts, interval result, evidence scope, warnings, missingness, and bounded references to exact Phase 19 reports/digests | Unsupported claim, copied arbitrary diagnostics, missing report, stale digest, inadequate scope, or rationale exceeding evidence |
| Prompt change | A unified diff limited to operator-declared harness-owned prompt files, with contained canonical paths, modes, and pre/post digests | Non-declared target, symlink/out-of-root path, denied path, binary ambiguity, missing pre-image, or diff/digest mismatch |
| Typed capability change | All eight before/after rows in canonical order and their Phase 18 before/after configuration digests | Partial delta, unknown/reordered ID, unavailable status, or state/digest mismatch |
| Safety findings | Results for every non-compensable network, write, command, privacy, and hard-regression gate | Missing, unknown, failed, or waived hard gate |
| Apply preconditions | Exact revision, root/path identities, pre-image bytes/digests/modes, proposal digest, and separate apply-approval record | Stale, missing, mismatched, out-of-scope, or subsequently changed precondition |
| Rollback instructions | Backup references, original bytes/modes/digests, applied post-image digests, created-file ownership, and manual-resolution conditions | Incomplete backup, ambiguous ownership, unguarded removal, or restoration not exact |

### Illustrative only — fictional proposal bundle

This fictional, secret-free, non-normative example is not a shipped schema and
is not accepted CLI input. It contains no credential, endpoint, provider
default, environment snapshot, or private identifier.

```text
proposal: sample-proposal-alpha
form_digest: digest-form-alpha
source_revision: revision-alpha
candidate_digest: digest-candidate-alpha
evidence:
  exploration_report_ref: report-alpha
  report_digest: digest-report-alpha
prompt_change:
  target: harness-owned/prompts/review.md
  unified_diff_ref: reviewed-diff-alpha
  pre_image_digest: digest-before-alpha
  post_image_digest: digest-after-alpha
capability_delta:
  snapshot: complete-eight-row-before-and-after
  before_digest: digest-capabilities-before
  after_digest: digest-capabilities-after
application: separate-human-approval-required
rollback: exact-backup-and-post-image-guard-required
```

Application is default-off and needs approval distinct from form confirmation
and evaluation approval. Immediately before any write, a future applier MUST
revalidate the exact revision, real contained roots, canonical allow/deny
policy, path ownership, symlink status, pre-image bytes/modes/digests, proposal
digest, and complete capability snapshots. It MUST finish exact backups of
every pre-image before the first write, then apply the whole proposal atomically
or leave the repository unchanged. A local audit record contains only bounded,
value-free identities, paths, modes, digests, outcomes, and backup references.

Any stale, missing, mismatched, unsafe, or out-of-scope precondition invalidates
the entire proposal. No automatic rebase, fuzzy patch, best-effort subset, or
model-authored repair is allowed.

Rollback also requires explicit operator authority. Restoration may proceed
only when each current file still matches the applied post-image digest. A
proposal-created file may be removed only when it is proposal-owned and remains
byte-for-byte unchanged. Missing or later-edited files require manual
resolution. Rollback MUST NOT delete or overwrite unrelated content,
subsequently edited user files, user settings, retained evidence, or another
proposal's assets. Backup-first exact-revert and atomic write behavior in the
current project lifecycle are precedents, not a generic applier delivered here.

## Bounded state machine and stopping policy

The future controller is a finite state machine. Every transition preserves the
confirmed form, immutable evidence history, and resource accounting. A
candidate cannot modify tasks, verifier, metrics, thresholds, bounds,
safety/approval/stopping policy, evidence scope rules, or prior evidence.

| State | Entry condition | Exit and outcome | Required evidence | Immutable while active |
|---|---|---|---|---|
| `specification` | Untrusted objective received | Reject/cancel, or submit strict form to `validation` | Objective reference only | No authority or inferred defaults |
| `validation` | Complete candidate form produced | Invalid → `rejection`; valid → human `approval`; cancel → `cancelled` | Canonical form, source/path/resource checks | Complete form and validation record |
| `candidate_proposal` | Confirmed form and remaining bounds | Invalid/non-improving ceiling → `exhausted`; valid artifact → `approval` | Candidate digest, scope checks, accounting | Control plane and evidence history |
| `approval` | A form, evaluation, patch, confirmation, or rollback action awaits a distinct decision | Approve to named next state; reject → `rejected`; cancel → `cancelled` | Exact object digest and authority type | Approval cannot cover another gate |
| `evaluation` | Explicit evaluation approval and validated Phase 19 plan | Complete → `comparison`; hard failure → `inconclusive` or `rejection`; cancel → `cancelled` | Canonical partial/final Phase 19 report | Schedule, task sets, source, adapter, verifier, seeds, limits |
| `comparison` | Canonical exploration report validated | Eligible → `patch_proposal`; insufficient evidence → `inconclusive` or `no_eligible_candidate`; budget remains → `candidate_proposal` | Terminal/pass states, digests, levels, pairs, missingness, warnings, intervals, scope | Selection and repeated-comparison policy |
| `patch_proposal` | Candidate passes exploration policy | Whole bundle valid → apply `approval`; invalid → `rejection` | Proposal identity, evidence, diff/delta, safety, preconditions, rollback | Proposal bytes and referenced evidence |
| `application` | Separate apply approval and immediate preflight passes | Atomic success → `confirmation`; preflight fail → `rejected`; ambiguous result → `manual_resolution` | Backups, pre/post digests, audit record | Approved proposal and backups |
| `confirmation` | Applied candidate and separately approved held-out schedule | Policy passes → `accepted`; inadequate evidence → `inconclusive`; regression/hard failure → `rollback` | One canonical held-out report, never generator feedback | Confirmation set and acceptance rules |
| `rollback` | Operator requests rollback or policy requires it | Exact restore → `rolled_back`; later edits/ambiguity → `manual_resolution`; cancel preserves state | Applied post-image checks and exact backups | No-clobber boundary and retained evidence |
| `rejection` | Invalid form/candidate/proposal, hard-gate failure, or explicit rejection | Terminal `rejected` | Value-free reason and retained evidence | All prior evidence |
| terminal | `accepted`, `inconclusive`, `no_eligible_candidate`, `rejected`, `cancelled`, `exhausted`, `rolled_back`, or `manual_resolution` reached | No automatic exit or restart | Final reason, resource totals, evidence/proposal references | Entire history |

### Stopping policy and selection conditions

| Condition | Required action/outcome |
|---|---|
| All hard gates pass; no regression guard fails; candidate/capability digests match; minimum eligible pairs are met; a usable interval satisfies the predeclared metric/direction/improvement rule; evidence scope is sufficient | Candidate may proceed from exploration to patch proposal; it is not yet accepted. |
| Exactly one separately approved held-out confirmation passes the same hard gates and predeclared acceptance policy | Stop as `accepted`. Further search requires a new form. |
| No candidate has adequate eligible pairs or compatible observations | Stop as `no_eligible_candidate`; never choose from absence. |
| Evidence exists but interval, missingness, warnings, scope, or improvement rule cannot establish eligibility | Stop as `inconclusive`; never relax policy post hoc. |
| Any non-compensable hard gate or safety/privacy regression fails | Stop evaluation/application; `rejected` or approved `rollback`. Metric gain cannot compensate. |
| Maximum candidates, iterations, total wall time, reported token budget, or reported cost budget is reached | Stop as `exhausted` before next admission. Missing token/cost reporting is not zero. |
| Consecutive invalid or non-improving candidate bound is reached | Stop as `exhausted`. |
| Human rejects form, evaluation, proposal, application, confirmation, or rollback | Stop as `rejected`, preserving evidence and current repository state. |
| Cancellation requested at any state | Stop admission, bound active Phase 19 cleanup, preserve partial evidence, and terminate as `cancelled`. |
| Rollback cannot safely restore because post-images changed or ownership is ambiguous | Stop as `manual_resolution`; do not overwrite or delete. |

Only an accepted held-out confirmation produces `accepted`. Exploration alone
cannot do so. Selection remains at least as conservative as Phase 19's report
semantics: missing intervals, small samples, intervals crossing the declared
no-effect boundary, incompatible semantics, unknown verifier outcomes, and
infrastructure failures cannot name a winner.

## Privacy and security invariants

These are requirements for any separately approved future implementation; Phase
20 does not implement the controls. Hard privacy and safety failures are
terminal and non-compensable. Artifacts remain local, bounded, value-minimized,
and bound to immutable source and evidence. No proposal or report may persist
prompts beyond the reviewed unified diff, model output, arbitrary diagnostics,
resolved credentials, endpoint values, or complete environment state.

| Threat pattern | Required future control | Failure disposition |
|---|---|---|
| Untrusted specification escalates policy or authority | Strict allow-listed versioned form, unknown-field rejection, no inferred defaults, separate human gates | Reject form before generation or execution |
| Path, symlink, or secret escape | Canonical real-root containment, deny precedence, no-follow checks, immediate preflight, value-free secret/config references | Reject whole form/proposal; write nothing |
| Adapter or candidate digest spoofing | Independently reconstruct exact form, candidate, adapter, Phase 18 state, and future overlay digests at each boundary | Observation/proposal is invalid, not a task failure |
| Confirmation-set overfitting | Separate committed exploration and held-out task sets; no overlap; held-out results never return to generator | Reject campaign or stop confirmation |
| Safety regression masked by metric gain | Non-compensable network/write/command/privacy and regression guards before metric selection | Reject or roll back regardless of metric |
| Resource exhaustion | Finite per-run, candidate, iteration, wall-time, reported-token/cost, invalid, and non-improvement ceilings with pre-admission accounting | Cancel active bounded work and stop as `exhausted` or `cancelled` |
| Apply/rollback time-of-check/time-of-use race or partial write | Immediate revision/path/pre-image revalidation, exact backups first, atomic all-or-nothing apply, post-image-guarded rollback | Leave unchanged, roll back exactly, or require `manual_resolution` |
| Proposal, report, or audit leakage | Strict bounded fields, local permissions, value-free diagnostics/IDs, reviewed diff only, report references instead of copied runtime content | Reject sensitive artifact and retain no partial copy |
| Infrastructure error fabricated as task outcome | Preserve Phase 19 terminal/pass separation, explicit missingness and partial reports, unknown verifier outcomes | `inconclusive` or ineligible; never fabricate pass/fail/winner |

## Prerequisites not delivered by Phases 14–19

Phases 14–19 already deliver structured local trajectories; asynchronous notes
and hindsight retrieval; typed memory nodes; compaction/artifact storage; the
eight capability IDs, toggles, digests, and value-free logs; committed strict
evaluation schemas; isolation and independent verification; two-pass and
one-off ablation execution; canonical reports, missingness, intervals,
cancellation; and `offline-framework` evidence. Those accepted substrates are
not backlog rows.

### Future implementation backlog — not delivered by Phase 20

Each row is future work requiring separate approval. The list is exactly nine
items; Phase 20 delivers none of them.

| # | Exact absent capability | Accepted substrate it may reuse | Delivery status |
|---|---|---|---|
| 1 | Natural-language-to-form compiler and validator | Strict versioning, canonical digests, and path validation patterns | Future work requiring separate approval; not delivered by Phase 20 |
| 2 | Bounded candidate generator | Phase 18 typed capability identities and retained evidence | Future work requiring separate approval; not delivered by Phase 20 |
| 3 | Candidate-config injection contract for external adapters | Phase 19 adapter seam and Phase 18 capability digests; Phase 19 currently has no arbitrary overlay identity or observed candidate digest and supports only exactly-one-capability-off ablation | Future work requiring separate approval; not delivered by Phase 20 |
| 4 | Scoped proposal/artifact schema | Existing strict versioned local artifacts and canonical reports | Future work requiring separate approval; not delivered by Phase 20 |
| 5 | Backup-first patch applier and rollback ledger | Existing backup-first uninstall/revert and atomic single-file write precedents | Future work requiring separate approval; not delivered by Phase 20 |
| 6 | Exploration and held-out committed task sets | Current committed task-set schema, exact revisions, and verifier | Future work requiring separate approval; not delivered by Phase 20 |
| 7 | Selection policy accounting for uncertainty and repeated comparisons | Phase 19 condition levels, paired estimates, missingness, warnings, and intervals | Future work requiring separate approval; not delivered by Phase 20 |
| 8 | Sufficient live baseline evidence | Validator-checked evidence scope and exact-source runtime provenance; existing offline evidence is framework-only | Future work requiring separate approval; not delivered by Phase 20 |
| 9 | Dedicated privacy/security threat review | Current local privacy, bounded storage, secret exclusion, and public hygiene guards | Future work requiring separate approval; not delivered by Phase 20 |

## Explicit exclusions

- No Cairnkeep orchestrator or unified orchestrator is designed or delivered.
- Cairnkeep does not own an inference loop; every inference execution remains
  with an operator-configured external adapter reached through Phase 19.
- Architect-style in-loop compression is outside this design and Phase 20.
- Trace UI is outside this design and Phase 20.
- Eval UI is outside this design and Phase 20.
- Phase 20 implements no compiler, generator, selection controller, proposal
  schema, patch applier, rollback ledger, candidate adapter-protocol change,
  configuration schema, CLI surface, runtime default, or modification of Phase
  18 or Phase 19 contracts.
- Phase 20 adds no symbol, command, flag, package, dependency, test source,
  executable interface, release, publication, or automatic product claim.

All excluded implementation work requires a new plan, threat review, approval,
tests, and evidence. Naming a future contract here does not reserve a public
interface or represent it as delivered.

## Decision traceability

| ID | Document home | Normative trace |
|---|---|---|
| META-01 | Natural-language specification → strict form | Untrusted prose can become only a complete, versioned, fail-closed future form. |
| META-02 | Ownership; evaluation; proposal; state machine | Candidates are bounded, measured only through Phase 19/adapters, and separately approved for application. |
| META-03 | Prerequisites; explicit exclusions | Exactly nine prerequisites remain future work and prohibited ownership/UI/implementation is explicit. |
| D-01 | Natural-language specification → strict form | Natural language is untrusted proposal data, never executable control. |
| D-02 | Required configuration fields | Scope, revisions, paths, resources, safety, capabilities, tasks, evaluation, selection, mutation, and authority are required. |
| D-03 | Admission is fail closed | Omissions, unknowns, unsafe paths, unresolved revisions, non-finite resources, and inferred defaults invalidate. |
| D-04 | Admission; privacy invariants | Only value-free operator-owned references are allowed; secret/endpoint/environment values are forbidden. |
| D-05 | Status and normative language | The artifact is design-only; examples are non-normative; no schema or CLI ships. |
| D-06 | Ownership and authority | Phase 19 is the sole execution/measurement seam and the external adapter owns inference. |
| D-07 | Candidate evaluation | Source, tasks, verifier, adapter identity, schedule, limits, seeds, and digests are frozen and comparable. |
| D-08 | Candidate evaluation | Canonical terminal/pass states, condition levels, missingness, uncertainty, and evidence scope remain authoritative. |
| D-09 | Bounded candidate artifact; ownership | Candidate generation and adapter execution are separate authorities. |
| D-10 | Candidate evaluation | Exploration and held-out sets are separate; held-out results never become generator feedback. |
| D-11 | Candidate evaluation | `offline-framework` authorizes framework claims only. |
| D-12 | Proposal bundle | Canonical identity, rationale, reports, diffs/deltas, safety, preconditions, and rollback form one review unit. |
| D-13 | Proposal bundle | Unified prompt diffs are limited to operator-declared harness-owned files. |
| D-14 | Application and rollback | Apply is separately approved, immediately revalidated, backup-first, atomic, and locally audited. |
| D-15 | Proposal invalidation | Any stale, missing, mismatched, unsafe, or out-of-scope element invalidates the whole proposal. |
| D-16 | Application and rollback | Reject/apply/rollback are explicit and restoration cannot clobber unrelated or later-edited content. |
| D-17 | Bounded state machine | Every required state has entry, evidence, immutable fields, and an explicit exit/outcome. |
| D-18 | Selection and stopping | Hard gates are non-compensable and all resource/search ceilings are finite. |
| D-19 | Selection and stopping | Acceptance needs matching digests, no regression, adequate pairs, usable interval, sufficient scope, and held-out confirmation. |
| D-20 | Selection and stopping | Exhaustion, invalid/non-improving bounds, rejection, cancellation, hard failure, and confirmation all stop explicitly. |
| D-21 | Future backlog | Exactly nine missing prerequisites are enumerated once and separated from accepted Phase 14–19 substrate. |
| D-22 | Explicit exclusions | The backlog is not implementation and all ownership, compression, UI, runtime, schema, CLI, and adapter work remains excluded. |

## References

- [Phase 18 capability schema](../../mcp-memory-server/src/capability-schema.ts)
  and [configuration resolver](../../mcp-memory-server/src/capability-config.ts)
  are the current capability contract of record.
- [Phase 19 evaluation schema](../../mcp-memory-server/src/eval-schema.ts),
  [plan validator](../../mcp-memory-server/src/eval-plan.ts),
  [runner](../../mcp-memory-server/src/eval-runner.ts), and
  [report owner](../../mcp-memory-server/src/eval-report.ts) are the current
  evaluation contract of record.
- Published current contracts are the
  [task-set schema](../../schemas/eval-task-set.schema.json),
  [adapter schema](../../schemas/eval-adapter.schema.json), and
  [report schema](../../schemas/eval-report.schema.json).
- [Operating](../operating.md), [privacy and data flow](../privacy-and-data-flow.md),
  and [storage](../storage.md) define the current operator, privacy, and local
  lifecycle boundaries.
- The paper's §2.3.4 and §2.4 are design inspiration only. Repository source,
  accepted Phase 18/19 behavior, and published schemas remain authoritative.
