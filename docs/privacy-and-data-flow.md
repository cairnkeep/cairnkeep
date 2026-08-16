# Privacy and data flow

Cairnkeep has no telemetry, analytics collector, hosted control plane, or
automatic remote-service discovery. A default local stdio installation stores
memory in SQLite on the machine running the MCP server and makes no model or RAG
request unless the corresponding endpoint and credential are configured.

## Data flows

| Feature | Data that can leave the server machine | Destination |
|---|---|---|
| Local substring search | None | Local SQLite only |
| Embedding-ranked search | Stored memory values that are not cached, plus the search query | `CAIRN_MEMORY_EMBEDDING_URL` or `CAIRN_LLM_API_URL` |
| `memory_extract` | The transcript supplied to the tool | `CAIRN_LLM_API_URL` |
| `domain_knowledge_query` | Workspace slug and query | `ANYTHINGLLM_BASE_URL` |
| `domain_knowledge_sync` | Files selected by the sync configuration | `ANYTHINGLLM_BASE_URL` |
| `route_check` | A health request, with no memory or prompt content | `CAIRN_ROUTE_ENDPOINT` |
| `context_explore` | Repository path and query are passed to the configured local executable | `CAIRN_EXPLORE_BINARY`; any further data flow is controlled by that tool |
| Local context-pack install/list/read/substring search | None | Verified immutable files and project pointers under `CAIRN_PACK_BASE_DIR` |
| Embedding-ranked context-pack search | Enabled file chunks not already cached, plus the query | The explicitly configured embedding endpoint; failure falls back locally |
| Authenticated HTTP context-pack retrieval | MCP requests and enabled document/approved-skill content | The explicit Cairnkeep HTTP server; requires separate pack HTTP consent |
| Optional Graphify workflow | The repository path, exact query/symbol names, root `graphify-out/` work directory, and local `.planning/graphs/` publication are passed to or produced by the operator-installed `graphify` executable | Local Graphify subprocess with a minimal environment and no provider credentials; managed build uses code-only `update`, never semantic document extraction |
| Remote HTTP memory | MCP requests and responses, including memory content | The explicitly registered Cairnkeep HTTP server |
| Opt-in trajectory capture | None | Local `<project>/.agentfs/trajectory.db` only; no model or HTTP path exists |
| Opt-in capability callback records | None | Payload-free final metadata in local `<project>/.agentfs/trajectory.db`; HTTP transport is always skipped |
| Opt-in Git-linked work evidence | Repository-relative Git state and exact local object identifiers | Local `<Git root>/.agentfs/work-evidence/v1/`; HTTP transport is always skipped |
| Separately enabled work-evidence patch | Redacted tracked diff from the starting commit to the ending worktree | Local artifact store only; requires both work-evidence patch and artifact-store consent |
| Opt-in deterministic note distillation | None | Reads redacted closed trajectories; writes local Markdown + manifest under `${CAIRN_AGENTFS_BASE_DIR:-~/.cairnkeep}/notes/` |
| Separately opted-in note enrichment | `CAIRN_LLM_API_KEY` | Sends bounded redacted note evidence to the explicit `CAIRN_LLM_API_URL` chat endpoint |
| Typed lifecycle and inline `memory_import` over local stdio | None | Values, metadata, digests, replay bindings, and history remain in the selected local store |
| Typed lifecycle and inline `memory_import` over authenticated HTTP | MCP requests and responses, including supplied values | The explicitly registered Cairnkeep HTTP server; import results omit values |
| Project/shared note lifecycle over local stdio | None | Canonical Markdown, history, replay, and journals remain in the server-controlled notes root |
| Project/shared note lifecycle over authenticated HTTP | MCP requests and responses, including complete note records | The explicitly registered server; clients send logical keys, never server filesystem paths |
| Claude `PostCompact` compaction capture | None | Redacted local `<project>/.agentfs/artifacts.db`; no model or HTTP path |
| OpenCode `session.compacted` + local SDK fetch | None | Redacted local `<project>/.agentfs/artifacts.db`; no model or HTTP path |
| Explicit artifact tools over local stdio | None | Inline artifact values remain in the local project artifact store |
| Separately enabled artifact tools over HTTP | MCP artifact requests and explicit read responses | The authenticated server selected by the client; requires `CAIRN_ARTIFACT_STORE`, `CAIRN_ARTIFACT_HTTP`, bearer/Host checks, and validated project identity |
| Automatic compaction recovery | None | Structured categories are injected locally; raw summary and other bodies are excluded |
| Explicit artifact read/show | The redacted body only when HTTP is separately enabled and the operator/client explicitly reads it | Local terminal/stdio, or the explicitly registered authenticated server |
| Opt-in evaluation coordinator | Adapter-defined inference may leave the machine only according to the explicit operator-owned adapter and inherited environment | Local adapter subprocess; Cairnkeep supplies no provider, endpoint, credential, model, or network default |
| Guided project setup | None | Selected scaffold assets and private `.ai/cairnkeep.json` state in the target; machine sync is never automatic |
| Codex project setup and launcher | None | Local `.codex/config.toml` starts `cairn memory-server` over stdio only after the operator trusts the project |
| Pi memory extension | None | Local `cairn memory-server` stdio child; no HTTP transport is inherited |

