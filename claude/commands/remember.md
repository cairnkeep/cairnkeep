---
description: Persist a durable finding across memory layers (AgentFS + file memory), flagging wiki/AnythingLLM candidates
argument-hint: "<the fact to remember>"
allowed-tools: Read, Write, Edit, Grep, Glob, mcp__cairn-memory__memory_read, mcp__cairn-memory__memory_search, mcp__cairn-memory__memory_write, mcp__cairn-memory__memory_supersede
---

<objective>
Persist one durable, accepted finding so future sessions recall it without being asked.

This is the write half of the memory loop. It writes the fact to the layers that hold short structured facts (AgentFS project scope + the Claude file-memory), and it only flags the document layers (wiki, AnythingLLM) as candidates rather than writing to them blindly, because those are compiled or embedded from canonical sources.
</objective>

<context>
Fact to remember: $ARGUMENTS

Layer shapes (do not treat as four copies of the same thing):
- AgentFS project scope: short key/value facts, accepted and branch-safe. Direct write.
- File-memory (`~/.claude/projects/<encoded-cwd>/memory/`): markdown, auto-loaded each session. Direct write.
- Wiki (`.planning/wiki/`): derived synthesis, compiled via /wiki-ingest. Not a raw-fact store.
- AnythingLLM: document embeddings, refreshed via domain_knowledge_sync. Not a raw-fact store.
</context>

<process>
## 1. Guard
If $ARGUMENTS is empty, ask what to remember and stop. Do not invent a fact.

## 2. Dedupe before writing
Run `memory_search` (scope `project`) on the key terms of the fact. If a near-duplicate key exists, update that entry instead of creating a new one.

## 3. Write AgentFS (project scope)
If step 2 found a near-duplicate key that should keep its prior value for audit/debugging, use `memory_supersede` on that key. Otherwise use `memory_write` scope `project` with a short kebab-case key and the fact as value. Convert relative dates to absolute. No em dashes or double-hyphen dashes (use commas or full stops).

## 4. Write file-memory
Append or update a one-file-one-fact note under the project memory directory and add a one-line pointer to its `MEMORY.md` index. Skip if the fact is already covered there.

## 5. Flag document layers (do not auto-run)
- If the fact is stable, doc-worthy synthesis of a canonical source, suggest `/wiki-ingest <path>`.
- If a repo document changed and retrieval should reflect it, suggest `domain_knowledge_sync`.
State the suggestion in one line each; do not execute them here.

## 6. Confirm
Print: the AgentFS key written, the file-memory file touched, and any flagged candidates.
</process>
