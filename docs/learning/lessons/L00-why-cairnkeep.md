# L00 - Why Cairnkeep?

**Status:** Ready
**Track:** Quickstart
**Time:** 10 minutes
**Tested with:** Cairnkeep 2.2.1

## Outcome

You can explain what Cairnkeep remembers, what remains canonical in the
repository, and how it differs from chat history and document retrieval.

## Why this matters

Coding harnesses are effective inside one session but important decisions,
pitfalls, and conventions are easily lost between sessions or tools. Copying an
entire transcript into the next prompt is expensive and preserves noise along
with useful facts.

Cairnkeep stores small, reviewed operational facts and retrieves them when they
are relevant. It also provides a derived wiki and governed review workflows,
without replacing source code, tests, issue trackers, or canonical documents.

## Mental model

Keep four layers distinct:

| Layer | Example | Role |
|---|---|---|
| Harness history | The current conversation | Temporary working context |
| Cairnkeep memory | “Use transactional migrations” | Durable operational fact |
| Project wiki | A cited architecture summary | Derived, reviewable knowledge |
| Canonical source | Code, tests, ADR, issue | Authority when layers disagree |

Document RAG is an optional fifth layer for retrieving larger documents. It is
not required for Cairnkeep memory.

## Exercise

For each statement, choose the appropriate destination:

1. “The payment API retries only idempotent operations.”
2. “Here is the complete API specification.”
3. “The current debugging hypothesis is a race in the cache.”
4. “Never run the production migration from a developer laptop.”

Suggested answer:

- 1 can become memory after validation and should cite the canonical code or
  specification in derived knowledge.
- 2 stays a canonical document and may optionally be indexed for RAG.
- 3 remains session context until confirmed.
- 4 is a durable constraint after it is verified against policy.

## Verify

You are ready for L01 if you can answer these questions:

- Does Cairnkeep replace the repository or its documentation? **No.**
- Does the default installation discover a remote memory server? **No.**
- Should every sentence in a session become durable memory? **No.**

## Common failures

| Misconception | Correction |
|---|---|
| Memory is another transcript store | Store concise, durable facts rather than complete prompts |
| RAG and memory are the same | RAG retrieves documents; memory preserves reviewed operational facts |
| Derived knowledge is authoritative | Code, tests, policies, and canonical documents win conflicts |

## Privacy and trust boundary

The default stdio topology stores memory on the local machine. Remote storage,
model-backed extraction, embeddings, and document RAG require explicit
configuration and are taught separately.

## Recap

- Memory is selective and durable.
- Derived knowledge remains subordinate to canonical sources.
- Optional services are not prerequisites.

Next: [L01 - Try it safely](L01-safe-trial.md).

## Video

Use [the L00 presenter script](../video-scripts/L00-why-cairnkeep.md).
