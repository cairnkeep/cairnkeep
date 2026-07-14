# AnythingLLM sync — reference example

The bundled reference implementation of the document-sync script that
Cairnkeep's `domain_knowledge_sync` tool shells out to. It is a usable,
deployment-neutral starting point; copy and adapt it when endpoint,
authentication, or include/exclude rules are deployment-specific.

See [`../../docs/domain-knowledge.md`](../../docs/domain-knowledge.md) for the
full RAG picture.

## What it does

Incrementally syncs each configured project's docs into its own AnythingLLM
workspace: creates the workspace, uploads changed files (tracked by sha256),
embeds them, and removes docs that disappeared. Supports `--dry-run`, `--full`,
`--replace`, `--rebuild-state`, `--list`, and `--project <slug>`.

## Setup

1. Requires Python 3 and `requests` (`pip install requests`).
2. Copy the config to the default user config location and fill in your
   projects:
   ```bash
   mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/cairnkeep"
   cp anythingllm-projects.example.json \
     "${XDG_CONFIG_HOME:-$HOME/.config}/cairnkeep/anythingllm-projects.json"
   # edit: set each project's absolute path, slug, and include/exclude globs
   ```
3. Point at your AnythingLLM instance:
   ```bash
   export ANYTHINGLLM_BASE_URL=http://localhost:3001   # default
   export ANYTHINGLLM_API_KEY=<your AnythingLLM API key>
   ```
4. First upload, then keep it in sync:
   ```bash
   python3 sync_to_anythingllm.py --full --project my-project
   python3 sync_to_anythingllm.py                       # incremental, all projects
   ```

## Wiring into cairnkeep

The installed server uses this script by default. To use an adapted copy, set:

```bash
CAIRN_ANYTHINGLLM_SYNC_SCRIPT=/abs/path/to/sync_to_anythingllm.py
```

Override the user-owned configuration or state locations when needed:

```bash
CAIRN_ANYTHINGLLM_PROJECTS_FILE=/abs/path/to/anythingllm-projects.json
CAIRN_ANYTHINGLLM_STATE_FILE=/abs/path/to/anythingllm-sync.json
```

For backward compatibility, an existing `anythingllm-projects.json` beside a
customized script and its `.anythingllm-sync.json` state are still used when the
override variables are unset.

## Files

| File | Committed? | Notes |
|---|---|---|
| `sync_to_anythingllm.py` | yes | the script |
| `anythingllm-projects.example.json` | yes | schema template |
| `anythingllm-projects.json` | **no** | User-owned config; defaults under the XDG config directory |
| `anythingllm-sync.json` | **no** | Machine-local SHA-256 state; defaults under the XDG state directory |