Model endpoints may be local or remote. Cairnkeep cannot determine a provider's
retention, training, or logging policy; verify it before sending confidential
material. Disabling `CAIRN_LLM_API_KEY`, `ANYTHINGLLM_API_KEY`, remote HTTP
registration, and delegated tools keeps the core memory workflow local.

## Data at rest

Memories are stored in SQLite databases. They are not encrypted by Cairnkeep at
the application layer. Use operating-system disk encryption, restrictive file
permissions, encrypted backups, and host access controls appropriate to the
sensitivity of the material. SQLite `-wal` and `-shm` sidecars and exported
archives can contain sensitive content too.

Project-scoped and named/global database locations are documented in
[Memory storage and deployment](storage.md). A remote client stores memory on
the remote server host; changing a storage environment variable on the client
does not relocate that server's databases.

Typed metadata adds no default egress. Values, canonical types/tags, complete
history snapshots, SHA-256 import digests, replay bindings, and note transaction
backups/journals are sensitive local data at rest. Dry-run and commit responses
contain scopes/address spaces, digests, keys, actions, and counts—not supplied
or displaced values. No model, API key, endpoint, or network is required.

The existing explicitly configured embedding search is the sole related egress:
eligible key/value/type/tag text and the query may be sent to
`CAIRN_MEMORY_EMBEDDING_URL` (or its documented fallback). Hard filters run
before that request; endpoint failure returns to local substring search. Note
search is always local and never uses embeddings.

Canonical note storage includes manifest records, Markdown, indexes, history,
import replay state, staged bytes, backups, and journals. Prepared/committing
recovery restores verified pre-images. Committed-before-cleanup recovery
verifies and preserves the completed mutation, then removes only transaction
artifacts. Unverifiable committed state remains blocked and is not rolled back.
Default uninstall retains this state; explicit `--purge-memory` backs it up
before removal and its `revert.sh` restores it.

Artifact envelopes, redacted content, digests, indexes, dedupe bindings,
revision counters, latest pointers, SQLite sidecars, backups, and explicit
read/CLI output are sensitive data at rest. They are not application-level
encrypted. Default uninstall retains them; purge is backup-first and the
generated revert restores exact bytes. Hard delete and explicit prune remove
content plus derived references without keeping a tombstone.

Evaluation reports and task-local note snapshots are also sensitive local data
at rest under `<project>/.agentfs/eval/experiments/`. Directories are private,
reports are mode `0600`, snapshots are read-only, and checkpoints are bounded
atomic replacements. Default uninstall retains them; explicit
`--purge-memory PROJECT` backs up the whole `.agentfs/` boundary before removal
and its generated `revert.sh` restores exact bytes, modes, and layout. Explicit
`cairn eval delete` and `prune` remove selected contained experiment trees with
no hidden tombstone.

## Guided setup, Codex, and Pi bridge

