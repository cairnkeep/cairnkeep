# L03 - Bootstrap the first project

**Status:** Ready
**Track:** Quickstart
**Time:** 25 minutes
**Tested with:** Cairnkeep 2.2.1

## Outcome

You can bootstrap a disposable project, verify its wiring, store one accepted
fact, and recall it from a new harness session.

## Prerequisites

- Completed [L02](L02-installation.md).
- Git and a supported harness.
- A disposable directory that contains no real project or confidential data.

## Exercise

1. Create a disposable repository:

   ```bash
   mkdir -p "$HOME/cairnkeep-course/first-project"
   cd "$HOME/cairnkeep-course/first-project"
   git init
   printf '# Cairnkeep course project\n' > README.md
   ```

2. Bootstrap the project:

   ```bash
   cairn bootstrap "$PWD"
   cp .ai/env.example .ai/.env
   ```

3. Keep optional endpoint and model values unset for this local exercise. Run
   diagnostics:

   ```bash
   cairn doctor
   ```

4. Launch Claude Code through the generated project launcher:

   ```bash
   ./.ai/start-claude.sh
   ```

5. In the harness, store a deliberately synthetic convention:

   ```text
   /remember Course convention: examples use UTC timestamps.
   ```

6. Retrieve it:

   ```text
   /recall UTC timestamps
   ```

7. Exit the harness, start it again with the same launcher, and repeat the
   recall. This second session is the persistence proof.

## Verify

The lesson is complete only if:

- `cairn doctor` reports no configured dependency failures;
- `/remember` confirms a durable key;
- `/recall` finds the fact after the first session has exited;
- `cairn memory path` points to local storage on this machine.

## Common failures

| Symptom | Cause | Recovery |
|---|---|---|
| Launcher is missing | A different directory was bootstrapped | Run `pwd`, then bootstrap that exact path |
| `.ai/.env` is missing | Only the example is generated | Copy `.ai/env.example` to `.ai/.env` |
| `cairn-memory` is unavailable | L02 MCP registration is absent or stale | Run `claude mcp get cairn-memory`, repair it, then restart Claude Code |
| Slash commands are unknown | Operating assets were not loaded | Run `cairn sync --check`, apply if needed, then restart the harness |
| Recall works only in the first session | Sessions used different storage routing | Compare launchers and environment, then inspect `cairn memory path` |

## Privacy and trust boundary

Use synthetic memory in the course. The local stdio server writes to local
AgentFS/SQLite storage. Project wiki and planning files are derived artifacts;
the repository remains canonical.

## Clean up

Exit the harness before removing the disposable project:

```bash
rm -rf "$HOME/cairnkeep-course/first-project"
```

This removes project scaffolding but not the global memory store. Remove the
synthetic memory through the normal memory review/delete workflow if required.

## Optional challenge

Repeat bootstrap with `--untracked` in another disposable Git repository, then
inspect `.git/info/exclude` to see how contributor mode avoids shared changes.

## Recap

- Bootstrap is project-specific and follows machine setup.
- The generated launcher establishes a repeatable project environment.
- Persistence is proven only after a new session recalls the accepted fact.

Next: [L04 - Memory fundamentals](L04-memory-fundamentals.md).

## Video

Use [the L03 presenter script](../video-scripts/L03-first-project.md).
