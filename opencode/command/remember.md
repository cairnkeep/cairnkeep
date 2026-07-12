---
description: Persist a durable finding to AgentFS, flagging wiki/AnythingLLM candidates
argument-hint: "<the fact to remember>"
tools:
  read: true
  grep: true
  glob: true
  cairn-memory_memory_read: true
  cairn-memory_memory_search: true
  cairn-memory_memory_write: true
  cairn-memory_memory_supersede: true
---

<objective>
Persist one durable, accepted finding so future sessions recall it without being asked.

This is the write half of the memory loop. It writes the fact to AgentFS (the shared, cross-harness durable store), and it only flags the document layers (wiki, AnythingLLM) as candidates rather than writing to them blindly, because those are compiled or embedded from canonical sources.
</objective>

<context>
Fact to remember: $ARGUMENTS

Layer shapes (do not treat as copies of the same thing):
- AgentFS project scope: short key/value facts, accepted and branch-safe. Direct write. The sole durable structured store for OpenCode.
- Wiki (`.planning/wiki/`): derived synthesis, compiled via /wiki-ingest. Not a raw-fact store.
- AnythingLLM: document embeddings, refreshed via domain_knowledge_sync. Not a raw-fact store.
</context>

<process>
## 1. Guard
If $ARGUMENTS is empty, ask what to remember and stop. Do not invent a fact.

## 2. Dedupe before writing
Run `cairn-memory_memory_search` (scope `project`) on the key terms of the fact. If a near-duplicate key exists, update that entry instead of creating a new one.

## 3. Write AgentFS (project scope)
If step 2 found a near-duplicate key that should keep its prior value for audit/debugging, use `cairn-memory_memory_supersede` on that key. Otherwise use `cairn-memory_memory_write` scope `project` with a short kebab-case key and the fact as value. Convert relative dates to absolute. No em dashes or double-hyphen dashes (use commas or full stops).

## 4. Flag document layers (do not auto-run)
- If the fact is stable, doc-worthy synthesis of a canonical source, suggest `/wiki-ingest <path>`.
- If a repo document changed and retrieval should reflect it, suggest `domain_knowledge_sync`.
State the suggestion in one line each; do not execute them here.

## 5. Confirm
Print: the AgentFS key written, and any flagged candidates.
</process>
