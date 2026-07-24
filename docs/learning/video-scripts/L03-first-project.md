# L03 Video Script - Bootstrap the first project

**Target duration:** 13 minutes
**Companion lesson:** [L03](../lessons/L03-first-project.md)

## Recording setup

- Start from the completed L02 VM snapshot.
- Confirm `$HOME/cairnkeep-course/first-project` does not exist.
- Use only the synthetic UTC convention from the lesson.
- Prepare to stop and restart the harness during the recording.

## 00:00 - Hook

**Say:** “An installation is not proven by files on disk. The useful proof is a
fact accepted in one session and recalled in a new session.”

## 00:30 - Outcome

**Say:** “We will bootstrap a disposable Git repository, run diagnostics, store
one synthetic convention, restart Claude Code, and retrieve it again.”

## 01:00 - Create the project

**Do:** Run the directory, `git init`, and README commands from L03.

**Say:** “I use a disposable repository so no course artifact can reach a real
project.”

## 02:00 - Bootstrap

**Say:** “Bootstrap adds project launchers and derived-knowledge scaffolding. It
does not reinstall the machine-level MCP server or operating assets.”

**Do:** Run `cairn bootstrap "$PWD"` and copy `.ai/env.example` to `.ai/.env`.

**Point out:** The generated next steps without reading every created filename.

## 03:45 - Diagnose

**Do:** Run `cairn doctor`.

**Say:** “Optional unconfigured integrations may be skipped. A configured but
unreachable dependency is a failure and should be fixed before relying on it.”

## 05:00 - Launch and remember

**Do:** Start `./.ai/start-claude.sh`.

**Say:** “I launch through the project script so every session loads the same
project environment.”

**Do in Claude:** `/remember Course convention: examples use UTC timestamps.`

**Point out:** The durable key returned by the workflow.

## 07:00 - Recall

**Do in Claude:** `/recall UTC timestamps`

**Say:** “This confirms retrieval inside the first session, but not yet
persistence across sessions.”

## 08:00 - Persistence proof

**Do:** Exit Claude Code, run the launcher again, and repeat `/recall UTC timestamps`.

**Pause:** Keep the retrieved result visible.

**Say:** “This is the important proof. The second harness process recovered the
accepted fact from durable local storage.”

## 10:00 - Locate storage

**Do:** Exit the harness and run `cairn memory path`.

**Say:** “The command reports the local store location. Nothing in bootstrap
silently selected a remote server.”

## 11:00 - Recovery and boundary

**Say:** “If recall fails after restart, compare the launcher and environment,
check the MCP registration, and verify the storage path. Do not solve routing
problems by copying database files while the server is running.”

## 12:00 - Recap

**Say:** “We bootstrapped one project, used its launcher, and proved persistence
across a new session. The quickstart is complete. L04 will teach how to choose
keys, scopes, search, history, and the memory review gate.”

## Editing notes

- Do not cut away the harness exit/restart; it is the central proof.
- Add captions for “first session” and “second session”.
- Link L03 and L04 in the description.
