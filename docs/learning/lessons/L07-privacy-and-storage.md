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
- Unreleased source-only storage foundation: `cairn memory-context init` prints
  a no-write plan; `--apply --confirm DIGEST` creates only an absent destination.
  `status` and `doctor` inspect the format without initializing SDK schemas.
  Existing stores are not converted, older clients refuse the new format, and
  turning off context tools does not roll back storage. Use disposable stores
  only until the platform and recovery gates are complete. This is not a
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

## Hands-on lab

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
