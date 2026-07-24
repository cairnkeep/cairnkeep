# L09 - Domain knowledge with RAG

**Status:** Brief
**Track:** Operator
**Planned time:** 35 minutes

## Outcome

Connect an optional document-RAG workspace, query it, and disable it again
without affecting core Cairnkeep memory.

## Planned lesson

- Memory versus document RAG responsibilities.
- Workspace selection and project configuration.
- Query-only setup before document synchronization.
- Incremental, full, and replacement synchronization boundaries.
- Endpoint, credential, and document-selection safety.
- Diagnosing an unavailable RAG service with `cairn doctor`.

## Hands-on lab

Index a synthetic three-document corpus into a disposable workspace, ask a
question requiring citations to two documents, update one document, resync, and
verify the new answer. Then unset the integration and prove memory still works.

## Acceptance criteria

- Only allowlisted synthetic documents are uploaded.
- The learner can identify the selected workspace and endpoint without printing
  its credential.
- Updated content replaces stale retrieval results.
- Disabling RAG leaves `/remember` and `/recall` healthy.

## Planned video

Lead with “optional, not required”, show query then sync, and finish by disabling
the integration. Target 12 minutes.

## Source material

- [Domain knowledge](../../domain-knowledge.md)
