# Ecosystem evaluation evidence — October 2026

This report records narrow, reproducible experiments. It is not a general
benchmark, endorsement, or claim that one project is globally better. Every
external integration remains optional and outside Cairnkeep's runtime trust
boundary.

## Reproduction boundary

| Subject | Pin used | License relevant to the run |
|---|---|---|
| MemFork | release `v0.3.0`; source commit `dfc0fd0907b94fa2bfd5a2c5c989e556085ba7d5` | Apache-2.0 |
| Context Language Models | source commit `18dc11115f50f261233c5bba7937834491e307e8` | CC BY-NC 4.0 research repository |
| pi-clm | npm `@lolipopshock/pi-clm@1.0.0` | MIT |
| Ollaya | runtime `0.12.0`; source commit `e352e0ff7086e85f7f115487f77310c13203a7a6` | Apache-2.0 runtime; model licenses remain separate |
| Ollaya model | `decima:agent`, 321M parameters, fp32 | Apache-2.0 model family |

No external source or model is vendored. The CLM research repository's
non-commercial license is a further reason not to copy its implementation into
Cairnkeep. The separately published Pi extension was used only in a disposable
evaluation home.

## MemFork: branchable agent state

The MCP evaluation used two separately identified clients against one
temporary store. All six observations passed:

- a candidate branch remained isolated from `main`;
- a conflicting merge with policy `fail` was rejected;
- discarding the failed branch retained a one-line lesson;
- a second client resumed the first client's handoff;
- branch diff and historical `at` reads returned the expected state;
- the reviewed candidate merged into `main`.

This is a meaningful capability Cairnkeep does not provide: cheap branching
and rewind of mutable agent scratch state. It does not replace Cairnkeep's
review, provenance, immutable artifacts, project identity, or durable-memory
authority rules. The recommended boundary is an optional future capability for
experimental agent state only.

```bash
MEMFORK_BIN=/path/to/memfork \
  node scripts/spikes/run-memfork-evaluation.mjs --version 0.3.0
```

## CLM plus Cairnkeep: one long-horizon Pi task

One six-turn release-ledger task ran twice with the same Sol/medium model,
project setup, Cairnkeep Pi bridge, disappearing source briefings, and hidden
15-check verifier. The candidate arm added pi-clm with an artificial 12,000
token budget and its bundled steering brief.

| Arm | Hidden verifier | Total model tokens | Reported cost |
|---|---:|---:|---:|
| Cairnkeep | 15/15 | 142,212 | $0.021117 |
| Cairnkeep + pi-clm | 15/15 | 51,530 | $0.0543623 |

CLM preserved quality and used about 63.8% fewer total tokens. It cost about
2.58 times as much on this single OpenRouter run because context editing and
cache-write behavior added provider-specific overhead. This is promising for
hard context limits, not evidence for default installation or lower cost.
The sample size is one task, the budget is artificial, and the comparison must
be repeated across providers and longer workloads before a product decision.

```bash
node scripts/spikes/run-clm-pi-evaluation.mjs \
  --cairn /absolute/path/to/bin/cairn \
  --pi /absolute/path/to/pi \
  --home /disposable/pi-home \
  --cairn-extension /disposable/pi-home/.pi/agent/extensions/cairnkeep-memory.ts \
  --clm-extension /disposable/pi-home/.pi/agent/npm/node_modules/@lolipopshock/pi-clm/index.ts \
  --clm-steering /disposable/pi-home/.pi/agent/npm/node_modules/@lolipopshock/pi-clm/steering/house-brief.md \
  --model openrouter/~openai/gpt-sol-latest
```

The runner makes paid/network model calls when the chosen provider requires
them. It never runs during package tests or CI.

## Ollaya: learned decisions versus explicit policy

The frozen dataset contains 32 balanced Cairnkeep cases: read-only
observations, mutations requiring approval, forbidden actions, and tasks where
memory is irrelevant. Labels are derived from four explicit boolean signals.

| Classifier | Correct | Accuracy |
|---|---:|---:|
| Deterministic policy | 32/32 | 100% |
| `decima:agent` | 19/32 | 59.4% |

The learned model averaged about 8.0 ms warm, but it missed four of eight
approval cases and four of eight denial cases. Some wrong answers were
confident, including treating deletion as no Cairnkeep action. That is
unacceptable for an authorization boundary.

```bash
OLLAYA_BIN=/path/to/ollaya \
  node scripts/spikes/run-ollaya-decision-evaluation.mjs \
  --runtime-version 0.12.0 --model decima:agent
```

The evidence supports a narrow use: a local decision model may rank fuzzy,
non-authoritative suggestions whose result is independently checked. MCP tool
exposure, mutation approval, secret handling, project isolation, memory
promotion, and release gates remain deterministic code.

## Product decision

1. Keep Cairnkeep focused on reviewed, local-first context and documentation.
2. Retain the optional read-only OpenViking provider already shipped.
3. Do not add MemFork, CLM, pi-clm, Ollaya, or model weights as dependencies.
4. Keep the three runners as opt-in evidence tools with disposable state.
5. Revisit a MemFork provider only if real multi-agent work needs speculative
   state branches; revisit CLM only after multi-provider cost and quality runs.
