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
