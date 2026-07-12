---
description: Recall known info across memory layers (AgentFS project scope, wiki index, optional AnythingLLM)
argument-hint: "<question or topic>"
allowed-tools: Read, Grep, Glob, mcp__cairn-memory__memory_read, mcp__cairn-memory__memory_search, mcp__cairn-memory__domain_knowledge_query
---

<objective>
Cross-layer read companion to the automatic SessionStart wakeup. Use mid-session when the task shifts and you need stored context the wakeup did not surface.
</objective>

<context>
Question or topic: $ARGUMENTS

Read order (canonical sources still win over derived layers):
1. AgentFS project scope (short accepted facts)
2. Wiki index and derived pages (.planning/wiki/)
3. AnythingLLM workspaces (only if repo docs and memory are insufficient)
</context>

<process>
## 1. AgentFS
`memory_search` scope `project` with $ARGUMENTS. If nothing relevant, retry scope `all`.

## 2. Wiki
Read `.planning/wiki/index.md` if present and follow links relevant to $ARGUMENTS.

## 3. AnythingLLM (optional)
Only if 1 and 2 are insufficient and the answer likely lives in long-form docs: `domain_knowledge_query` against the project workspace from the memory config.

## 4. Report
Summarize what each layer returned in a few lines. If layers disagree, prefer the canonical raw source and note the staleness.
</process>
