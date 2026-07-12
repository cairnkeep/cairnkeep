---
description: "Build, rebuild, query, and inspect the project knowledge graph in .planning/graphs/"
argument-hint: "[build [--force]|query <term>|status|diff]"
tools:
  read: true
  bash: true
  task: true
---

**STOP -- DO NOT READ THIS FILE. You are already reading it. This prompt was injected into your context by Claude Code's command system. Using the Read tool on this file wastes tokens. Begin executing Step 0 immediately.**

**graphify CLI:** the `graphify` subcommand is exposed by `gsd-tools` (on PATH). Invoke as `gsd-tools graphify …` as documented in this command and in `docs/CLI-TOOLS.md`. Other GSD queries use `gsd-tools <subcmd>` where a handler exists.

## Step 0 -- Banner

**Before ANY tool calls**, display this banner:

```
GRAPHIFY
```

Then proceed to Step 1.

## Step 1 -- Config Gate

Check if graphify is enabled by reading `.planning/config.json` directly using the Read tool.

**DO NOT use the gsd-tools config get-value command** -- it hard-exits on missing keys.

1. Read `.planning/config.json` using the Read tool
2. If the file does not exist: display the disabled message below and **STOP**
3. Parse the JSON content. Check if `config.graphify && config.graphify.enabled === true`
4. If `graphify.enabled` is NOT explicitly `true`: display the disabled message below and **STOP**
5. If `graphify.enabled` is `true`: proceed to Step 2

**Disabled message:**

```
GRAPHIFY

Knowledge graph is disabled. To activate:

  gsd-tools config-set graphify.enabled true

Then run /graphify build to create the initial graph.
```

---

## Step 2 -- Parse Argument

Parse `$ARGUMENTS` to determine the operation mode:

| Argument | Action |
|----------|--------|
| `build` or `build --force` | Run inline build (Step 3) |
| `query <term>` | Run inline query (Step 2a) |
| `status` | Run inline status check (Step 2b) |
| `diff` | Run inline diff check (Step 2c) |
| No argument or unknown | Show usage message |

**Usage message** (shown when no argument or unrecognized argument):

```
GRAPHIFY

Usage: /graphify <mode>

Modes:
  build [--force] Build or rebuild the knowledge graph
  query <term>    Search the graph for a term
  status          Show graph freshness and statistics
  diff            Show changes since last build
```

### Step 2a -- Query

Run:

```bash
gsd-tools graphify query <term>
```

Parse the JSON output and display results:
- If the output contains `"disabled": true`, display the disabled message from Step 1 and **STOP**
- If the output contains `"error"` field, display the error message and **STOP**
- If no nodes found, display: `No graph matches for '<term>'. Try /graphify build to create or rebuild the graph.`
- Otherwise, display matched nodes grouped by type, with edge relationships and confidence tiers (EXTRACTED/INFERRED/AMBIGUOUS)

**STOP** after displaying results. Do not spawn an agent.

### Step 2b -- Status

Run:

```bash
gsd-tools graphify status
```

Parse the JSON output and display:
- If `exists: false`, display the message field
- Otherwise show last build time, node/edge/hyperedge counts, and STALE or FRESH indicator

**STOP** after displaying status. Do not spawn an agent.

### Step 2c -- Diff

Run:

```bash
gsd-tools graphify diff
```

Parse the JSON output and display:
- If `no_baseline: true`, display the message field
- Otherwise show node and edge change counts (added/removed/changed)

If no snapshot exists, suggest running `build` twice (first to create, second to generate a diff baseline).

**STOP** after displaying diff. Do not spawn an agent.

---

## Step 3 -- Build (Inline)

Run:

```bash
gsd-tools graphify build [--force]
```

Parse the JSON output and display:
- If the output contains `"disabled": true`, display the disabled message from Step 1 and **STOP**
- If the output contains an `"error"` field, display the error and the `stage` field when present, then **STOP**
- Otherwise display the build summary using `status.last_build`, `status.node_count`, `status.edge_count`, `status.hyperedge_count`, whether the snapshot was saved, and whether a forced clean rebuild was used

This command now performs the full pipeline directly:
- runs `graphify update .` with legacy fallback to `graphify . --update`
- when `--force` is present, clears `graphify-out/`, published graph artifacts, and `.planning/graphs/.last-build-snapshot.json` first
- validates `graphify-out/graph.json`
- copies `graph.json`, `graph.html`, and `GRAPH_REPORT.md` into `.planning/graphs/`
- writes `.planning/graphs/.last-build-snapshot.json`

**STOP** after displaying the build result. Do not spawn an agent.

---

## Anti-Patterns

1. DO NOT spawn an agent for graphify operations -- build/query/status/diff are handled directly
2. DO NOT modify graph files directly outside the graphify CLI path
3. DO NOT skip the config gate check
4. DO NOT use gsd-tools config get-value for the config gate -- it exits on missing keys
