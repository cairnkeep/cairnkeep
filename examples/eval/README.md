# Offline evaluation fixture

This directory contains Cairnkeep's deterministic, network-free evaluation
population. It validates the evaluation framework; its designed differences are
not performance, efficiency, quality, or live-product evidence.

`task-set.json` is the immutable `cairn-offline-fake-v1` source. The loader
requires its exact canonical bytes, the package version, and the SHA-256 digest
recorded by `bundled-fake.json` before it creates a workspace. `adapter.json`
selects the only executable adapter shipped by Cairnkeep,
`scripts/fake-eval-adapter.mjs`. Live harness adapters remain explicit
operator-owned program-plus-argument configurations.

The coordinator sends one bounded JSON request on standard input. The fake
emits exactly one schema-valid JSON result on standard output for ordinary
cases and uses standard error only for value-free diagnostics. Requests include
the task, arm, repetition, pass, seed, relative workspace/notes/output paths,
limits, and expected capability digest. Results can include terminal adapter
status, turn semantics, optional usage, component identities, the observed
capability digest, and a task-local trajectory reference. The independent task
verifier, never the adapter, assigns pass or fail.

The population has ten stable tasks covering verified pass, verifier failure,
missing tokens, successful note creation, no notes, distillation failure,
skipped distillation, timeout, structured adapter error, invalid result, and a
cancellation control. With one repetition the two-pass run estimates and then
performs exactly 20 serial adapter invocations. Run 2 starts only after all ten
Run 1 observations and offline distillation stages finish.

Validate without invoking the adapter:

```bash
CAIRN_EVAL=1 node mcp-memory-server/dist/eval-cli.js validate \
  --task-set examples/eval/task-set.json \
  --adapter examples/eval/adapter.json \
  --output .agentfs/eval/experiments --json
```

Run only in a disposable checkout when exercising the fixture directly. The
result is always scoped as `offline-framework`; it cannot authorize a README or
release claim. No provider, endpoint, credential, model service, or network
default is included.
