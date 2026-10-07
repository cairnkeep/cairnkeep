# Bounded release-ledger task

Use a disposable project, Node standard APIs and ESM only. Implement
`src/release-ledger.mjs` exporting `createLedger()`. The returned API exposes
`append(input)`, `finalize(packageName, version)`, `get(packageName, version)`
and `list()`.

- Package names match `^[a-z][a-z0-9-]*$`; versions are numeric x.y.z. Notes
  are non-empty arrays of non-empty strings, preserving order. Invalid input
  throws Error with code `INVALID_PACKAGE`, `INVALID_VERSION` or `INVALID_NOTES`.
- `append({package,version,notes})` creates a draft with monotonically
  increasing sequence starting at 1. A pair is unique forever; duplicates
  throw `DUPLICATE_RELEASE`.
- Entries have exactly package, version, notes, sequence, state and optional
  checksum. Draft state is `draft`; finalized state is `final`.
- `finalize` is idempotent. Checksum is lowercase SHA-256 of
  `JSON.stringify({package,version,notes,sequence})` in that property order.
  Missing releases throw `NOT_FOUND`.
- `get` and `list` return detached copies including nested notes. `list` is
  sequence ordered. Add and run self-tests without changing this brief.

After the task closes, run the maintained independent grader from outside the
project, with an external process timeout:

```sh
node scripts/spikes/verify-release-ledger.mjs /PATH/TO/LAB/src/release-ledger.mjs
```

This imports and executes the selected artifact; it is not a safe reader for
arbitrary untrusted code. Use a lab with no production secrets or services.
The grader checks 15 bounded behaviors, not all possible inputs or security.
Do not expose its implementation to the task before grading. A model could
deliberately game any visible rubric; this is a correctness smoke test, not
adversarial certification. Run protocol observation separately using the
[memory audit](../agent-memory-protocol.md). Keep raw exports private; publish
only appropriately reviewed aggregate evidence. One run is not an A/B study.
