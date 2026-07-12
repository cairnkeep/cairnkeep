# AnythingLLM sync — reference example

A reference implementation of the document-sync script that cairnkeep's
`domain_knowledge_sync` tool shells out to. cairnkeep ships **no** sync script
in core (endpoints and include/exclude rules are deployment-specific); this is
an optional starting point you copy and adapt.

See [`../../docs/domain-knowledge.md`](../../docs/domain-knowledge.md) for the
full RAG picture.

## What it does

Incrementally syncs each configured project's docs into its own AnythingLLM
workspace: creates the workspace, uploads changed files (tracked by sha256),
embeds them, and removes docs that disappeared. Supports `--dry-run`, `--full`,
`--replace`, `--rebuild-state`, `--list`, and `--project <slug>`.

## Setup

1. Requires Python 3 and `requests` (`pip install requests`).
2. Copy the config and fill in your projects:
   ```bash
   cp anythingllm-projects.example.json anythingllm-projects.json
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

Point the memory server's sync tool at your copy:

```bash
CAIRN_ANYTHINGLLM_SYNC_SCRIPT=/abs/path/to/sync_to_anythingllm.py
```

## Files

| File | Committed? | Notes |
|---|---|---|
| `sync_to_anythingllm.py` | yes | the script |
| `anythingllm-projects.example.json` | yes | schema template |
| `anythingllm-projects.json` | **no** | your real config (paths) — gitignored |
| `.anythingllm-sync.json` | **no** | machine-local sha256 state — gitignored |
