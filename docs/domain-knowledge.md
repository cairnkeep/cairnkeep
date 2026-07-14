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
| `CAIRN_ANYTHINGLLM_SYNC_SCRIPT` | Optional path to a custom document-sync script. Unset -> `domain_knowledge_sync` uses the bundled deployment-neutral example. |
| `CAIRN_ANYTHINGLLM_PROJECTS_FILE` | Optional config path for the bundled sync script. Default `${XDG_CONFIG_HOME:-~/.config}/cairnkeep/anythingllm-projects.json`. |
| `CAIRN_ANYTHINGLLM_STATE_FILE` | Optional state path for the bundled sync script. Default `${XDG_STATE_HOME:-~/.local/state}/cairnkeep/anythingllm-sync.json`. |

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

In local stdio mode, that config is read from the client project's working
directory. In remote HTTP mode, the server cannot read files from the client
PC. Configure `ANYTHINGLLM_BASE_URL`, `ANYTHINGLLM_API_KEY`, and any sync script
on the HTTP server host, then send the project workspaces in the
`X-Cairn-AnythingLLM-Workspaces` session header. See
[Memory storage and deployment](storage.md#per-project-remote-sessions).

The HTTP server performs queries and runs the sync script on its own host. A
remote sync script must therefore obtain project documents from a server-side
checkout, object store, or git host; it cannot read an arbitrary client PC's
working tree.

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

`domain_knowledge_sync` shells out to a document-upload/embed script. Cairnkeep
ships a deployment-neutral example that reads its project mapping from a config
file. For deployment-specific authentication, checkout rules, or document
selection, keep a customized script in your overlay and point Cairnkeep at it:

```bash
CAIRN_ANYTHINGLLM_SYNC_SCRIPT=/abs/path/to/your/sync_to_anythingllm.py
```

The script receives the workspace slug and is expected to upload + embed the
project's documents into that AnythingLLM workspace. See
[building-an-overlay.md](building-an-overlay.md) for the wrapper pattern.

The bundled default lives in
[`examples/anythingllm/`](../examples/anythingllm/): an incremental,
SHA-256-tracked multi-project sync script plus a config schema. Put a customized
copy of the example JSON at the default user config path, or set
`CAIRN_ANYTHINGLLM_PROJECTS_FILE`. Existing custom scripts with configuration
and state beside the script retain that legacy behavior. To customize the
implementation itself, set `CAIRN_ANYTHINGLLM_SYNC_SCRIPT` to the adapted copy.

## Not using RAG?

Do nothing. The tools stay inert, cost nothing, and the rest of cairnkeep is
fully functional without an AnythingLLM instance.