Guided setup performs a read-only target and Git preflight before project
writes. Its schema-v1 `.ai/cairnkeep.json` record contains the package version,
Git and memory choices, selected harness names, and setup-owned asset paths,
digests, modes, and template identifiers. It does not contain credentials,
endpoints, absolute paths, prompts, or memory values. The file is mode `0600`
on POSIX and receives the private managed-file ACL on native Windows. Setup
never invokes machine sync, and it does not start a harness or server child.

Selecting Codex with local memory adds a non-secret project MCP table that
invokes `cairn memory-server`. Setup never edits user-wide Codex configuration,
grants project trust, or overwrites a different `.codex/config.toml`. Doctor can
validate a manually merged Cairnkeep table without claiming ownership of the
surrounding operator configuration, and uninstall leaves that file intact.

When the explicitly installed Pi memory extension starts a session, it spawns
`cairn memory-server` as a child in the project directory over local stdio. The
bridge removes `MCP_HTTP_PORT` from the child environment, retains only the
newest 16 KiB of child stderr for bounded failure diagnostics, caps startup,
calls, catalogs, and results, and closes the child at shutdown. The child still
inherits the remaining operator environment needed by the normal local server,
so those environment values and the project directory are a child-process trust
boundary even though they are not persisted by the bridge.

Catalog and call replay is allow-listed to MCP tool metadata and result fields.
Names, schemas, annotations, content, `structuredContent`, `_meta`, and error
state are preserved without sanitizing away protocol meaning; Pi receives the
annotations in trusted result `details` because Pi 0.84.1 has no native
annotations field. The bridge does not log requests or results, create a second
catalog, activate prompts or skills, add remote access, or persist a transcript.
Sanitized test replay uses synthetic tool arguments, results, stderr, and
project paths only; release evidence must not include credentials, private
endpoints, memory values, or identifying local paths.

## Evaluation adapter and report flow

`CAIRN_EVAL` is unset/off by default. With it off, `cairn eval` returns a fixed
disabled result before task-set or adapter reads, workspace/report creation,
database access, subprocess execution, or network activity. A credential in
the environment never enables evaluation. When enabled, Cairnkeep remains a
local coordinator; the operator selects and owns any inference performed by
the explicit adapter program.

The per-observation flow is:

```text
validated committed task set + explicit adapter program/args
  → fresh task/pass/arm HOME, TMP, XDG, workspace, notes, and output roots
  → one bounded schema-v1 request on adapter stdin
  → exactly one bounded strict schema-v1 observation on adapter stdout
  → independent deterministic task verifier
  → allow-listed local observation + atomic partial/final report checkpoint
  → workspace cleanup
```

The request fields are exactly schema version, experiment/task identity, arm,
repetition, pass, relative workspace path, nullable relative notes path, fixed
task input, declared limits, paired seed, expected capability digest, and
relative output path. The fixed task input is prompt-like content delivered to
the adapter for execution; it is not copied into the report. Run 2 can receive
only the immutable note snapshot distilled from that same task's Run 1
trajectory. No other task's notes, checkout, HOME, temporary directory, XDG
state, or output directory is reused.

The supplied `workspace_path` is the task's Cairnkeep project root for
trajectory-producing harness work. Offline Run 1 distillation performs an
exact session lookup only in that task workspace's local
`.agentfs/trajectory.db`; `trajectory_ref` is a bounded session identifier and
not a path. If the exact session is absent or stored under a different root,
the report retains failed note missingness and Run 2 receives no snapshot.
Cairnkeep does not retry the source or parent root, recursively discover
stores, inspect siblings, or accept an adapter-selected absolute locator.

The strict stdout observation can contain only terminal status and a value-free
error code; turns with an exact semantics ID; independently optional input,
output, reasoning, cache-read, cache-write, and total token counts; optional
amount-plus-currency cost; bounded harness/adapter/model/config identities;
observed capability digest; and bounded trajectory/artifact references. It has
no pass field—the verifier owns pass state. Unknown fields, oversized output,
invalid UTF-8/JSON, semantic mismatches, and capability-digest mismatches are
rejected or retained as explicit missing/invalid observations rather than
being inferred.

