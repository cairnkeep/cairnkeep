---
description: "Build, rebuild, query, and inspect the project knowledge graph in .planning/graphs/"
argument-hint: "[build [--force]|query <term>|explain <symbol>|path <from> <to>|status|diff]"
tools:
  read: true
  bash: true
  task: true
---

**STOP -- DO NOT READ THIS FILE. You are already reading it. This prompt was injected into your context by OpenCode's command system. Using the Read tool on this file wastes tokens. Begin executing Step 1 immediately.**

**graph workflow:** Cairnkeep owns this surface through `cairn graph`. The
operator installs only the isolated `graphify` executable; do not invoke
Graphify's harness installer.

## Output heading

Begin the final user-facing response with `GRAPHIFY`. Do not emit a standalone
banner before owner I/O: in headless OpenCode, content-only output can end the
turn before the command reaches its tools.

## Step 1 -- Capability ownership

Do not implement a separate configuration gate in the prompt. Every
`cairn graph` operation enforces the typed `graph` capability and its legacy
`graphify.enabled` compatibility default before Graphify or graph-file I/O.
Proceed directly to Step 2; if the owner reports a disabled capability, display
its fixed remediation message and **STOP**.

---

## Step 2 -- Parse Argument

The exact invocation argument is delimited here:

```text
<argument>$ARGUMENTS</argument>
```

Parse only the text between those markers to determine the operation mode. If
the markers contain `status`, that is the status mode; do not treat it as an
empty or unknown argument. Apply the same exact matching rule to every row:

| Argument | Action |
|----------|--------|
| `build` or `build --force` | Run inline build (Step 3) |
| `query <term>` | Run inline query (Step 2a) |
| `explain <symbol>` | Explain one exact symbol (Step 2d) |
| `path <from> <to>` | Find the shortest path between two exact symbols (Step 2e) |
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
  explain <symbol> Explain one exact symbol and its relationships
  path <from> <to> Find the shortest path between two exact symbols
  status          Show graph freshness and statistics
  diff            Show changes since last build
```

### Step 2a -- Query

**Invoke the shell tool** with this exact command; do not print the command as
the result and do not continue until the tool returns:

```bash
cairn graph query <term>
```

Pass the parsed term as exactly one argument and display the result verbatim.
On failure, display the error without retrying or changing configuration.

**STOP** after displaying results. Do not spawn an agent.

### Step 2d -- Explain

**Invoke the shell tool** with `cairn graph explain <symbol>`, passing the
parsed symbol as exactly one argument. Display Graphify's explanation verbatim.
On failure, display the error and suggest `/graphify build` only when the
published graph is missing.

**STOP** after displaying the result. Do not spawn an agent.

### Step 2e -- Path

**Invoke the shell tool** with `cairn graph path <from> <to>`, passing each
parsed symbol as exactly one argument. Display Graphify's path result verbatim.
On failure, display the error and suggest `/graphify build` only when the
published graph is missing.

**STOP** after displaying the result. Do not spawn an agent.

### Step 2b -- Status

**Invoke the shell tool** with this exact command; do not print the command as
the result and do not continue until the tool returns:

```bash
cairn graph status
```

Display the local node/edge counts and freshness result verbatim.

**STOP** after displaying status. Do not spawn an agent.

### Step 2c -- Diff

**Invoke the shell tool** with this exact command; do not print the command as
the result and do not continue until the tool returns:

```bash
cairn graph diff
```

Display the node and edge change counts verbatim. If no snapshot exists,
suggest rebuilding after the next code change.

**STOP** after displaying diff. Do not spawn an agent.

---

## Step 3 -- Build (Inline)

**Invoke the shell tool** with this exact command; do not print the command as
the result and do not continue until the tool returns:

```bash
cairn graph build [--force]
```

Display the build summary verbatim. This managed path runs Graphify's local
code-only `update`, strips provider credentials from its subprocess
environment, validates the resulting graph, atomically publishes available
artifacts into `.planning/graphs/`, and snapshots the previous graph for diff.
`--force` permits a rebuilt graph with fewer nodes after code deletion.

**STOP** after displaying the build result. Do not spawn an agent.

---

## Anti-Patterns

1. DO NOT spawn an agent for graphify operations -- build/query/explain/path/status/diff are handled directly
2. DO NOT modify graph files directly outside the graphify CLI path
3. DO NOT duplicate capability parsing in the prompt -- `cairn graph` owns it
