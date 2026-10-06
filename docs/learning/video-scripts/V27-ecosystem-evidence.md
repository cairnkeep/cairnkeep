# V27 - Context companions: measured, not absorbed

Target length: 10–12 minutes. Audience: experienced developers evaluating
agent-memory and context-management tooling.

## Recording outline

### 0:00–1:15 — Draw the layers

Animate five labelled cards: maintained source, reviewed durable memory,
current model context, speculative agent state, deterministic policy. Keep the
cards visible as a small sidebar for the rest of the video.

Narration:

> Similar-looking tools often solve different time scales. The useful question
> is not which project wins, but which layer it improves without inheriting
> authority it should not have.

### 1:15–3:30 — MemFork in a disposable store

Type the real command at human speed and pause on the six booleans:

```sh
MEMFORK_BIN=/path/to/memfork \
  node scripts/spikes/run-memfork-evaluation.mjs --version 0.3.0
```

Show branch isolation, conflict rejection, discard lesson, second-client
handoff, time travel, and reviewed merge. Move the MemFork card beside
"speculative agent state", not "durable authority".

### 3:30–6:30 — CLM changes the request, not the truth

Use a split terminal with the same six-turn release-ledger task. Accelerate
dead wait time with cuts, but show real commands, the disappearing briefing
files, and the private context revision count. End on the table:

- both arms: 15/15;
- total tokens: 142,212 versus 51,530;
- reported cost: $0.021117 versus $0.0543623.

Pause after "fewer tokens, higher cost." Explain the artificial 12k budget,
single task, provider cache pricing, and why this is evidence for another
experiment rather than default installation.

### 6:30–8:45 — A fast classifier is not a guardrail

Run:

```sh
OLLAYA_BIN=/path/to/ollaya \
  node scripts/spikes/run-ollaya-decision-evaluation.mjs \
  --runtime-version 0.12.0 --model decima:agent
```

Highlight 32/32 for explicit policy and 19/32 for the learned model. Zoom into
one missed deletion and one missed denial. Move Ollaya beside "advisory
ranking" and keep deterministic policy attached to the approval gate.

### 8:45–10:15 — The product decision

Return to all five cards:

1. Keep Cairnkeep's reviewed-memory and source-verification contract.
2. Keep OpenViking read-only and optional.
3. Consider MemFork only for disposable speculative state.
4. Re-test CLM across providers before integration.
5. Never replace permission code with a learned decision.

Close on `scripts/test-ecosystem-spikes.sh`, which validates the public fixture
and evidence offline without launching any companion.

## Recording cautions

- Show synthetic projects and no real provider key, endpoint, memory, or path.
- State every version and pin on screen.
- Do not call a one-task result a benchmark win.
- Do not imply that the scripts install or enable companions automatically.
- Let the tables breathe; use pauses rather than faster narration.
