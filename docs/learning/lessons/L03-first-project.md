# L03 - Set up the first project

**Status:** Ready
**Track:** Quickstart
**Time:** 25 minutes
**Tested with:** Cairnkeep 2.16.0

## Outcome

You can use the guided setup contract on an empty directory, choose Claude Code
or Codex CLI, verify its Git and harness wiring, store one accepted fact, and
recall it from a new session.

## Prerequisites

- Completed [L02](L02-installation.md).
- Git and a supported harness.
- A disposable directory that contains no real project or confidential data.

## Exercise

1. Create an empty disposable project directory:

   ```bash
   mkdir -p "$HOME/cairnkeep-course/first-project"
   cd "$HOME/cairnkeep-course/first-project"
   ```

2. Run the interactive setup and choose a harness. Use Up/Down and Enter for
   Git and memory choices; use Space to tick Claude Code or Codex CLI in the
   harness checklist. Review the plan before selecting **Yes, apply the plan**:

   ```bash
   cairn setup "$PWD"
   cp .ai/env.example .ai/.env
   ```

   For a reproducible non-interactive exercise, the equivalent Claude Code
   command is `cairn setup "$PWD" --git init --harness claude --memory local
   --yes`; replace `claude` with `codex` for the self-contained Codex route.

   Setup must create the Git repository, generate only the selected harness
   assets, and write the private `.ai/cairnkeep.json` setup record. Codex also
   receives `.codex/config.toml`; review it and accept Codex's project-trust
   prompt before launching.

3. Keep optional endpoint and model values unset for this local exercise. Run
   diagnostics:

   ```bash
   cairn doctor
   ```

   Also leave trajectory, note, compaction, artifact, typed-memory, capability,
   and evaluation flags unset. The quickstart proves core memory without
   silently changing the amount of retained data.

4. Launch the selected harness through its generated project launcher:

   ```bash
   ./.ai/start-claude.sh
   # Codex route: ./.ai/start-codex.sh
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
| Setup refuses the target | The directory is non-empty or its Git state conflicts with `--git init` | Preserve the directory, inspect it, then select `--git existing` or use a genuinely empty disposable path |
| Launcher is missing | A different directory was configured or Claude was not selected | Run `pwd`, inspect `.ai/cairnkeep.json`, then replay the recovery command from `cairn doctor` |
| `.ai/.env` is missing | Only the example is generated | Copy `.ai/env.example` to `.ai/.env` |
| `cairn-memory` is unavailable in Claude | L02 MCP registration is absent or stale | Run `claude mcp get cairn-memory`, repair it, then restart Claude Code |
| `cairn-memory` is unavailable in Codex | Project configuration was skipped or the project is not trusted | Review/merge `.codex/config.toml`, rerun setup, then accept project trust and relaunch |
| Slash commands are unknown | Operating assets were not loaded | Run `cairn sync --check`, apply if needed, then restart the harness |
| Recall works only in the first session | Sessions used different storage routing | Compare launchers and environment, then inspect `cairn memory path` |

## Privacy and trust boundary

Use synthetic memory in the course. The local stdio server writes to local
AgentFS/SQLite storage. Project wiki and planning files are derived artifacts;
the repository remains canonical. Optional session evidence is off in this
lesson and is introduced in L13.

## Clean up

Exit the harness before removing the disposable project:

```bash
rm -rf "$HOME/cairnkeep-course/first-project"
```

This removes project scaffolding but not the global memory store. Remove the
synthetic memory through the normal memory review/delete workflow if required.

## Optional challenge

Create another disposable Git repository and run `cairn bootstrap --untracked`
there. Inspect `.git/info/exclude` to see how the compatibility primitive keeps
contributor-mode scaffolding out of shared changes.

## Recap

- Guided setup owns target preflight, Git choice, harness selection, and a
  private reconciliation record.
- Bootstrap remains available for compatibility and contributor workflows.
- The generated launcher establishes a repeatable project environment.
- Codex memory setup is project-scoped and does not silently grant trust or
  modify the user-wide Codex configuration.
- Persistence is proven only after a new session recalls the accepted fact.

Next: [L04 - Memory fundamentals](L04-memory-fundamentals.md).