The adapter inherits the operator's process environment so an operator-owned
harness can use its existing secrets. Cairnkeep overrides only isolated
task-local HOME/TMP/XDG roots and explicit capability-arm values. Secret values
and full environment snapshots are never report fields. Adapter stderr is
inherited for live operator diagnostics and is never buffered into evidence.
Adapter stdout is discarded after strict observation validation. Prompts,
model outputs, verifier stdout/stderr, arbitrary errors, workspace contents,
and complete environment values are not persisted in reports. Identifiers and
references are bounded and value-minimized so metadata cannot become a free
text channel.

Reports persist only the versioned schedule and terminal/process/verifier
states; allow-listed observations; expected/observed capability state and
digests; task-local note outcome/manifests/digests; revisions and task/adapter
digests; runtime/component identifiers; explicit optional metrics; populations,
missingness, warnings, and uncertainty metadata. The stable JSON report is the
source of truth; human output is rendered only from validated JSON. Local
report and snapshot retention/removal is documented in
[storage](storage.md#evaluation-report-and-note-snapshot-storage).

`validate` performs no adapter or network call. `run` and `ablate` print the
deterministic serial invocation estimate and require explicit `--yes` before
execution. Cairnkeep supplies no live adapter, provider, endpoint, credential,
model, retry, or network default. The packaged fake adapter is deterministic,
network-free, and permanently scoped as framework-only evidence.

SIGINT/SIGTERM stops new schedule admission, terminates the active adapter,
checkpoints cancellation, performs bounded cleanup, and retains a partial
report. POSIX process groups receive TERM followed by bounded KILL escalation.
Native Windows uses `taskkill.exe /T` for the exact child tree and `/F` for
bounded force escalation; it does not enumerate or terminate unrelated
processes.

Turns aggregate only under exact matching compatibility IDs. Missing token
components/totals, unknown verifier outcomes, incompatible turn semantics, and
failed or absent note snapshots remain explicit missingness. Reports show both
the full committed population and note-eligible subset with paired counts and
seeded uncertainty; they do not convert framework output into a causal,
significance, quality, or efficiency claim.

## Validated skill improvement flow

Harvest and review are local-only operations over project hindsight notes.
Before approval, no proposal subprocess is started and no evidence crosses a
process boundary. After explicit approval, the configured proposal adapter
receives exactly one bounded JSON request containing the approved candidate,
candidate digest, selected target path, current target content and digest, and
edit budget.

The proposal adapter receives an isolated private HOME and TMPDIR, a minimal
PATH and locale, and only environment variables named in its strict
`environment_allowlist`. It does not inherit the rest of the parent
environment. HOME, PATH, temporary and XDG roots, and Node runtime injection
variables are isolation-controlled and cannot be allowlisted. Its stdout must
be one strict bounded response containing status
and bounded edits; arbitrary stderr is live operator diagnostics and is not
stored. Cairnkeep records the adapter executable digest and rejects a change
during the invocation. The adapter may perform network access according to the
executable and host policy, but Cairnkeep provides no endpoint, credential, or
network default. Operators must treat approval as consent to send those exact
evidence and target fields to that adapter.

The reduced environment is not an operating-system sandbox. The explicit
adapter executable retains the invoking user's filesystem and network
authority, so operators must trust it or wrap it in a separately enforced host
sandbox.

Evaluation sends neither candidate evidence nor proposal rationales to the
harness adapter. It overlays baseline or candidate skill bytes into separate
fresh worktrees and otherwise uses the existing evaluation request contract.
Exploration and confirmation use disjoint task IDs and definitions. Confirmation
is not opened unless exploration passes, and its results cannot be supplied
back to proposal generation by this workflow. Both stages bind one evaluation
adapter executable digest and reject a change during either stage.

Apply and rollback invoke no model and make no network request. They operate on
one contained regular target and private local artifacts, require exact
digests, reject symlinks, and fail closed on concurrent target changes. See
[storage](storage.md#validated-skill-storage) for retained bytes and
[Validated skill improvement](skill-improvement.md) for the operator sequence.

## Compaction and artifact flows

Both `CAIRN_COMPACTION_CAPTURE` and `CAIRN_ARTIFACT_STORE` are default-off and
independent. With a flag off, its adapter returns before new parsing, SDK,
subprocess, file/database, network, stdout/stderr, or context-injection work.
Credentials never imply either flag. No model call, telemetry, automatic
remote discovery, or default egress is introduced.

Claude local capture:

```text
documented PostCompact stdin (session/cwd/trigger/compact_summary)
  → supported-version validation
  → recursive redaction
  → truncate / digest / index / write
  → local .agentfs/artifacts.db
```

OpenCode local capture:

```text
session.compacted session ID
  → local SDK get(session) + messages(session)
  → select the pinned completed summary shape
  → recursive redaction
  → truncate / digest / index / write
  → local .agentfs/artifacts.db
```

Only Claude Code `PostCompact` 2.1.219 and 2.1.220 and OpenCode
`session.compacted` 1.17.20 are pinned. Unknown versions/shapes fail open. Their payload is not logged, serialized,
temporarily copied, digested, indexed, or retained; doctor receives only a
bounded value-free reason. Artifact candidates are redacted before digest, index, temporary storage, or any Cairnkeep write.
Truncation also happens only after redaction. The same recursive
built-ins and bounded project redaction file used by trajectory capture apply.

Explicit artifact ingress:

```text
local stdio artifact_write (CAIRN_ARTIFACT_STORE)
  → bounded inline schema → redact → truncate → digest/index/write locally

authenticated HTTP artifact_write (both artifact flags)
  → bearer + Host/CORS + X-Cairn-Project
  → server-derived project root → same bounded redaction/write path
```

The four accepted kinds are `compaction_summary`, `diff`, `test_output`, and
`generated_file`. Generated-file paths are labels only and are never read;
binary or oversized bodies become metadata-only. There is no ambient command
output capture, filesystem watcher, or caller-selected path dereference.

Recovery egress is local and concise:

```text
current-session latest valid compaction, else newest valid project compaction
  → provenance/freshness/completeness + four structured categories
  → harness SessionStart/system-transform context
```

Raw summaries are on-demand only through explicit `artifact_read` or
`cairn artifact show`; automatic recovery never injects them or another
artifact body. Lists, writes, deletes, pruning, and doctor omit bodies. Stored
redacted content is still sensitive and can be exposed by an explicit read.

HTTP artifact egress is separately enabled by `CAIRN_ARTIFACT_HTTP` in
addition to `CAIRN_ARTIFACT_STORE` and existing authenticated transport
controls. It exposes only the four artifact tools, never trajectories,
compaction hooks, or a generic filesystem. With HTTP consent absent, remote
clients cannot observe artifact schemas or content. Artifacts have no default egress.
Artifacts have no telemetry; local capture/recovery never uses the HTTP route.

## Git-linked work evidence

Work evidence is disabled unless `CAIRN_WORK_EVIDENCE=1` is present in the
launcher environment. Generated launchers observe Git immediately before and
after the harness process and store commit, branch/detached/unborn and dirty
state, canonical status/workspace digests, bounded touched-path labels,
timestamps and exit status. Descendant processes may append exact identifiers
for trajectories, artifacts and reviewed-memory writes. They do not copy those
bodies into the evidence record.

Workspace digests are derived from Git object state and can include the hashes
of observed untracked content. Bodies are not retained, but hashing is not
redaction: an observer can test guesses for low-entropy content. Keep secrets
out of project worktrees and do not enable this feature when path labels or
content-derived digests exceed the project's retention policy.

No prompt, keystroke, shell history, environment value or model reasoning is
captured. Repository-relative path labels are retained because they are needed
to explain the observed worktree transition. Concurrent processes are not
distinguishable, and a path restored to its starting state is not reported as
touched. The record is evidence of an interval and integrity relationships, not
proof of authorship.

Optional patch capture requires both `CAIRN_WORK_EVIDENCE_PATCH=1` and
`CAIRN_ARTIFACT_STORE=1`. The diff is computed from the start commit to the end
worktree, so it can contain tracked edits that existed before launch. Untracked
bodies are omitted. Existing recursive redaction and the lower configured byte
cap apply before the artifact is persisted. Cairnkeep never applies, restores
or sends the patch.

`work_evidence_list` and `work_evidence_read` are local-stdio-only observation
tools. They are absent when the feature is off and absent from authenticated
HTTP even when it is on. No work-evidence path performs a network request.

## Structured trajectory capture

`CAIRN_TRAJECTORY_CAPTURE` is unset and off by default. When explicitly set to
`1`, `true`, `yes`, or `on`, the existing Claude Code SessionEnd hook reads the
harness-owned transcript file named in its hook event, or the existing OpenCode
session-idle plugin requests that session's structured messages and parts from
the local SDK, or the Pi `session_shutdown` extension reads Pi's active branch
through its read-only session manager. Cairnkeep does not change, copy, retain,
or delete Claude Code's source transcript, and it does not control OpenCode or
Pi's own source retention.
Those harness-owned sources remain a separate privacy boundary.

The capture path allow-lists user messages, visible model outputs, tool
invocations, tool results, system events, timestamps, and usage/cost fields
when the harness exposes them. It does not store hidden reasoning text;
reasoning blocks and unknown record types are counted as omissions. Records are
normalized into the versioned trajectory schema, recursively redacted, bounded
by UTF-8 serialized size, and only then passed to AgentFS. Built-in rules redact
secret-like object keys, bearer/API-key/password forms, credential-bearing URLs,
private-key blocks, and exact values of secret-like environment variables.
For Pi, model and thinking-level changes become system events; hidden thinking
blocks are never written. Provider error messages become redacted system events
so failed sessions remain useful to later hindsight processing. Only the active branch is captured. The extension
passes the structured branch to the same local normalizer/store path, kills a
stalled capture subprocess after three seconds, and always fails open so a
capture error cannot change the Pi session's outcome.

Bootstrap writes `.ai/trajectory-redaction.json` with no custom rules and does
not enable capture. A project may add up to 32 bounded regular expressions to
that file, or select another project-contained file with
`CAIRN_TRAJECTORY_REDACTION_FILE`. Invalid, unreadable, outside-project, or
uncompilable configuration fails that capture attempt before any partial write.
Custom patterns are defense in depth: they can miss an unknown secret shape or
redact too broadly, so captured sessions must still be treated as sensitive.

The redacted v1 session and time index live only at
`<project>/.agentfs/trajectory.db`. Default limits are 5 MiB per session, 256
MiB logical total and 30 days. Capture and explicit `cairn trajectory prune`
apply age and oldest-first budget retention. `list`, `show`, `prune --dry-run`,
doctor output, SQLite `-wal`/`-shm` files, backups and terminal output remain
local but can expose redacted project content, paths, error output and metadata
to anyone who can access them. Cairnkeep provides no application-level
encryption; use host encryption and access controls.

Trajectory capture has no MCP tool or remote HTTP endpoint and never calls an
LLM, embedding service, AnythingLLM, telemetry service, or other network
destination. With the flag unset, the hook/plugin does not create or touch the
trajectory database. `cairn doctor --repair` may rebuild missing metadata and
indexes from valid full records but does not discard an invalid full record;
only capture retention, explicit prune, or explicit uninstall purge removes
trajectory sessions.

## Capability callback flow

Callback measurement has three consents, all separately default-off where
applicable:

```text
CAIRN_CAPABILITY_CONTRACT enabled
  + managed logging.callbacks enabled (or CAIRN_CAPABILITY_LOGGING)
  + CAIRN_TRAJECTORY_CAPTURE enabled
  + local non-HTTP invocation
      -> resolve effective state and digest
      -> durably issue one payload-free local operating marker
      -> run the unchanged capability owner
      -> check current three-consent authorization and effective state again
      -> consume the exact issued marker once with one payload-free final record
```

The resulting three-state privacy contract is precise:

- With the master contract off, Cairnkeep preserves exact legacy behavior. It
  installs or invokes no capability hook/plugin, never introduces a capability
  block, and creates no pending lease, callback final, or other capability
  measurement state.
- With the master contract on and the target disabled, the fixed block always
  occurs before owner I/O. When all three consents are enabled, the issued
  lease is atomically consumed into exactly one D-25/D-26 value-free
  `disabled` final. If either measurement consent—managed callback logging or
  local trajectory capture—is off, the same fixed block remains in force and
  no pending or final state is written.
- With the master contract on and the target enabled, turning either
  measurement consent off leaves owner execution unchanged and writes no
  pending or final state.

Consent affects measurement, never the disabled policy decision. No branch may
record arguments, results, prompts, query text, paths, raw errors, or secrets.

An operating start with absent consent, HTTP transport, or a local-store fault
returns the existing unmeasured bypass without issuing a handle. At finish,
the contract flag and local trajectory capture are checked before managed
status resolution; current three-consent authorization is checked again at finish,
and managed logging, capability enablement, state source, and the effective
configuration digest must still match. Revoked consent or stale
configuration defensively consumes a matching existing marker without a final
record. This invalidation never creates a database, remains value-free and
fail-open, and cannot resurrect the invocation after re-enable.

A schema-valid handle alone proves nothing. Unissued, strict-field-mismatched,
expired, stale, and replayed handles return a non-finalizing result and cannot
produce final callback evidence. A mismatch does not consume the authentic
marker; the untouched issued handle can still settle exactly once.

There is no remote/HTTP callback persistence. HTTP callbacks are never persisted.
Pending markers and final records never use remote project routing.
There is no payload, no telemetry, no analytics, no log export, and no callback
network request. This is a no-payload, no-telemetry, no-network boundary.
Existing authenticated HTTP MCP behavior is unchanged.

The strict schema permits only these final fields:

- `schema_version`
- `capability_id`
- `invocation_id` (`cap:<uuid>`, unique per invocation)
- `correlation_id` (the explicit harness session when exposed, otherwise one
  stable per-process/run `cairn:<uuid>`; never `unknown`)
- `harness` (`claude-code`, `opencode`, `pi`, or `other`)
- `source` (`mcp`, `notes-cli`, `audit-timer`, `operating-command`, or
  `operating-workflow`)
- `transport` (`stdio`, `local-process`, or `harness-command` for persisted
  records; HTTP is skipped)
- `started_at`, `finished_at`, and non-negative `duration_ms`
- `outcome` (`success`, `error`, `timeout`, or `disabled`) and, for a
  non-success outcome, one stable value-free `error_code`
- `state_source` (`environment`, `project`, or `compatibility`)
- `configuration_digest` (the SHA-256 digest of the effective state snapshot)

There is no start record in callback evidence. A transient marker under
`capability-callback/v1/pending/` contains only the same strict handle scalars;
it is not a trajectory session or callback record, is bounded by the callback
retention/cap policy, and is consumed once. Final records remain under the
unchanged `capability-callback/v1/record/` schema and allow-list. One atomic
final record is attempted after a terminal outcome; an operating disabled
result may record `disabled`. A store open, lock, schema, validation, or write
failure is fail-open: it cannot change the owner result, thrown error, timeout
behavior, stdout/stderr, or exit status.

Neither issuance nor the final-record constructor receives or persists
arguments, results, prompts, query text, memory values, file paths, stack
traces, raw errors, secrets, credentials, arbitrary metadata, or user-supplied
messages/details. The timer starts only immediately before the capability-owned
body after state resolution, and ends after its outcome before final
presentation; discovery, configuration, guard, and unrelated harness overhead
are excluded.

When one of `memory.write`, `memory.search`, `route.check`, or
`context.explore` is disabled, it is omitted from MCP registration and cannot
produce a callback record. The schema-v1 `cairn capabilities status --json`
snapshot and its `configuration_digest` are the evidence for that omitted tool.
This is operating evidence only, not a task result, telemetry event, or
evaluation/quality claim.

## Hindsight note distillation

`CAIRN_NOTE_DISTILLATION` is unset/off by default. With it off, every public
notes operation returns before reading trajectories, walking projects, opening
the note store, acquiring a lock, or making a request. Capture does not imply
distillation, and the presence of any API credential does not enable it.

The local deterministic flow is:

```text
harness-owned source
  → allow-listed, redacted, bounded trajectory in <project>/.agentfs/trajectory.db
  → conservative failure/validation evidence
  → versioned message + stack + component signature and lifecycle reducer
  → local managed Markdown, README indexes, and hidden manifest under ~/.cairnkeep/notes/
```

Only explicit failed tool results, structured nonzero statuses, provider-error
events, equivalent later successful validation calls, and a bounded set of
explicit abandonment phrases affect lifecycle. The note stores normalized
error/component data, session IDs/digests, timestamps, outcome evidence, and
optional generated prose; it does not copy full trajectories or hidden
reasoning. Visible Markdown omits absolute checkout roots. The hidden manifest
retains canonical project roots for local scheduling, lookup maps, lifecycle
records, and processed-session digests. Occurrence history is capped at 1024
entries per note and processed-session history at 4096 digests per project.
Notes have no automatic age deletion and survive trajectory pruning; inspect or
delete them under your local retention policy.

Markdown and manifest files, locks, backups, terminal JSON, and promoted shared
notes are sensitive derived project data. They are owner-readable local files,
not encrypted by Cairnkeep. Generated `cairnkeep:managed:v1` blocks may be
rewritten; text after the block is preserved. Promotion is explicit and local,
requires compatible evidence from two distinct projects plus `--confirm`, and
creates one shared canonical note with project provenance references.

Optional enrichment adds a second, independent egress boundary. It runs only
when `CAIRN_NOTE_ENRICHMENT` and the master flag are truthy and key, base URL,
and model are all explicitly configured. One changed note's bounded redacted
error, component, lifecycle, and attempt strings are sent to the configured
OpenAI-compatible `/chat/completions` endpoint; full trajectories, manifests,
manual Markdown, credentials, and hidden reasoning are not request fields.
Requests use a bounded output, timeout, strict response schema, and at most one
retry. Returned prose is labeled non-authoritative and cannot change identity,
lifecycle, exact keys, or provenance. Missing configuration or provider failure
leaves the deterministic note intact.

Redaction is best effort, not proof that content is non-sensitive. Unknown
secret formats or secrets embedded in unusual free text can survive imperfect
patterns and therefore reach local notes or, if enrichment is enabled, the
configured endpoint. Inspect redaction rules and representative local notes
before enabling enrichment for confidential projects. Endpoint operation,
retention, training, access control, jurisdiction, and deletion policy are the
operator's responsibility; Cairnkeep cannot verify them.

The official container stores all databases below `/data`. A named volume
persists them after container replacement and remains sensitive data. Sandbox
workspace mode also retains a repository copy in its named volume. Neither
volume is encrypted by Cairnkeep; remove it explicitly when its retention
period ends. See [Containers](containers.md).

## Credentials and transport

Keep API keys and bearer tokens out of repositories and command output. Load
them from a secret manager or protected environment file. For remote HTTP mode,
use TLS or an encrypted private network and keep the raw listener on loopback.
One HTTP bearer token grants access to the entire server; Cairnkeep does not
provide tenant isolation or per-scope authorization.

Before sharing diagnostics, remove credentials, private endpoints, database
files, memory values, local paths, and project names. Report vulnerabilities
through the private channel in [SECURITY.md](../SECURITY.md).

## Context-pack trust boundary

Pack validation proves that installed bytes match the manifest and immutable
digest. It does not authenticate a publisher. Review the source, commit, license,
and content before enabling a digest; signatures are not yet supported. Local
directory installation, listing, reading, and substring search make no network
request. Git installation/update contacts only the operator-supplied source and
is never scheduled in the background.

All enabled documents carry pack and file provenance in MCP results. Skill files
are excluded until the current project approves the exact pack digest, path, and
file digest. Updating the pack invalidates that approval. Approval only makes a
skill readable; Cairnkeep never copies it into a harness or executes it.
