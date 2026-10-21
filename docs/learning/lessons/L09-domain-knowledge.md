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
- Explicit directory-to-workspace mapping for local stdio; HTTP session headers
  remain authoritative for remote routing, not the server's current directory.
- Query-only setup before document synchronization.
- Incremental, full, and replacement synchronization boundaries.
- Endpoint, credential, and document-selection safety.
- Diagnosing an unavailable RAG service with `cairn doctor`.

## Hands-on lab

Index a synthetic three-document corpus into a disposable workspace, ask a
question requiring citations to two documents, update one document, resync, and
verify the new answer. Then unset the integration and prove memory still works.

Use two disposable checkouts sharing a global memory configuration. Declare
their absolute paths and distinct slugs in `anythingllm-projects.json`; verify
root and subdirectory queries report the expected workspace. Check an explicit
workspace override and an undeclared-directory fallback. Keep synchronization
synthetic and separately approved; a destination mapping is not write consent.
See the [recording supplement](../video-scripts/V09-workspace-routing-supplement.md).

## Acceptance criteria

- Only allowlisted synthetic documents are uploaded.
- The learner can identify the selected workspace and endpoint without printing
  its credential.
- Updated content replaces stale retrieval results.
- The learner verifies the returned workspace before trusting an empty answer;
  conflicting deepest declarations require an explicit destination or repair.
- Disabling RAG leaves `/remember` and `/recall` healthy.

## Source material

- [Domain knowledge](../../domain-knowledge.md)
