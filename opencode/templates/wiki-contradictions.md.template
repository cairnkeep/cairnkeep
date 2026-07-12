# Wiki Contradiction Register

> Persistent register of contradictions flagged across `.planning/wiki/`.
> Updated in place by `/wiki-lint`. Unlike per-run REPORTS, this file is the
> durable record — lint opens and resolves entries here rather than emitting
> write-and-forget reports. Raw repo docs, tests, interfaces, config, and code
> remain canonical; this register only tracks where the *derived* wiki disagrees.

## Severity Taxonomy

- **soft** — non-blocking, contextual difference. Pages can coexist; flagged for awareness. No action required unless it accumulates.
- **scope-mismatch** — the two claims apply to different scopes/contexts and do not truly conflict. Recorded so a future reader is not confused; coexists.
- **hard** — genuinely conflicting claims that cannot both be correct. Must be resolved before downstream work relies on either page. Surface at session start.

## How To Use

- `/wiki-lint` writes/updates entries here on every run. Do not delete open entries by hand — resolve the underlying page disagreement, then let lint (or a `/wiki-ingest --refresh`) flip the status to `resolved`.
- At session start, scan the **Open** section for `severity: hard`. Surface any hard/open items before doing work that depends on the affected pages.
- An entry is `resolved` only after the conflicting wiki page(s) have actually been reconciled to the canonical source — not merely acknowledged.

## Open

<!-- wiki:contradictions:open:start -->
- None.
<!-- wiki:contradictions:open:end -->

## Resolved

<!-- wiki:contradictions:resolved:start -->
- None.
<!-- wiki:contradictions:resolved:end -->
