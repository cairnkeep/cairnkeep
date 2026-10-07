# L27 - Evaluate context companions without moving authority

**Tested with:** Cairnkeep 2.22.0 and Node.js 22 or newer

## Outcome

You will distinguish durable reviewed memory, current-request context,
speculative agent state, external retrieval, and learned decisions. You will
also inspect reproducible evidence without turning an interesting companion
project into a Cairnkeep dependency or security authority.

## Prerequisites

- Complete [L16 - Evaluation and ablation](L16-evaluation.md) and
  [L26 - Context intelligence](L26-context-intelligence.md).
- Use a disposable Cairnkeep source checkout.
- External binaries, models, and paid providers are optional. The offline
  contract check requires none of them.

## 1. Start with the five layers

Use a different question for each layer:

| Layer | Question | Cairnkeep boundary |
|---|---|---|
| Maintained source | What is true now? | Repository and reviewed docs are authoritative |
| Durable memory | What prior decision may matter? | Search locates; verify against source |
| Current context | What must this model request retain? | A harness or CLM may project it temporarily |
| Speculative state | What should this experimental agent branch see? | A branchable store may isolate and rewind it |
| Policy decision | May this action execute? | Deterministic capability and approval code decides |

This separation prevents a context optimizer, memory database, or classifier
from silently becoming an authorization system.

## 2. Verify the frozen local contract

Run the network-free repository check:

```sh
scripts/test-ecosystem-spikes.sh
```

It syntax-checks every runner, validates 32 unique balanced decision cases,
recomputes their deterministic labels, and checks that the published evidence
matches the frozen results. It does not launch MemFork, Pi, Ollaya, a model, or
the network.

## 3. Read the evidence before the conclusion

Open [the October 2026 evidence report](../../research/ecosystem-evidence-2026-10.md)
and answer:

1. Which MemFork behavior is genuinely absent from Cairnkeep?
2. Did CLM improve the hidden verifier score, token use, cost, or some subset?
3. Which destructive or forbidden cases did the learned decision model miss?
4. Which result is a single-task observation rather than a product claim?

The correct interpretation is deliberately mixed. MemFork demonstrated useful
branching. CLM preserved quality with fewer total tokens but higher provider
cost in one run. The learned classifier was fast but unsafe as a guardrail.

## 4. Reproduce only the experiment you need

Each runner requires an explicit external binary or disposable Pi home:

```sh
MEMFORK_BIN=/path/to/memfork \
  node scripts/spikes/run-memfork-evaluation.mjs --version 0.3.0

OLLAYA_BIN=/path/to/ollaya \
  node scripts/spikes/run-ollaya-decision-evaluation.mjs \
  --runtime-version 0.12.0 --model decima:agent
```

The longer Pi command is documented in the evidence report. It makes model
calls and may incur provider cost. Use an isolated home and never install the
CLM extension into a daily harness merely to run the comparison.

## Acceptance

- `scripts/test-ecosystem-spikes.sh` passes without network access.
- You can place each project in the correct layer without calling it a
  Cairnkeep replacement.
- You do not infer a default integration from one benchmark.
- Learned output remains advisory and independently verified; deterministic
  code retains permission, project-isolation, promotion, and release gates.

## Recovery

The runners delete temporary state by default. If you used `--keep-data` or
`--keep-workspaces`, inspect the printed exact temporary path, retain only
sanitized evidence you need, then remove that specific directory. Stop any
separately launched local model service through its own supported command.
