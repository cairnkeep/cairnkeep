# L00 - Why Cairnkeep?

**Status:** Ready
**Track:** Quickstart
**Time:** 10 minutes
**Tested with:** Cairnkeep 2.16.0

## Outcome

You can explain what Cairnkeep remembers, what remains canonical in the
repository, and how it differs from chat history and document retrieval.

## Why this matters

Coding harnesses are effective inside one session but important decisions,
pitfalls, and conventions are easily lost between sessions or tools. Copying an
entire transcript into the next prompt is expensive and preserves noise along
with useful facts.

Cairnkeep stores small, reviewed operational facts and retrieves them when they
are relevant. It also provides a derived wiki and governed review workflows.
Optional local evidence features can retain redacted session structure,
artifacts, and deterministic hindsight notes, but they remain distinct from
reviewed memory and are disabled by default. None of these layers replaces
source code, tests, issue trackers, or canonical documents.

## Mental model

Follow information through a trust ladder:

| Layer | Example | Role |
|---|---|---|
| Harness history | The current conversation | Temporary working context |
| Captured evidence (optional) | A redacted tool result or compaction summary | Bounded local evidence, not trusted instruction |
| Hindsight note (optional) | A repeated failure signature and resolution | Deterministic derived knowledge, not automatically shared |
| Cairnkeep memory | “Use transactional migrations” | Durable operational fact |
| Project wiki | A cited architecture summary | Derived, reviewable knowledge |
| Canonical source | Code, tests, ADR, issue | Authority when layers disagree |

Document RAG and token-miser context exploration are optional retrieval paths,
not additional authorities. Neither is required for Cairnkeep memory.

## Exercise

For each statement, choose the appropriate destination:

1. “The payment API retries only idempotent operations.”
2. “Here is the complete API specification.”
3. “The current debugging hypothesis is a race in the cache.”
4. “Never run the production migration from a developer laptop.”
5. “This synthetic stack trace appeared and was resolved twice.”

Suggested answer:

- 1 can become memory after validation and should cite the canonical code or
  specification in derived knowledge.
- 2 stays a canonical document and may optionally be indexed for RAG.
- 3 remains session context until confirmed.
- 4 is a durable constraint after it is verified against policy.
- 5 may become local session evidence and a hindsight note. It becomes reviewed
  memory only through a separate explicit workflow.

## Verify

You are ready for L01 if you can answer these questions:

- Does Cairnkeep replace the repository or its documentation? **No.**
- Does the default installation discover a remote memory server? **No.**
- Should every sentence in a session become durable memory? **No.**
- Does enabling one optional evidence feature enable the others? **No.**

## Common failures

| Misconception | Correction |
|---|---|
| Memory is another transcript store | Store concise, durable facts rather than complete prompts |
| RAG and memory are the same | RAG retrieves documents; memory preserves reviewed operational facts |
| Captured evidence is trusted memory | Evidence and notes remain derived until explicitly reviewed or promoted |
| Derived knowledge is authoritative | Code, tests, policies, and canonical documents win conflicts |

## Privacy and trust boundary

The default stdio topology stores memory on the local machine. Remote storage,
structured capture, note distillation/enrichment, artifacts, evaluation,
model-backed extraction, embeddings, and document RAG require separate explicit
configuration and are taught later.

## Recap

- Memory is selective and durable.
- Optional evidence and notes are distinct from reviewed memory.
- Derived knowledge remains subordinate to canonical sources.
- Optional services are not prerequisites.

Reference: [Cairnkeep for coding agents](../../agents.md).

Next: [L01 - Try it safely](L01-safe-trial.md).
