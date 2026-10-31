# L07 - Privacy and storage

**Status:** Brief
**Track:** Practitioner
**Planned time:** 30 minutes

## Outcome

Predict where memory, project artifacts, credentials, and optional model data
will go before starting a session.

## Planned lesson

- The placement rule: the server process owns the store it opens.
- Local stdio versus explicitly configured remote HTTP.
- AgentFS/SQLite data at rest and project-derived artifacts.
- Separate local stores and retention for trajectories, notes, immutable
  artifacts, capability callbacks, and evaluation experiments.
- Credential boundaries and environment-variable precedence.
- Embedding/extraction endpoints and what content they receive.
- `cairn memory path` and a preflight data-flow checklist.
- Optional 2.28 tracked-store foundation: `cairn memory-context init` prints
  a no-write plan; `--apply --confirm DIGEST` creates only an absent destination.
  `status` and `doctor` inspect the format without initializing SDK schemas.
  Existing stores are not converted, older clients refuse the new format, and
  turning off context tools does not roll back storage. Use disposable stores
  only: foundation platform/recovery gates pass, but production admission and
  release remain separate decisions. This is not a
  rehearsed lesson or a change to the released installation instructions.
- Advanced recovery brief: `cairn memory-context backup --output FILE` creates
  a standalone no-overwrite snapshot. `restore --input FILE` plans an absent,
  same-owner destination; exact-digest apply renews the restore epoch before
  publication. Raw copies cannot invalidate old evidence, generic legacy import
  refuses tracked stores, and recovery is offline administration. Never
  demonstrate removal or replacement of a learner's real database.
- Source-only failure drill: distinguish a rejected pre-publication operation
  from `MEMORY_PUBLICATION_UNCERTAIN`, where a complete object may already be
  visible. Inspect status/doctor and retain recovery files; never demonstrate a
  blind retry or weaken Windows ACLs to make a test pass. This remains a Brief,
  not a claim that a new video has been rehearsed or recorded.
- Runtime check: the Node 22.16 API floor is not a safe SQLite-version promise.
  Tracked stores require a bundled SQLite with the WAL-reset fix; an unsupported
  native runtime refuses before writes while ordinary legacy memory still works.
- Development-only freshness brief: explicit assertions bind source generations,
  metadata revisions and restore epochs. Changed facts cannot become verified
  again merely because their old text returns. Source references are opaque,
  never fetched; reads do not verify facts. In the opt-in 2.28 workflow,
  demonstrate local `memory-context set-freshness` plan/exact-digest apply,
  `inspect` and metadata-only `doctor` on a disposable store. Show gated read-only
  `memory_inspect`, its separate HTTP consent and stale-plan refusal. Do not
  imply released availability, independent native qualification or a recording.
  Explain that oversized escaped keys refuse rather than changing identity, and
  legacy inspection never initializes SDK tables. Its bounded read-only child
  cannot change the main server's SDK connection cache or later write behavior.
  This does not add cross-process file locking to the legacy Windows backend;
  never demonstrate simultaneous writer processes against one such store.

## Hands-on lab

The optional [opt-in joint lab](../../memory-continuity-workflow.md) adds
feedback privacy and managed restore to the same workflow. Locate the project
ledger, explain why minimized digests are still sensitive, and distinguish
30-day eligibility from retained history and its 10,000-row cap. Export is local;
forget requires exact selected IDs and a current digest, never an automatic purge.
Show the same-secret epoch control: restore retains records but invalidates votes
even about unchanged shared memory. The fixture preserves its entire stopped
old directory; never demonstrate deleting a real database. Deliberate loopback
HTTP traffic is distinct from external provider traffic, and one bearer domain
does not create per-user ACLs. Keep this opt-in supplement separate from
ordinary released setup and legacy Windows locking limits.

Source-only map extension: identify the private disposable `.memory-map-cache/`
beside the selected database. It can contain sensitive keys/titles/provenance,
but is not authoritative memory or part of managed backups. A missing/corrupt
cache must not enable access, conversion or network traffic. Demonstrate HTTP's
separate consent/project binding; `all` never joins stores or opens team/pack/
skill backends. See [map privacy and limits](../../memory-maps.md).

Draw the data flow for a default local setup and for a disposable loopback HTTP
setup. Verify the local store path, inspect only file permissions and database
names, and prove that no remote destination was discovered.

## Acceptance criteria

- The learner predicts the correct storage host for both topologies.
- Secrets are never printed, committed, or included in screenshots.
- Optional model and RAG flows are identified separately from memory storage.
- The learner can stop when an effective destination is ambiguous.
- Independent feature flags are not treated as one blanket consent switch.

## Source material

- [Privacy and data flow](../../privacy-and-data-flow.md)
- [Storage and deployment](../../storage.md)
