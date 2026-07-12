# Domain knowledge (RAG) — optional

Cairnkeep's memory server exposes two **optional** document-RAG tools alongside
the `memory_*` tools:

- **`domain_knowledge_query`** — ask a question against a document workspace and
  get a grounded answer with citations.
- **`domain_knowledge_sync`** — (re)embed a project's documentation into a
  workspace.

These are a thin bridge to a running **[AnythingLLM](https://anythingllm.com/)**
instance (a generic, self-hostable document-RAG product). They are **off unless
you configure them** — cairnkeep hosts no RAG engine, ships no documents, and
hardcodes no endpoint. If you never set `ANYTHINGLLM_API_KEY`, the tools simply
error at call time and nothing else is affected; `memory_*` and the wiki layer
work exactly the same without them.

## What you need

1. A running AnythingLLM instance with at least one **workspace** that has your
   documents embedded. (Local via podman/docker, or any reachable instance.)
2. An AnythingLLM **API key**.
3. cairnkeep pointed at it (below).

## Configuration

| Variable | Purpose |
|---|---|
| `ANYTHINGLLM_API_KEY` | **Required** for the domain-knowledge tools. Unset → the tools error at call time (everything else works). |
| `ANYTHINGLLM_BASE_URL` | AnythingLLM base URL. Default `http://localhost:3001`. |
| `CAIRN_ANYTHINGLLM_SYNC_SCRIPT` | Path to the document-sync script used by `domain_knowledge_sync`. The core does not bundle one — point this at your own (see below). Unset → `domain_knowledge_sync` uses the in-repo default path. |

The workspaces the tools target come from the project's **memory config** — the
first of `.agent/memory.json`, `.opencode/memory.json`, `.claude/memory.json`, or
`memory.json` that exists:

```json
{
  "scopes": ["identity"],
  "anythingllm_workspaces": ["engineering-patterns", "my-project-docs"]
}
```

`domain_knowledge_query` takes an explicit `workspace`, or falls back to the first
configured workspace that is not `engineering-patterns` (the conventional shared
workspace). With no workspace given and none configured, it errors.

## Setup (query)

```bash
# 1. Start AnythingLLM (example: local podman on :3001) and create/populate a
#    workspace with your docs (via the AnythingLLM UI or its API).
# 2. Point cairnkeep at it, in the project's .ai/.env:
ANYTHINGLLM_BASE_URL=http://localhost:3001
ANYTHINGLLM_API_KEY=<your AnythingLLM API key>
# 3. List the workspace(s) in the project's memory config (see JSON above).
```

Then `domain_knowledge_query { "workspace": "my-project-docs", "query": "..." }`
returns a grounded answer.

## Setup (sync / embedding)

`domain_knowledge_sync` shells out to a document-upload/embed script. Because the
scripts that talk to your AnythingLLM (and any include/exclude rules) are
deployment-specific, they live in **your** wrapper, not the core — point cairnkeep
at yours:

```bash
CAIRN_ANYTHINGLLM_SYNC_SCRIPT=/abs/path/to/your/sync_to_anythingllm.py
```

The script receives the workspace slug and is expected to upload + embed the
project's documents into that AnythingLLM workspace. See
[building-an-overlay.md](building-an-overlay.md) for the wrapper pattern.

A working, deployment-agnostic starting point lives in
[`examples/anythingllm/`](../examples/anythingllm/): an incremental
(sha256-tracked) multi-project sync script plus a config schema. Copy it, adapt
`anythingllm-projects.json`, and point `CAIRN_ANYTHINGLLM_SYNC_SCRIPT` at your
copy.

## Not using RAG?

Do nothing. The tools stay inert, cost nothing, and the rest of cairnkeep is
fully functional without an AnythingLLM instance.
